import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  DEFAULT_VOICE_MODEL,
  MAX_AUDIO_BASE64,
  OPENROUTER_CHAT_URL,
  OUTPUT_SAMPLE_RATE,
  buildTranscribeBody,
  buildVoiceBody,
  createVoiceSseParser,
  parseVoiceRequest,
  pickVoice,
  transcriptFrom,
  type VoiceRequest,
} from './voiceCore.ts';

/**
 * Live voice for the health agents, through OpenRouter.
 *   GET  /agent/voice/status  -> { configured }
 *   POST /agent/voice         -> NDJSON stream: {type:'start', sampleRate}, {type:'user', text},
 *                                {type:'audio', data}, {type:'text', text}, {type:'error', message}, {type:'done'}
 * The browser sends one spoken turn as WAV; the reply streams back as 24 kHz PCM16 with its transcript.
 * OPENROUTER_API_KEY stays in this server process (never a VITE_ variable).
 *
 * Dev/preview only: a production deployment needs the same route as an edge function.
 */
const MAX_BODY_BYTES = MAX_AUDIO_BASE64 + 160 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function fail(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

export function voiceAgent(opts: { apiKey?: string; model?: string; voice?: string }): Plugin {
  const model = opts.model?.trim() || DEFAULT_VOICE_MODEL;
  const voice = pickVoice(opts.voice);
  const headers = () => ({
    authorization: `Bearer ${opts.apiKey?.trim()}`,
    'content-type': 'application/json',
    'x-title': 'Digital Twin Biomedical',
  });

  const transcribe = async (parsed: VoiceRequest, signal: AbortSignal) => {
    const r = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildTranscribeBody(parsed, model)),
      signal,
    });
    if (!r.ok) {
      console.error(`[voice-agent] transcription HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      return '';
    }
    return transcriptFrom(await r.json());
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path === '/agent/voice/status') {
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      return res.end(JSON.stringify({ configured: Boolean(opts.apiKey?.trim()) }));
    }
    if (path !== '/agent/voice') return next();
    void (async () => {
      if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
      if (!opts.apiKey?.trim()) {
        console.error('[voice-agent] OPENROUTER_API_KEY is not set on the server.');
        return fail(res, 503, 'Voice chat is not set up yet.');
      }
      let parsed: VoiceRequest | string;
      try {
        parsed = parseVoiceRequest(JSON.parse(await readBody(req)));
      } catch {
        return fail(res, 400, 'Invalid request.');
      }
      if (typeof parsed === 'string') return fail(res, 400, parsed);

      const abort = new AbortController();
      res.on('close', () => abort.abort());
      const transcript = transcribe(parsed, abort.signal).catch(e => {
        if (!abort.signal.aborted) console.error('[voice-agent] transcription failed:', e);
        return '';
      });

      let upstream: Response;
      try {
        upstream = await fetch(OPENROUTER_CHAT_URL, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(buildVoiceBody(parsed, model, voice)),
          signal: abort.signal,
        });
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error('[voice-agent] request failed:', e);
        return fail(res, 502, 'Voice chat could not be reached. Try again in a moment.');
      }
      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '');
        console.error(`[voice-agent] upstream HTTP ${upstream.status}: ${detail.slice(0, 300)}`);
        return fail(res, 502, `Voice chat is unavailable right now (HTTP ${upstream.status}).`);
      }

      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      });
      const send = (event: object) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      };
      send({ type: 'start', sampleRate: OUTPUT_SAMPLE_RATE });
      void transcript.then(text => send({ type: 'user', text }));

      const parse = createVoiceSseParser(send);
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parse(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error('[voice-agent] stream interrupted:', e);
          send({ type: 'error', message: 'The reply was cut off. Try again.' });
        }
      }
      await transcript;
      send({ type: 'done' });
      res.end();
    })();
  };

  return {
    name: 'voice-agent',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

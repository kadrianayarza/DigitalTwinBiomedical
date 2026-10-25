import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  BITDEER_CHAT_URL,
  DEFAULT_AGENT_MODEL,
  buildUpstreamBody,
  createSseParser,
  parseAgentRequest,
} from './agentCore';

/**
 * POST /agent/chat: streams a health-agent reply from Bitdeer (DeepSeek) as plain text.
 * The API key stays in this server process (BITDEER_API_KEY in .env.local, never a
 * VITE_ variable), so the browser never sees it.
 *
 * Dev/preview only: a production deployment needs the same route as an edge function.
 */
const MAX_BODY_BYTES = 96 * 1024;

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

export function healthAgent(opts: { apiKey?: string; model?: string }): Plugin {
  const model = opts.model?.trim() || DEFAULT_AGENT_MODEL;

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split('?')[0] !== '/agent/chat') return next();
    void (async () => {
      if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
      const apiKey = opts.apiKey?.trim();
      if (!apiKey) {
        console.error('[health-agent] BITDEER_API_KEY is not set on the server.');
        return fail(res, 503, 'The health agent is not set up yet.');
      }
      let parsed;
      try {
        parsed = parseAgentRequest(JSON.parse(await readBody(req)));
      } catch {
        return fail(res, 400, 'Invalid request.');
      }
      if (typeof parsed === 'string') return fail(res, 400, parsed);

      const abort = new AbortController();
      res.on('close', () => abort.abort());
      let upstream: Response;
      try {
        upstream = await fetch(BITDEER_CHAT_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(buildUpstreamBody(parsed, model)),
          signal: abort.signal,
        });
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error('[health-agent] request failed:', e);
        return fail(res, 502, 'The health agent could not be reached. Try again in a moment.');
      }
      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '');
        console.error(`[health-agent] upstream HTTP ${upstream.status}: ${detail.slice(0, 300)}`);
        return fail(res, 502, `The health agent is unavailable right now (HTTP ${upstream.status}).`);
      }

      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      });
      const parse = createSseParser(text => res.write(text));
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parse(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        if (!abort.signal.aborted) console.error('[health-agent] stream interrupted:', e);
      }
      res.end();
    })();
  };

  return {
    name: 'health-agent',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

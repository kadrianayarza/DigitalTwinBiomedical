import { base64ToBytes, bytesToBase64, createPcm16Decoder, createVad, encodeWav, resample, rms } from './audio';

export type VoiceState = 'starting' | 'listening' | 'hearing' | 'thinking' | 'speaking';
type Turn = { role: 'user' | 'assistant'; content: string };

export type VoiceCallbacks = {
  onState: (s: VoiceState) => void;
  /** A spoken turn was sent; returns an id used by the text callbacks below. */
  onTurn: () => number;
  onUserText: (turn: number, text: string) => void;
  onAgentText: (turn: number, chunk: string) => void;
  onTurnEnd: (turn: number) => void;
  onError: (message: string) => void;
  history: () => Turn[];
  context: () => string;
  audience: 'patient' | 'nurse';
};

const SEND_RATE = 16000;
const PREROLL_MS = 400;
const MAX_TURN_MS = 40_000;

const TAP_WORKLET = `
class TwinMicTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('twin-mic-tap', TwinMicTap);`;

let statusPromise: Promise<boolean> | null = null;
/** Whether the server has a voice key; asked once per page load. */
export function voiceAvailable(): Promise<boolean> {
  statusPromise ??= fetch('/agent/voice/status')
    .then(r => (r.ok ? r.json() : { configured: false }))
    .then((j: { configured?: boolean }) => Boolean(j.configured))
    .catch(() => false);
  return statusPromise;
}

/** Plays streamed PCM16 gaplessly and can be cut off mid-sentence. */
class PcmPlayer {
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private decode = createPcm16Decoder();
  constructor(
    private ctx: AudioContext,
    private rate: number,
    private onIdle: () => void
  ) {}
  get playing() {
    return this.sources.size > 0;
  }
  push(b64: string) {
    const samples = this.decode(base64ToBytes(b64));
    if (!samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, this.rate);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime + (this.sources.size ? 0.01 : 0.12), this.next);
    src.start(startAt);
    this.next = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.onIdle();
    };
  }
  stop() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear();
    this.next = 0;
    this.decode = createPcm16Decoder();
  }
}

/** One hands-free voice conversation: listens, sends each finished turn, plays the reply. */
export class VoiceSession {
  level = 0;
  muted = false;
  private state: VoiceState = 'starting';
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private vad = createVad({ frameMs: 0 });
  private preroll: Float32Array[] = [];
  private prerollSamples = 0;
  private utterance: Float32Array[] = [];
  private utteranceSamples = 0;
  private request: AbortController | null = null;
  private player: PcmPlayer | null = null;
  private replyDone = true;
  private closed = false;

  constructor(private cb: VoiceCallbacks) {}

  /** Call from a click handler so the browser lets audio start. */
  async start() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    void ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      this.close();
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      throw new Error(
        denied
          ? 'Microphone access is blocked. Allow it from the icon in the address bar, then try again.'
          : 'No microphone was found.'
      );
    }
    if (this.closed) return this.close();
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    if (this.closed) return this.close();
    const source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'twin-mic-tap');
    this.vad = createVad({ frameMs: (128 / ctx.sampleRate) * 1000 });
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data);
    source.connect(this.node);
    this.player = new PcmPlayer(ctx, 24000, () => this.onPlaybackIdle());
    this.setState('listening');
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach(t => (t.enabled = !muted));
    if (muted && this.state === 'hearing') {
      this.vad.reset();
      this.utterance = [];
      this.utteranceSamples = 0;
      this.setState('listening');
    }
  }

  /** Stops the agent mid-reply and goes back to listening. */
  interrupt() {
    this.request?.abort();
    this.player?.stop();
    this.replyDone = true;
    this.vad.reset();
    this.setState('listening');
  }

  close() {
    this.closed = true;
    this.request?.abort();
    this.player?.stop();
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private setState(s: VoiceState) {
    if (this.state === s || this.closed) return;
    this.state = s;
    this.cb.onState(s);
  }

  private onFrame(frame: Float32Array) {
    if (this.closed || !this.ctx) return;
    const level = this.muted ? 0 : rms(frame);
    this.level = level;
    const agentTalking = this.state === 'thinking' || this.state === 'speaking';
    const ev = this.vad.push(level, agentTalking);

    if (ev === 'barge') {
      this.request?.abort();
      this.player?.stop();
      this.replyDone = true;
      this.beginUtterance(frame);
      return;
    }
    if (agentTalking) return;

    if (this.state === 'hearing') {
      this.utterance.push(frame);
      this.utteranceSamples += frame.length;
      const ms = (this.utteranceSamples / this.ctx.sampleRate) * 1000;
      if (ev === 'end' || ms >= MAX_TURN_MS) {
        if (ms >= MAX_TURN_MS) this.vad.reset();
        this.sendUtterance();
      } else if (ev === 'discard') {
        this.utterance = [];
        this.utteranceSamples = 0;
        this.setState('listening');
      }
      return;
    }

    this.preroll.push(frame);
    this.prerollSamples += frame.length;
    const keep = (PREROLL_MS / 1000) * this.ctx.sampleRate;
    while (this.prerollSamples - (this.preroll[0]?.length ?? 0) > keep)
      this.prerollSamples -= this.preroll.shift()!.length;
    if (ev === 'start') this.beginUtterance();
  }

  private beginUtterance(frame?: Float32Array) {
    this.utterance = [...this.preroll, ...(frame ? [frame] : [])];
    this.utteranceSamples = this.utterance.reduce((n, f) => n + f.length, 0);
    this.preroll = [];
    this.prerollSamples = 0;
    this.setState('hearing');
  }

  private sendUtterance() {
    const ctx = this.ctx!;
    const all = new Float32Array(this.utteranceSamples);
    let at = 0;
    for (const f of this.utterance) {
      all.set(f, at);
      at += f.length;
    }
    this.utterance = [];
    this.utteranceSamples = 0;
    const audio = bytesToBase64(encodeWav(resample(all, ctx.sampleRate, SEND_RATE), SEND_RATE));
    this.setState('thinking');
    void this.ask(audio);
  }

  private async ask(audio: string) {
    const abort = new AbortController();
    this.request = abort;
    this.replyDone = false;
    const turn = this.cb.onTurn();
    try {
      const res = await fetch('/agent/voice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          audience: this.cb.audience,
          messages: this.cb.history(),
          context: this.cb.context(),
          audio,
        }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.trim()) this.onEvent(turn, JSON.parse(line));
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        this.cb.onError(e instanceof Error ? e.message : String(e));
        this.player?.stop();
      }
    } finally {
      if (this.request === abort) {
        this.request = null;
        this.replyDone = true;
        if (!this.player?.playing && (this.state === 'thinking' || this.state === 'speaking'))
          this.setState('listening');
      }
      this.cb.onTurnEnd(turn);
    }
  }

  private onEvent(turn: number, ev: { type: string; text?: string; data?: string; message?: string }) {
    if (ev.type === 'user' && typeof ev.text === 'string') this.cb.onUserText(turn, ev.text);
    else if (ev.type === 'text' && ev.text) this.cb.onAgentText(turn, ev.text);
    else if (ev.type === 'audio' && ev.data) {
      this.player?.push(ev.data);
      this.setState('speaking');
    } else if (ev.type === 'error' && ev.message) this.cb.onError(ev.message);
  }

  private onPlaybackIdle() {
    if (this.replyDone && this.state === 'speaking') {
      this.vad.reset();
      this.setState('listening');
    }
  }
}

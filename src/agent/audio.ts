// Pure audio helpers for voice chat: resampling, WAV encoding and PCM16 decoding.

/** Linear-interpolation resample of mono samples (good enough for speech going to a recognizer). */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decodes streamed little-endian PCM16 into floats. Network chunks can split a sample in half,
 * so a trailing odd byte is carried into the next call.
 */
export function createPcm16Decoder() {
  let carry: number | null = null;
  return (chunk: Uint8Array): Float32Array => {
    let bytes = chunk;
    if (carry !== null) {
      bytes = new Uint8Array(chunk.length + 1);
      bytes[0] = carry;
      bytes.set(chunk, 1);
      carry = null;
    }
    if (bytes.length % 2) {
      carry = bytes[bytes.length - 1]!;
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(bytes.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
    return out;
  };
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / (frame.length || 1));
}

export type VadState = 'idle' | 'speech';
export type VadEvent = 'start' | 'end' | 'discard' | 'barge' | null;

/**
 * Energy-based turn detection with an adaptive noise floor. Feed it one RMS value per frame;
 * it reports when speech starts, when a turn ends after trailing silence, and (while the agent
 * is talking) when the user talks over it loudly enough to count as an interruption.
 */
export function createVad(opts: {
  frameMs: number;
  startMs?: number;
  endMs?: number;
  minSpeechMs?: number;
  bargeMs?: number;
}) {
  const startMs = opts.startMs ?? 140;
  const endMs = opts.endMs ?? 900;
  const minSpeechMs = opts.minSpeechMs ?? 350;
  const bargeMs = opts.bargeMs ?? 320;
  let noise = 0.004;
  let state: VadState = 'idle';
  let above = 0;
  let silence = 0;
  let voiced = 0;
  let loud = 0;

  const threshold = () => Math.min(0.08, Math.max(0.014, noise * 3.5));

  return {
    get state() {
      return state;
    },
    get threshold() {
      return threshold();
    },
    reset() {
      state = 'idle';
      above = silence = voiced = loud = 0;
    },
    /** `agentTalking` switches to interruption detection with a much higher bar, since speakers echo. */
    push(level: number, agentTalking = false): VadEvent {
      const t = threshold();
      if (agentTalking) {
        loud = level > Math.max(0.06, t * 2.5) ? loud + opts.frameMs : 0;
        if (loud >= bargeMs) {
          loud = 0;
          state = 'speech';
          above = silence = 0;
          voiced = bargeMs;
          return 'barge';
        }
        return null;
      }
      if (state === 'idle') {
        if (level > t) {
          above += opts.frameMs;
          if (above >= startMs) {
            state = 'speech';
            voiced = above;
            silence = 0;
            return 'start';
          }
        } else {
          above = 0;
          noise = noise * 0.97 + Math.min(level, 0.05) * 0.03;
        }
        return null;
      }
      if (level > t * 0.6) {
        silence = 0;
        voiced += opts.frameMs;
      } else silence += opts.frameMs;
      if (silence >= endMs) {
        const enough = voiced >= minSpeechMs;
        state = 'idle';
        above = silence = voiced = 0;
        return enough ? 'end' : 'discard';
      }
      return null;
    },
  };
}

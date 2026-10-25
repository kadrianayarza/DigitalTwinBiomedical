import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typings for the Web Speech API, which is not in the standard DOM lib.
type SpeechAlternative = { transcript: string; confidence: number };
type SpeechResult = { 0: SpeechAlternative; isFinal: boolean; length: number };
type SpeechEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
};
type SpeechErrorEvent = { error: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export type Speech = {
  supported: boolean;
  listening: boolean;
  /** Text recognized so far in this turn, updated live. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
};

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in your browser settings and try again.',
  'service-not-allowed': 'Speech recognition is unavailable in this browser.',
  'no-speech': 'Nothing was heard. Try again and speak a little closer to the microphone.',
  'audio-capture': 'No microphone was found. Check that one is connected.',
  network: 'Speech recognition needs a network connection.',
  aborted: '',
};

/**
 * Live speech recognition. Final results are passed to `onFinal` one turn at a time;
 * interim text is exposed so the UI can show what is being heard.
 */
export function useSpeech(onFinal: (transcript: string) => void, lang = 'en-US'): Speech {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const supported = typeof window !== 'undefined' && !!recognitionCtor();

  useEffect(() => {
    if (!supported) return;
    const Ctor = recognitionCtor()!;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = event => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const said = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const text = said.trim();
          if (text) finalRef.current(text);
        } else {
          live += said;
        }
      }
      setInterim(live);
    };
    rec.onerror = event => {
      const message = ERROR_TEXT[event.error];
      if (message !== '') setError(message ?? `Speech error: ${event.error}`);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };

    recRef.current = rec;
    return () => {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Aborting a recognition that never started throws; nothing to clean up.
      }
      recRef.current = null;
    };
  }, [lang, supported]);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    setError(null);
    setInterim('');
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if recognition is already running; treat that as listening.
      setListening(true);
    }
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      // Stopping when not started is harmless.
    }
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setInterim('');
  }, []);

  return { supported, listening, interim, error, start, stop, reset };
}

/**
 * Match a spoken yes or no to a decision. Used so a patient can confirm a proposal by
 * speaking instead of tapping.
 */
export function spokenDecision(transcript: string): boolean | undefined {
  const text = transcript.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (/\b(no|nope|nah|don'?t|do not|stop|reject|wrong|incorrect|never mind|nevermind)\b/.test(text)) {
    return false;
  }
  if (/\b(yes|yeah|yep|yup|correct|confirm|confirmed|right|sure|ok|okay|exactly|that'?s right|affirmative)\b/.test(text)) {
    return true;
  }
  return undefined;
}
// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

type Synth = {
  speak: (u: SpeechSynthesisUtterance) => void;
  cancel: () => void;
  getVoices: () => SpeechSynthesisVoice[];
};

function synth(): Synth | undefined {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? (window.speechSynthesis as Synth)
    : undefined;
}

export type Tts = {
  supported: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  speaking: boolean;
  /** Speak text aloud; onEnd runs once the utterance actually finished. */
  speak: (text: string, onEnd?: () => void) => void;
  stop: () => void;
  /** True when a transcript is just the bot hearing its own words over speakers. */
  echoOf: (transcript: string) => boolean;
};

const TTS_KEY = 'twincare.voice-tts';

/**
 * The assistant's voice. Speaks replies and questions aloud so the conversation can be
 * hands-free, with a persisted on/off switch the user controls.
 */
export function useTts(): Tts {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(TTS_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [speaking, setSpeaking] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onEndRef = useRef<(() => void) | null>(null);
  const lastSpokenRef = useRef('');
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Never leave a voice running after the component that asked for it is gone.
  useEffect(() => {
    return () => {
      onEndRef.current = null;
      try {
        synth()?.cancel();
      } catch {
        // Cancelling an idle synth throws on some browsers; nothing to clean up.
      }
    };
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(TTS_KEY, on ? 'on' : 'off');
    } catch {
      // Private browsing blocks localStorage; the toggle still works for this visit.
    }
    if (!on) {
      onEndRef.current = null;
      try {
        synth()?.cancel();
      } catch {
        // Same as above.
      }
      setSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      const engine = synth();
      const clean = text.trim();
      if (!enabledRef.current || !engine || !clean) return;
      // A cancelled utterance fires onend too; detach the old callback before cancelling.
      onEndRef.current = null;
      try {
        engine.cancel();
      } catch {
        // An idle synth may throw on cancel; the new utterance still goes out.
      }
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = 'en-US';
      const voices = engine.getVoices();
      const voice =
        voices.find(v => v.lang.startsWith('en') && /natural|google|neural/i.test(v.name)) ??
        voices.find(v => v.lang.startsWith('en'));
      if (voice) u.voice = voice;
      lastSpokenRef.current = clean;
      onEndRef.current = onEnd ?? null;
      u.onend = () => {
        if (utterRef.current !== u) return; // A newer utterance took over.
        setSpeaking(false);
        const cb = onEndRef.current;
        onEndRef.current = null;
        cb?.();
      };
      u.onerror = () => {
        if (utterRef.current !== u) return;
        setSpeaking(false);
      };
      // Keep a reference so Chrome does not garbage-collect the utterance mid-sentence.
      utterRef.current = u;
      setSpeaking(true);
      engine.speak(u);
    },
    []
  );

  const stop = useCallback(() => {
    onEndRef.current = null;
    try {
      synth()?.cancel();
    } catch {
      // Nothing is speaking; nothing to stop.
    }
    setSpeaking(false);
  }, []);

  const echoOf = useCallback((transcript: string) => {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const said = norm(transcript);
    const spoke = norm(lastSpokenRef.current);
    if (!said || !spoke) return false;
    return said.length >= 6 && (spoke.includes(said) || said.includes(spoke));
  }, []);

  return { supported, enabled, setEnabled, speaking, speak, stop, echoOf };
}

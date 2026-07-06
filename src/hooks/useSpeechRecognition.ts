import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(getSpeechRecognitionCtor());
}

export function useSpeechRecognition(options?: {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (code: string) => void;
}) {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const pendingTranscriptRef = useRef('');
  const finalSentRef = useRef(false);
  const listeningRef = useRef(false);

  const onInterimRef = useRef(options?.onInterim);
  const onFinalRef = useRef(options?.onFinal);
  const onErrorRef = useRef(options?.onError);
  onInterimRef.current = options?.onInterim;
  onFinalRef.current = options?.onFinal;
  onErrorRef.current = options?.onError;

  const lang = options?.lang || 'en-IN';

  const setListening = useCallback((value: boolean) => {
    listeningRef.current = value;
    setIsListening(value);
  }, []);

  const flushPendingTranscript = useCallback(() => {
    if (finalSentRef.current) return;
    const text = pendingTranscriptRef.current.trim();
    if (!text) return;
    finalSentRef.current = true;
    pendingTranscriptRef.current = '';
    setInterimTranscript('');
    onFinalRef.current?.(text);
  }, []);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) {
      flushPendingTranscript();
      setListening(false);
      setInterimTranscript('');
      return;
    }
    try {
      rec.stop();
    } catch {
      flushPendingTranscript();
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript('');
    }
  }, [flushPendingTranscript, setListening]);

  /** Must stay synchronous through recognition.start() — async breaks Chrome user-gesture. */
  const startListening = useCallback(() => {
    if (listeningRef.current) {
      stopListening();
      return;
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      onErrorRef.current?.('not-supported');
      return;
    }

    if (!window.isSecureContext) {
      onErrorRef.current?.('insecure-context');
      return;
    }

    pendingTranscriptRef.current = '';
    finalSentRef.current = false;
    setInterimTranscript('');

    const recognition = new Ctor();
    recognitionRef.current = recognition;
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalChunk += transcript;
        else interim += transcript;
      }

      const trimmedFinal = finalChunk.trim();
      if (trimmedFinal) {
        pendingTranscriptRef.current = [pendingTranscriptRef.current, trimmedFinal]
          .filter(Boolean)
          .join(' ')
          .trim();
      }

      const display = (pendingTranscriptRef.current + (interim ? ` ${interim}` : '')).trim();
      if (display) {
        pendingTranscriptRef.current = display;
        setInterimTranscript(display);
        onInterimRef.current?.(display);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || 'unknown';
      if (code !== 'aborted') {
        onErrorRef.current?.(code);
      }
      recognitionRef.current = null;
      setListening(false);
      pendingTranscriptRef.current = '';
      finalSentRef.current = false;
    };

    recognition.onend = () => {
      flushPendingTranscript();
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript('');
      finalSentRef.current = false;
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      onErrorRef.current?.('start-failed');
    }
  }, [flushPendingTranscript, lang, setListening, stopListening]);

  useEffect(() => () => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }, []);

  return {
    isSupported: isSpeechRecognitionSupported(),
    isListening,
    interimTranscript,
    startListening,
    stopListening,
  };
}

export function speakText(text: string, enabled = true) {
  if (!enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
  const plain = text.replace(/\*\*/g, '').replace(/[#_`]/g, '').replace(/\n+/g, '. ');
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(plain);
  utterance.lang = 'en-IN';
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

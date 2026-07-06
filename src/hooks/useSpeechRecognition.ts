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

/** Check at call time — some embedded browsers expose API only after user gesture. */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(getSpeechRecognitionCtor());
}

export function useSpeechRecognition(options?: {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (code: string) => void;
  onListeningChange?: (listening: boolean) => void;
}) {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pendingTranscriptRef = useRef('');
  const finalSentRef = useRef(false);
  const listeningRef = useRef(false);

  const onInterimRef = useRef(options?.onInterim);
  const onFinalRef = useRef(options?.onFinal);
  const onErrorRef = useRef(options?.onError);
  const onListeningChangeRef = useRef(options?.onListeningChange);
  onInterimRef.current = options?.onInterim;
  onFinalRef.current = options?.onFinal;
  onErrorRef.current = options?.onError;
  onListeningChangeRef.current = options?.onListeningChange;

  const lang = options?.lang || 'en-IN';

  const releaseMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const setListening = useCallback((value: boolean) => {
    listeningRef.current = value;
    setIsListening(value);
    onListeningChangeRef.current?.(value);
  }, []);

  const flushPendingTranscript = useCallback(() => {
    if (finalSentRef.current) return;
    const text = pendingTranscriptRef.current.trim();
    if (!text) return;
    finalSentRef.current = true;
    pendingTranscriptRef.current = '';
    onFinalRef.current?.(text);
    setInterimTranscript('');
  }, []);

  const stopListening = useCallback(() => {
    flushPendingTranscript();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.onstart = null;
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    }
    releaseMediaStream();
    setListening(false);
    setInterimTranscript('');
  }, [flushPendingTranscript, releaseMediaStream, setListening]);

  const startListening = useCallback(async () => {
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

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch {
      onErrorRef.current?.('not-allowed');
      return;
    }

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
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }

      const combined = (finalText || interim).trim();
      if (combined) {
        pendingTranscriptRef.current = combined;
        setInterimTranscript(combined);
        onInterimRef.current?.(combined);
      }

      if (finalText.trim()) {
        finalSentRef.current = true;
        pendingTranscriptRef.current = '';
        setInterimTranscript('');
        onFinalRef.current?.(finalText.trim());
        try {
          recognition.stop();
        } catch {
          /* ignore */
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || 'unknown';
      if (code !== 'aborted') {
        onErrorRef.current?.(code);
      }
      releaseMediaStream();
      recognitionRef.current = null;
      setListening(false);
      pendingTranscriptRef.current = '';
      finalSentRef.current = false;
    };

    recognition.onend = () => {
      flushPendingTranscript();
      releaseMediaStream();
      recognitionRef.current = null;
      setListening(false);
      finalSentRef.current = false;
    };

    try {
      recognition.start();
    } catch {
      releaseMediaStream();
      recognitionRef.current = null;
      setListening(false);
      onErrorRef.current?.('start-failed');
    }
  }, [flushPendingTranscript, lang, releaseMediaStream, setListening, stopListening]);

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
    releaseMediaStream();
  }, [releaseMediaStream]);

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

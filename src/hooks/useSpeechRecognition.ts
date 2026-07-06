import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function speechRecognitionAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  return Boolean(getSpeechRecognition());
}

export function useSpeechRecognition(options?: {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (code: string) => void;
}) {
  const [isSupported] = useState(speechRecognitionAvailable);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const onInterimRef = useRef(options?.onInterim);
  const onFinalRef = useRef(options?.onFinal);
  const onErrorRef = useRef(options?.onError);
  onInterimRef.current = options?.onInterim;
  onFinalRef.current = options?.onFinal;
  onErrorRef.current = options?.onError;

  const lang = options?.lang || 'en-IN';

  const stopListening = useCallback(() => {
    listeningRef.current = false;
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
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const startListening = useCallback(async () => {
    if (listeningRef.current) {
      stopListening();
      return;
    }

    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      onErrorRef.current?.('not-supported');
      return;
    }

    if (!window.isSecureContext) {
      onErrorRef.current?.('insecure-context');
      return;
    }

    // Prime the mic — required on many browsers before SpeechRecognition will capture.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      }
    } catch {
      onErrorRef.current?.('not-allowed');
      return;
    }

    const recognition = new Ctor();
    recognitionRef.current = recognition;
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listeningRef.current = true;
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }

      const display = (finalText || interim).trim();
      setInterimTranscript(display);
      if (display) onInterimRef.current?.(display);

      if (finalText.trim()) {
        onFinalRef.current?.(finalText.trim());
        setInterimTranscript('');
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || 'unknown';
      if (code !== 'aborted') {
        onErrorRef.current?.(code);
      }
      listeningRef.current = false;
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      listeningRef.current = false;
      setIsListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch {
      listeningRef.current = false;
      setIsListening(false);
      recognitionRef.current = null;
      onErrorRef.current?.('start-failed');
    }
  }, [lang, stopListening]);

  useEffect(() => () => stopListening(), [stopListening]);

  return { isSupported, isListening, interimTranscript, startListening, stopListening };
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

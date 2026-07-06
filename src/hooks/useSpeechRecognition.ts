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

export function useSpeechRecognition(options?: {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (code: string) => void;
}) {
  const [isSupported] = useState(() => Boolean(getSpeechRecognition()));
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onInterimRef = useRef(options?.onInterim);
  const onFinalRef = useRef(options?.onFinal);
  const onErrorRef = useRef(options?.onError);
  onInterimRef.current = options?.onInterim;
  onFinalRef.current = options?.onFinal;
  onErrorRef.current = options?.onError;

  useEffect(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = options?.lang || 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

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

    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: Event) => {
      setIsListening(false);
      const code = (event as SpeechRecognitionErrorEvent).error || 'unknown';
      onErrorRef.current?.(code);
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [options?.lang]);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || isListening) return;
    setInterimTranscript('');
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimTranscript('');
  }, []);

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

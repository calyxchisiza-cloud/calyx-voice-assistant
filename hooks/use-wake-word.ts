'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionEventLike extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function useWakeWord(onWakeWord: () => void) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const startRef = useRef<() => void>(() => undefined);
  const shouldRunRef = useRef(false);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const speechWindow = window as WindowWithSpeechRecognition;
    setSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
  }, []);

  const stop = useCallback(() => {
    shouldRunRef.current = false;
    setEnabled(false);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const start = useCallback(() => {
    const speechWindow = window as WindowWithSpeechRecognition;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setError('Wake-word listening is not available in this browser. Start a voice session manually instead.');
      setEnabled(false);
      return;
    }

    if (recognitionRef.current) return;

    setError(null);
    shouldRunRef.current = true;
    setEnabled(true);
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      if (/\bhey\s+calyx\b/i.test(transcript)) {
        shouldRunRef.current = false;
        recognition.stop();
        recognitionRef.current = null;
        setEnabled(false);
        onWakeWord();
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(`Wake-word detection stopped: ${event.error}. You can still start a session manually.`);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (shouldRunRef.current) {
        window.setTimeout(() => {
          if (!shouldRunRef.current) return;
          startRef.current();
        }, 300);
      } else {
        setEnabled(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setEnabled(false);
      setError('Wake-word detection could not start. Check microphone permission and try again.');
    }
  }, [onWakeWord]);

  startRef.current = start;

  useEffect(() => () => {
    shouldRunRef.current = false;
    recognitionRef.current?.stop();
  }, []);

  return { supported, enabled, error, start, stop };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FREE_MODE_GREETING,
  getUserFacingError,
  GreetingMode,
  SessionStatus,
  SupportedVoice,
  TranscriptMessage,
} from '@/lib/realtime';
import { runSkill, SkillAction } from '@/lib/skills';
import { isAffirmative, isNegative, type SystemRequest } from '@/lib/system';

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
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type Turn = { role: 'user' | 'assistant'; text: string };

type PendingAction = {
  question: string;
  request: SystemRequest;
  expiresAt: number;
};

type SkillExecution = { speak: string; display?: string };

const AUDIO_SAMPLE_RATE = 24_000;
const BARGE_IN_LEVEL = 0.16;
const BARGE_IN_FRAMES = 8;
const BARGE_IN_SETTLE_MS = 450;

/**
 * Speech recognition reports "network" when the service is momentarily
 * unreachable. In practice it usually succeeds on the next attempt, so a single
 * blip must not be presented as voice being broken.
 */
const NETWORK_WARNING = 'Speech recognition lost contact with the speech service. Still listening — if this keeps happening, check your connection.';
const NETWORK_FAILURES_BEFORE_GIVING_UP = 3;

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickSpeechVoice(voices: SpeechSynthesisVoice[], preferred: SupportedVoice) {
  if (voices.length === 0) return null;
  const english = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  const preferredMatch = pool.find((voice) => voice.name.toLowerCase().includes(preferred));
  if (preferredMatch) return preferredMatch;
  const friendly = ['google us english', 'microsoft aria', 'microsoft jenny', 'microsoft zira', 'samantha', 'daniel'];
  for (const needle of friendly) {
    const match = pool.find((voice) => voice.name.toLowerCase().includes(needle));
    if (match) return match;
  }
  return pool.find((voice) => voice.default) || pool[0] || null;
}

export function useFreeSession() {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [outputReady, setOutputReady] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionRunningRef = useRef(false);
  const networkErrorStreakRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const startInFlightRef = useRef(false);
  const epochRef = useRef(0);
  const statusRef = useRef<SessionStatus>('idle');
  const voiceRef = useRef<SupportedVoice>('marin');
  const greetingModeRef = useRef<GreetingMode>('sometimes');
  const voiceInterruptRef = useRef(true);
  const bargeFramesRef = useRef(0);
  const speakStartedAtRef = useRef(0);
  const interruptRef = useRef<() => void>(() => undefined);
  const timerIdsRef = useRef<number[]>([]);
  const startListeningRef = useRef<() => void>(() => undefined);
  const runTurnRef = useRef<(text: string) => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);
  const pendingRef = useRef<PendingAction | null>(null);

  const updateStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    const loop = () => {
      const analyser = analyserRef.current;
      let level = 0;
      if (analyser) {
        const values = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(values);
        let total = 0;
        for (const value of values) {
          const normalized = (value - 128) / 128;
          total += normalized * normalized;
        }
        level = Math.min(1, Math.sqrt(total / values.length) * 2.6);
      }
      setInputLevel(level);

      // Voice interruption: while CALYX is speaking, a sustained burst of
      // sound stops playback and hands the microphone back to the user.
      const speaking = statusRef.current === 'speaking';
      const settled = Date.now() - speakStartedAtRef.current > BARGE_IN_SETTLE_MS;
      if (activeRef.current && speaking && voiceInterruptRef.current && settled && level > BARGE_IN_LEVEL) {
        bargeFramesRef.current += 1;
        if (bargeFramesRef.current >= BARGE_IN_FRAMES) {
          bargeFramesRef.current = 0;
          interruptRef.current();
        }
      } else {
        bargeFramesRef.current = 0;
      }

      setOutputLevel((current) => {
        const target = statusRef.current === 'speaking' ? 0.32 + 0.26 * Math.abs(Math.sin(Date.now() / 220)) : 0;
        return Math.abs(current - target) < 0.02 ? target : current + (target - current) * 0.3;
      });
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const stopRecognition = useCallback(() => {
    recognitionRunningRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // The recognition instance may already be inactive.
      }
    }
  }, []);

  const speak = useCallback((text: string) => new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const chosen = pickSpeechVoice(synth.getVoices(), voiceRef.current);
    if (chosen) {
      utterance.voice = chosen;
      utterance.lang = chosen.lang || 'en-US';
    }
    utterance.rate = 1;
    utterance.pitch = 1;
    setOutputReady(true);
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    bargeFramesRef.current = 0;
    speakStartedAtRef.current = Date.now();
    synth.speak(utterance);
  }), []);

  const stop = useCallback(() => {
    activeRef.current = false;
    busyRef.current = false;
    startInFlightRef.current = false;
    epochRef.current += 1;
    stopRecognition();
    timerIdsRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timerIdsRef.current = [];
    pendingRef.current = null;
    bargeFramesRef.current = 0;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close();
    turnsRef.current = [];
    setInputLevel(0);
    setOutputLevel(0);
    setMicrophoneReady(false);
    setOutputReady(false);
    updateStatus('idle');
  }, [stopRecognition, updateStatus]);

  stopRef.current = stop;

  // Speak an out-of-band announcement (for example a finished timer) once the
  // current turn has finished, then hand the microphone back to the user.
  const announce = useCallback((text: string) => {
    void (async () => {
      for (let attempt = 0; attempt < 40 && busyRef.current; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (!activeRef.current || !text) return;
      const myEpoch = epochRef.current;
      busyRef.current = true;
      stopRecognition();
      setMessages((current) => [...current, { id: makeId('assistant'), role: 'assistant', text }]);
      updateStatus('speaking');
      await speak(text);
      if (myEpoch !== epochRef.current) return;
      busyRef.current = false;
      updateStatus('listening');
      startListeningRef.current();
    })();
  }, [speak, stopRecognition, updateStatus]);

  const applySkillAction = useCallback(async (action: SkillAction | undefined): Promise<SkillExecution | null> => {
    if (!action) return null;
    if (action.type === 'open-url') {
      try {
        const opened = window.open(action.url, '_blank');
        if (opened) opened.opener = null;
      } catch {
        // Pop-up blocked — the transcript still carries a clickable link.
      }
      return null;
    }
    if (action.type === 'open-email') {
      // A hidden anchor hands the mailto: URL to the default mail app without
      // navigating the CALYX page away.
      try {
        const url = `mailto:${action.to}?subject=${encodeURIComponent(action.subject)}&body=${encodeURIComponent(action.body)}`;
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } catch {
        // The transcript still carries a clickable mailto link.
      }
      return null;
    }
    if (action.type === 'timer') {
      const timerId = window.setTimeout(() => {
        timerIdsRef.current = timerIdsRef.current.filter((id) => id !== timerId);
        announce(`Your ${action.label} timer is finished.`);
      }, action.durationMs);
      timerIdsRef.current.push(timerId);
      return null;
    }
    if (action.type === 'system') {
      try {
        const response = await fetch('/api/system', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(action.request),
          signal: AbortSignal.timeout(35_000),
        });
        const data = (await response.json()) as { ok?: boolean; reply?: string; output?: string };
        const reply = data.reply || (response.ok ? 'Done.' : 'That system action failed.');
        if (data.output) return { speak: reply, display: `${reply}\n\n${data.output}` };
        return { speak: reply };
      } catch {
        return { speak: 'I could not reach the system bridge. Make sure CALYX is still running on this PC.' };
      }
    }
    return null;
  }, [announce]);

  const runTurn = useCallback((rawText: string) => {
    const text = rawText.trim();
    if (!text || !activeRef.current || busyRef.current) return;
    busyRef.current = true;
    stopRecognition();
    const myEpoch = epochRef.current;
    turnsRef.current = [...turnsRef.current, { role: 'user', text }];
    setMessages((current) => [...current, { id: makeId('user'), role: 'user', text }]);
    updateStatus('thinking');

    const finishTurn = async (reply: string, display?: string, link?: { url: string; label: string }) => {
      turnsRef.current = [...turnsRef.current, { role: 'assistant', text: display || reply }];
      setMessages((current) => [...current, { id: makeId('assistant'), role: 'assistant', text: display || reply, link }]);
      updateStatus('speaking');
      await speak(reply);
      if (myEpoch !== epochRef.current) return;
      busyRef.current = false;
      updateStatus('listening');
      startListeningRef.current();
    };

    void (async () => {
      try {
        // A destructive action is waiting on a spoken yes/no. Only an explicit
        // affirmative runs it; "no" cancels, and anything else cancels and is
        // handled as a fresh request.
        const pending = pendingRef.current;
        if (pending) {
          const expired = Date.now() > pending.expiresAt;
          pendingRef.current = null;
          if (expired && isAffirmative(text)) {
            await finishTurn('That confirmation expired. Ask me again.');
            return;
          }
          if (!expired && isAffirmative(text)) {
            const execution = await applySkillAction({ type: 'system', request: pending.request });
            if (myEpoch !== epochRef.current) return;
            if (execution) await finishTurn(execution.speak, execution.display);
            else await finishTurn('Done.');
            return;
          }
          if (!expired && isNegative(text)) {
            await finishTurn('Cancelled.');
            return;
          }
        }

        const skill = await runSkill(text);
        if (myEpoch !== epochRef.current) return;

        if (skill?.confirmation) {
          pendingRef.current = {
            question: skill.confirmation.question,
            request: skill.confirmation.request,
            expiresAt: Date.now() + (skill.confirmation.ttlMs ?? 20_000),
          };
          await finishTurn(skill.confirmation.question);
          return;
        }

        if (skill) {
          if (skill.action?.type === 'stop-speaking') {
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
            busyRef.current = false;
            updateStatus('listening');
            startListeningRef.current();
            return;
          }

          if (skill.action?.type === 'clear-conversation') {
            turnsRef.current = [];
            pendingRef.current = null;
            setMessages([]);
          }

          const execution = await applySkillAction(skill.action);
          if (myEpoch !== epochRef.current) return;
          const reply = execution?.speak ?? skill.reply;
          if (reply) {
            turnsRef.current = [...turnsRef.current, { role: 'assistant', text: execution?.display || reply }];
            setMessages((current) => [
              ...current,
              { id: makeId('assistant'), role: 'assistant', text: execution?.display || reply, link: skill.link },
            ]);
            updateStatus('speaking');
            await speak(reply);
          }

          if (myEpoch !== epochRef.current) return;
          busyRef.current = false;
          updateStatus('listening');
          startListeningRef.current();
          return;
        }

        const response = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ messages: turnsRef.current }),
        });
        const data = (await response.json()) as { reply?: string; error?: string };
        if (myEpoch !== epochRef.current) return;
        if (!response.ok || !data.reply) throw new Error(data.error || 'The assistant could not reply. Try again.');

        const reply = data.reply;
        turnsRef.current = [...turnsRef.current, { role: 'assistant', text: reply }];
        setMessages((current) => [...current, { id: makeId('assistant'), role: 'assistant', text: reply }]);
        updateStatus('speaking');
        await speak(reply);
        if (myEpoch !== epochRef.current) return;
        busyRef.current = false;
        updateStatus('listening');
        startListeningRef.current();
      } catch (caughtError) {
        if (myEpoch !== epochRef.current) return;
        const message = getUserFacingError(caughtError);
        stopRef.current();
        setError(message);
        updateStatus('error');
      }
    })();
  }, [applySkillAction, speak, stopRecognition, updateStatus]);

  runTurnRef.current = runTurn;

  const startListening = useCallback(() => {
    if (!activeRef.current || busyRef.current || recognitionRunningRef.current) return;
    const speechWindow = window as WindowWithSpeech;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      activeRef.current = false;
      setError('Free voice mode needs browser speech recognition, which is unavailable here. Use a current Chrome, Edge, or Safari release, or switch the engine to Realtime.');
      updateStatus('error');
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
      }
      // Recognition is demonstrably working, so any earlier warning is stale.
      // Without this, a brief network blip left a permanent "voice is
      // unavailable" message on screen while the user was talking successfully.
      networkErrorStreakRef.current = 0;
      setError((current) => (current && current === NETWORK_WARNING ? null : current));
      if (finalText.trim()) runTurnRef.current(finalText);
    };
    recognition.onstart = () => {
      // A successful start also means the previous failure recovered.
      networkErrorStreakRef.current = 0;
      setError((current) => (current && current === NETWORK_WARNING ? null : current));
    };
    recognition.onerror = (event) => {
      // Every error must surface. Silently ignoring one leaves the user talking
      // to an app that appears frozen, which is exactly how the "network" error
      // behaved in the packaged desktop app.
      const reason = event.error || 'unknown';
      recognitionRunningRef.current = false;
      recognitionRef.current = null;

      if (reason === 'not-allowed' || reason === 'service-not-allowed') {
        activeRef.current = false;
        setError('Microphone access was declined. Allow microphone access for CALYX in Windows settings, then start again.');
        updateStatus('error');
        return;
      }
      if (reason === 'network') {
        // The speech service was briefly unreachable. Edge normally recovers on
        // the next attempt, so this is a caution rather than a failure: the
        // session stays live, retries automatically, and clears the message as
        // soon as recognition works again.
        networkErrorStreakRef.current += 1;
        if (networkErrorStreakRef.current >= NETWORK_FAILURES_BEFORE_GIVING_UP) {
          activeRef.current = false;
          setError('CALYX could not reach a speech service, so voice input stopped. Type your message, or start the session again.');
          updateStatus('error');
          return;
        }
        setError(NETWORK_WARNING);
        updateStatus('listening');
        // onend restarts listening; make sure it does.
        activeRef.current = true;
        return;
      }
      if (reason === 'no-speech' || reason === 'aborted') return;
      setError(`Voice input stopped: ${reason}. Type your message, or start the session again.`);
      updateStatus('listening');
    };
    recognition.onend = () => {
      recognitionRunningRef.current = false;
      recognitionRef.current = null;
      if (activeRef.current && !busyRef.current) {
        window.setTimeout(() => startListeningRef.current(), 250);
      }
    };

    recognitionRef.current = recognition;
    recognitionRunningRef.current = true;
    try {
      recognition.start();
    } catch {
      recognitionRunningRef.current = false;
      recognitionRef.current = null;
    }
  }, [updateStatus]);

  startListeningRef.current = startListening;

  const start = useCallback(async (voice: SupportedVoice, greetingMode: GreetingMode, suppressGreeting = false) => {
    if (startInFlightRef.current || activeRef.current) return;
    startInFlightRef.current = true;
    voiceRef.current = voice;
    greetingModeRef.current = greetingMode;
    setError(null);
    updateStatus('connecting');

    try {
      const speechWindow = window as WindowWithSpeech;
      if (!navigator.mediaDevices?.getUserMedia || !(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition)) {
        throw new Error('Free voice mode needs a browser with microphone access and speech recognition. Use a current Chrome, Edge, or Safari release over HTTPS.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      setMicrophoneReady(true);

      const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyserRef.current = analyser;

      if ('speechSynthesis' in window) window.speechSynthesis.getVoices();

      activeRef.current = true;
      epochRef.current += 1;
      turnsRef.current = [];
      pendingRef.current = null;
      busyRef.current = false;
      networkErrorStreakRef.current = 0;

      const hasGreeted = window.sessionStorage.getItem('calyx-greeted') === 'true';
      if (!suppressGreeting && greetingMode === 'sometimes' && !hasGreeted) {
        window.sessionStorage.setItem('calyx-greeted', 'true');
        updateStatus('speaking');
        await speak(FREE_MODE_GREETING);
        if (!activeRef.current) return;
      }

      updateStatus('listening');
      startListeningRef.current();
    } catch (caughtError) {
      stop();
      setError(getUserFacingError(caughtError));
      updateStatus('error');
    } finally {
      startInFlightRef.current = false;
    }
  }, [speak, stop, updateStatus]);

  const sendText = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean || !activeRef.current || busyRef.current) return false;
    runTurnRef.current(clean);
    return true;
  }, []);

  const interrupt = useCallback(() => {
    if (!activeRef.current) return;
    epochRef.current += 1;
    busyRef.current = false;
    bargeFramesRef.current = 0;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setOutputLevel(0);
    updateStatus('listening');
    startListeningRef.current();
  }, [updateStatus]);

  interruptRef.current = interrupt;

  const setVoiceInterrupt = useCallback((enabled: boolean) => {
    voiceInterruptRef.current = enabled;
  }, []);

  const reconnect = useCallback(() => {
    stop();
    void start(voiceRef.current, greetingModeRef.current, true);
  }, [start, stop]);

  useEffect(() => () => stopRef.current(), []);

  return {
    status,
    messages,
    error,
    inputLevel,
    outputLevel,
    microphoneReady,
    outputReady,
    isActive: status !== 'idle' && status !== 'error',
    start,
    stop,
    reconnect,
    sendText,
    interrupt,
    setVoiceInterrupt,
    clearMessages: () => {
      turnsRef.current = [];
      pendingRef.current = null;
      setMessages([]);
    },
  };
}

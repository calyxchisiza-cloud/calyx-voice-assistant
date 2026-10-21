'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeRealtimeFailure,
  getUserFacingError,
  GreetingMode,
  SessionStatus,
  SupportedVoice,
  SYSTEM_INSTRUCTIONS,
  TranscriptMessage,
} from '@/lib/realtime';

type RealtimeEvent = {
  type?: string;
  event_id?: string;
  response_id?: string;
  item_id?: string;
  transcript?: string;
  delta?: string;
  error?: { message?: string; code?: string };
  response?: { id?: string };
};

type TokenResponse = { value?: string; expires_at?: number; error?: string };

const AUDIO_SAMPLE_RATE = 24_000;

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useRealtimeSession() {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [outputReady, setOutputReady] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAudioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeResponseIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeAssistantTextRef = useRef('');
  const sessionActiveRef = useRef(false);
  const startInFlightRef = useRef(false);
  const currentVoiceRef = useRef<SupportedVoice>('marin');
  const greetingModeRef = useRef<GreetingMode>('sometimes');

  const setAssistantText = useCallback((text: string, pending = true) => {
    const messageId = activeAssistantMessageIdRef.current || makeId('assistant');
    activeAssistantMessageIdRef.current = messageId;
    activeAssistantTextRef.current = text;
    setMessages((current) => {
      const existing = current.find((message) => message.id === messageId);
      if (existing) {
        return current.map((message) => message.id === messageId ? { ...message, text, pending } : message);
      }
      return [...current, { id: messageId, role: 'assistant', text, pending }];
    });
  }, []);

  const finishAssistantMessage = useCallback(() => {
    const messageId = activeAssistantMessageIdRef.current;
    if (!messageId) return;
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, pending: false } : message));
    activeAssistantMessageIdRef.current = null;
    activeAssistantTextRef.current = '';
  }, []);

  const stop = useCallback(() => {
    sessionActiveRef.current = false;
    startInFlightRef.current = false;
    const channel = dcRef.current;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify({ type: 'response.cancel' }));
      channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
    }
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (outputAudioRef.current) {
      outputAudioRef.current.pause();
      outputAudioRef.current.srcObject = null;
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close();
    activeResponseIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    activeAssistantTextRef.current = '';
    setInputLevel(0);
    setOutputLevel(0);
    setMicrophoneReady(false);
    setOutputReady(false);
    setStatus('idle');
  }, []);

  const start = useCallback(async (voice: SupportedVoice, greetingMode: GreetingMode, suppressGreeting = false) => {
    if (startInFlightRef.current || sessionActiveRef.current) return;
    startInFlightRef.current = true;
    currentVoiceRef.current = voice;
    greetingModeRef.current = greetingMode;
    setError(null);
    setStatus('connecting');

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        throw new Error('This browser does not support the microphone and WebRTC features required by CALYX. Try a current Chrome, Edge, Safari, or Firefox release over HTTPS.');
      }

      const tokenResponse = await fetch('/api/realtime/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ voice }),
      });
      const tokenData = (await tokenResponse.json()) as TokenResponse;
      if (!tokenResponse.ok || !tokenData.value) {
        throw new Error(tokenData.error || 'The server could not create a temporary Realtime credential.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mediaStreamRef.current = stream;
      setMicrophoneReady(true);

      const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const inputSource = audioContext.createMediaStreamSource(stream);
      const inputAnalyser = audioContext.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyser.smoothingTimeConstant = 0.82;
      inputSource.connect(inputAnalyser);
      inputAnalyserRef.current = inputAnalyser;

      const peerConnection = new RTCPeerConnection();
      pcRef.current = peerConnection;
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      const outputAudio = new Audio();
      outputAudio.autoplay = true;
      outputAudio.setAttribute('playsinline', 'true');
      outputAudioRef.current = outputAudio;

      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        outputAudio.srcObject = remoteStream;
        setOutputReady(true);
        const outputSource = audioContext.createMediaStreamSource(remoteStream);
        const outputAnalyser = audioContext.createAnalyser();
        outputAnalyser.fftSize = 256;
        outputAnalyser.smoothingTimeConstant = 0.86;
        outputSource.connect(outputAnalyser);
        outputAnalyserRef.current = outputAnalyser;
        void outputAudio.play().catch(() => setError('Audio playback is blocked. Click the page once to allow CALYX to speak.'));
      };

      peerConnection.onconnectionstatechange = () => {
        const connectionState = peerConnection.connectionState;
        if (connectionState === 'connected') {
          setStatus('listening');
        } else if (connectionState === 'failed' || connectionState === 'disconnected') {
          if (sessionActiveRef.current) setStatus('reconnecting');
        }
      };

      const channel = peerConnection.createDataChannel('oai-events');
      dcRef.current = channel;
      channel.onopen = () => {
        channel.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: SYSTEM_INSTRUCTIONS,
            audio: {
              input: {
                transcription: { model: 'gpt-4o-mini-transcribe' },
                turn_detection: {
                  type: 'server_vad',
                  create_response: true,
                  interrupt_response: true,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500,
                },
              },
              output: { voice },
            },
          },
        }));
        setStatus('listening');
        const hasGreeted = window.sessionStorage.getItem('jarvis-greeted') === 'true';
        if (!suppressGreeting && greetingMode === 'sometimes' && !hasGreeted) {
          window.sessionStorage.setItem('jarvis-greeted', 'true');
          window.setTimeout(() => {
            if (channel.readyState === 'open') {
              channel.send(JSON.stringify({ type: 'response.create', response: { instructions: 'Give a brief, warm greeting and then say you are ready to listen.' } }));
            }
          }, 240);
        }
      };

      channel.onmessage = (messageEvent) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(String(messageEvent.data)) as RealtimeEvent;
        } catch {
          return;
        }
        switch (event.type) {
          case 'conversation.item.input_audio_transcription.completed':
            if (event.transcript?.trim()) {
              setMessages((current) => [...current, { id: event.item_id || makeId('user'), role: 'user', text: event.transcript!.trim() }]);
            }
            break;
          case 'response.created':
            activeResponseIdRef.current = event.response?.id || event.response_id || null;
            activeAssistantTextRef.current = '';
            setStatus('thinking');
            break;
          case 'response.output_audio_transcript.delta':
          case 'response.output_text.delta':
            if (event.delta) {
              setStatus('speaking');
              setAssistantText(activeAssistantTextRef.current + event.delta, true);
            }
            break;
          case 'response.output_audio_transcript.done':
          case 'response.output_text.done':
            if (event.transcript || event.delta) setAssistantText(event.transcript || event.delta || '', false);
            break;
          case 'response.done':
            finishAssistantMessage();
            activeResponseIdRef.current = null;
            setStatus('listening');
            break;
          case 'input_audio_buffer.speech_started':
            setStatus('listening');
            break;
          case 'input_audio_buffer.speech_stopped':
            setStatus('thinking');
            break;
          case 'error':
            setError(event.error?.message || 'The Realtime session returned an error.');
            setStatus('error');
            break;
          default:
            break;
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${tokenData.value}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpResponse.ok) throw new Error(describeRealtimeFailure(sdpResponse.status, await sdpResponse.text()));
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
      sessionActiveRef.current = true;
    } catch (caughtError) {
      stop();
      const message = getUserFacingError(caughtError);
      setError(message);
      setStatus('error');
    } finally {
      startInFlightRef.current = false;
    }
  }, [finishAssistantMessage, setAssistantText, stop]);

  const sendText = useCallback((text: string) => {
    const cleanText = text.trim();
    const channel = dcRef.current;
    if (!cleanText || channel?.readyState !== 'open') return false;
    setMessages((current) => [...current, { id: makeId('user'), role: 'user', text: cleanText }]);
    channel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: cleanText }] },
    }));
    channel.send(JSON.stringify({ type: 'response.create' }));
    setStatus('thinking');
    return true;
  }, []);

  const interrupt = useCallback(() => {
    const channel = dcRef.current;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify({ type: 'response.cancel', response_id: activeResponseIdRef.current || undefined }));
      channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
    }
    finishAssistantMessage();
    setStatus('listening');
  }, [finishAssistantMessage]);

  const reconnect = useCallback(() => {
    stop();
    void start(currentVoiceRef.current, greetingModeRef.current, true);
  }, [start, stop]);

  useEffect(() => {
    const loop = () => {
      const readLevel = (analyser: AnalyserNode | null) => {
        if (!analyser) return 0;
        const values = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(values);
        let total = 0;
        for (const value of values) {
          const normalized = (value - 128) / 128;
          total += normalized * normalized;
        }
        return Math.min(1, Math.sqrt(total / values.length) * 2.6);
      };
      setInputLevel(readLevel(inputAnalyserRef.current));
      setOutputLevel(readLevel(outputAnalyserRef.current));
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => () => stop(), [stop]);

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
    clearMessages: () => setMessages([]),
  };
}

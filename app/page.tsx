'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CircleStop, Command, ExternalLink, Mic, PanelRight, Power, Radio, RotateCw, Sparkles, Volume2, WifiOff } from 'lucide-react';
import { AssistantVisualizer, type VisualQuality } from '@/components/assistant-visualizer';
import { ConversationPanel } from '@/components/conversation-panel';
import { SettingsPanel } from '@/components/settings-panel';
import { SyntheticOverlays } from '@/components/synthetic-overlays';
import { useRealtimeSession } from '@/hooks/use-realtime-session';
import { useFreeSession } from '@/hooks/use-free-session';
import { useWakeWord } from '@/hooks/use-wake-word';
import { EngineMode, GreetingMode, SessionStatus, SupportedVoice, VoiceSession } from '@/lib/realtime';

const statusLabels: Record<SessionStatus, string> = {
  idle: 'Standby', connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', reconnecting: 'Reconnecting', error: 'Error',
};

export default function Home() {
  const realtimeSession = useRealtimeSession();
  const freeSession = useFreeSession();
  const [engine, setEngine] = useState<EngineMode>('free');
  const session: VoiceSession = engine === 'free' ? freeSession : realtimeSession;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voice, setVoice] = useState<SupportedVoice>('marin');
  const [greeting, setGreeting] = useState<GreetingMode>('sometimes');
  const [textMode, setTextMode] = useState(false);
  const [voiceInterrupt, setVoiceInterrupt] = useState(true);
  const [quality, setQuality] = useState<VisualQuality>('auto');

  useEffect(() => {
    try {
      const storedVoice = window.localStorage.getItem('calyx-voice');
      const storedGreeting = window.localStorage.getItem('calyx-greeting');
      const storedTextMode = window.localStorage.getItem('calyx-text-mode');
      const storedEngine = window.localStorage.getItem('calyx-engine');
      const storedVoiceInterrupt = window.localStorage.getItem('calyx-voice-interrupt');
      const storedQuality = window.localStorage.getItem('calyx-quality');
      if (storedVoice) setVoice(storedVoice as SupportedVoice);
      if (storedGreeting === 'never' || storedGreeting === 'sometimes') setGreeting(storedGreeting);
      if (storedTextMode === 'true') setTextMode(true);
      if (storedVoiceInterrupt === 'false') setVoiceInterrupt(false);
      if (storedEngine === 'free' || storedEngine === 'realtime') setEngine(storedEngine);
      if (storedQuality === 'auto' || storedQuality === 'low' || storedQuality === 'medium' || storedQuality === 'high' || storedQuality === 'off') setQuality(storedQuality);
    } catch {
      // Local preferences are optional and must never block voice use.
    }
  }, []);

  useEffect(() => { try { window.localStorage.setItem('calyx-voice', voice); } catch {} }, [voice]);
  useEffect(() => { try { window.localStorage.setItem('calyx-greeting', greeting); } catch {} }, [greeting]);
  useEffect(() => { try { window.localStorage.setItem('calyx-text-mode', String(textMode)); } catch {} }, [textMode]);
  useEffect(() => { try { window.localStorage.setItem('calyx-voice-interrupt', String(voiceInterrupt)); } catch {} }, [voiceInterrupt]);
  useEffect(() => { try { window.localStorage.setItem('calyx-quality', quality); } catch {} }, [quality]);

  const stopRealtimeSession = realtimeSession.stop;
  const stopFreeSession = freeSession.stop;
  useEffect(() => {
    if (engine === 'free') stopRealtimeSession();
    else stopFreeSession();
    // Stop functions are stable, so this only reacts to engine changes.
  }, [engine, stopFreeSession, stopRealtimeSession]);

  const startSession = useCallback(() => { void session.start(voice, greeting); }, [greeting, session, voice]);
  const changeEngine = useCallback((next: EngineMode) => {
    setEngine(next);
    try { window.localStorage.setItem('calyx-engine', next); } catch {}
  }, []);
  const applyVoiceInterrupt = freeSession.setVoiceInterrupt;
  useEffect(() => { applyVoiceInterrupt?.(voiceInterrupt); }, [applyVoiceInterrupt, voiceInterrupt]);
  const wakeWord = useWakeWord(() => {
    if (!session.isActive) startSession();
  });

  const toggleWakeWord = () => {
    if (wakeWord.enabled) wakeWord.stop();
    else wakeWord.start();
  };

  const statusLabel = statusLabels[session.status];
  const statusHint = useMemo(() => {
    if (session.error) return session.error;
    if (session.status === 'idle') return engine === 'free' ? 'Free browser voice ready' : 'Local interface ready';
    if (session.status === 'reconnecting') return 'Attempting to restore the channel';
    return engine === 'free' ? 'Free mode · browser speech engine' : 'Encrypted browser-to-Realtime link';
  }, [engine, session.error, session.status]);

  return (
    <main className="app-shell">
      <SyntheticOverlays />
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="app-header">
        <div className="brand-lockup"><div className="brand-mark"><span /><span /><span /></div><div><div className="brand-name">CALYX</div><div className="brand-subtitle">PERSONAL INTELLIGENCE / VOICE FIRST</div></div></div>
        <div className="header-actions"><div className={`connection-badge ${session.status}`}><span className="status-beacon" /><span>{statusLabel}</span><small>{session.status === 'idle' ? 'offline' : 'live'}</small></div><button className="icon-button header-settings" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><PanelRight size={18} /></button></div>
      </header>

      <div className="command-layout">
        <aside className="left-rail">
          <div className="rail-label">SESSION</div>
          <div className="rail-readout"><span className="readout-key">ENGINE</span><strong className={engine === 'free' ? 'cyan-text' : ''}>{engine === 'free' ? 'FREE' : 'REALTIME'}</strong></div>
          <div className="rail-readout"><span className="readout-key">MODE</span><strong>VOICE</strong></div>
          <div className="rail-readout"><span className="readout-key">VOICE</span><strong>{voice.toUpperCase()}</strong></div>
          <div className="rail-readout"><span className="readout-key">WAKE WORD</span><strong className={wakeWord.enabled ? 'cyan-text' : ''}>{wakeWord.enabled ? 'ARMED' : 'OFF'}</strong></div>
          <div className="rail-divider" />
          <div className="rail-footer"><Activity size={15} /><span>Audio telemetry<br /><b>{session.status === 'speaking' ? `${Math.round(session.outputLevel * 100)}% output` : `${Math.round(session.inputLevel * 100)}% input`}</b></span></div>
        </aside>

        <section className="center-column">
          <div className="center-intro"><span className="eyebrow"><Sparkles size={13} /> NIGHTWATCH CONSOLE</span><h1>Ready when<br /><em>you are.</em></h1><p>Speak naturally. CALYX listens for the end of your thought, responds in voice, and stays with the thread. Talk over it whenever you want to take the lead.</p></div>
          <AssistantVisualizer status={session.status} inputLevel={session.inputLevel} outputLevel={session.outputLevel} voiceHint={voice.toUpperCase()} onInterrupt={session.interrupt} quality={quality} />
          <div className="status-line"><span className={`status-icon ${session.status}`}><Radio size={13} /></span><span>{statusHint}</span>{session.status === 'reconnecting' && <button type="button" className="inline-action" onClick={session.reconnect}><RotateCw size={13} /> Retry now</button>}</div>
          {session.error && <div className="error-banner"><WifiOff size={16} /><span>{session.error}</span><button type="button" className="inline-action" onClick={startSession}><RotateCw size={13} /> Try again</button></div>}
          <div className="primary-controls"><button className={`primary-action ${session.isActive ? 'stop-action' : ''}`} type="button" onClick={session.isActive ? session.stop : startSession} disabled={session.status === 'connecting'}>{session.isActive ? <><CircleStop size={18} /> Stop session</> : <><Power size={18} /> Start conversation</>}</button><button className={`secondary-action ${wakeWord.enabled ? 'armed' : ''}`} type="button" onClick={toggleWakeWord}><Command size={17} /><span>Hey CALYX</span><i>{wakeWord.enabled ? 'armed' : 'wake word'}</i></button><button className={`secondary-action ${textMode ? 'selected' : ''}`} type="button" onClick={() => setTextMode((value) => !value)}><Mic size={17} /><span>{textMode ? 'Text + voice' : 'Voice only'}</span><i>{textMode ? 'on' : 'mode'}</i></button></div>
          <div className="microcopy"><Volume2 size={13} /> {engine === 'free' ? 'Browser voice · free Gemini brain · turn based' : 'Marin voice · natural turn detection · interruptible audio'}</div>
        </section>

        <ConversationPanel messages={session.messages} textMode={textMode} active={session.isActive} onSend={session.sendText} onClear={session.clearMessages} />
      </div>

      <footer className="app-footer"><span><span className="footer-pulse" /> {engine === 'free' ? 'Free browser voice layer' : 'Realtime session layer'}</span><span>Nothing is recorded or stored by this interface</span><a href={engine === 'free' ? 'https://ai.google.dev/gemini-api/docs' : 'https://platform.openai.com/docs/guides/realtime'} target="_blank" rel="noreferrer">API notes <ExternalLink size={12} /></a></footer>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} engine={engine} onEngineChange={changeEngine} voice={voice} onVoiceChange={setVoice} greeting={greeting} onGreetingChange={setGreeting} voiceInterrupt={voiceInterrupt} onVoiceInterruptChange={setVoiceInterrupt} quality={quality} onQualityChange={setQuality} wakeSupported={wakeWord.supported} wakeEnabled={wakeWord.enabled} wakeError={wakeWord.error} microphoneReady={session.microphoneReady} outputReady={session.outputReady} />
      {settingsOpen && <button className="drawer-backdrop" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings overlay" />}
    </main>
  );
}

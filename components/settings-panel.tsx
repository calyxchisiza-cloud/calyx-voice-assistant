'use client';

import { Check, ChevronDown, CircleHelp, Cpu, Headphones, Mic, Monitor, Radio, Settings2, X } from 'lucide-react';
import { EngineMode, GreetingMode, SUPPORTED_VOICES, SupportedVoice } from '@/lib/realtime';
import type { VisualQuality } from '@/components/assistant-visualizer';

type Props = {
  open: boolean;
  onClose: () => void;
  engine: EngineMode;
  onEngineChange: (engine: EngineMode) => void;
  voice: SupportedVoice;
  onVoiceChange: (voice: SupportedVoice) => void;
  greeting: GreetingMode;
  onGreetingChange: (greeting: GreetingMode) => void;
  voiceInterrupt: boolean;
  onVoiceInterruptChange: (enabled: boolean) => void;
  quality: VisualQuality;
  onQualityChange: (quality: VisualQuality) => void;
  wakeSupported: boolean;
  wakeEnabled: boolean;
  wakeError: string | null;
  microphoneReady: boolean;
  outputReady: boolean;
};

const QUALITY_OPTIONS: { id: VisualQuality; label: string; note: string }[] = [
  { id: 'auto', label: 'Auto', note: 'Picks a level for this machine' },
  { id: 'low', label: 'Low', note: 'Lightest on the CPU' },
  { id: 'medium', label: 'Medium', note: 'Balanced' },
  { id: 'high', label: 'High', note: 'Densest field' },
  { id: 'off', label: 'Off', note: 'Flat CSS core, no canvas' },
];

export function SettingsPanel({ open, onClose, engine, onEngineChange, voice, onVoiceChange, greeting, onGreetingChange, voiceInterrupt, onVoiceInterruptChange, quality, onQualityChange, wakeSupported, wakeEnabled, wakeError, microphoneReady, outputReady }: Props) {
  return (
    <aside className={`settings-drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Assistant settings">
      <div className="settings-header">
        <div><span className="eyebrow"><Settings2 size={13} /> CONFIGURATION</span><h2>Signal settings</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <div className="section-title"><span>Engine</span><span className="setting-value">{engine === 'free' ? 'free' : 'realtime'}</span></div>
          <div className="segmented-control" role="group" aria-label="Voice engine">
            <button type="button" className={engine === 'realtime' ? 'selected' : ''} onClick={() => onEngineChange('realtime')}>{engine === 'realtime' && <Check size={13} />} Realtime</button>
            <button type="button" className={engine === 'free' ? 'selected' : ''} onClick={() => onEngineChange('free')}>{engine === 'free' && <Check size={13} />} Free</button>
          </div>
          <div className="hardware-row"><Cpu size={16} /><div><strong>{engine === 'free' ? 'Free browser voice' : 'OpenAI Realtime'}</strong><span>{engine === 'free' ? 'Browser speech + free Gemini brain' : 'Premium low-latency streaming'}</span></div></div>
          <p className="setting-help">{engine === 'free' ? 'Uses your browser’s speech recognition and voice with a free Gemini key. No OpenAI credits needed; turn based rather than full duplex.' : 'Requires OpenAI Realtime access and account credits. Instant, interruptible, natural voice.'}</p>
        </section>

        <section className="settings-section">
          <div className="section-title"><span>Voice</span><span className="setting-value">{voice}</span></div>
          <label className="select-wrap"><span className="sr-only">Assistant voice</span><select value={voice} onChange={(event) => onVoiceChange(event.target.value as SupportedVoice)}><optgroup label="Recommended">{SUPPORTED_VOICES.slice(0, 2).map((item) => <option key={item.id} value={item.id}>{item.label} — {item.note}</option>)}</optgroup><optgroup label="More voices">{SUPPORTED_VOICES.slice(2).map((item) => <option key={item.id} value={item.id}>{item.label} — {item.note}</option>)}</optgroup></select><ChevronDown size={15} /></label>
          <p className="setting-help">Voice can change before the first audio response in a session.</p>
        </section>

        <section className="settings-section">
          <div className="section-title"><span>Greeting</span><CircleHelp size={14} /></div>
          <div className="segmented-control" role="group" aria-label="Greeting preference">
            <button type="button" className={greeting === 'sometimes' ? 'selected' : ''} onClick={() => onGreetingChange('sometimes')}>{greeting === 'sometimes' && <Check size={13} />} Sometimes</button>
            <button type="button" className={greeting === 'never' ? 'selected' : ''} onClick={() => onGreetingChange('never')}>{greeting === 'never' && <Check size={13} />} Never</button>
          </div>
          <p className="setting-help">A brief spoken greeting is used once per visit when set to Sometimes.</p>
        </section>

        <section className="settings-section">
          <div className="section-title"><span>Interruption</span><span className={`status-pill ${voiceInterrupt ? 'on' : ''}`}>{voiceInterrupt ? 'ON' : 'OFF'}</span></div>
          <div className="segmented-control" role="group" aria-label="Voice interruption">
            <button type="button" className={voiceInterrupt ? 'selected' : ''} onClick={() => onVoiceInterruptChange(true)}>{voiceInterrupt && <Check size={13} />} Speak over</button>
            <button type="button" className={!voiceInterrupt ? 'selected' : ''} onClick={() => onVoiceInterruptChange(false)}>{!voiceInterrupt && <Check size={13} />} Button only</button>
          </div>
          <p className="setting-help">With “Speak over”, you can cut CALYX off just by talking — playback stops and it listens immediately. The Interrupt button always works.</p>
        </section>

        <section className="settings-section">
          <div className="section-title"><span>Wake word</span><span className={`status-pill ${wakeEnabled ? 'on' : ''}`}>{wakeEnabled ? 'ON' : 'OFF'}</span></div>
          <div className="hardware-row"><Radio size={16} /><div><strong>“Hey CALYX”</strong><span>{wakeSupported ? 'Browser speech recognition available' : 'Browser support not detected'}</span></div></div>
          <p className="setting-help">Wake-word recognition is browser-dependent and may use an online speech service. It is not an offline guarantee.</p>
          {wakeError && <p className="inline-warning">{wakeError}</p>}
        </section>

        <section className="settings-section">
          <div className="section-title"><span>Graphics</span><span className="setting-value">{quality}</span></div>
          <div className="segmented-control" role="group" aria-label="Graphics quality">
            {QUALITY_OPTIONS.map((option) => (
              <button key={option.id} type="button" className={quality === option.id ? 'selected' : ''} onClick={() => onQualityChange(option.id)} title={option.note}>
                {quality === option.id && <Check size={13} />} {option.label}
              </button>
            ))}
          </div>
          <div className="hardware-row"><Monitor size={16} /><div><strong>The 3D core</strong><span>{QUALITY_OPTIONS.find((option) => option.id === quality)?.note}</span></div></div>
          <p className="setting-help">The animated core is the heaviest part of CALYX. Lower it if the app feels sluggish or if your PC is short on memory.</p>
        </section>

        <section className="settings-section">
          <div className="section-title"><span>Hardware</span><span className="setting-value">LIVE</span></div>
          <div className="hardware-grid"><div className="hardware-row"><Mic size={15} /><div><strong>Microphone</strong><span className={microphoneReady ? 'ready-text' : ''}>{microphoneReady ? 'Connected' : 'Not active'}</span></div></div><div className="hardware-row"><Headphones size={15} /><div><strong>Output</strong><span className={outputReady ? 'ready-text' : ''}>{outputReady ? 'Streaming' : 'Awaiting session'}</span></div></div></div>
        </section>
      </div>
    </aside>
  );
}

'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Eraser, MessageCircle, UserRound } from 'lucide-react';
import { TranscriptMessage } from '@/lib/realtime';

type Props = {
  messages: TranscriptMessage[];
  textMode: boolean;
  active: boolean;
  onSend: (text: string) => boolean;
  onClear: () => void;
};

export function ConversationPanel({ messages, textMode, active, onSend, onClear }: Props) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (onSend(draft)) setDraft('');
  };

  return (
    <section className="transcript-panel panel-surface" aria-label="Conversation transcript">
      <div className="panel-heading">
        <div>
          <span className="eyebrow"><MessageCircle size={13} /> LIVE TRANSCRIPT</span>
          <h2>Conversation</h2>
        </div>
        <button className="icon-button quiet" type="button" onClick={onClear} disabled={!messages.length} aria-label="Clear transcript" title="Clear transcript"><Eraser size={16} /></button>
      </div>

      <div className="transcript-scroll" ref={scrollRef}>
        {!messages.length ? (
          <div className="empty-transcript">
            <div className="empty-icon"><MessageCircle size={18} /></div>
            <p>Your conversation will appear here.</p>
            <span>Voice is active by default. Type only when it is useful.</span>
          </div>
        ) : messages.map((message) => (
          <article className={`transcript-message ${message.role}`} key={message.id}>
            <div className="message-avatar">{message.role === 'assistant' ? <Bot size={15} /> : <UserRound size={15} />}</div>
            <div className="message-body">
              <div className="message-meta"><span>{message.role === 'assistant' ? 'CALYX' : 'YOU'}</span>{message.pending && <i>receiving</i>}</div>
              <p>{message.text}{message.pending && <span className="typing-caret" />}</p>
              {message.link && <a className="message-link" href={message.link.url} target="_blank" rel="noreferrer">{message.link.label}</a>}
            </div>
          </article>
        ))}
      </div>

      {textMode && (
        <form className="text-composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="text-message">Send a text message</label>
          <textarea id="text-message" rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} placeholder={active ? 'Send a message to CALYX…' : 'Start a voice session to enable text'} disabled={!active} />
          <button className="send-button" type="submit" disabled={!active || !draft.trim()} aria-label="Send message"><ArrowUp size={17} /></button>
        </form>
      )}
    </section>
  );
}

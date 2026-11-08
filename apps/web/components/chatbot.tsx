'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import { streamChat } from '@/lib/api';
import { RobotAssistant, ROBOT_ACTIONS, type RobotState } from '@/components/robot-assistant';

type Message = { role: 'user' | 'assistant'; content: string };
const suggestions = ['How do I manage leads?', 'How do follow-up reminders work?'];

const menuStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 6,
  maxWidth: 420,
  margin: '4px auto 10px',
};
const chipStyle: CSSProperties = {
  padding: '6px 11px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.6)',
  background: 'rgba(255,255,255,0.6)',
  backdropFilter: 'blur(8px)',
  color: '#1f2a44',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};

export function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [hasReceivedToken, setHasReceivedToken] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manualAction, setManualAction] = useState<RobotState | null>(null);
  const sendingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const actionTimers = useRef<number[]>([]);

  // Priority: thinking while sending > picked action > lying down while typing > happy > idle.
  const robotState: RobotState = sending
    ? 'thinking'
    : manualAction ?? (input.trim() ? 'listening' : celebrating ? 'happy' : 'idle');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, error, sending, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setMenuOpen(false);
  }, [open]);

  useEffect(() => () => actionTimers.current.forEach((id) => window.clearTimeout(id)), []);

  function playAction(state: RobotState, ms: number) {
    actionTimers.current.forEach((id) => window.clearTimeout(id));
    actionTimers.current = [];
    setMenuOpen(false);
    setManualAction(null); // reset first so picking the same action again replays it
    actionTimers.current.push(
      window.setTimeout(() => setManualAction(state), 60),
      window.setTimeout(() => setManualAction(null), 60 + ms),
    );
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError('');
    setHasReceivedToken(false);
    setCelebrating(false);
    setManualAction(null);
    setInput('');
    const conversation: Message[] = [...messages.slice(-19), { role: 'user', content }];
    const assistantIndex = conversation.length;
    setMessages([...conversation, { role: 'assistant', content: '' }]);
    try {
      await streamChat(conversation, (token) => {
        setHasReceivedToken(true);
        setMessages((current) => current.map((message, index) => index === assistantIndex
          ? { ...message, content: message.content + token }
          : message));
      });
      setCelebrating(true);
      window.setTimeout(() => setCelebrating(false), 2600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send your message.');
      setMessages((current) => current.filter((message, index) => index !== assistantIndex || message.content));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <div className="orbit-chat">
      {open && <div className="orbit-chat-overlay" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}>
        <section className="orbit-chat-experience" aria-label="Orbit Assistant" aria-live="polite">
          <header className="orbit-chat-header">
            <span className="orbit-chat-avatar"><Sparkles size={17} /></span>
            <button type="button" className="orbit-chat-icon-button" onClick={() => setOpen(false)} aria-label="Close chat"><X size={19} /></button>
          </header>
          <div className="orbit-chat-stage">
            <div className="orbit-chat-robot-column">
              <div className="orbit-chat-robot-glow" aria-hidden="true" />
              <RobotAssistant
                state={robotState}
                disabled={false}
                onClick={() => setMenuOpen((value) => !value)}
                label="Orbit Assistant robot. Click to pick an action"
                expanded={menuOpen}
                fullSize
              />
              {menuOpen && <div className="orbit-chat-action-menu" role="menu" aria-label="Robot actions" style={menuStyle}>
                {ROBOT_ACTIONS.map((action: { state: RobotState; ms: number; emoji: string; label: string }) => <button
                  type="button"
                  role="menuitem"
                  key={action.state}
                  style={chipStyle}
                  onClick={() => playAction(action.state, action.ms)}
                >{action.emoji} {action.label}</button>)}
              </div>}
              <form className="orbit-chat-form orbit-chat-glass-form" onSubmit={submit}>
                <textarea autoFocus aria-label="Message Orbit Assistant" placeholder="Ask me anything…" value={input} onChange={(event) => setInput(event.target.value)} maxLength={4000} rows={1} disabled={sending} onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }} />
                <button type="submit" className="orbit-chat-send" disabled={sending || !input.trim()} aria-label="Send message"><Send size={17} /></button>
              </form>
              <p className="orbit-chat-disclaimer">AI can make mistakes. Don’t share sensitive information.</p>
            </div>
            <div className="orbit-chat-conversation">
              {messages.length === 0 ? <div className="orbit-chat-welcome">
                <span className="orbit-chat-welcome-icon"><Bot size={23} /></span>
                <strong>Hi! How can I help?</strong>
                <p>Ask me a question about Orbit or anything else you need help with.</p>
                <div className="orbit-chat-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={sending}>{suggestion}</button>)}</div>
              </div> : messages.map((message, index) => <article key={`${index}-${message.role}`} className={`orbit-chat-message orbit-chat-${message.role}`}>
                {message.role === 'assistant' && <span className="orbit-chat-message-avatar"><Sparkles size={13} /></span>}
                <div className="orbit-chat-message-content">
                  {renderMarkdown(message.content)}
                  {message.role === 'assistant' && sending && index === messages.length - 1 && hasReceivedToken && <span className="orbit-chat-cursor" aria-hidden="true" />}
                </div>
              </article>)}
              {sending && !hasReceivedToken && <div className="orbit-chat-typing" role="status"><span /><span /><span /> Thinking…</div>}
              {error && <p className="orbit-chat-error" role="alert">{error}</p>}
              <div ref={bottomRef} />
            </div>
          </div>
        </section>
      </div>}
      <RobotAssistant
        state={sending ? 'thinking' : celebrating ? 'happy' : 'idle'}
        disabled={false}
        onClick={() => setOpen(true)}
        label={open ? 'Close Orbit Assistant' : 'Open Orbit Assistant'}
        expanded={open}
        fullSize
        draggable
        visuallyHidden={open}
      />
    </div>
  );
}

function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
    blocks.push(list.ordered
      ? <ol key={`ol-${blocks.length}`}>{items}</ol>
      : <ul key={`ul-${blocks.length}`}>{items}</ul>);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInline(quote.join(' '))}</blockquote>);
    quote = [];
  };

  for (const line of lines) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const text = renderInline(heading[2]);
      const key = `heading-${blocks.length}`;
      if (heading[1].length === 1) blocks.push(<h2 key={key}>{text}</h2>);
      else if (heading[1].length <= 3) blocks.push(<h3 key={key}>{text}</h3>);
      else blocks.push(<h4 key={key}>{text}</h4>);
      continue;
    }

    if (/^\s*(?:(?:-{3,})|(?:\*{3,})|(?:_{3,}))\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      continue;
    }

    const quoteLine = line.match(/^\s*>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1].trim());
      continue;
    }
    flushQuote();

    const match = line.match(/^\s*(?:(-|\*|•)\s+|(\d+)[.)]\s+)(.*)$/);
    if (match) {
      flushParagraph();
      const ordered = Boolean(match[2]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(match[3]);
    } else if (line.trim()) {
      flushList();
      paragraph.push(line.trim());
    } else {
      flushParagraph();
      flushList();
    }
  }
  flushParagraph();
  flushList();
  flushQuote();
  return blocks;
}

function renderInline(text: string) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    const token = match[0];
    const bold = token.startsWith('**') || token.startsWith('__');
    const code = token.startsWith('`');
    const content = token.slice(bold ? 2 : 1, bold ? -2 : -1);
    parts.push(bold
      ? <strong key={index}>{content}</strong>
      : code
        ? <code key={index}>{content}</code>
        : <em key={index}>{content}</em>);
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
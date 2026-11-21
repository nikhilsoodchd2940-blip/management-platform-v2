'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/MemberPicker';
import { getDirectMessages, sendDirectMessage, type DirectMessage } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { tx, dateLocale } from '@/lib/i18n/tr';

const when = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A conversation with one person of the event, written from the admin panel. */
export default function DirectChat({ eventId, person, onClose }: { eventId: string; person: { userId: string; name: string; photoUrl?: string; role: string }; onClose: () => void }) {
  const [rows, setRows] = useState<DirectMessage[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = () => getDirectMessages({ eventId, withUserId: person.userId }).then((r) => setRows(r.data.messages)).catch((e: Error) => { setRows((x) => x ?? []); notify(e.message, 'error'); });
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [eventId, person.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [rows?.length]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try { await sendDirectMessage({ eventId, toUserId: person.userId, text: t }); setText(''); await load(); }
    catch (e) { notify((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  return createPortal(
    <div className="mls-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mls-sheet dc" role="dialog" aria-label={`Messages with ${person.name}`}>
        <header className="dc-h">
          <Avatar name={person.name} photoUrl={person.photoUrl} size={44} />
          <div><h3>{person.name}</h3><p>{person.role}</p></div>
          <button type="button" className="mls-x" onClick={onClose} aria-label={tx("Close")}>×</button>
        </header>
        <div className="dc-body">
          {rows === null && <p className="dc-none">{tx("Loading…")}</p>}
          {rows?.length === 0 && <p className="dc-none">{tx("No message yet. Write the first one below;")} {person.name.split(' ')[0]} {tx("is notified at once.")}</p>}
          {rows?.map((m) => (
            <div key={m.id} className={`dc-msg${m.mine ? ' me' : ''}`}><p>{m.text}</p><small>{m.mine ? tx("You") : m.fromName} · {when(m.atMs)}</small></div>
          ))}
          <div ref={end} />
        </div>
        <form className="dc-send" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea value={text} rows={2} maxLength={1000} placeholder={tx("Write your message")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>{tx("Send")}</button>
        </form>
      </div>
    </div>,
    document.body
  );
}

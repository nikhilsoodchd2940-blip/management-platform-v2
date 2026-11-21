'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDoc, collection, limit, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { useAuth } from '@/context/AuthContext';
import { tsMs } from '@/lib/useCollection';
import { DEFAULT_MEMBER_PHOTO } from '@/components/MemberPicker';
import { notify } from '@/lib/notify';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Msg { id: string; senderId: string; text: string; sentAt: unknown }

/** Direct conversation between the administrator and one member. The member reads and answers it in the app. */
export default function ChatDialog({ userId, name, photoUrl, onClose }: { userId: string; name: string; photoUrl?: string; onClose: () => void }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'directChats', userId, 'messages'), orderBy('sentAt', 'asc'), limit(200)), (s) =>
      setMsgs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Msg, 'id'>) })))
    , () => setMsgs([]));
  }, [userId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function send() {
    const t = text.trim();
    if (!t || busy || !user) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'directChats', userId, 'messages'), { senderId: user.uid, senderName: user.displayName || 'Admin', text: t, sentAt: serverTimestamp() });
      setText('');
    } catch {
      notify('The message could not be sent', 'error');
    } finally { setBusy(false); }
  }

  const time = (ms: number) => (ms ? new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…');
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="cd-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cd" role="dialog" aria-modal="true" aria-label={`${tx("Chat with")} ${name}`}>
        <header>
          <img alt="" src={photoUrl || DEFAULT_MEMBER_PHOTO} />
          <div><b>{name}</b><small>{tx("Direct message · read in the app")}</small></div>
          <button type="button" onClick={onClose} aria-label={tx("Close")}>✕</button>
        </header>
        <div className="cd-msgs">
          {msgs === null && <div className="cd-note">{tx("Loading…")}</div>}
          {msgs?.length === 0 && <div className="cd-note">{tx("No message yet. Write the first one below.")}</div>}
          {msgs?.map((m) => (
            <div key={m.id} className={`cd-m ${m.senderId === userId ? 'in' : 'out'}`}><p>{m.text}</p><small>{time(tsMs(m.sentAt))}</small></div>
          ))}
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Write a message…")} maxLength={2000} autoFocus />
          <button type="submit" disabled={busy || !text.trim()}>{tx("Send")}</button>
        </form>
      </div>
    </div>,
    document.body
  );
}

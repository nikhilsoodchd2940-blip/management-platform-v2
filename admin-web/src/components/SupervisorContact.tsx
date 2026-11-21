'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/MemberPicker';
import DirectChat from '@/components/DirectChat';
import { LEVEL_NAME, getDirectInbox, type SupervisionEvent, type SupervisionLevel } from '@/lib/functions';
import { tx } from '@/lib/i18n/tr';

const GROUPS: { level: SupervisionLevel; title: string }[] = [
  { level: 'admin', title: 'Administration' },
  { level: 'main', title: 'Main event supervisor' },
  { level: 'manager', title: 'Site managers' },
  { level: 'member', title: 'Site staff' },
];

/** Who to reach, according to the level of the signed-in person: photo, role, places and a message button. */
export default function SupervisorContact({ eventId, contacts, level }: { eventId: string; contacts: SupervisionEvent['contacts']; level: SupervisionLevel }) {
  const [chat, setChat] = useState<SupervisionEvent['contacts'][number] | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  useEffect(() => {
    const load = () => getDirectInbox({ eventId }).then((r) => setUnread(r.data.byUser)).catch(() => undefined);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [eventId, chat]);
  const chain = level === 'member' ? 'Your site manager and the main supervisor' : level === 'manager' ? 'The main supervisor, the organiser and your staff' : 'The organiser, the site managers and the staff';
  return (
    <div className="ct">
      <p className="ct-intro">{chain}. Use Reports and replies to write something that has to be answered and followed up. Use Message to write to someone here, in the panel; the person is notified at once.</p>
      {contacts.length === 0 && <p className="th-empty">{tx("Nobody else is assigned to this event yet.")}</p>}
      {GROUPS.map((g) => {
        const list = contacts.filter((c) => c.level === g.level);
        if (list.length === 0) return null;
        return (
          <section key={g.level}>
            <h3>{g.title} <span className="th-n">{list.length}</span></h3>
            <div className="ct-grid">
              {list.map((c) => (
                <article key={c.userId} className="ct-card">
                  <Avatar name={c.name} photoUrl={c.photoUrl} size={56} />
                  <div className="ct-body">
                    <b>{c.name}</b>
                    <small>{c.role}{c.places.length ? ` · ${c.places.join(', ')}` : ''}</small>
                    {c.phone ? <span className="ct-num">{c.phone}</span> : <span className="ct-none">{tx("No phone on file")}</span>}
                    {c.email && <span className="ct-mail">{c.email}</span>}
                    <div className="ct-links">
                      <button type="button" className="btn btn-primary" onClick={() => setChat(c)}>{tx("Message")}{unread[c.userId] ? <em className="ct-n">{unread[c.userId]}</em> : null}</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
      {chat && <DirectChat eventId={eventId} person={{ userId: chat.userId, name: chat.name, photoUrl: chat.photoUrl, role: chat.role }} onClose={() => setChat(null)} />}
      <p className="ct-foot">{tx("You are signed in as")} {LEVEL_NAME[level].toLowerCase()}.</p>
    </div>
  );
}

'use client';

import '../../px/messagerie.css';
import { useEffect, useMemo, useState } from 'react';
import { collection, limit as fsLimit, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { fmt, useCount } from '@/lib/liveStats';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import Dropdown from '@/components/Dropdown';
import { WizSvg } from '@/components/WizardShell';
import { CxBanner, CxStats } from '@/components/Cx';
import { Check, Layers, MessageSquare, Users } from 'lucide-react';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Message {
  id: string;
  senderId: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'file';
  sentMs: number;
}

const PAGE = 200;
const initials = (s: string) => s.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const time = (ms: number) => (ms ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '');

/** Discussions — read-only supervision of kurel chats, in the approved layout. */
export default function MessagingPage() {
  const { leafGroups, locationOf } = useGroupHierarchy();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [inChat, setInChat] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [shownN, setShownN] = useState(40);
  const online = useCount('presence', [['lastActiveAt', '>=', Timestamp.fromMillis(Date.now() - 5 * 60 * 1000)]], 60000);

  const groups = useMemo(
    () => leafGroups.filter((g) => {
      const l = locationOf(g.id);
      if (country && l.country?.id !== country) return false;
      if (city && l.city?.id !== city) return false;
      return !search.trim() || g.name.toLowerCase().includes(search.trim().toLowerCase());
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leafGroups, search, country, city]
  );
  const countryOpts = useMemo(() => { const m = new Map<string, string>(); leafGroups.forEach((g) => { const c = locationOf(g.id).country; if (c) m.set(c.id, c.name); }); return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)); }, [leafGroups]); // eslint-disable-line react-hooks/exhaustive-deps
  const cityOpts = useMemo(() => { const m = new Map<string, string>(); leafGroups.forEach((g) => { const l = locationOf(g.id); if (l.city && (!country || l.country?.id === country)) m.set(l.city.id, l.city.name); }); return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)); }, [leafGroups, country]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = leafGroups.find((g) => g.id === selectedId) ?? leafGroups[0];

  useEffect(() => setLimit(PAGE), [selected?.id]);
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    return onSnapshot(query(collection(db, 'chatRooms', selected.id, 'messages'), orderBy('sentAt', 'desc'), fsLimit(limit)), (snap) =>
      setMessages(
        snap.docs
          .map((d) => ({
            id: d.id,
            senderId: d.data().senderId as string,
            text: d.data().text as string | undefined,
            mediaUrl: d.data().mediaUrl as string | undefined,
            mediaType: d.data().mediaType as 'image' | 'file' | undefined,
            sentMs: (d.data().sentAt as Timestamp | undefined)?.toMillis?.() ?? 0,
          }))
          .reverse()
      )
    );
  }, [selected?.id, limit]);

  const profiles = useUserProfiles(messages.map((m) => m.senderId));
  const names = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.name]));
  const shown = messages.filter((m) => !inChat.trim() || (m.text ?? '').toLowerCase().includes(inChat.trim().toLowerCase()));
  const loc = selected ? locationOf(selected.id) : {};
  const participants = Array.from(new Set(messages.map((m) => m.senderId)));

  const byDay: { day: string; items: Message[] }[] = [];
  shown.forEach((m) => {
    const d = m.sentMs ? new Date(m.sentMs).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    const last = byDay[byDay.length - 1];
    if (last && last.day === d) last.items.push(m); else byDay.push({ day: d, items: [m] });
  });
  const perPerson = new Map<string, number>();
  messages.forEach((m) => perPerson.set(m.senderId, (perPerson.get(m.senderId) ?? 0) + 1));
  const top = Array.from(perPerson.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const media = messages.filter((m) => m.mediaUrl).length;
  const lastMs = messages.length ? messages[messages.length - 1].sentMs : 0;
  const where = [loc.city?.name, loc.country?.name].filter(Boolean).join(' · ');

  return (
    <div className="px px-messagerie">
      <div className="content">
        <CxBanner icon={<MessageSquare size={26} />} kicker={tx("Read-only supervision")} title={tx("Discussions")} sub={tx("Follow the kurel discussions inside your administrative scope.")} />
        <CxStats items={[
          { label: tx("Discussions"), value: fmt(leafGroups.length), icon: <MessageSquare size={18} />, tone: 'green' },
          { label: tx("Members online"), value: fmt(online), icon: <Check size={18} />, tone: 'amber' },
          { label: tx("Messages loaded"), value: messages.length, icon: <Layers size={18} />, tone: 'violet' },
          { label: tx("Active here"), value: participants.length, icon: <Users size={18} />, tone: 'blue' },
        ]} />
        <section className="chat-shell" id="chatShell">
          <aside className="chat-list">
            <div className="chat-list-top">
              <label className="ms-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input placeholder={tx("Search a discussion")} type="search" value={search} onChange={(e) => { setSearch(e.target.value); setShownN(40); }} /></label>
              <div className="ms-dd">
                <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); setShownN(40); }} allLabel="All countries" options={countryOpts} />
                <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setShownN(40); }} allLabel="All cities" options={cityOpts} />
              </div>
            </div>
            <div className="conversations">
              <div className="section-label group-label">{groups.length} {tx("kurel discussion")}{groups.length === 1 ? '' : 's'}</div>
              {groups.slice(0, shownN).map((g) => (
                <button type="button" key={g.id} className={`conversation group${selected?.id === g.id ? ' active' : ''}`} onClick={() => setSelectedId(g.id)}>
                  <span className="conversation-avatar group">{initials(g.name)}</span>
                  <span><strong>{g.name}</strong><span>{[locationOf(g.id).city?.name, locationOf(g.id).country?.name].filter(Boolean).join(' · ')}</span></span>
                </button>
              ))}
              {groups.length > shownN && <button type="button" className="ms-more" onClick={() => setShownN(shownN + 40)}>{tx("Show 40 more ·")} {groups.length - shownN} {tx("left")}</button>}
              {groups.length === 0 && <div className="empty">{tx("No discussion found.")}</div>}
            </div>
          </aside>
          <section className="chat-main">
            <header className="chat-head">
              <div className="chat-head-info">
                <span className="conversation-avatar group">{selected ? initials(selected.name) : '—'}</span>
                <div><strong>{selected?.name ?? tx("No discussion selected")}</strong><span>{where}</span></div>
              </div>
              <div className="chat-head-actions">
                <label className="ms-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input type="search" placeholder={tx("Search in this chat")} value={inChat} onChange={(e) => setInChat(e.target.value)} /></label>
              </div>
            </header>
            <div className="messages">
              {messages.length >= limit && (
                <div className="day-label"><span><button type="button" onClick={() => setLimit((n) => n + PAGE)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>{tx("Load older messages")}</button></span></div>
              )}
              {shown.length === 0 && (
                <div className="ms-empty">
                  <WizSvg name="doc" size={34} />
                  <b>{messages.length === 0 ? tx("No message in this discussion yet") : tx("No message matches your search")}</b>
                  <small>{messages.length === 0 ? tx("Messages written by the members of this kurel appear here in real time.") : tx("Try another word.")}</small>
                </div>
              )}
              {byDay.map((d) => (
                <div key={d.day}>
                  <div className="day-label"><span>{d.day}</span></div>
                  {d.items.map((m) => (
                    <div className="message" key={m.id}>
                      <Avatar name={names[m.senderId] || '?'} photoUrl={profiles[m.senderId]?.photoUrl} size={36} />
                      <div className="bubble">
                        <b>{names[m.senderId] || '…'}</b>
                        {m.text && <p>{m.text}</p>}
                        {m.mediaUrl && <p><a href={m.mediaUrl} target="_blank" rel="noreferrer">{m.mediaType === 'image' ? tx("View image") : tx("View file")}</a></p>}
                        <small>{time(m.sentMs)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="ms-readonly"><WizSvg name="shield" size={18} /> {tx("Supervision view: you can read the discussion but not write in it. It follows your access scope.")}</div>
          </section>
          <aside className="chat-details">
            <div className="ms-ident">
              <div className="detail-avatar">{selected ? initials(selected.name) : '—'}</div>
              <h2>{selected?.name ?? '—'}</h2>
              <p>{where}</p>
            </div>
            <div className="ms-mini">
              <div><b>{messages.length}</b><small>{tx("Messages")}</small></div>
              <div><b>{participants.length}</b><small>{tx("People")}</small></div>
              <div><b>{media}</b><small>{tx("Files")}</small></div>
              <div><b>{lastMs ? time(lastMs) : '—'}</b><small>{tx("Last message")}</small></div>
            </div>
            <div className="detail-section">
              <h3>{tx("Most active")}</h3>
              {top.length === 0 ? <p className="ms-none">{tx("Nobody has written yet.")}</p> : (
                <ul className="ms-top">{top.map(([id, n]) => (
                  <li key={id}><Avatar name={names[id] || '?'} photoUrl={profiles[id]?.photoUrl} size={28} /><b>{names[id] || '…'}</b><span>{n}</span></li>
                ))}</ul>
              )}
            </div>
            <div className="detail-section">
              <h3>{tx("Scope")}</h3>
              <div className="detail-row"><span>{tx("Type")}</span><b>{tx("Kurel")}</b></div>
              <div className="detail-row"><span>{tx("City")}</span><b>{loc.city?.name ?? '—'}</b></div>
              <div className="detail-row"><span>{tx("Country")}</span><b>{loc.country?.name ?? '—'}</b></div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, limit as fsLimit, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { fmt } from '@/lib/liveStats';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useUserProfiles } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import Dropdown from '@/components/Dropdown';
import { CxBanner, CxStats, CxTabs, CxPill } from '@/components/Cx';
import { Archive, Building2, Calendar, Check, Download, FileText, Flag, Inbox, Layers, Mail, MapPin, Megaphone, MessageSquare, Search, Send, User, Users } from 'lucide-react';
import { sendAnnouncement } from '@/lib/functions';
import { notify } from '@/lib/notify';
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
  const [zoneF, setZoneF] = useState('');
  const [groupF, setGroupF] = useState('');
  const [typeF, setTypeF] = useState<'' | 'group' | 'broadcast'>('');
  const [shownN, setShownN] = useState(40);

  const [folder, setFolder] = useState<'all' | 'group' | 'broadcast' | 'scheduled' | 'templates'>('all');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [bcAll, setBcAll] = useState(true);
  const [bcOpen, setBcOpen] = useState(false);
  const [bcTitle, setBcTitle] = useState('');
  const [bcBody, setBcBody] = useState('');
  const [scope, setScope] = useState<'group' | 'all'>('group');
  const [side, setSide] = useState<'recent' | 'templates'>('recent');
  const [ann, setAnn] = useState<{ id: string; title: string; body: string; target: string; targetGroupId?: string; recipientCount: number; ms: number }[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), fsLimit(60)), (snap) =>
    setAnn(snap.docs.map((d) => ({ id: d.id, title: (d.data().title as string) ?? '', body: (d.data().body as string) ?? '', target: (d.data().target as string) ?? 'all', targetGroupId: d.data().targetGroupId as string | undefined, recipientCount: (d.data().recipientCount as number) ?? 0, ms: (d.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0 })))), []);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const sentToday = ann.filter((a) => a.ms >= dayStart.getTime()).length;
  const reached = ann.reduce((a, x) => a + x.recipientCount, 0);
  const fmtShort = (ms: number) => (ms ? new Date(ms).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }) : '');
  const groups = useMemo(
    () => leafGroups.filter((g) => {
      const l = locationOf(g.id);
      if (country && l.country?.id !== country) return false;
      if (city && l.city?.id !== city) return false;
      if (zoneF && (g as { zoneId?: string }).zoneId !== zoneF) return false;
      if (groupF && g.id !== groupF) return false;
      if (typeF === 'broadcast') return false;
      return !search.trim() || g.name.toLowerCase().includes(search.trim().toLowerCase());
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leafGroups, search, country, city, zoneF, groupF, typeF]
  );
  const countryOpts = useMemo(() => { const m = new Map<string, string>(); leafGroups.forEach((g) => { const c = locationOf(g.id).country; if (c) m.set(c.id, c.name); }); return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)); }, [leafGroups]); // eslint-disable-line react-hooks/exhaustive-deps
  const cityOpts = useMemo(() => { const m = new Map<string, string>(); leafGroups.forEach((g) => { const l = locationOf(g.id); if (l.city && (!country || l.country?.id === country)) m.set(l.city.id, l.city.name); }); return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)); }, [leafGroups, country]); // eslint-disable-line react-hooks/exhaustive-deps
  const zonesRaw = useZones() as unknown as { id: string; name: string }[];
  const zoneOpts = (zonesRaw ?? []).map((z) => ({ value: z.id, label: z.name }));
  const groupOpts = leafGroups.map((g) => ({ value: g.id, label: g.name }));
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
  const where = [loc.city?.name, loc.country?.name].filter(Boolean).join(' · ');
  const byDay: { day: string; items: Message[] }[] = [];
  shown.forEach((m) => {
    const d = m.sentMs ? new Date(m.sentMs).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    const last = byDay[byDay.length - 1];
    if (last && last.day === d) last.items.push(m); else byDay.push({ day: d, items: [m] });
  });
  const groupName = (id?: string) => (id ? leafGroups.find((g) => g.id === id)?.name ?? '' : '');

  async function sendNow(title: string, text: string, target: 'all' | 'group', gid?: string) {
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await sendAnnouncement({ title: title.trim() || tx('Message'), body: text.trim(), target, ...(target === 'group' && gid ? { targetGroupId: gid } : {}) });
      notify(`${tx("Sent to")} ${r.data.recipientCount} ${tx("recipients")}`, 'success');
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : tx("Could not send"), 'error');
      return false;
    } finally {
      setSending(false);
    }
  }

  const folders: { k: typeof folder; icon: ReactNode; label: string; n: number }[] = [
    { k: 'all', icon: <MessageSquare size={17} />, label: tx("All messages"), n: leafGroups.length + ann.length },
    { k: 'group', icon: <Users size={17} />, label: tx("Group chats"), n: leafGroups.length },
    { k: 'broadcast', icon: <Megaphone size={17} />, label: tx("Broadcasts"), n: ann.length },
    { k: 'scheduled', icon: <Calendar size={17} />, label: tx("Scheduled"), n: 0 },
    { k: 'templates', icon: <Layers size={17} />, label: tx("Templates"), n: 0 },
  ];
  const tabKey = folder === 'all' ? 'inbox' : folder === 'group' ? 'groups' : folder;

  return (
    <div className="cx-page cc">
      <CxBanner icon={<MessageSquare size={26} />} kicker={tx("Administration")} title={tx("Communication Center")} sub={tx("Direct messages, group conversations, bulk announcements and message history.")}>
        <button type="button" className="cx-btn ghost-light" onClick={() => { setScope('group'); document.getElementById('cc-composer')?.focus(); }}><Mail size={16} />{tx("New message")}</button>
        <button type="button" className="cx-btn gold" onClick={() => { setBcOpen(true); document.getElementById('cc-bc')?.scrollIntoView({ behavior: 'smooth' }); }}><Megaphone size={16} />{tx("New broadcast")}</button>
      </CxBanner>
      <CxTabs value={tabKey} onChange={(v) => setFolder(v === 'inbox' ? 'all' : v === 'groups' ? 'group' : (v as typeof folder))} items={[
        { value: 'inbox', label: tx("Inbox"), icon: <Inbox size={14} /> },
        { value: 'groups', label: tx("Groups"), icon: <Users size={14} /> },
        { value: 'broadcast', label: tx("Broadcasts"), icon: <Megaphone size={14} /> },
        { value: 'scheduled', label: tx("Scheduled"), icon: <Calendar size={14} /> },
        { value: 'templates', label: tx("Templates"), icon: <Layers size={14} /> },
      ]} />
      <CxStats items={[
        { label: tx("Active conversations"), value: fmt(leafGroups.length), icon: <MessageSquare size={18} />, tone: 'green' },
        { label: tx("Unread"), value: '—', sub: tx("Per member, not tracked"), icon: <Mail size={18} />, tone: 'amber' },
        { label: tx("Scheduled"), value: 0, icon: <Calendar size={18} />, tone: 'violet' },
        { label: tx("Sent today"), value: sentToday, icon: <Send size={18} />, tone: 'blue' },
        { label: tx("Recipients reached"), value: fmt(reached), icon: <Users size={18} />, tone: 'teal' },
      ]} />

      <div className="cc-shell">
        <aside className="cc-filters">
          <label className="cx-search"><Search size={15} /><input type="search" placeholder={tx("Search member, group or conversation")} value={search} onChange={(e) => { setSearch(e.target.value); setShownN(40); }} /></label>
          <div className="cc-dd">
            <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); setShownN(40); }} allLabel={tx("All countries")} options={countryOpts} />
            <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setShownN(40); }} allLabel={tx("All cities")} options={cityOpts} />
            <Dropdown label={tx("Zone")} value={zoneF} onChange={(v) => { setZoneF(v); setShownN(40); }} allLabel={tx("All zones")} options={zoneOpts} />
            <Dropdown label={tx("Group")} value={groupF} onChange={(v) => { setGroupF(v); setShownN(40); }} allLabel={tx("All groups")} options={groupOpts} />
            <Dropdown label={tx("Type")} value={typeF} onChange={(v) => { setTypeF(v as '' | 'group' | 'broadcast'); setShownN(40); }} allLabel={tx("All types")} options={[{ value: 'group', label: tx("Group chats") }, { value: 'broadcast', label: tx("Broadcasts") }]} />
          </div>
          <nav className="cc-folders">
            {folders.map((f) => (
              <button type="button" key={f.k} className={folder === f.k ? 'on' : ''} onClick={() => setFolder(f.k)}>{f.icon}<span>{f.label}</span><em>{f.n}</em></button>
            ))}
            <button type="button" disabled title={tx("Not tracked yet")}><User size={17} /><span>{tx("Direct messages")}</span><em>0</em></button>
            <button type="button" disabled title={tx("Not tracked yet")}><Archive size={17} /><span>{tx("Archived")}</span><em>0</em></button>
          </nav>
        </aside>

        <section className="cc-list">
          <header><b>{tx("Conversations")} ({folder === 'broadcast' ? ann.length : groups.length})</b><span>{tx("Sort: Recent")}</span></header>
          <div className="cc-items">
            {(folder === 'all' || folder === 'group') && groups.slice(0, shownN).map((g) => (
              <button type="button" key={g.id} className={`cc-item${selected?.id === g.id ? ' on' : ''}`} onClick={() => setSelectedId(g.id)}>
                <span className="cc-av"><Users size={20} /></span>
                <span className="cc-tx"><b>{g.name}<CxPill tone="green">{tx("Group")}</CxPill></b><small>{where && selected?.id === g.id ? where : [locationOf(g.id).city?.name, locationOf(g.id).country?.name].filter(Boolean).join(' · ')}</small></span>
              </button>
            ))}
            {(folder === 'all' || folder === 'broadcast') && ann.slice(0, folder === 'all' ? 8 : 60).map((a) => (
              <div key={a.id} className="cc-item bc">
                <span className="cc-av"><Megaphone size={20} /></span>
                <span className="cc-tx"><b>{a.title}<CxPill tone="amber">{tx("Broadcast")}</CxPill></b><small>{a.body}</small></span>
                <em>{fmtShort(a.ms)}</em>
              </div>
            ))}
            {(folder === 'scheduled' || folder === 'templates') && <p className="cx-empty">{folder === 'scheduled' ? tx("No scheduled message. Scheduled sending is not enabled yet.") : tx("No saved template yet.")}</p>}
            {groups.length > shownN && (folder === 'all' || folder === 'group') && <button type="button" className="cc-more" onClick={() => setShownN(shownN + 40)}>{tx("Show 40 more ·")} {groups.length - shownN} {tx("left")}</button>}
            {groups.length === 0 && folder === 'group' && <p className="cx-empty">{tx("No discussion found.")}</p>}
          </div>
        </section>

        <section className="cc-thread">
          <header>
            <span className="cc-av"><Users size={20} /></span>
            <div><b>{selected?.name ?? tx("No discussion selected")}</b><small>{tx("Group")} · {where}</small></div>
            <label className="cx-search sm"><Search size={14} /><input type="search" placeholder={tx("Search in this discussion")} value={inChat} onChange={(e) => setInChat(e.target.value)} /></label>
          </header>
          <div className="cc-msgs">
            {messages.length >= limit && <button type="button" className="cc-more" onClick={() => setLimit((n) => n + PAGE)}>{tx("Load earlier messages")}</button>}
            {shown.length === 0 && <p className="cx-empty">{messages.length === 0 ? tx("No message in this discussion yet") : tx("No message matches your search")}</p>}
            {byDay.map((d) => (
              <div key={d.day}>
                <div className="cc-day"><span>{d.day}</span></div>
                {d.items.map((m) => (
                  <div className="cc-msg" key={m.id}>
                    <Avatar name={names[m.senderId] || '?'} photoUrl={profiles[m.senderId]?.photoUrl} size={34} />
                    <div className="cc-bub">
                      <b>{names[m.senderId] || '…'}</b>
                      {m.text && <p>{m.text}</p>}
                      {m.mediaUrl && <a className="cc-file" href={m.mediaUrl} target="_blank" rel="noreferrer"><FileText size={18} /><span>{m.mediaType === 'image' ? tx("View image") : tx("View file")}</span><Download size={16} /></a>}
                      <small>{time(m.sentMs)}</small>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="cc-compose">
            <textarea id="cc-composer" rows={2} placeholder={tx("Write a message to the members of this group...")} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="cc-cbar">
              <small>{tx("Sent as a notification to every member of")} {selected?.name ?? '—'}.</small>
              <button type="button" className="cx-btn green" disabled={sending || !draft.trim() || !selected} onClick={async () => { if (selected && await sendNow(selected.name, draft, 'group', selected.id)) setDraft(''); }}><Send size={15} />{tx("Send")}</button>
            </div>
          </div>
        </section>

        <aside className="cc-side">
          <div className="cc-box">
            <h4><Users size={16} />{tx("Send to")}</h4><small>{tx("Choose the communication scope.")}</small>
            <div className="cc-scope">
              {([['single', <User key="a" size={17} />, 'Single member', false], ['group', <Users key="b" size={17} />, 'Group / Kurel', true], ['zone', <MapPin key="c" size={17} />, 'Zone', false], ['city', <Building2 key="d" size={17} />, 'City', false], ['country', <Flag key="e" size={17} />, 'Country', false], ['all', <Layers key="f" size={17} />, 'Bulk recipients', true]] as const).map(([k, ic, l, on]) => (
                <button type="button" key={k} disabled={!on} title={on ? '' : tx("Not available yet")} className={scope === k ? 'on' : ''} onClick={() => on && setScope(k as 'group' | 'all')}>{ic}<span>{tx(l)}</span>{scope === k && <Check size={12} className="cc-ck" />}</button>
              ))}
            </div>
            <div className="cc-sel"><span>{tx("Selected members")}</span><b>{scope === 'all' ? fmt(leafGroups.reduce((a, g) => a + ((g as { capacity?: number }).capacity ?? 0), 0)) : selected ? fmt((selected as { capacity?: number }).capacity ?? 0) : 0}</b></div>
          </div>
          <div className="cc-box" id="cc-bc">
            <h4><Megaphone size={16} />{tx("Quick broadcast")}</h4><small>{tx("Send an announcement to a selected audience.")}</small>
            <ul className="cc-aud">
              <li><label><input type="checkbox" checked={bcAll} onChange={(e) => setBcAll(e.target.checked)} />{tx("All kurels")}</label><em>{leafGroups.length}</em></li>
              <li className="off"><label><input type="checkbox" disabled />{tx("Committee leaders")}</label><em>—</em></li>
              <li className="off"><label><input type="checkbox" disabled />{tx("Zone supervisors")}</label><em>—</em></li>
              <li className="off"><label><input type="checkbox" disabled />{tx("City teams")}</label><em>—</em></li>
              <li><label><input type="checkbox" checked={!bcAll} onChange={(e) => setBcAll(!e.target.checked)} />{tx("Selected group")}</label><em>{selected ? 1 : 0}</em></li>
            </ul>
            {bcOpen && (
              <div className="cc-bcform">
                <input placeholder={tx("Title")} value={bcTitle} onChange={(e) => setBcTitle(e.target.value)} />
                <textarea rows={3} placeholder={tx("Announcement text")} value={bcBody} onChange={(e) => setBcBody(e.target.value)} />
              </div>
            )}
            <button type="button" className="cx-btn green cc-wide" disabled={sending} onClick={async () => {
              if (!bcOpen) { setBcOpen(true); return; }
              if (!bcTitle.trim() || !bcBody.trim()) { notify(tx("Add a title and a text"), 'error'); return; }
              if (!confirm(tx("Send this broadcast now?"))) return;
              if (await sendNow(bcTitle, bcBody, bcAll ? 'all' : 'group', selected?.id)) { setBcTitle(''); setBcBody(''); setBcOpen(false); }
            }}><Send size={15} />{bcOpen ? tx("Send broadcast") : tx("Prepare broadcast")}</button>
          </div>
          <div className="cc-box">
            <h4><Layers size={16} />{tx("Broadcast summary")}</h4>
            <dl className="cc-sum">
              <div><dt>{tx("Audience")}</dt><dd>{bcAll ? `${leafGroups.length} ${tx("kurels")}` : selected?.name ?? '—'}</dd></div>
              <div><dt>{tx("Channel")}</dt><dd>{tx("In-app message")}</dd></div>
              <div><dt>{tx("Schedule time")}</dt><dd>{tx("Now")}</dd></div>
              <div><dt>{tx("Delivery type")}</dt><dd>{tx("Announcement (Bulk)")}</dd></div>
            </dl>
          </div>
          <div className="cc-box">
            <div className="cc-stabs"><button type="button" className={side === 'recent' ? 'on' : ''} onClick={() => setSide('recent')}><Megaphone size={14} />{tx("Recent campaigns")}</button><button type="button" className={side === 'templates' ? 'on' : ''} onClick={() => setSide('templates')}><Layers size={14} />{tx("Saved templates")}</button></div>
            {side === 'recent' ? ann.slice(0, 4).map((a) => (
              <div className="cc-camp" key={a.id}><i><Megaphone size={15} /></i><span><b>{a.title}</b><small>{a.target === 'all' ? tx("All kurels") : groupName(a.targetGroupId) || tx("Group")} · {tx("Sent")} {fmtShort(a.ms)}</small></span><em><Check size={13} />{a.recipientCount}</em></div>
            )) : <p className="cx-empty">{tx("No saved template yet.")}</p>}
            {side === 'recent' && ann.length === 0 && <p className="cx-empty">{tx("No campaign sent yet.")}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

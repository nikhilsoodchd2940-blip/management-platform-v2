'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, limit as fsLimit, orderBy, query } from 'firebase/firestore';
import { Check, Crown, Globe2, MapPin, Building2, Users, MessageSquare, Send, Radio, Contact, ChevronRight } from 'lucide-react';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { sendAnnouncement } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import Dropdown from '@/components/Dropdown';
import { CxCard } from '@/components/Cx';
import { tx } from '@/lib/i18n/tr';

interface Row { id: string; title: string; body: string; target: string; sentMs: number }

/** Communication center of the pedagogical committee: send to every kurel or one kurel, and see what was sent recently. */
export default function PdComms() {
  const { activeLeafGroups } = useGroupHierarchy();
  const [tab, setTab] = useState<'message' | 'discussions' | 'contacts'>('message');
  const [scope, setScope] = useState<'all' | 'group'>('all');
  const [gid, setGid] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Row[]>([]);

  useEffect(() => onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), fsLimit(3)), (s) =>
    setRecent(s.docs.map((d) => { const x = d.data(); return { id: d.id, title: (x.title as string) ?? '', body: (x.body as string) ?? '', target: (x.target as string) ?? 'all', sentMs: (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0 }; }))), []);

  async function send() {
    if (!text.trim() || (scope === 'group' && !gid)) return;
    setBusy(true);
    try {
      const r = await sendAnnouncement({ title: tx('Message from the pedagogical committee'), body: text.trim(), target: scope, ...(scope === 'group' ? { targetGroupId: gid } : {}) });
      notify(`${tx("Sent to")} ${r.data.recipientCount} ${tx("recipients")}`, 'success');
      setText('');
    } catch (e) { notify(e instanceof Error ? e.message : tx("Could not send"), 'error'); } finally { setBusy(false); }
  }
  const soon = tx("Not available yet");
  const chips: [string, ReactIcon, boolean][] = [[tx("All kurels"), Check, true], [tx("One kurel"), Users, true], [tx("Zone committee"), MapPin, false], [tx("City committee"), Building2, false], [tx("Country committee"), Globe2, false], [tx("General committee"), Crown, false]];

  return (
    <div className="pd-comm">
      <CxCard dark icon={<MessageSquare size={22} />} title={tx("Communication center")} sub={tx("Exchange, communicate and contact the committees.")}>
        <div className="pd-ct" role="tablist">
          <button type="button" className={tab === 'message' ? 'on' : ''} onClick={() => setTab('message')}><MessageSquare size={15} /> {tx("Message")}</button>
          <Link href="/dashboard/messagerie"><Radio size={15} /> {tx("Discussions")}</Link>
          <Link href="/dashboard/committees"><Contact size={15} /> {tx("Contacts")}</Link>
        </div>
        <p className="pd-cl">{tx("Recipients (scope of the sending)")}</p>
        <div className="pd-cc">
          {chips.map(([l, Ic, on], i) => {
            const active = (i === 0 && scope === 'all') || (i === 1 && scope === 'group');
            return <button type="button" key={l} disabled={!on} title={on ? undefined : soon} className={active ? 'on' : ''} onClick={() => on && setScope(i === 0 ? 'all' : 'group')}><Ic size={15} /> {l}</button>;
          })}
        </div>
        {scope === 'group' && <Dropdown label={tx("Kurel")} value={gid} onChange={setGid} allLabel={tx("Choose a kurel")} options={activeLeafGroups.map((g) => ({ value: g.id, label: g.name }))} />}
        <textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Write your message…")} />
        <div className="pd-cs"><span>{text.length} / 1 000</span><button type="button" className="send" disabled={busy || !text.trim() || (scope === 'group' && !gid)} onClick={() => void send()}><Send size={16} /> {busy ? tx("Sending…") : tx("Send")}</button></div>
      </CxCard>
      <section className="pd-recent">
        <header><b>{tx("Recent communications")}</b><Link href="/dashboard/communications">{tx("See all")} <ChevronRight size={14} /></Link></header>
        {recent.length === 0 && <p className="kt-empty">{tx("Nothing sent yet.")}</p>}
        <ul>{recent.map((r) => (
          <li key={r.id}><Link href="/dashboard/communications"><i><Radio size={16} /></i><span><b>{r.title || tx("Message")}</b><small>{r.body}</small></span><em>{r.sentMs ? new Date(r.sentMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</em></Link></li>
        ))}</ul>
      </section>
    </div>
  );
}
type ReactIcon = typeof Check;

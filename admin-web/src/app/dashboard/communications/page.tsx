'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, orderBy, query, limit as fsLimit, type Timestamp } from 'firebase/firestore';
import { Bell, Check, ChevronLeft, ChevronRight, Eye, Image as ImageIcon, Layers, Megaphone, Pencil, Plus, Search, Users, X } from 'lucide-react';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import Dropdown from '@/components/Dropdown';
import CommsHeader from '@/components/CommsHeader';
import { CxCard, CxPill } from '@/components/Cx';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Kind = 'announcement' | 'popup' | 'banner';
interface Item { id: string; kind: Kind; title: string; sub: string; audience: string; active: boolean; ms: number; reach: number; img?: string; href: string }
const PAGE = 5;

/** Communications overview: every announcement, pop-up and banner in one list, with previews and quick actions. */
export default function CommunicationsPage() {
  const router = useRouter();
  const { byId } = useGroupHierarchy();
  const [ann, setAnn] = useState<Item[]>([]);
  const [pop, setPop] = useState<Item[]>([]);
  const [ban, setBan] = useState<Item[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [hash, setHash] = useState('');
  useEffect(() => { const h = () => setHash(window.location.hash.replace('#', '')); h(); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), fsLimit(100)), (s) =>
      setAnn(s.docs.map((d) => { const x = d.data(); return { id: d.id, kind: 'announcement' as Kind, title: (x.title as string) ?? '', sub: (x.body as string) ?? '', audience: x.target === 'group' ? (byId[x.targetGroupId as string]?.name ?? tx('Group')) : tx('All members'), active: true, ms: (x.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0, reach: (x.recipientCount as number) ?? 0, href: '/dashboard/announcements' }; })));
    const u2 = onSnapshot(query(collection(db, 'popups'), orderBy('order')), (s) =>
      setPop(s.docs.map((d) => { const x = d.data(); return { id: d.id, kind: 'popup' as Kind, title: (x.title as string) ?? '', sub: (x.description as string) ?? '', audience: tx('All members'), active: x.active === true, ms: (x.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0, reach: 0, img: x.imageUrl as string | undefined, href: '/dashboard/popups' }; })));
    const u3 = onSnapshot(query(collection(db, 'banners'), orderBy('order')), (s) =>
      setBan(s.docs.map((d) => { const x = d.data(); return { id: d.id, kind: 'banner' as Kind, title: (x.linkUrl as string) || tx('Banner'), sub: tx('Home banner'), audience: tx('All members'), active: x.active === true, ms: (x.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0, reach: 0, img: x.imageUrl as string | undefined, href: '/dashboard/banners' }; })));
    return () => { u1(); u2(); u3(); };
  }, [byId]);

  const all = useMemo(() => [...ann, ...pop, ...ban].sort((a, b) => b.ms - a.ms), [ann, pop, ban]);
  const rows = all.filter((i) => (!kind || i.kind === kind) && (!q.trim() || i.title.toLowerCase().includes(q.trim().toLowerCase())));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const KIND = { announcement: { label: tx('Announcement'), tone: 'green' as const, icon: <Megaphone size={14} /> }, popup: { label: tx('Pop-Up'), tone: 'amber' as const, icon: <Bell size={14} /> }, banner: { label: tx('Banner'), tone: 'blue' as const, icon: <ImageIcon size={14} /> } };
  const d = (ms: number) => (ms ? new Date(ms).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }) : '—');
  const lastAnn = ann[0]; const lastPop = pop.find((p) => p.active) ?? pop[0]; const lastBan = ban.find((b) => b.active) ?? ban[0];

  if (hash === 'templates' || hash === 'history') {
    return (
      <div className="cx-page cm">
        <CommsHeader />
        {hash === 'templates' ? (
          <CxCard icon={<Layers size={18} />} title={tx('Templates')} sub={tx('Reusable announcement, pop-up and banner models.')}>
            <p className="cx-empty">{tx('No saved template yet. Create an announcement, pop-up or banner first.')}</p>
          </CxCard>
        ) : (
          <CxCard icon={<Megaphone size={18} />} title={tx('History & Reports')} sub={tx('Everything sent so far, newest first.')}>
            <table className="cx-table"><thead><tr><th>{tx('Title')}</th><th>{tx('Type')}</th><th>{tx('Audience')}</th><th>{tx('Date')}</th><th>{tx('Reach')}</th></tr></thead>
              <tbody>{all.length === 0 && <tr><td colSpan={5} className="cx-empty">{tx('Nothing sent yet.')}</td></tr>}
                {all.slice(0, 50).map((i) => <tr key={i.kind + i.id}><td><b>{i.title}</b></td><td><CxPill tone={KIND[i.kind].tone}>{KIND[i.kind].label}</CxPill></td><td>{i.audience}</td><td>{d(i.ms)}</td><td>{i.reach || '—'}</td></tr>)}</tbody></table>
          </CxCard>
        )}
      </div>
    );
  }

  return (
    <div className="cx-page cm">
      <CommsHeader />
      <div className="cx-grid cx-g21 cm-main">
        <div className="cm-left">
          <CxCard dark icon={<Megaphone size={18} />} title={tx('Recent & Active Communications')} sub={tx('Latest announcements, pop-ups and banners with their status and reach.')}
            right={<div className="cm-tools"><label className="cx-search sm"><Search size={14} /><input type="search" placeholder={tx('Search by title...')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
              <Dropdown label={tx('Type')} value={kind} onChange={(v) => { setKind(v); setPage(1); }} allLabel={tx('All types')} options={[{ value: 'announcement', label: tx('Announcements') }, { value: 'popup', label: tx('Pop-Ups') }, { value: 'banner', label: tx('Banners') }]} /></div>}>
            <div className="cx-scroll"><table className="cx-table cm-table">
              <thead><tr><th>{tx('Title')}</th><th>{tx('Type')}</th><th>{tx('Audience')}</th><th>{tx('Status')}</th><th>{tx('Created')}</th><th>{tx('Reach')}</th><th>{tx('Actions')}</th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={7} className="cx-empty">{tx('Nothing here yet. Use Create New.')}</td></tr>}
                {shown.map((i) => (
                  <tr key={i.kind + i.id}>
                    <td><span className="cm-th">{i.img ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={i.img} alt="" /> : KIND[i.kind].icon}</span><span className="cm-tt"><b>{i.title}</b><small>{i.sub}</small></span></td>
                    <td><CxPill tone={KIND[i.kind].tone}>{KIND[i.kind].label}</CxPill></td>
                    <td>{i.audience}</td>
                    <td>{i.active ? <CxPill tone="green" dot>{tx('Active')}</CxPill> : <CxPill tone="grey" dot>{tx('Inactive')}</CxPill>}</td>
                    <td>{d(i.ms)}</td>
                    <td><Users size={13} /> {i.reach || '—'}</td>
                    <td className="cm-act"><button type="button" title={tx('Open')} onClick={() => router.push(i.href)}><Eye size={16} /></button><button type="button" title={tx('Edit')} onClick={() => router.push(i.href)}><Pencil size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="cx-pager"><span>{tx('Showing')} {rows.length ? (cur - 1) * PAGE + 1 : 0}–{Math.min(cur * PAGE, rows.length)} {tx('of')} {rows.length} {tx('items')}</span>
              <div><button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)}><ChevronLeft size={15} /></button>
                {Array.from({ length: Math.min(pages, 5) }, (_, k) => k + 1).map((n) => <button type="button" key={n} className={n === cur ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
                <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)}><ChevronRight size={15} /></button></div></div>
          </CxCard>

          <CxCard dark icon={<Eye size={18} />} title={tx('Preview & Management')} sub={tx('Visualize your communications before and during publication.')}>
            <div className="cx-grid cx-g3 cm-prev">
              <div className="cm-pv ann"><small><Megaphone size={13} /> {tx('Announcement')}</small>{lastAnn ? <div className="cm-card"><b>{lastAnn.title}</b><p>{lastAnn.sub}</p></div> : <p className="cx-empty">{tx('No announcement yet.')}</p>}</div>
              <div className="cm-pv pop"><small><Bell size={13} /> {tx('Pop-Up')}</small>{lastPop ? <div className="cm-card pop">{lastPop.img && /* eslint-disable-next-line @next/next/no-img-element */ <img src={lastPop.img} alt="" />}<b>{lastPop.title}</b><p>{lastPop.sub}</p><span className="cm-ok">OK</span></div> : <p className="cx-empty">{tx('No pop-up yet.')}</p>}</div>
              <div className="cm-pv ban"><small><ImageIcon size={13} /> {tx('Banner')}</small>{lastBan?.img ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="cm-banimg" src={lastBan.img} alt="" /> : <p className="cx-empty">{tx('No banner yet.')}</p>}</div>
            </div>
          </CxCard>
        </div>

        <div className="cm-right">
          <CxCard icon={<Plus size={18} />} title={tx('Quick Actions')}>
            <div className="cm-qa">
              <button type="button" className="g" onClick={() => router.push('/dashboard/announcements')}><Megaphone size={18} /><span>+ {tx('New Announcement')}</span></button>
              <button type="button" className="y" onClick={() => router.push('/dashboard/popups')}><Bell size={18} /><span>+ {tx('New Pop-Up')}</span></button>
              <button type="button" className="b" onClick={() => router.push('/dashboard/banners')}><ImageIcon size={18} /><span>+ {tx('New Banner')}</span></button>
              <button type="button" onClick={() => { window.location.hash = 'templates'; }}><Layers size={18} /><span>{tx('Use a Template')}</span></button>
            </div>
          </CxCard>
          <CxCard icon={<Users size={18} />} title={tx('Target Audience')}>
            <ul className="cm-aud">{[tx('All members'), tx('By country'), tx('By city'), tx('By zone / pole'), tx('By kurel'), tx('By role (managers, supervisors, etc.)')].map((a) => <li key={a}><Check size={14} />{a}</li>)}</ul>
          </CxCard>
        </div>
      </div>
    </div>
  );
}

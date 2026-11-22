'use client';

import '../../px/index.css';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { limit as fsLimit, orderBy, type Timestamp } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { formatDuration, formatInZone } from '@/lib/timeZones';
import { SELECTION_LABEL, type Remark, type Selection, type Slot } from '../events/planParts';
import Dropdown from '@/components/Dropdown';
import { Clear } from '@/components/kit';
import { CxBanner, CxBar, CxCard, CxDonut, CxInitials, CxPill, CxStats, CxTabs } from '@/components/Cx';
import { Archive, BarChart3, Calendar, CheckCircle2, ChevronDown, ChevronRight, Download, FileText, Layers, MapPin, MessageCircle, Mic, Plus, Search, Trophy, Users, Eye, Clock, BookOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { tx } from '@/lib/i18n/tr';

interface EventRow { title: string }
type Sel = Selection & { reviewLog?: { action: string; byName: string; at: Timestamp; reason?: string }[] };

const STATUS: Record<string, { text: string; cls: string }> = {
  scheduled: { text: 'Not started', cls: 'warn' },
  started: { text: 'Started', cls: 'ok' },
  completed: { text: 'Completed', cls: '' },
};

/** Everything a group has done on stage, kept for good, so feedback and instructions can guide the next event. */
export default function PerformanceHistoryPage() {
  const { byId, countries, cities, activeLeafGroups } = useGroupHierarchy();
  const { allows } = useMyScope();
  const slots = useCollection<Slot>('eventSlots', [orderBy('startAt', 'desc'), fsLimit(500)], 'hist');
  const sels = useCollection<Sel>('performanceSelections', [fsLimit(1000)], 'hist-sel');
  const remarks = useCollection<Remark & { slotId: string }>('performanceRemarks', [orderBy('createdAt', 'desc'), fsLimit(1000)], 'hist-rem');
  const events = useCollection<EventRow>('events', [fsLimit(1000)], 'hist-ev');
  const zones = useZones();
  const [country, setCountry] = useState('');
  const [zone, setZone] = useState('');
  const [city, setCity] = useState('');
  const [group, setGroup] = useState('');
  const [perf, setPerf] = useState('');
  const [apr, setApr] = useState('');
  const [q, setQ] = useState('');
  const [openG, setOpenG] = useState('');
  const [inner, setInner] = useState<'perf' | 'stats' | 'fb'>('perf');
  const [tab, setTab] = useState<'group' | 'location' | 'year' | 'stats'>('group');
  const [order, setOrder] = useState<'perf' | 'name'>('perf');
  const router = useRouter();

  const titleOf = (id: string) => events?.find((e) => e.id === id)?.title ?? '—';
  const base = useMemo(() => (slots ?? []).filter((s) => allows(s)
    && (!country || s.countryId === country) && (!zone || s.zoneId === zone) && (!city || s.cityId === city) && (!group || s.groupId === group)), [slots, allows, country, zone, city, group]);
  const selOf = (id: string) => sels?.find((x) => x.id === id);
  const term = q.trim().toLowerCase();
  const rows = useMemo(() => base.filter((s) => (!perf || (s.performanceStatus ?? 'scheduled') === perf) && (!apr || (selOf(s.id)?.status ?? 'none') === apr)
    && (!term || titleOf(s.eventId).toLowerCase().includes(term) || s.groupName.toLowerCase().includes(term))), [base, perf, apr, term, sels, events]); // eslint-disable-line react-hooks/exhaustive-deps
  const byGroup = useMemo(() => {
    const m = new Map<string, Slot[]>();
    rows.forEach((s) => m.set(s.groupId, [...(m.get(s.groupId) ?? []), s]));
    return [...m.entries()];
  }, [rows]);
  const leaf = (activeLeafGroups ?? []).filter((g) => allows({ groupId: g.id, cityId: g.parentGroupId }));
  const filtering = !!(country || zone || city || group || perf || apr || q);
  const clear = () => { setCountry(''); setZone(''); setCity(''); setGroup(''); setPerf(''); setApr(''); setQ(''); };
  const nApproved = base.filter((s) => selOf(s.id)?.status === 'approved').length;
  const nFeedback = base.filter((s) => (remarks ?? []).some((r) => r.slotId === s.id)).length;

  const nCompleted = base.filter((s) => s.performanceStatus === 'completed').length;
  const nNotStarted = base.filter((s) => (s.performanceStatus ?? 'scheduled') === 'scheduled').length;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const remCount = (id: string) => (remarks ?? []).filter((r) => r.slotId === id).length;
  const groupStats = byGroup.map(([gid, list]) => ({ gid, list, name: list[0].groupName, city: byId[list[0].cityId]?.name ?? '', n: list.length, done: list.filter((s) => s.performanceStatus === 'completed').length, appr: list.filter((s) => selOf(s.id)?.status === 'approved').length, fb: list.filter((s) => remCount(s.id) > 0).length }))
    .sort((a, b) => (order === 'perf' ? b.n - a.n : a.name.localeCompare(b.name)));
  const years = useMemo(() => { const m = new Map<number, number>(); base.forEach((s) => { const y = new Date(tsMs(s.startAt)).getFullYear(); m.set(y, (m.get(y) ?? 0) + 1); }); return [...m.entries()].sort((a, b) => a[0] - b[0]).slice(-5); }, [base]);
  const locations = useMemo(() => { const m = new Map<string, number>(); base.forEach((s) => { const c = byId[s.cityId]?.name ?? '—'; m.set(c, (m.get(c) ?? 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [base, byId]);
  const top3 = [...groupStats].sort((a, b) => b.n - a.n).slice(0, 3);
  const matOf = (id: string) => { const sel = selOf(id); return sel?.items?.length ? sel.items.map((x) => x.title).join(', ') : '—'; };
  function exportCsv() {
    const lines = [['Date', 'Event', 'Group', 'Location', 'Material', 'Duration', 'Status', 'Approval'], ...rows.map((s) => [formatInZone(tsMs(s.startAt), s.timeZone), titleOf(s.eventId), s.groupName, byId[s.cityId]?.name ?? '', matOf(s.id), formatDuration(s.allocatedSeconds), STATUS[s.performanceStatus ?? 'scheduled'].text, SELECTION_LABEL[selOf(s.id)?.status ?? 'none'].text])];
    const csv = lines.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'performance-history.csv'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <main className="fx2-page zp cx-page ph-page">
      <CxBanner icon={<Archive size={26} />} kicker={tx("Archive")} title={tx("Performance history")} sub={tx("Each group's past events, chosen audio or books, dates, status, approval record, feedback and instructions for next time.")}>
        <button type="button" className="cx-btn ghost-light" onClick={exportCsv}><Download size={16} />{tx("Export")}</button>
        <button type="button" className="cx-btn gold" onClick={() => router.push('/dashboard/events')}><Plus size={18} />{tx("Add a record")}</button>
      </CxBanner>

      <CxStats items={[
        { label: tx("Performances"), value: base.length, icon: <Mic size={24} />, tone: 'dark', onClick: () => { setPerf(''); setApr(''); } },
        { label: tx("Completed"), value: nCompleted, badge: `${pct(nCompleted, base.length)}%`, icon: <CheckCircle2 size={24} />, tone: 'green', onClick: () => setPerf(perf === 'completed' ? '' : 'completed') },
        { label: tx("Approved"), value: nApproved, badge: `${pct(nApproved, base.length)}%`, icon: <CheckCircle2 size={24} />, tone: 'green', onClick: () => setApr(apr === 'approved' ? '' : 'approved') },
        { label: tx("With feedback"), value: nFeedback, badge: `${pct(nFeedback, base.length)}%`, icon: <MessageCircle size={24} />, tone: 'amber' },
      ]} />

      <section className="cx-filters ph-filters">
        <label className="cx-search"><Search size={18} /><input type="search" placeholder={tx("Search an event or a group")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setZone(''); setCity(''); setGroup(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("Zone")} value={zone} onChange={(v) => { setZone(v); setCity(''); setGroup(''); }} allLabel={tx("All zones")} options={(zones ?? []).filter((z) => !country || z.countryId === country).map((z) => ({ value: z.id, label: z.name }))} className="loc-dd" />
        <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setGroup(''); }} allLabel={tx("All cities")} options={cities.filter((c) => (!country || c.parentGroupId === country) && (!zone || c.zoneId === zone)).map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("Group")} value={group} onChange={setGroup} allLabel={tx("All groups")} options={leaf.filter((g) => !city || g.parentGroupId === city).map((g) => ({ value: g.id, label: g.name }))} className="loc-dd" />
        <Dropdown label={tx("Status")} value={perf} onChange={setPerf} allLabel={tx("All statuses")} options={Object.entries(STATUS).map(([k, v]) => ({ value: k, label: tx(v.text) }))} className="loc-dd" />
        <Dropdown label={tx("Approval")} value={apr} onChange={setApr} allLabel={tx("Any status")} options={['none', 'submitted', 'approved', 'rejected', 'needs_revision'].map((k) => ({ value: k, label: tx(SELECTION_LABEL[k].text) }))} className="loc-dd" />
        {filtering && <Clear onClick={clear} />}
      </section>

      <CxTabs value={tab} onChange={(v) => setTab(v as typeof tab)} items={[
        { value: 'group', label: tx("By group"), icon: <Users size={20} /> },
        { value: 'location', label: tx("By location"), icon: <MapPin size={20} /> },
        { value: 'year', label: tx("By year"), icon: <Calendar size={20} /> },
        { value: 'stats', label: tx("Statistics"), icon: <BarChart3 size={20} /> },
      ]} />

      <div className="cx-grid cx-g3 ph-top">
        <CxCard icon={<BarChart3 size={22} />} title={tx("Status overview")}>
          <div className="at-donut">
            <CxDonut size={150} big={base.length} label={tx("Performances")} slices={[{ value: nCompleted, color: '#1f9d63' }, { value: nApproved, color: '#3b82f6' }, { value: nFeedback, color: '#e0a21b' }, { value: nNotStarted, color: '#b9c6bf' }]} />
            <ul className="at-leg">
              <li><i style={{ background: '#1f9d63' }} />{tx("Completed")}<b>{nCompleted} ({pct(nCompleted, base.length)}%)</b></li>
              <li><i style={{ background: '#3b82f6' }} />{tx("Approved")}<b>{nApproved} ({pct(nApproved, base.length)}%)</b></li>
              <li><i style={{ background: '#e0a21b' }} />{tx("With feedback")}<b>{nFeedback} ({pct(nFeedback, base.length)}%)</b></li>
              <li><i style={{ background: '#b9c6bf' }} />{tx("Not started")}<b>{nNotStarted} ({pct(nNotStarted, base.length)}%)</b></li>
            </ul>
          </div>
        </CxCard>
        <CxCard icon={<Calendar size={22} />} title={tx("Performances by year")}>
          {years.length === 0 ? <p className="kt-empty">{tx("No performance recorded for these filters.")}</p> : (
            <div className="cx-vbars">{years.map(([y, n], i) => <div key={y}><b>{n}</b><u><s className={i === years.length - 1 ? 'gold' : ''} style={{ height: `${(n / Math.max(1, ...years.map((x) => x[1]))) * 100}%` }} /></u><span>{y}</span></div>)}</div>
          )}
        </CxCard>
        <CxCard tone="amber" icon={<Trophy size={22} />} title={tx("Most active groups")}>
          <ol className="ph-top3">{top3.map((g, i) => <li key={g.gid}><b>{i + 1}</b><strong>{g.name}</strong><em>{g.n}</em></li>)}{top3.length === 0 && <li className="ev-none">—</li>}</ol>
        </CxCard>
      </div>

      {tab === 'location' && (
        <CxCard dark icon={<MapPin size={22} />} title={tx("Performances by location")}>
          <ul className="at-groups">{locations.map(([c, n], i) => <li key={c}><b>{i + 1}</b><span className="at-pin"><MapPin size={18} /></span><span><strong>{c}</strong></span><CxBar pct={(n / Math.max(1, locations[0]?.[1] ?? 1)) * 100} thick /><em>{n}</em></li>)}</ul>
        </CxCard>
      )}
      {tab === 'year' && (
        <CxCard dark icon={<Calendar size={22} />} title={tx("Performances by year")}>
          <ul className="at-groups">{[...years].reverse().map(([y, n], i) => <li key={y}><b>{i + 1}</b><span className="at-pin"><Calendar size={18} /></span><span><strong>{y}</strong></span><CxBar pct={(n / Math.max(1, ...years.map((x) => x[1]))) * 100} thick /><em>{n}</em></li>)}</ul>
        </CxCard>
      )}
      {tab === 'stats' && (
        <CxCard dark icon={<BarChart3 size={22} />} title={tx("Statistics")}>
          <div className="at-stats"><div><b>{base.length}</b><span>{tx("Performances")}</span></div><div><b>{byGroup.length}</b><span>{tx("Groups")}</span></div><div><b>{pct(nCompleted, base.length)}%</b><span>{tx("Completed")}</span></div><div><b>{pct(nApproved, base.length)}%</b><span>{tx("Approved")}</span></div></div>
        </CxCard>
      )}

      {tab === 'group' && (
        <CxCard dark id="ph-groups" icon={<Users size={22} />} title={<>{tx("Groups")} ({groupStats.length})</>}
          right={<Dropdown label={tx("Sort by")} value={order} onChange={(v) => setOrder((v || 'perf') as typeof order)} allLabel={tx("Most performances")} options={[{ value: 'name', label: tx("Name (A-Z)") }]} className="loc-dd" />}>
          {slots === null ? <p>{tx("Loading…")}</p> : groupStats.length === 0 ? <p className="kt-empty">{tx("No performance recorded for these filters.")}</p> : (
            <div className="ph-groups">
              <div className="ph-gh"><span>{tx("Group")}</span><span>{tx("Location")}</span><span>{tx("Performances")}</span><span>{tx("Completed")}</span><span>{tx("Approved")}</span><span>{tx("With feedback")}</span><span /></div>
              {groupStats.map((g) => {
                const open = openG === g.gid;
                return (
                  <div key={g.gid} className={`ph-g${open ? ' open' : ''}`}>
                    <div className="ph-gr" role="button" tabIndex={0} onClick={() => { setOpenG(open ? '' : g.gid); setInner('perf'); }} onKeyDown={(e) => e.key === 'Enter' && setOpenG(open ? '' : g.gid)}>
                      <span className="ph-gn">{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<CxInitials name={g.name} size={40} /><strong>{g.name}</strong></span>
                      <span className="ph-gl"><MapPin size={15} />{g.city}</span>
                      <span className="ph-c"><Calendar size={18} /><b>{g.n}</b></span>
                      <span className="ph-c ok"><CheckCircle2 size={18} /><b>{g.done}</b></span>
                      <span className="ph-c gold"><CheckCircle2 size={18} /><b>{g.appr}</b></span>
                      <span className="ph-c red"><MessageCircle size={18} /><b>{g.fb}</b></span>
                      <span className="ph-ga"><span className="cx-btn sm"><FileText size={14} />{tx("View details")}</span></span>
                    </div>
                    {open && (
                      <div className="ph-in">
                        <div className="ph-it">
                          <button type="button" className={inner === 'perf' ? 'on' : ''} onClick={() => setInner('perf')}>{tx("Performances")} ({g.n})</button>
                          <button type="button" className={inner === 'stats' ? 'on' : ''} onClick={() => setInner('stats')}>{tx("Statistics")}</button>
                          <button type="button" className={inner === 'fb' ? 'on' : ''} onClick={() => setInner('fb')}>{tx("Feedback")} ({g.fb})</button>
                        </div>
                        {inner === 'perf' && (
                          <div className="cx-scroll"><table className="cx-table ph-t">
                            <thead><tr><th>{tx("Date")}</th><th>{tx("Event")}</th><th>{tx("Location")}</th><th>{tx("Material")}</th><th>{tx("Duration")}</th><th>{tx("Status")}</th><th>{tx("Approval")}</th><th /></tr></thead>
                            <tbody>{g.list.map((s) => { const st = STATUS[s.performanceStatus ?? 'scheduled']; const sl = SELECTION_LABEL[selOf(s.id)?.status ?? 'none']; return (
                              <tr key={s.id}>
                                <td><span className="at-loc"><Calendar size={15} />{formatInZone(tsMs(s.startAt), s.timeZone)}</span></td>
                                <td><Link href={`/dashboard/events/${s.eventId}`} className="lnk"><strong>{titleOf(s.eventId)}</strong></Link></td>
                                <td><Link href="/dashboard/locations" className="at-loc lnk"><MapPin size={15} />{byId[s.cityId]?.name ?? ''}</Link></td>
                                <td><Link href="/dashboard/library" className="at-loc lnk"><BookOpen size={15} />{matOf(s.id)}</Link></td>
                                <td><span className="at-loc"><Clock size={15} />{formatDuration(s.allocatedSeconds)}</span></td>
                                <td><CxPill tone={st.cls === 'ok' ? 'green' : st.cls === 'warn' ? 'amber' : 'green'}>{tx(st.text)}</CxPill></td>
                                <td><CxPill tone={sl.cls === 'ok' ? 'green' : sl.cls === 'warn' ? 'amber' : sl.cls === 'bad' ? 'red' : 'grey'}>{tx(sl.text)}</CxPill></td>
                                <td><Link className="cx-btn sm" href={`/dashboard/events/${s.eventId}`} title={tx("Open the event plan")}><Eye size={15} /></Link></td>
                              </tr>); })}</tbody></table></div>
                        )}
                        {inner === 'stats' && <div className="at-stats"><div><b>{g.n}</b><span>{tx("Performances")}</span></div><div><b>{pct(g.done, g.n)}%</b><span>{tx("Completed")}</span></div><div><b>{pct(g.appr, g.n)}%</b><span>{tx("Approved")}</span></div><div><b>{pct(g.fb, g.n)}%</b><span>{tx("With feedback")}</span></div></div>}
                        {inner === 'fb' && (
                          <ul className="ph-rem">
                            {g.list.flatMap((s) => (remarks ?? []).filter((r) => r.slotId === s.id).map((r) => <li key={r.id} className={r.kind === 'instruction' ? 'ins' : ''}><em>{r.kind === 'instruction' ? tx("Instruction for next time: ") : tx("Feedback: ")}</em>{r.text} <small>({r.authorName}, {titleOf(s.eventId)})</small></li>))}
                            {g.fb === 0 && <li>{tx("No feedback yet.")}</li>}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CxCard>
      )}
      <p className="ph-foot"><Layers size={14} /> {tx("Open the event plan from a performance to see its approval record.")}</p>
    </main>
  );
}

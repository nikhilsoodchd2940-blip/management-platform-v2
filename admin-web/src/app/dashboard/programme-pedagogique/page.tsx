'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarClock, ClipboardCheck, Music2, Pencil, Plus, RefreshCw, Send, Users, BarChart3, Calendar, FileText, Globe2, Building2, Crown, MapPin, Hourglass, Layers, MessageSquare, Upload, Mail, Play, Network, Target, Zap, Eye } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { collection, limit as fsLimit, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { fmt } from '@/lib/liveStats';
import { useCollection } from '@/lib/useCollection';
import { submitEventProgram, recordProgramPerformance } from '@/lib/functions';
import { notify } from '@/lib/notify';
import FormDialog from '@/components/FormDialog';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import ManageToggle from '../../px/ManageToggle';
import CurriculumManage from './Manage';
import Dropdown from '@/components/Dropdown';
import { EbBar, EbPanel, EbPill, EbSearch, EbTable, EB_COLS, EB_SOFT, type EbCol } from '@/components/Eb';
import Link from 'next/link';
import { tx } from '@/lib/i18n/tr';
import { CxBanner, CxBar, CxCard, CxDonut, CxInitials, CxLine, CxPill, CxStats, CxTabs } from '@/components/Cx';
import { useZones } from '@/lib/useZones';

interface Material {
  id: string;
  code: string;
  title: string;
  melody: string;
  levelId?: string;
  durationSeconds?: number;
  status: string;
}
interface Allocation {
  qacaidId: string;
  groupId: string;
}
interface Report {
  id: string;
  groupId: string;
  masteryPct: number;
  melodyPct: number;
  timingPct: number;
  directivesPct: number;
  submittedMs: number;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const mmss = (s?: number) => (s ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : '—');

/** Pedagogical committee — the approved layout on Firebase data. */
export default function PedagogicalCommitteePage() {
  const { byId, activeLeafGroups, locationOf, countries, cities } = useGroupHierarchy();
  const { levels, byId: levelById } = useLevels();
  const router = useRouter();
  const zones = useZones();
  const [tab, setTab] = useState<'overview' | 'assign' | 'books' | 'programs' | 'progress' | 'reports'>('overview');
  const [gQ, setGQ] = useState('');
  const [gLevel, setGLevel] = useState('');
  const [gCountry, setGCountry] = useState('');
  const [gCity, setGCity] = useState('');
  const [gPage, setGPage] = useState(1);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [melodyFilter, setMelodyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignFilter, setAssignFilter] = useState('');
  const [progStatus, setProgStatus] = useState('');
  const [manageSignal, setManageSignal] = useState(0);
  const [progDialog, setProgDialog] = useState<null | 'submit' | { record: string }>(null);
  const [progEvent, setProgEvent] = useState('');
  const [liveEventId, setLiveEventId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const eventsRaw = useCollection<{ title: string; status: string; subGroupIds: string[]; startAt: { toMillis: () => number }; endAt: { toMillis: () => number } }>('events', [orderBy('startAt', 'desc'), fsLimit(100)]);
  const events = useMemo(() => (eventsRaw ?? []).filter((e) => e.status === 'published'), [eventsRaw]);
  const programsRaw = useCollection<{ eventId: string; groupId: string; allocatedSeconds: number; status: string; items: { qacaidId: string; title: string; melody?: string; plannedSeconds: number; actualSeconds?: number; rating?: number }[]; feedback?: { text: string; kind: string } }>('eventPrograms', [orderBy('updatedAt', 'desc'), fsLimit(60)]);
  const programs = useMemo(() => programsRaw ?? [], [programsRaw]);
  const liveEvent = events.find((e) => e.id === liveEventId) ?? events.find((e) => e.startAt.toMillis() <= now && e.endAt.toMillis() >= now);
  const liveProgs = programs.filter((p) => p.eventId === liveEvent?.id);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'qacaid'), orderBy('code')), (snap) =>
      setMaterials(
        snap.docs.map((d) => ({
          id: d.id,
          code: (d.data().code as string) ?? '',
          title: (d.data().title as string) ?? '',
          melody: (d.data().melody as string) ?? '',
          levelId: (d.data().levelId as string) || undefined,
          durationSeconds: d.data().durationSeconds as number | undefined,
          status: (d.data().status as string) ?? 'active',
        }))
      )
    );
    const u2 = onSnapshot(collection(db, 'qacaidAllocations'), (snap) =>
      setAllocations(snap.docs.map((d) => ({ qacaidId: d.data().qacaidId as string, groupId: d.data().groupId as string })))
    );
    const u3 = onSnapshot(query(collection(db, 'progressReports'), orderBy('submittedAt', 'desc'), fsLimit(200)), (snap) =>
      setReports(
        snap.docs.map((d) => ({
          id: d.id,
          groupId: d.data().groupId as string,
          masteryPct: Number(d.data().masteryPct) || 0,
          melodyPct: Number(d.data().melodyPct) || 0,
          timingPct: Number(d.data().timingPct) || 0,
          directivesPct: Number(d.data().directivesPct) || 0,
          submittedMs: (d.data().submittedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0,
        }))
      )
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const allocCount = useMemo(() => {
    const m: Record<string, number> = {};
    allocations.forEach((a) => (m[a.qacaidId] = (m[a.qacaidId] ?? 0) + 1));
    return m;
  }, [allocations]);

  const rows = materials.filter(
    (m) => (!levelFilter || (levelFilter === '__none__' ? !m.levelId : m.levelId === levelFilter)) && (!melodyFilter || m.melody === melodyFilter) && (!statusFilter || m.status === statusFilter) && (!assignFilter || (assignFilter === 'none' ? !(allocCount[m.id] ?? 0) : (allocCount[m.id] ?? 0) > 0)) && (!search.trim() || `${m.title} ${m.code} ${m.melody}`.toLowerCase().includes(search.trim().toLowerCase()))
  );
  const melodyList = Array.from(new Set(materials.map((m) => m.melody).filter(Boolean))).sort();
  const anyFilter = !!(search || levelFilter || melodyFilter || statusFilter || assignFilter);
  const clearFilters = () => { setSearch(''); setLevelFilter(''); setMelodyFilter(''); setStatusFilter(''); setAssignFilter(''); };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  const mastery = avg(reports.map((r) => r.masteryPct));
  const melody = avg(reports.map((r) => r.melodyPct));
  const timing = avg(reports.map((r) => r.timingPct));
  const directives = avg(reports.map((r) => r.directivesPct));
  const overall = avg([mastery, melody, timing, directives].filter((x): x is number => x !== null));
  const melodies = new Set(materials.map((m) => m.melody).filter(Boolean)).size;

  const kurelsByLevel = (levelId: string) => activeLeafGroups.filter((g) => g.levelId === levelId).length;
  const recentAlloc = useMemo(
    () =>
      materials
        .map((m) => ({ m, n: allocCount[m.id] ?? 0 }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 4),
    [materials, allocCount]
  );
  const lowReports = useMemo(() => {
    const latest = new Map<string, Report>();
    reports.forEach((r) => !latest.has(r.groupId) && latest.set(r.groupId, r));
    return [...latest.values()]
      .map((r) => ({ r, pct: Math.round((r.masteryPct + r.melodyPct + r.timingPct + r.directivesPct) / 4) }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 4);
  }, [reports]);

  const bar = (label: string, v: number | null) => (
    <div>
      <div className="eb2-bh"><span>{label}</span><b>{v === null ? '—' : `${v}%`}</b></div>
      <div className="eb2-bar2"><i style={{ ['--p' as string]: `${v ?? 0}%` }} /></div>
    </div>
  );
  const manage = () => setManageSignal((n) => n + 1);
  const levelName = (m: Material) => (m.levelId && levelById[m.levelId] ? levelById[m.levelId].name : '');
  const nUnleveled = activeLeafGroups.filter((g) => !g.levelId).length;

  const bookCols: EbCol<Material>[] = [
    { key: 'book', label: tx("Book"), width: '26%', stack: true, sort: (m) => m.title.toLowerCase(), onCell: () => manage(), hint: tx("Manage this book"), render: (m) => <><b>{m.title}</b><small>{m.code}</small></> },
    { key: 'melody', label: tx("Melody"), width: '16%', sort: (m) => (m.melody || '~').toLowerCase(), onCell: (m) => { if (m.melody) setMelodyFilter(melodyFilter === m.melody ? '' : m.melody); else manage(); }, hint: tx("Show only this melody"), render: (m) => <span>{m.melody || '—'}</span> },
    { key: 'duration', label: tx("Duration"), width: '12%', num: true, sort: (m) => m.durationSeconds ?? 0, onCell: () => manage(), hint: tx("Manage this book"), render: (m) => <span>{mmss(m.durationSeconds)}</span> },
    { key: 'level', label: tx("Level"), width: '14%', sort: (m) => levelById[m.levelId ?? '']?.rank ?? 99, onCell: (m) => setLevelFilter(m.levelId ?? '__none__'), hint: tx("Show only this level"), render: (m) => (levelName(m) ? <EbPill tone="ok">{levelName(m)}</EbPill> : <EbPill tone="red">{tx("No level")}</EbPill>) },
    { key: 'assigned', label: tx("Assigned to"), width: '16%', sort: (m) => allocCount[m.id] ?? 0, onCell: () => manage(), hint: tx("Assign this book to a kurel"), render: (m) => <span>{allocCount[m.id] ?? 0} {tx("kurel")}{(allocCount[m.id] ?? 0) === 1 ? '' : 's'}</span> },
    { key: 'status', label: tx("Status"), width: '16%', sort: (m) => m.status, onCell: (m) => setStatusFilter(statusFilter === m.status ? '' : m.status), hint: tx("Show only this status"), render: (m) => <EbPill tone={m.status === 'active' ? 'ok' : 'gold'}>{m.status === 'active' ? tx("Active") : tx("Retired")}</EbPill> },
  ];

  type Prog = (typeof programs)[number];
  const progRows = programs.filter((p) => !progStatus || p.status === progStatus);
  const evTitle = (p: Prog) => (eventsRaw ?? []).find((e) => e.id === p.eventId)?.title ?? tx("Event");
  const plannedOf = (p: Prog) => p.items.reduce((a, i) => a + i.plannedSeconds, 0);
  const openLive = (p: Prog) => { setLiveEventId(p.eventId); go('direct'); };
  const progCols: EbCol<Prog>[] = [
    { key: 'kurel', label: tx("Kurel"), width: '20%', stack: true, sort: (p) => (byId[p.groupId]?.name ?? p.groupId).toLowerCase(), onCell: openLive, hint: tx("Follow this event live"), render: (p) => <b>{byId[p.groupId]?.name ?? p.groupId}</b> },
    { key: 'event', label: tx("Event"), width: '20%', sort: (p) => evTitle(p).toLowerCase(), onCell: openLive, hint: tx("Follow this event live"), render: (p) => <span>{evTitle(p)}</span> },
    { key: 'books', label: tx("Book"), width: '9%', num: true, sort: (p) => p.items.length, onCell: (p) => setProgDialog({ record: p.id }), hint: tx("Record the performance"), render: (p) => <EbPill tone="teal">{p.items.length}</EbPill> },
    { key: 'time', label: tx("Time"), width: '16%', sort: (p) => plannedOf(p), onCell: (p) => setProgDialog({ record: p.id }), hint: tx("Record the performance"), render: (p) => <span>{mmss(plannedOf(p))} {tx("of")} {mmss(p.allocatedSeconds)}</span> },
    { key: 'status', label: tx("Status"), width: '12%', sort: (p) => p.status, onCell: (p) => setProgStatus(progStatus === p.status ? '' : p.status), hint: tx("Show only this status"), render: (p) => <EbPill tone={p.status === 'performed' ? 'ok' : 'gold'}>{p.status === 'performed' ? tx("performed") : tx("submitted")}</EbPill> },
    { key: 'feedback', label: tx("Feedback"), width: '13%', stack: true, onCell: (p) => setProgDialog({ record: p.id }), hint: tx("Record the performance"), render: (p) => (p.feedback ? <><small>{p.feedback.kind}</small><span>{p.feedback.text}</span></> : <span className="mut">—</span>) },
    { key: 'actions', label: tx("Actions"), width: '10%', actions: true, render: (p) => <span className="eb2-acts-row"><button type="button" className="eb2-ibt" aria-label={tx("Record the performance")} title={tx("Record the performance")} onClick={() => setProgDialog({ record: p.id })}><Pencil size={15} /></button></span> },
  ];

  const liveItems = liveProgs.flatMap((p) => p.items);
  const liveDone = liveItems.filter((i) => i.actualSeconds !== undefined);
  const liveGap = liveDone.reduce((a, i) => a + (i.actualSeconds ?? 0), 0) - liveDone.reduce((a, i) => a + i.plannedSeconds, 0);

  // ---- committee overview and assignments ----
  const yearNow = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const academicYear = `${yearNow} – ${yearNow + 1}`;
  const matById = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])) as Record<string, Material>, [materials]);
  const allocByGroup = useMemo(() => { const m: Record<string, Material[]> = {}; allocations.forEach((a) => { const mm = matById[a.qacaidId]; if (mm) (m[a.groupId] ??= []).push(mm); }); return m; }, [allocations, matById]);
  const latestPct = useMemo(() => { const m: Record<string, number> = {}; const seen = new Set<string>(); reports.forEach((r) => { if (seen.has(r.groupId)) return; seen.add(r.groupId); m[r.groupId] = Math.round((r.masteryPct + r.melodyPct + r.timingPct + r.directivesPct) / 4); }); return m; }, [reports]);
  const totalGroups = activeLeafGroups.length;
  const assignedGroups = activeLeafGroups.filter((g) => (allocByGroup[g.id]?.length ?? 0) > 0);
  const pendingGroups = activeLeafGroups.filter((g) => (allocByGroup[g.id]?.length ?? 0) === 0);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const booksAssigned = allocations.length;
  const melodiesAssigned = allocations.filter((a) => matById[a.qacaidId]?.melody).length;
  const distinctBooks = new Set(allocations.map((a) => a.qacaidId)).size;
  const distinctMelodies = new Set(allocations.map((a) => matById[a.qacaidId]?.melody).filter(Boolean)).size;
  const gRows = useMemo(() => activeLeafGroups.filter((g) => {
    const loc = locationOf(g.id);
    return (!gLevel || (gLevel === '__none__' ? !g.levelId : g.levelId === gLevel)) && (!gCountry || loc.country?.id === gCountry) && (!gCity || loc.city?.id === gCity) && (!gQ.trim() || g.name.toLowerCase().includes(gQ.trim().toLowerCase()));
  }).map((g) => ({ g, mats: allocByGroup[g.id] ?? [], pctDone: latestPct[g.id] })).sort((a, b) => (b.pctDone ?? -1) - (a.pctDone ?? -1) || a.g.name.localeCompare(b.g.name)), [activeLeafGroups, gLevel, gCountry, gCity, gQ, allocByGroup, latestPct, locationOf]);
  const GPER = 5;
  const gPages = Math.max(1, Math.ceil(gRows.length / GPER));
  const gCur = Math.min(gPage, gPages);
  const gShown = gRows.slice((gCur - 1) * GPER, gCur * GPER);
  const byLevelRows = levels.map((l) => { const gs = activeLeafGroups.filter((g) => g.levelId === l.id); const done = gs.filter((g) => (allocByGroup[g.id]?.length ?? 0) > 0).length; return { l, n: gs.length, done }; });
  const topProgress = Object.entries(latestPct).map(([gid, v]) => ({ gid, v, name: byId[gid]?.name ?? gid })).sort((a, b) => b.v - a.v).slice(0, 5);
  const evolution = useMemo(() => {
    const m = new Map<string, number[]>();
    reports.forEach((r) => { if (!r.submittedMs) return; const d = new Date(r.submittedMs); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (m.get(k) ?? m.set(k, []).get(k)!).push(Math.round((r.masteryPct + r.melodyPct + r.timingPct + r.directivesPct) / 4)); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([k, v]) => ({ k, v: Math.round(v.reduce((n, x) => n + x, 0) / v.length) }));
  }, [reports]);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const groupTable = (rowsShown: typeof gShown, withFilters: boolean) => (
    <>
      {withFilters && (
        <div className="pd-gf">
          <label className="cx-search"><span aria-hidden>⌕</span><input type="search" placeholder={tx("Search a group")} value={gQ} onChange={(e) => { setGQ(e.target.value); setGPage(1); }} /></label>
          <Dropdown label={tx("Country")} value={gCountry} onChange={(v) => { setGCountry(v); setGCity(''); setGPage(1); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
          <Dropdown label={tx("City")} value={gCity} onChange={(v) => { setGCity(v); setGPage(1); }} allLabel={tx("All cities")} options={cities.filter((c) => !gCountry || c.parentGroupId === gCountry).map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
          <Dropdown label={tx("Level")} value={gLevel} onChange={(v) => { setGLevel(v); setGPage(1); }} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level") }, ...levels.map((l) => ({ value: l.id, label: l.name }))]} className="loc-dd" />
        </div>
      )}
      <div className="cx-scroll">
        <table className="cx-table pd-t">
          <thead><tr><th>{tx("Group (Kurel)")}</th><th>{tx("Level")}</th><th>{tx("Assigned program (book & melody)")}</th><th>{tx("Books")}</th><th>{tx("Duration")}</th><th>{tx("Status")}</th><th>{tx("Progress")}</th><th /></tr></thead>
          <tbody>
            {rowsShown.length === 0 && <tr><td colSpan={8}><span className="cx-empty"><b>{tx("No group matches these filters.")}</b></span></td></tr>}
            {rowsShown.map(({ g, mats, pctDone }) => {
              const first = mats[0];
              const dur = mats.reduce((n, m) => n + (m.durationSeconds ?? 0), 0);
              const lv = g.levelId ? levelById[g.levelId] : undefined;
              return (
                <tr key={g.id}>
                  <td><Link href="/dashboard/groups" className="pd-g lnk"><CxInitials name={g.name} size={38} /><strong>{g.name}</strong></Link></td>
                  <td>{lv ? <Link href="/dashboard/levels" className="pd-lv">{lv.name}</Link> : <span className="cx-pill grey">{tx("No level")}</span>}</td>
                  <td>{first ? <Link href="/dashboard/library" className="pd-prog lnk"><BookOpen size={15} />{first.title}{first.melody && <><Music2 size={15} />{first.melody}</>}{mats.length > 1 && <em>+{mats.length - 1}</em>}</Link> : <span className="cx-note-i">—</span>}</td>
                  <td>{mats.length}</td>
                  <td>{dur ? mmss(dur) : '—'}</td>
                  <td>{mats.length ? <CxPill tone="green">{tx("Assigned")}</CxPill> : <CxPill tone="amber">{tx("Pending")}</CxPill>}</td>
                  <td>{pctDone === undefined ? <span className="cx-note-i">—</span> : <span className="pd-pr"><CxBar pct={pctDone} /><b>{pctDone}%</b></span>}</td>
                  <td><button type="button" className="cx-btn sm" title={tx("Manage this book")} onClick={manage}><Eye size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cx-pager"><span>{tx("Showing")} {gRows.length === 0 ? 0 : (gCur - 1) * GPER + 1}–{Math.min(gCur * GPER, gRows.length)} {tx("of")} {gRows.length} {tx("groups")}</span>
        <div><button type="button" disabled={gCur <= 1} onClick={() => setGPage(gCur - 1)}>‹</button>{Array.from({ length: Math.min(gPages, 4) }, (_, i) => i + 1).map((n) => <button type="button" key={n} className={n === gCur ? 'on' : ''} onClick={() => setGPage(n)}>{n}</button>)}{gPages > 4 && <span>…</span>}<button type="button" disabled={gCur >= gPages} onClick={() => setGPage(gCur + 1)}>›</button></div></div>
    </>
  );
  const process = [
    [<BookOpen size={26} key="1" />, '1. Collect', 'Census and validation of the books and audios', 'Mar – Apr'],
    [<Layers size={26} key="2" />, '2. Elaboration', 'Design of the programs by level and by group', 'Apr – May'],
    [<Users size={26} key="3" />, '3. Assignment', 'Assigning the books and melodies to the groups', 'May – Jun'],
    [<Play size={26} key="4" />, '4. Follow-up', 'Follow-up of the rehearsals and of the progress', 'Jun – Nov'],
    [<BarChart3 size={26} key="5" />, '5. Evaluation', 'Evaluation of the performances and of the level', 'Nov – Dec'],
    [<Target size={26} key="6" />, '6. Closing', 'Final report and preparation of next year', 'Dec – Jan'],
  ] as const;

  return (
    <>
      <div className="eb2 cx-page pd-page">
        <CxBanner icon={<BookOpen size={26} />} kicker={tx("Pedagogical committee")} title={tx("Books & Melodies Assignment")} sub={tx("Assign books and melodies to groups for the annual program, and follow up on implementation.")}>
          <span className="pd-year"><Calendar size={16} />{tx("Academic year")} <b>{academicYear}</b></span>
          <button type="button" className="cx-btn ghost-light" onClick={() => router.push('/dashboard/messagerie')}><MessageSquare size={16} />{tx("Communication")}</button>
          <button type="button" className="cx-btn gold" onClick={manage}><Plus size={18} />{tx("New assignment")}</button>
        </CxBanner>

        <CxStats items={[
          { label: tx("Total groups"), value: fmt(totalGroups), icon: <Users size={22} />, tone: 'green', onClick: () => setTab('assign') },
          { label: tx("Groups assigned"), value: fmt(assignedGroups.length), badge: `${pct(assignedGroups.length, totalGroups)}%`, icon: <BookOpen size={22} />, tone: 'amber', onClick: () => setTab('assign') },
          { label: tx("Pending assignment"), value: fmt(pendingGroups.length), badge: `${pct(pendingGroups.length, totalGroups)}%`, icon: <Hourglass size={22} />, tone: 'red', onClick: () => setTab('assign') },
          { label: tx("Books assigned"), value: fmt(booksAssigned), icon: <BookOpen size={22} />, tone: 'green', onClick: () => setTab('books') },
          { label: tx("Melodies assigned"), value: fmt(melodiesAssigned), icon: <Music2 size={22} />, tone: 'amber', onClick: () => setTab('books') },
          { label: tx("Academic year"), value: academicYear.replace(' – ', '–'), icon: <Calendar size={22} />, tone: 'teal' },
        ]} />

        <CxTabs value={tab} onChange={(v) => setTab(v as typeof tab)} items={[
          { value: 'overview', label: tx("Overview"), icon: <Layers size={20} /> },
          { value: 'assign', label: tx("Assignments"), icon: <BookOpen size={20} /> },
          { value: 'books', label: tx("Books & Melodies"), icon: <Music2 size={20} /> },
          { value: 'programs', label: tx("Programs"), icon: <Layers size={20} />, count: programs.length || undefined },
          { value: 'progress', label: tx("Progress"), icon: <BarChart3 size={20} /> },
          { value: 'reports', label: tx("Reports"), icon: <FileText size={20} /> },
        ]} />

        {(tab === 'overview' || tab === 'assign') && (
          <div className="cx-grid cx-g3">
            <CxCard icon={<Target size={22} />} title={tx("Assignment progress")} sub={tx("Groups with their annual program (books & melodies).")}>
              <div className="at-donut">
                <CxDonut size={160} big={`${pct(assignedGroups.length, totalGroups)}%`} label={<>{tx("Assigned")}<br />({assignedGroups.length} / {totalGroups})</>} slices={[{ value: assignedGroups.length, color: '#1f9d63' }, { value: pendingGroups.length, color: '#e0a21b' }]} />
                <ul className="at-leg">
                  <li><i style={{ background: '#1f9d63' }} />{tx("Assigned groups")}<b>{assignedGroups.length}</b></li>
                  <li><i style={{ background: '#e0a21b' }} />{tx("Pending assignment")}<b>{pendingGroups.length}</b></li>
                  <li><i style={{ background: '#b9c6bf' }} />{tx("No program defined")}<b>{allocations.length === 0 ? totalGroups : 0}</b></li>
                </ul>
              </div>
            </CxCard>
            <CxCard icon={<Layers size={22} />} title={tx("Program by level")} sub={tx("Assignment status for each academic level.")}>
              <ul className="pd-lv-list">
                {byLevelRows.length === 0 && <li className="ev-none">{tx("No levels yet")}</li>}
                {byLevelRows.map(({ l, n, done }) => <li key={l.id}><b>{l.name}</b><span>{done} / {n}</span><CxBar pct={pct(done, n)} thick /><em>{n ? `${pct(done, n)}%` : '—'}</em></li>)}
              </ul>
            </CxCard>
            <CxCard icon={<BookOpen size={22} />} title={tx("Books & melodies overview")} sub={tx("All materials assigned for the year.")}>
              <div className="cx-two">
                <div className="pd-mt"><BookOpen size={30} /><b>{booksAssigned}</b><span>{tx("Books assigned")}</span><small>({distinctBooks} {tx("distinct books")})</small></div>
                <div className="pd-mt warm"><Music2 size={30} /><b>{melodiesAssigned}</b><span>{tx("Melodies assigned")}</span><small>({distinctMelodies} {tx("distinct melodies")})</small></div>
              </div>
            </CxCard>
          </div>
        )}

        {tab === 'overview' && (<>
          <div className="cx-grid cx-g2">
            <CxCard icon={<Target size={22} />} title={tx("Group progression (Top 5)")} sub={tx("Program completion rate.")} right={<button type="button" className="cx-btn sm ok" onClick={() => setTab('assign')}>{tx("See all groups")} →</button>}>
              <ul className="at-groups">{topProgress.map((t, i) => <li key={t.gid}><b>{i + 1}</b><CxInitials name={t.name} /><span><strong>{t.name}</strong></span><CxBar pct={t.v} thick /><em>{t.v}%</em></li>)}{topProgress.length === 0 && <li className="ev-none">{tx("No reports yet.")}</li>}</ul>
            </CxCard>
            <CxCard icon={<BarChart3 size={22} />} title={tx("Program evolution")} sub={tx("Overall completion rate by month.")}>
              {evolution.length === 0 ? <p className="kt-empty">{tx("No reports yet.")}</p> : <CxLine labels={evolution.map((e) => MON[Number(e.k.slice(5, 7)) - 1])} values={evolution.map((e) => e.v)} min={0} max={100} unit="%" />}
            </CxCard>
          </div>
          <section className="pd-quick">
            <b><Zap size={18} />{tx("Quick actions")}</b>
            <button type="button" className="cx-btn gold sm" onClick={manage}><Plus size={15} />{tx("New program")}</button>
            <button type="button" className="cx-btn sm" onClick={manage}><Music2 size={15} />{tx("Add a melody")}</button>
            <button type="button" className="cx-btn sm" onClick={manage}><BookOpen size={15} />{tx("Assign a book")}</button>
            <button type="button" className="cx-btn sm" onClick={() => router.push('/dashboard/rehearsals')}><Calendar size={15} />{tx("Plan a rehearsal")}</button>
            <button type="button" className="cx-btn sm" onClick={() => router.push('/dashboard/evaluations')}><BarChart3 size={15} />{tx("Launch an evaluation")}</button>
            <button type="button" className="cx-btn sm" onClick={() => setTab('reports')}><FileText size={15} />{tx("Generate a report")}</button>
          </section>
          <div className="cx-grid cx-g12">
            <CxCard dark icon={<Network size={22} />} title={tx("Committee organisation")} sub={tx("People in charge and deputies by level.")}>
              <ul className="pd-org">
                {[[<Crown size={22} key="a" />, tx("General committee"), tx("National direction")], [<Globe2 size={22} key="b" />, tx("Country committee"), `${countries.length} ${tx("countries")}`], [<Building2 size={22} key="c" />, tx("City committee"), `${cities.length} ${tx("cities")}`], [<MapPin size={22} key="d" />, tx("Zone committee"), `${(zones ?? []).length} ${tx("zones")}`], [<Users size={22} key="e" />, tx("Kurel committee"), `${totalGroups} ${tx("groups")}`]].map(([ic, t, d]) => (
                  <li key={t as string}><button type="button" onClick={() => router.push('/dashboard/committees')}><i>{ic}</i><span><b>{t}</b><small>{d}</small></span><em>›</em></button></li>
                ))}
              </ul>
            </CxCard>
            <CxCard dark icon={<BookOpen size={22} />} title={tx("Group programs")} sub={tx("Annual program (books & melodies) assigned to each group.")} right={<button type="button" className="cx-btn gold sm" onClick={() => setTab('books')}><BookOpen size={15} />{tx("Book library")}</button>}>
              {groupTable(gShown, false)}
            </CxCard>
          </div>
          <CxCard dark icon={<Network size={22} />} title={tx("Annual program process")} sub={tx("Annual work cycle of the Pedagogical Committee.")} right={<button type="button" className="cx-btn sm ghost-light" onClick={() => router.push('/dashboard/agenda')}><Calendar size={15} />{tx("See the full calendar")}</button>}>
            <ol className="pd-flow">{process.map(([ic, t, d, m], i) => <li key={t} className={i === 3 ? 'on' : ''}><i>{ic}</i><b>{tx(t)}</b><span>{tx(d)}</span><em>{tx(m)}</em></li>)}</ol>
          </CxCard>
        </>)}

        {tab === 'assign' && (
          <div className="cx-grid cx-g21">
            <CxCard dark icon={<Users size={22} />} title={tx("Group assignments")} sub={tx("List of all groups with their assigned books and melodies.")}>
              {groupTable(gShown, true)}
            </CxCard>
            <div className="ev-side">
              <CxCard tone="red" icon={<Hourglass size={22} />} title={tx("Unassigned groups")} sub={tx("Groups that still need a book and melody.")} right={<span className="cx-pill red">{pendingGroups.length}</span>}>
                <ul className="pd-un">{pendingGroups.slice(0, 6).map((g) => <li key={g.id}><MapPin size={15} /><span>{g.name}{g.levelId && levelById[g.levelId] ? ` (${levelById[g.levelId].name})` : ''}</span></li>)}{pendingGroups.length === 0 && <li>{tx("Every group has a program.")}</li>}</ul>
                <button type="button" className="cx-btn" onClick={manage}>{tx("Assign to these groups")} →</button>
              </CxCard>
              <CxCard icon={<Zap size={22} />} title={tx("Quick actions")}>
                <div className="pd-qa">
                  <button type="button" className="cx-btn ok" onClick={manage}><Plus size={16} />{tx("Assign books & melodies")}</button>
                  <button type="button" className="cx-btn" onClick={manage}><Upload size={16} />{tx("Import assignments (Excel)")}</button>
                  <button type="button" className="cx-btn" onClick={() => router.push('/dashboard/messagerie')}><Mail size={16} />{tx("Send the program to the groups")}</button>
                  <button type="button" className="cx-btn" onClick={() => router.push('/dashboard/announcements')}><MessageSquare size={16} />{tx("Create a group announcement")}</button>
                </div>
              </CxCard>
            </div>
          </div>
        )}

        {tab === 'assign' && (
          <CxCard dark icon={<Network size={22} />} title={tx("Program assignment workflow")} sub={tx("Annual process to prepare, assign and follow up the groups' program.")}>
            <ol className="pd-flow">{process.slice(0, 5).map(([ic, t, d], i) => <li key={t} className={i === 0 ? 'on' : ''}><i>{ic}</i><b>{tx(t)}</b><span>{tx(d)}</span></li>)}</ol>
          </CxCard>
        )}

        {tab === 'books' && (<>
          <EbBar active={anyFilter} onClear={clearFilters}>
          <EbSearch value={search} onChange={setSearch} placeholder={tx("Search a book or a melody")} />
          <Dropdown label={tx("Level")} value={levelFilter} onChange={setLevelFilter} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level") }, ...levels.map((l) => ({ value: l.id, label: l.name }))]} className="eb2-dd" />
          <Dropdown label={tx("Melody")} value={melodyFilter} onChange={setMelodyFilter} allLabel={tx("All melodies")} options={melodyList.map((m) => ({ value: m, label: m }))} className="eb2-dd" />
          <Dropdown label={tx("Assigned to")} value={assignFilter} onChange={setAssignFilter} allLabel={tx("Any assignment")} options={[{ value: 'some', label: tx("Assigned to a kurel") }, { value: 'none', label: tx("Not assigned yet") }]} className="eb2-dd" />
          <Dropdown label={tx("Status")} value={statusFilter} onChange={setStatusFilter} allLabel={tx("Any status")} options={[{ value: 'active', label: tx("Active") }, { value: 'retired', label: tx("Retired") }]} className="eb2-dd" />
        </EbBar>
          <EbPanel id="repertoire" icon={<BookOpen size={20} />} title={tx("Books and melodies")} count={anyFilter ? `${rows.length} / ${materials.length}` : materials.length} note={tx("Each material belongs to an academic level.")}>
          <EbTable rows={rows} cols={bookCols} rowKey={(m) => m.id} empty={materials.length === 0 ? tx("No material yet.") : tx("No book matches these filters.")} />
        </EbPanel>
        </>)}

        {tab === 'programs' && (<>
          <EbPanel id="programmes" icon={<Send size={20} />} title={tx("Programs submitted by kurels")} count={progRows.length === programs.length ? programs.length : `${progRows.length} / ${programs.length}`} note={tx("Annual programs and proposals before a performance.")}
          actions={<>
            <Dropdown label={tx("Status")} value={progStatus} onChange={setProgStatus} allLabel={tx("Any status")} options={[{ value: 'submitted', label: tx("submitted") }, { value: 'performed', label: tx("performed") }]} className="eb2-dd" />
            <button type="button" className="eb2-bt pri" onClick={() => setProgDialog('submit')}><Plus size={14} /> {tx("Submit a programme")}</button>
          </>}>
          <EbTable rows={progRows} cols={progCols} rowKey={(p) => p.id} loading={programsRaw === null} empty={programs.length === 0 ? tx("No programs submitted.") : tx("No program matches these filters.")} />
        </EbPanel>
          <EbPanel id="direct" icon={<CalendarClock size={20} />} title={tx("Pedagogical follow-up of the event · Live")} note={tx("Program, book, melodies, real time and evaluation of each performance.")}
          actions={<>
            <Dropdown label={tx("Event")} value={liveEvent?.id ?? ''} onChange={setLiveEventId} allLabel={liveEvent ? undefined : tx("No event in progress")} options={events.slice(0, 30).map((e) => ({ value: e.id, label: e.title }))} className="eb2-dd" />
            <button type="button" className="eb2-bt" onClick={() => setNow(Date.now())}><RefreshCw size={14} /> {tx("Refresh")}</button>
          </>}>
          <div className="eb2-grid g11" style={{ padding: 18 }}>
            <div className="eb2-lvgrid" style={{ padding: 0, gridTemplateColumns: 'repeat(2,minmax(0,1fr))', alignContent: 'start' }}>
              <div style={{ ['--c' as string]: '#1e9d66', ['--cb' as string]: '#e3f6ec' } as React.CSSProperties} className="eb2-metric"><span>{tx("Progress")}</span><strong>{liveItems.length ? `${liveDone.length} / ${liveItems.length}` : '—'}</strong></div>
              <div style={{ ['--c' as string]: '#7c4cc4', ['--cb' as string]: '#efe8fa' } as React.CSSProperties} className="eb2-metric"><span>{tx("Overall gap")}</span><strong>{liveDone.length ? `${liveGap > 0 ? '+' : liveGap < 0 ? '−' : ''}${mmss(Math.abs(liveGap))}` : '—'}</strong></div>
            </div>
            <div className="eb2-list" style={{ border: '1.5px solid #e6ece8', borderRadius: 16, overflow: 'hidden' }}>
              {liveProgs.length === 0 && <p className="eb2-empty-row">{tx("Nothing scheduled.")}</p>}
              {liveProgs.map((p, i) => (
                <button type="button" className="eb2-row" key={p.id} style={{ ['--c' as string]: EB_COLS[i % EB_COLS.length], ['--cb' as string]: EB_SOFT[i % EB_SOFT.length] }} onClick={() => setProgDialog({ record: p.id })} title={tx("Record the performance")}>
                  <span className="top"><b>{byId[p.groupId]?.name ?? p.groupId}</b><span className="eb2-bt"><Pencil size={13} /> {tx("Record the performance")}</span></span>
                  {p.items.map((it) => <small key={it.qacaidId}>{it.title} {tx("— planned")} {mmss(it.plannedSeconds)}{it.actualSeconds !== undefined ? ` · actual ${mmss(it.actualSeconds)}` : ''}{it.rating !== undefined ? ` · ${it.rating}/10` : ''}</small>)}
                </button>
              ))}
            </div>
          </div>
        </EbPanel>
        </>)}

        {tab === 'progress' && (<>
          <div className="eb2-grid g11" id="progression">
          <EbPanel icon={<ClipboardCheck size={20} />} title={tx("Kurel progress")} note={tx("Consolidated evaluation of all submitted reports.")}>
            <div className="eb2-prog">
              <div className="eb2-ring" style={{ background: overall === null ? '#e4ece8' : `conic-gradient(#1e9d66 0 ${overall}%, #e4ece8 ${overall}% 100%)` }}><div><strong>{overall === null ? '—' : `${overall}%`}</strong><span>{tx("overall")}</span></div></div>
              <div className="bars">
                {bar(tx("Mastery of the book"), mastery)}
                {bar(tx("Respect of the melody"), melody)}
                {bar(tx("Performance timing"), timing)}
                {bar(tx("Application of guidelines"), directives)}
              </div>
            </div>
          </EbPanel>
          <EbPanel icon={<CalendarClock size={20} />} title={tx("Kurel levels")} count={`${activeLeafGroups.length} ${tx("kurels")}`} note={tx("Academic level assigned to each kurel.")}>
            <div className="eb2-lvgrid">
              {levels.length === 0 && <p className="eb2-empty-row">{tx("No levels yet")}</p>}
              {levels.map((l, i) => (
                <button type="button" key={l.id} style={{ ['--c' as string]: EB_COLS[i % EB_COLS.length], ['--cb' as string]: EB_SOFT[i % EB_SOFT.length] }} onClick={() => { setLevelFilter(l.id); go('repertoire'); }} title={tx("Show the books of this level")}>
                  <strong>{kurelsByLevel(l.id)}</strong><span>{l.name}</span><small>{l.description ?? '\u00a0'}</small>
                </button>
              ))}
              {levels.length > 0 && <button type="button" style={{ ['--c' as string]: '#c23b3b', ['--cb' as string]: '#fdeaea' }} onClick={() => { setLevelFilter('__none__'); go('repertoire'); }} title={tx("Show the books without a level")}><strong>{nUnleveled}</strong><span>{tx("Kurels without a level")}</span><small>{activeLeafGroups.length ? Math.round((nUnleveled / activeLeafGroups.length) * 100) : 0}%</small></button>}
            </div>
          </EbPanel>
        </div>
        </>)}

        {tab === 'reports' && (<>
          <div className="eb2-grid g11">
          <EbPanel id="allocations" icon={<Users size={20} />} title={tx("Recent allocations")} count={`${allocations.length} ${tx("active")}`} note={tx("Materials assigned to kurels.")}>
            {recentAlloc.length === 0 ? <p className="eb2-empty-row">{tx("No allocations yet.")}</p> : (
              <div className="eb2-list">
                {recentAlloc.map(({ m, n }, i) => (
                  <button type="button" className="eb2-row" key={m.id} style={{ ['--c' as string]: EB_COLS[i % EB_COLS.length], ['--cb' as string]: EB_SOFT[i % EB_SOFT.length] }} onClick={() => { setSearch(m.title); go('repertoire'); }} title={tx("Show this book")}>
                    <span className="top"><b>{m.title}{m.melody ? ` · ${m.melody}` : ''}</b><EbPill tone="ok">{n} {tx("kurel")}{n === 1 ? '' : 's'}</EbPill></span>
                    <small>{levelName(m) || tx("No level")}</small>
                    <span className="eb2-bar2"><i style={{ ['--p' as string]: `${activeLeafGroups.length ? Math.min(100, Math.round((n / activeLeafGroups.length) * 100)) : 0}%` }} /></span>
                  </button>
                ))}
              </div>
            )}
          </EbPanel>
          <EbPanel icon={<ClipboardCheck size={20} />} title={tx("Evaluations to follow")} count={lowReports.length} note={tx("Latest report of each kurel, lowest first.")}>
            {lowReports.length === 0 ? <p className="eb2-empty-row">{tx("No reports yet.")}</p> : (
              <div className="eb2-list">
                {lowReports.map(({ r, pct }, i) => (
                  <button type="button" className="eb2-row" key={r.id} style={{ ['--c' as string]: pct < 50 ? '#c23b3b' : EB_COLS[i % EB_COLS.length], ['--cb' as string]: pct < 50 ? '#fdeaea' : EB_SOFT[i % EB_SOFT.length] }} onClick={() => go('progression')} title={tx("Kurel progress")}>
                    <span className="top"><b>{byId[r.groupId]?.name ?? r.groupId}</b><EbPill tone={pct < 50 ? 'red' : 'ok'}>{pct}%</EbPill></span>
                    <span className="eb2-bar2"><i style={{ ['--p' as string]: `${pct}%` }} /></span>
                  </button>
                ))}
              </div>
            )}
          </EbPanel>
        </div>
        </>)}
      </div>

      {progDialog === 'submit' && (
        <FormDialog
          title={tx("Submit a programme")}
          intro="The pedagogy president lists the book for the event. The total duration must fit the time allocated to the kurel."
          submitLabel={tx("Submit")}
          onClose={() => setProgDialog(null)}
          onValuesChange={(v) => setProgEvent(v.eventId)}
          fields={[
            { name: 'eventId', label: tx("Event"), type: 'select', required: true, options: events.map((e) => ({ value: e.id, label: e.title })) },
            { name: 'groupId', label: tx("Kurel"), type: 'select', required: true, options: (events.find((e) => e.id === progEvent)?.subGroupIds ?? []).map((g) => ({ value: g, label: byId[g]?.name ?? g })) },
            { name: 'minutes', label: tx("Time allocated (minutes)"), type: 'number', required: true, min: 1 },
            { name: 'items', label: tx("Book to perform (in order)"), type: 'checkboxes', options: materials.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: `${m.code} · ${m.title}${m.durationSeconds ? ` (${mmss(m.durationSeconds)})` : ' (no duration set)'}` })) },
          ]}
          onSubmit={(v) => submitEventProgram({ eventId: v.eventId, groupId: v.groupId, allocatedSeconds: Number(v.minutes) * 60, items: (v.items ? v.items.split(',') : []).map((id) => ({ qacaidId: id, plannedSeconds: materials.find((m) => m.id === id)?.durationSeconds ?? 0 })) }).then(() => notify('Programme submitted', 'success'))}
        />
      )}
      {progDialog && progDialog !== 'submit' && (() => {
        const prog = programs.find((p) => p.id === progDialog.record);
        if (!prog) return null;
        return (
          <FormDialog
            title={tx("Record the performance")}
            intro="Actual duration (seconds) and rating out of 10 for each book. The report is available as soon as you save."
            submitLabel={tx("Save")}
            onClose={() => setProgDialog(null)}
            fields={prog.items.flatMap((i) => [
              { name: `a_${i.qacaidId}`, label: `${i.title} — actual seconds`, type: 'number' as const, min: 0, initial: i.actualSeconds !== undefined ? String(i.actualSeconds) : '' },
              { name: `r_${i.qacaidId}`, label: `${i.title} — rating /10`, type: 'number' as const, min: 0, max: 10, initial: i.rating !== undefined ? String(i.rating) : '' },
            ])}
            onSubmit={(v) => recordProgramPerformance({ programId: prog.id, results: prog.items.map((i) => ({ qacaidId: i.qacaidId, actualSeconds: v[`a_${i.qacaidId}`] === '' ? undefined : Number(v[`a_${i.qacaidId}`]), rating: v[`r_${i.qacaidId}`] === '' ? undefined : Number(v[`r_${i.qacaidId}`]) })) }).then(() => notify('Performance recorded', 'success'))}
          />
        );
      })()}
      <ManageToggle title={tx("Manage the curriculum — materials, allocations, reports")} openSignal={manageSignal}>
        <CurriculumManage />
      </ManageToggle>
    </>
  );
}

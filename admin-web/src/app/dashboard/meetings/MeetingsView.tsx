'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { limit as fsLimit, orderBy, where, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useUserProfiles } from '@/lib/useUserNames';
import { notify } from '@/lib/notify';
import { controlAgendaPoint, createMeeting, finishMeeting, createFollowUpMeetings, markMeetingAttendance, setMeetingStatus, setMeetingActionStatus, submitMeetingFeedback, updateMeetingAgenda } from '@/lib/functions';
import FormDialog from '@/components/FormDialog';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink, ViewProfile } from '@/components/MemberProfile';
import { createPortal } from 'react-dom';
import DateTimePicker from '@/components/DateTimePicker';
import MemberPicker, { type PickedMember } from '@/components/MemberPicker';
import WizardShell, { WizSvg, type WizIcon } from '@/components/WizardShell';
import Dropdown from '@/components/Dropdown';
import { TIME_ZONES, zonedToUtcMs } from '@/lib/timeZones';
import { AgendaBuilder, LocationPicker, Participants, blankPoint, type DocDraft, type Place, type PointDraft } from './MeetingForms';
import { tx, txf, dateLocale } from '@/lib/i18n/tr';

type PointStatus = 'pending' | 'active' | 'extended' | 'completed' | 'follow_up';
interface Point {
  id: string; title: string; ownerName?: string; plannedMinutes: number; actualMinutes?: number; description?: string;
  documents?: { title: string; url: string; kind?: string }[]; status?: PointStatus; startedAt?: unknown; extendedMinutes?: number;
  decision?: string; notes?: string; actionItems?: { text: string; ownerId?: string; ownerName?: string; dueMs?: number }[];
  followUpOn?: unknown; followUpMeetingId?: string;
  carriedFrom?: { meetingId: string; meetingTitle: string; notes?: string; decision?: string };
}
interface Meeting {
  title: string; type: 'online' | 'in_person'; timeZone?: string; location?: string; link?: string; startAt: unknown; targetMinutes: number;
  inviteeIds: string[]; coordinatorId?: string; coordinatorName?: string; agenda: Point[]; activePointId?: string | null;
  decisions: { id: string; text: string }[];
  actions: { id: string; text: string; ownerId?: string; ownerName?: string; dueAt?: unknown; status: 'open' | 'done' }[];
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  parentMeetingId?: string; parentMeetingTitle?: string; followUpMeetingIds?: string[];
  feedback?: Record<string, { name: string; rating: number; comment?: string }>;
  attendance?: Record<string, { name: string; status: 'present' | 'absent'; at?: unknown }>;
  endAt?: unknown; endedAt?: unknown; startedAt?: unknown; lat?: number; lng?: number;
}
/** When a meeting counts for ordering: a finished meeting by the moment it really ended, the others by their planned start. */
const orderMs = (m: { status: string; startAt: unknown; endedAt?: unknown }) => (m.status === 'completed' && m.endedAt ? tsMs(m.endedAt) || tsMs(m.startAt) : tsMs(m.startAt));
type Row = Meeting & { id: string };
type Tab = 'upcoming' | 'ongoing' | 'completed' | 'followups' | 'pending' | 'history';

const fmtDate = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** "45 min", "2 h 10 min", "3 d 4 h": a span in the most useful unit. */
const fmtSpan = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${Math.floor(m / 1440)} d${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)} h` : ''}`;
};
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const tProxy = (o: Record<string, string>) => new Proxy(o, { get: (t, k) => (typeof k === 'string' && k in t ? tx(t[k]) : undefined) });
const STATUS: Record<string, string> = tProxy({ scheduled: 'Scheduled', in_progress: 'Ongoing', completed: 'Completed', cancelled: 'Cancelled' });
const PSTATUS: Record<string, string> = tProxy({ pending: 'Waiting', active: 'Running', extended: 'Extended', completed: 'Completed', follow_up: 'Follow-up required' });
const pointTone = (s?: string) => (s === 'completed' ? 'ok' : s === 'follow_up' ? 'gold' : s === 'active' || s === 'extended' ? 'live' : 'idle');
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (sec: number) => `${pad(Math.floor(Math.abs(sec) / 60))}:${pad(Math.abs(sec) % 60)}`;
const isOpen = (p: Point) => !p.status || p.status === 'pending' || p.status === 'active' || p.status === 'extended';
const toLocalInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const docOf = (d: DocDraft | { title: string; url: string; kind?: string }) => ({ title: d.title, url: d.url, ...(d.kind ? { kind: d.kind } : {}) });

function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/**
 * The meetings screen. `memberMode` is the member portal: a signed-in member sees only the meetings they are invited to,
 * cannot create meetings, and only the coordinator of a meeting gets the controls (start, decide, extend, attendance, end).
 */
export default function MeetingsView({ memberMode = false }: { memberMode?: boolean }) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const fetched = useCollection<Meeting>('meetings', memberMode ? [where('inviteeIds', 'array-contains', uid || '-')] : [orderBy('startAt', 'desc'), fsLimit(150)], memberMode ? `m-${uid}` : 'admin');
  const raw = memberMode && fetched ? [...fetched].sort((a, b) => tsMs(b.startAt) - tsMs(a.startAt)) : fetched;
  const rows = useMemo<Row[]>(() => raw ?? [], [raw]);
  const [tab, setTab] = useState<Tab>('completed');
  const [sel, setSel] = useState('');
  // Finding a meeting among hundreds: a period, a search, and a sort. A chosen period is searched on the server.
  const [preset, setPreset] = useState<Preset>('all');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [q, setQ] = useState('');
  const [asc, setAsc] = useState<boolean | null>(null);
  const [shown, setShown] = useState(30);
  const range = useMemo(() => presetRange(preset, cFrom, cTo), [preset, cFrom, cTo]);
  const ranged = useCollection<Meeting>('meetings', range && !memberMode ? [where('startAt', '>=', Timestamp.fromMillis(range.from)), where('startAt', '<=', Timestamp.fromMillis(range.to)), orderBy('startAt', 'desc'), fsLimit(1000)] : [fsLimit(1)], range && !memberMode ? `r-${range.from}-${range.to}` : 'r-off');
  const detailRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<'new' | null>(null);
  // A notification link such as /dashboard/meetings?open=<id> opens that meeting.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('open');
    if (id) { setSel(id); setTab('history'); }
  }, []);

  // The meetings the tabs show: everything loaded, or only the chosen period.
  const vrows = useMemo<Row[]>(() => {
    if (!range) return rows;
    if (memberMode) return rows.filter((m) => tsMs(m.startAt) >= range.from && tsMs(m.startAt) <= range.to);
    return ranged ?? [];
  }, [rows, range, memberMode, ranged]);
  const allRows = useMemo<Row[]>(() => { const seen = new Set(rows.map((r) => r.id)); return [...rows, ...vrows.filter((r) => !seen.has(r.id))]; }, [rows, vrows]);
  const groups = useMemo(() => ({
    upcoming: vrows.filter((m) => m.status === 'scheduled').sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt)),
    ongoing: vrows.filter((m) => m.status === 'in_progress'),
    completed: vrows.filter((m) => m.status === 'completed'),
    followups: vrows.filter((m) => !!m.parentMeetingId),
    history: vrows,
  }), [vrows]);
  const pending = useMemo(() => {
    const done = new Set(rows.filter((m) => m.status === 'completed').map((m) => m.id));
    const points = rows.flatMap((m) => m.agenda.filter((p) => p.status === 'follow_up' && !(p.followUpMeetingId && done.has(p.followUpMeetingId))).map((p) => ({ m, p })));
    const actions = rows.flatMap((m) => m.actions.filter((a) => a.status === 'open').map((a) => ({ m, a })));
    return { points, actions };
  }, [rows]);

  const browse = tab !== 'pending' && tab !== 'ongoing';
  const [month, setMonth] = useState('');
  const listBase = useMemo(() => {
    if (tab === 'pending') return [] as Row[];
    let l = groups[tab];
    const t = q.trim().toLowerCase();
    if (browse && t) l = l.filter((m) => `${m.title} ${m.coordinatorName ?? ''} ${m.location ?? ''}`.toLowerCase().includes(t));
    if (browse) { const up = asc ?? tab === 'upcoming'; l = [...l].sort((a, b) => (up ? 1 : -1) * (orderMs(a) - orderMs(b))); }
    return l;
  }, [groups, tab, q, asc, browse]);
  const monthKey = (m: Row) => { const d = new Date(orderMs(m)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const months = useMemo(() => {
    const by = new Map<string, { key: string; label: string; n: number }>();
    listBase.forEach((m) => { const k = monthKey(m); const c = by.get(k); if (c) c.n++; else by.set(k, { key: k, label: new Date(orderMs(m)).toLocaleDateString(dateLocale(), { month: 'short', year: 'numeric' }), n: 1 }); });
    return [...by.values()];
  }, [listBase]);
  const mSel = months.some((x) => x.key === month) ? month : '';
  const list = useMemo(() => (mSel ? listBase.filter((m) => monthKey(m) === mSel) : listBase), [listBase, mSel]);
  const selected = (tab === 'pending' ? allRows.find((m) => m.id === sel) : list.find((m) => m.id === sel)) ?? (list[0] ?? null);
  const tabs: { key: Tab; name: string; n: number }[] = [
    { key: 'completed', name: tx("Completed"), n: groups.completed.length }, { key: 'upcoming', name: tx("Upcoming"), n: groups.upcoming.length },
    { key: 'ongoing', name: tx("Ongoing"), n: groups.ongoing.length }, { key: 'followups', name: tx("Follow-up meetings"), n: groups.followups.length },
    { key: 'pending', name: tx("Pending decisions"), n: pending.points.length + pending.actions.length }, { key: 'history', name: tx("History and feedback"), n: vrows.length },
  ];
  // Opening a meeting from a link: if it is not in the current tab, switch to History, which lists every meeting.
  const open = (id: string, t?: Tab) => { setSel(id); if (t) setTab(t); else if (tab !== 'pending' && !list.some((m) => m.id === id)) { setTab('history'); setPreset('all'); setQ(''); } };
  const pick = (id: string) => { setSel(id); window.setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };

  return (
    <div className="mt-page">
      <header className="mt-head">
        <div><h1>{tx("Meetings")}</h1><p>{tx("Plan a meeting, run it point by point with a timer, record decisions and let the system arrange the follow-up.")}</p></div>
        {!memberMode && <button type="button" className="fx2-btn" onClick={() => setDialog('new')}>{tx("New meeting")}</button>}
      </header>
      <nav className="mt-tabs">{tabs.map((t) => <button key={t.key} type="button" className={tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setSel(''); }}>{t.name}<em>{t.n}</em></button>)}</nav>
      {raw === null ? <p className="mt-empty">{tx("Loading meetings…")}</p> : (
        <>
          {tab === 'pending' ? <div className="mx-pending"><Pending pending={pending} onOpen={(id) => open(id)} /></div> : list.length === 0 && !(browse && (range || q.trim() || groups[tab].length > 0)) ? <EmptyTab tab={tab} tabs={tabs} canCreate={!memberMode} onNew={() => setDialog('new')} onTab={(t) => { setTab(t); setSel(''); }} /> : (
            browse ? (
              <MeetingBrowser
                list={list} months={months} month={mSel} setMonth={(v) => { setMonth(v); setShown(30); }} total={groups[tab].length} selectedId={selected?.id} onPick={pick}
                preset={preset} setPreset={(v) => { setPreset(v); setShown(30); }} from={cFrom} to={cTo} setFrom={setCFrom} setTo={setCTo}
                q={q} setQ={(v) => { setQ(v); setShown(30); }} asc={asc ?? tab === 'upcoming'} setAsc={setAsc} shown={shown} setShown={setShown}
                loading={Boolean(range) && !memberMode && ranged === null} capped={!range && !memberMode && rows.length >= 150}
              />
            ) : (
            <div className="mx-strip" role="list">
              {list.map((m) => {
                const done = m.agenda.filter((p) => p.status === 'completed').length;
                const pct = m.agenda.length ? Math.round((done / m.agenda.length) * 100) : 0;
                const rate = ratingOf(m);
                return (
                  <button type="button" role="listitem" key={m.id} className={`mx-mc ${selected?.id === m.id ? 'on' : ''}`} onClick={() => setSel(m.id)}>
                    <span className="mx-mc-top"><b>{m.title}</b><span className={`mt-chip ${m.status}`}>{STATUS[m.status]}</span></span>
                    <span className="mx-mc-big">{fmtDate(tsMs(m.startAt))}</span>
                    <span className="mx-mc-sub">{m.type === 'online' ? tx("Online") : (m.location || tx("In person"))} · {m.inviteeIds.length} {tx("invited")}</span>
                    <span className="mx-mc-bar"><i style={{ width: `${pct}%` }} /></span>
                    <span className="mx-mc-sub">{done}/{m.agenda.length} {tx("points done")}{m.parentMeetingId ? tx(" · follow-up") : ''}{rate ? ` · ★ ${rate}` : ''}</span>
                  </button>
                );
              })}
            </div>
            )
          )}
          {selected ? <div ref={detailRef} className="mx-detail-anchor"><Detail key={selected.id} m={selected} uid={uid} memberMode={memberMode} all={allRows} onOpen={(id) => open(id)} /></div> : tab !== 'pending' && list.length > 0 ? <p className="mt-empty mx-choose">{tx("Choose a meeting from the list to see its agenda, decisions and controls.")}</p> : null}
        </>
      )}
      {dialog === 'new' && <NewMeeting existing={rows} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ratingOf(m: Meeting) {
  const f = Object.values(m.feedback ?? {});
  return f.length ? (f.reduce((a, x) => a + x.rating, 0) / f.length).toFixed(1) : '';
}

function Pending({ pending, onOpen }: { pending: { points: { m: Row; p: Point }[]; actions: { m: Row; a: Meeting['actions'][number] }[] }; onOpen: (id: string) => void }) {
  return (
    <>
      <h3 className="mt-sub">{tx("Points waiting for a decision")}</h3>
      {pending.points.length === 0 && <p className="mt-empty">{tx("Nothing is waiting.")}</p>}
      {pending.points.map(({ m, p }) => (
        <button type="button" key={`${m.id}${p.id}`} className="mt-item" onClick={() => onOpen(m.id)}>
          <span className="mt-item-top"><b>{p.title}</b><span className="mt-chip gold">{p.followUpOn ? fmtDay(tsMs(p.followUpOn)) : tx("No date")}</span></span>
          <span className="mt-item-sub">{m.title}</span>
        </button>
      ))}
      <h3 className="mt-sub">{tx("Open action items")}</h3>
      {pending.actions.length === 0 && <p className="mt-empty">{tx("No open actions.")}</p>}
      {pending.actions.map(({ m, a }) => (
        <button type="button" key={`${m.id}${a.id}`} className="mt-item" onClick={() => onOpen(m.id)}>
          <span className="mt-item-top"><b>{a.text}</b>{a.dueAt ? <span className="mt-chip scheduled">{fmtDay(tsMs(a.dueAt))}</span> : null}</span>
          <span className="mt-item-sub">{a.ownerName ?? tx("No owner")} · {m.title}</span>
        </button>
      ))}
    </>
  );
}

function Detail({ m, uid, all, onOpen, memberMode = false }: { m: Row; uid: string; all: Row[]; onOpen: (id: string) => void; memberMode?: boolean }) {
  // Admins control everything; in the member portal only the coordinator runs the meeting, and nobody edits the agenda or people there.
  const isCtl = !memberMode || m.coordinatorId === uid;
  const isAdm = !memberMode;
  const startMs = tsMs(m.startAt);
  const endMs = tsMs(m.endAt);
  const everyone = useMemo(() => Array.from(new Set([...m.inviteeIds, ...(m.coordinatorId ? [m.coordinatorId] : []), ...Object.keys(m.attendance ?? {}), ...Object.keys(m.feedback ?? {})])), [m.inviteeIds, m.coordinatorId, m.attendance, m.feedback]);
  const profiles = useUserProfiles(everyone);
  const running = m.status === 'in_progress';
  const now = useNow(running);
  const [showInv, setShowInv] = useState(false);
  const [dlg, setDlg] = useState<null | { kind: 'agenda' | 'decision' | 'extend' | 'followup' | 'finish' | 'people'; point?: Point }>(null);
  const [busy, setBusy] = useState(false);
  const [sideTab, setSideTab] = useState<'people' | 'agenda'>('agenda');
  const [view, setView] = useState<'agenda' | 'decisions' | 'docs'>('agenda');
  const [pTab, setPTab] = useState<'all' | 'present' | 'absent'>('all');
  const [pq, setPq] = useState('');
  const [pLimit, setPLimit] = useState(40);
  const [sel, setSel] = useState<string[]>([]);
  const active = m.agenda.find((p) => p.id === m.activePointId);
  const canEdit = m.status === 'scheduled' || m.status === 'in_progress';
  const plan = useMemo(() => {
    const by = new Map<number, number[]>();
    m.agenda.forEach((p, i) => { if (p.status === 'follow_up' && p.followUpOn) { const k = tsMs(p.followUpOn); by.set(k, [...(by.get(k) ?? []), i + 1]); } });
    return Array.from(by.entries()).sort((a, b) => a[0] - b[0]);
  }, [m.agenda]);
  const children = all.filter((x) => x.parentMeetingId === m.id);
  const parent = all.find((x) => x.id === m.parentMeetingId);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); notify(ok, 'success'); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(false); }
  }
  const ctl = (action: string, pointId: string, extra: Record<string, unknown> = {}) => controlAgendaPoint({ meetingId: m.id, pointId, action, ...extra });
  const saveAgenda = (list: Point[]) => updateMeetingAgenda({ meetingId: m.id, agenda: list.map((p) => ({ id: p.id, title: p.title, plannedMinutes: p.plannedMinutes, ownerName: p.ownerName, description: p.description ?? '', documents: (p.documents ?? []).map(docOf) })) });
  const durationMin = endMs > startMs ? Math.round((endMs - startMs) / 60000) : null;
  const closedMin = m.agenda.filter((p) => !isOpen(p)).reduce((a, p) => a + p.plannedMinutes, 0);
  /** Shares the time that is left equally between the points that are still open. */
  function autoSchedule() {
    const open = m.agenda.filter(isOpen);
    if (durationMin === null || open.length === 0) return;
    const free = durationMin - closedMin;
    const base = Math.floor(free / open.length);
    if (base < 1) { notify(tx("There is not enough time for that many points. Lengthen the meeting."), 'error'); return; }
    const extra = free - base * open.length;
    let k = 0;
    void run(() => saveAgenda(m.agenda.map((p) => (isOpen(p) ? { ...p, plannedMinutes: base + (k++ < extra ? 1 : 0) } : p))), tx("Time shared equally between the points"));
  }
  const parentMeeting = all.find((x) => x.id === m.parentMeetingId);
  const attendance = m.attendance ?? {};
  const presentN = m.inviteeIds.filter((id) => attendance[id]?.status === 'present').length;
  const absentN = m.inviteeIds.filter((id) => attendance[id]?.status === 'absent').length;
  const pf = (id: string) => pTab === 'all' || attendance[id]?.status === pTab;
  const pFiltered = m.inviteeIds.filter((id) => pf(id) && (!pq.trim() || (profiles[id]?.name ?? '').toLowerCase().includes(pq.trim().toLowerCase())));
  const pVisible = pFiltered.slice(0, pLimit);
  const selSet = new Set(sel);
  const allSel = pFiltered.length > 0 && pFiltered.every((id) => selSet.has(id));
  const toggleAll = () => setSel(allSel ? [] : pFiltered);
  const bulk = (status: 'present' | 'absent') => run(async () => { await markMeetingAttendance({ meetingId: m.id, userIds: sel, status }); setSel([]); }, `${sel.length} marked ${status}`);
  const mark = (userId: string, status: 'present' | 'absent') => run(() => markMeetingAttendance({ meetingId: m.id, userId, status }), status === 'present' ? tx("Marked present") : tx("Marked absent"));
  const openPts = m.agenda.filter(isOpen);

  const total = active ? (active.plannedMinutes + (active.extendedMinutes ?? 0)) * 60 : 0;
  const left = active ? total - Math.floor((now - tsMs(active.startedAt)) / 1000) : 0;
  const nearEnd = !!active && left <= 120;

  const plannedTotal = m.agenda.reduce((a, p) => a + p.plannedMinutes, 0);
  const usedMin = m.agenda.reduce((a, p) => a + (p.actualMinutes ?? 0), 0);
  const decided = m.agenda.filter((p) => p.decision);
  const closedPts = m.agenda.filter((p) => p.status === 'completed');
  const docs = m.agenda.flatMap((p, i) => (p.documents ?? []).map((d) => ({ ...d, point: p.title, n: i + 1 })));
  const overdue = m.actions.filter((a) => a.status === 'open' && a.dueAt && tsMs(a.dueAt) < Date.now()).length;
  const unmarked = Math.max(0, m.inviteeIds.length - presentN - absentN);
  const nowMs = Date.now();
  const span = endMs > startMs ? endMs - startMs : 0;
  const timePct = span ? Math.min(100, Math.max(0, ((now - startMs) / span) * 100)) : 0;
  const untilStart = startMs - nowMs;
  const untilLabel = untilStart > 0 ? (untilStart < 3600000 ? txf("Starts in {n} min", { n: Math.max(1, Math.round(untilStart / 60000)) }) : untilStart < 86400000 ? txf("Starts in {n} h", { n: Math.round(untilStart / 3600000) }) : txf("Starts in {n} days", { n: Math.round(untilStart / 86400000) })) : '';
  const where = m.type === 'online' ? (m.link ? <a href={m.link} target="_blank" rel="noreferrer">{tx("Join online")}</a> : tx("Online")) : (m.lat !== undefined && m.lng !== undefined ? <a href={`https://www.google.com/maps?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer">{m.location || tx("Open in Google Maps")}</a> : (m.location || tx("In person")));
  const avg = ratingOf(m);
  const tiles: { v: string; l: string; tone: string }[] = [
    { v: String(m.agenda.length), l: tx("Agenda points"), tone: 'g' },
    { v: `${plannedTotal} min`, l: durationMin !== null ? `${tx("planned of")} ${durationMin}` : tx("planned"), tone: 'y' },
    { v: `${m.agenda.filter((p) => p.status === 'completed').length}/${m.agenda.length}`, l: tx("Completed"), tone: 'g' },
    { v: String(m.agenda.filter((p) => p.status === 'follow_up').length), l: tx("Follow-ups"), tone: 'y' },
    { v: m.status === 'scheduled' ? String(m.inviteeIds.length) : `${presentN}/${m.inviteeIds.length}`, l: m.status === 'scheduled' ? tx("Participants") : tx("Present"), tone: 'g' },
    { v: String(m.actions.filter((x) => x.status === 'open').length), l: overdue ? `${tx("Open actions")} · ${overdue} ${tx("overdue")}` : tx("Open actions"), tone: overdue ? 'r' : 'y' },
    { v: avg ? `★ ${avg}` : '—', l: avg ? `${tx("Rating")} · ${Object.keys(m.feedback ?? {}).length} ${tx("votes")}` : tx("No feedback yet"), tone: 'g' },
    { v: usedMin ? `${usedMin} min` : '—', l: tx("Time used so far"), tone: 'y' },
  ];

  const canMark = isCtl && (running || m.status === 'completed');
  const peoplePanel = (
    <>
            <div className="mt-card">
              <div className="mt-sub-row"><h3 className="mt-sub">{tx("Participants ·")} {m.inviteeIds.length}</h3>{m.inviteeIds.includes(uid) && attendance[uid]?.status !== 'present' && <button type="button" className="fx2-btn" disabled={busy} onClick={() => mark(uid, 'present')}>{tx("I am here")}</button>}</div>
              <div className="mx3-ptabs" role="tablist">
                <button type="button" role="tab" aria-selected={pTab === 'all'} className={pTab === 'all' ? 'on' : ''} onClick={() => { setPTab('all'); setPLimit(40); }}>{tx("All (")}{m.inviteeIds.length})</button>
                <button type="button" role="tab" aria-selected={pTab === 'present'} className={pTab === 'present' ? 'on' : ''} onClick={() => { setPTab('present'); setPLimit(40); }}>{tx("Present (")}{presentN})</button>
                <button type="button" role="tab" aria-selected={pTab === 'absent'} className={pTab === 'absent' ? 'on' : ''} onClick={() => { setPTab('absent'); setPLimit(40); }}>{tx("Absent (")}{absentN})</button>
              </div>
              <label className="mx3-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={pq} onChange={(e) => { setPq(e.target.value); setPLimit(40); }} placeholder={tx("Search a participant")} aria-label={tx("Search a participant")} />{pq && <button type="button" aria-label={tx("Clear")} onClick={() => setPq('')}>×</button>}</label>
              <div className="mx-att" aria-label={tx("Attendance")}><i className="p" style={{ flexGrow: presentN }} /><i className="a" style={{ flexGrow: absentN }} /><i className="u" style={{ flexGrow: unmarked }} /></div>
              <p className="mx-att-l"><span className="p">{presentN} {tx("present")}</span><span className="a">{absentN} {tx("absent")}</span><span className="u">{unmarked} {tx("not marked")}</span></p>
              {canMark && (
                <div className={`mx3-bulk${sel.length ? ' on' : ''}`}>
                  <label className="mx3-all"><input type="checkbox" checked={allSel} onChange={toggleAll} /> <span>{sel.length ? txf("{n} selected", { n: sel.length }) : txf("Select all {n}", { n: pFiltered.length })}</span></label>
                  <button type="button" className="pres" disabled={busy || sel.length === 0} onClick={() => bulk('present')}>{tx("✓ Present")}</button>
                  <button type="button" className="abs" disabled={busy || sel.length === 0} onClick={() => bulk('absent')}>{tx("✗ Absent")}</button>
                  {sel.length > 0 && <button type="button" className="clr" onClick={() => setSel([])}>{tx("Clear")}</button>}
                </div>
              )}
              <div className="mx3-pbox"><div className="mx3-pscroll">
              <ul className="mx3-ppl mx4">
                {pVisible.length === 0 && <li className="none">{tx("Nobody matches.")}</li>}
                {pVisible.map((id) => {
                  const st = attendance[id]?.status;
                  return (
                    <li key={id} className={`${st ?? ''}${selSet.has(id) ? ' sel' : ''}`}>
                      {canMark && <input type="checkbox" aria-label={tx("Select")} checked={selSet.has(id)} onChange={() => setSel(selSet.has(id) ? sel.filter((x) => x !== id) : [...sel, id])} />}
                      <Avatar name={profiles[id]?.name ?? ''} photoUrl={profiles[id]?.photoUrl} size={36} />
                      <span className="mx4-who">
                        <PersonLink userId={id}><b>{profiles[id]?.name || tx("Member")}</b></PersonLink>
                        <small>
                          <span className={`mt-chip att ${st === 'present' ? 'pres' : st === 'absent' ? 'abs' : 'idle'}`}>{st === 'present' ? tx("Present") : st === 'absent' ? tx("Absent") : tx("Not marked")}</span>
                          {id === m.coordinatorId && <em className="mt-co">{tx("Coordinator")}</em>}
                        </small>
                      </span>
                      <span className="mx4-act">
                        <ViewProfile userId={id} />
                        {canMark && <span className="mx3-qm"><button type="button" className="pres" title={tx("Mark present")} disabled={busy || st === 'present'} onClick={() => mark(id, 'present')}>✓</button><button type="button" className="abs" title={tx("Mark absent")} disabled={busy || st === 'absent'} onClick={() => mark(id, 'absent')}>✗</button></span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {pFiltered.length > pVisible.length && <button type="button" className="mx3-more" onClick={() => setPLimit(pLimit + 40)}>{tx("Show 40 more ·")} {pFiltered.length - pVisible.length} {tx("left")}</button>}
              </div></div>
            </div>
    </>
  );

  return (
    <div className="mt-detail mx-detail">
      <section className="mx-hero">
        <div className="mx-hero-top">
          <div className="mx-hero-main">
            <h2>{m.title}</h2>
            <div className="mx-pills">
              <span className={`mx-pill st ${m.status}`}>{STATUS[m.status]}</span>
              <span className="mx-pill">{m.type === 'online' ? tx("Online") : tx("In person")}</span>
              {durationMin !== null && <span className="mx-pill">{durationMin} {tx("min")}</span>}
              <span className="mx-pill">{fmtDate(startMs)}{endMs > startMs ? ` – ${fmtTime(endMs)}` : ''}</span>
              {m.timeZone && <span className="mx-pill" title={tx("The time zone this meeting was planned in")}>{m.timeZone.replace(/_/g, ' ')}</span>}
              {untilLabel && m.status === 'scheduled' && <span className="mx-pill gold">{untilLabel}</span>}
              {m.parentMeetingId || m.parentMeetingTitle ? <span className="mx-pill gold">Follow-up</span> : null}
            </div>
            <p className="mx-line"><span>{tx("Where")}</span> {where}</p>
            <p className="mx-line"><span>{tx("Coordinator")}</span> {m.coordinatorId ? <PersonLink userId={m.coordinatorId}>{m.coordinatorName ?? tx("Unknown")}</PersonLink> : tx("not set (use Edit meeting)")}</p>
            {parent ? <p className="mx-line"><span>{tx("Follow-up of")}</span> <button type="button" className="mt-link" onClick={() => onOpen(parent.id)}>{parent.title}</button></p> : m.parentMeetingTitle ? <p className="mx-line"><span>{tx("Follow-up of")}</span> {m.parentMeetingTitle}</p> : null}
            {children.length > 0 && <p className="mx-line"><span>Follow-ups</span> {children.map((c) => <button key={c.id} type="button" className="mt-link" onClick={() => onOpen(c.id)}>{fmtDay(tsMs(c.startAt))}</button>)}</p>}
            <div className="mx-inv">
              <button type="button" className="mx-inv-stack" onClick={() => setShowInv(true)} aria-label={txf("View the {n} invited people", { n: m.inviteeIds.length })}>
                {m.inviteeIds.slice(0, 9).map((id) => <Avatar key={id} name={profiles[id]?.name ?? ''} photoUrl={profiles[id]?.photoUrl} size={34} />)}
                {m.inviteeIds.length > 9 && <span className="mx-inv-more">+{m.inviteeIds.length - 9}</span>}
              </button>
              <button type="button" className="mx-inv-btn" onClick={() => setShowInv(true)}>
                <WizSvg name="users" size={16} /> {m.inviteeIds.length} {tx("invited · View the full list")}
              </button>
            </div>
          </div>
          <div className="mx-hero-actions">
            {isCtl && m.status === 'scheduled' && <button type="button" className="fx2-btn" disabled={busy} onClick={() => run(() => setMeetingStatus({ meetingId: m.id, status: 'in_progress' }), tx("Meeting started and everyone notified"))}>{tx("Start meeting")}</button>}
            {isCtl && running && <button type="button" className="fx2-btn" disabled={busy || !!m.activePointId} onClick={() => setDlg({ kind: 'finish' })}>{tx("End meeting")}</button>}
            {isAdm && m.status === 'scheduled' && <button type="button" className="fx2-btn ghost" onClick={() => setDlg({ kind: 'people' })}>{tx("Edit meeting")}</button>}
            {isAdm && canEdit && <button type="button" className="fx2-btn ghost" onClick={() => setDlg({ kind: 'agenda' })}>{tx("Edit agenda")}</button>}
            {isCtl && m.status === 'scheduled' && <button type="button" className="fx2-btn danger" disabled={busy} onClick={() => run(() => setMeetingStatus({ meetingId: m.id, status: 'cancelled' }), tx("Meeting cancelled"))}>{tx("Cancel")}</button>}
            {isCtl && m.status === 'completed' && m.agenda.some((p) => p.status === 'follow_up' && !p.followUpMeetingId) && <button type="button" className="fx2-btn" disabled={busy} onClick={() => run(() => createFollowUpMeetings({ meetingId: m.id }), tx("Follow-up meetings created"))}>{tx("Create follow-up meetings")}</button>}
          </div>
        </div>
        {running && span > 0 && (
          <div className="mx-time"><span>{fmtTime(startMs)}</span><div className="mx-time-bar"><i style={{ width: `${timePct}%` }} /></div><span>{fmtTime(endMs)}</span><em className={now > endMs ? 'bad' : now < startMs ? 'early' : ''}>{now > endMs ? txf("{t} over time", { t: fmtSpan(now - endMs) }) : now < startMs ? txf("Started early · planned {d}", { d: fmtDate(startMs) }) : txf("{t} left", { t: fmtSpan(endMs - now) })}</em></div>
        )}
        {plannedTotal > 0 && (<>
        <div className="mx-tl" aria-label={tx("Agenda timeline")}>
            {m.agenda.map((p, i) => <span key={p.id} className={`mx-seg ${pointTone(p.status)}`} style={{ flexGrow: Math.max(1, p.plannedMinutes) }} title={`${i + 1}. ${p.title} · ${p.plannedMinutes} min · ${PSTATUS[p.status ?? 'pending']}`}><b>{i + 1}</b><i>{p.title} · {p.plannedMinutes}m</i></span>)}
          </div>
        </>)}
        <div className="mx-tiles">{tiles.map((t) => <div key={t.l} className={`mx-tile ${t.tone}`}><b>{t.v}</b><span>{t.l}</span></div>)}</div>
      </section>

{running ? (
        <div className={`mx-body mx3${view === 'agenda' ? ' mx3-ag' : ''}`}>
          <nav className="mx3-nav" aria-label={tx("Meeting sections")}>
            <button type="button" className={view === 'agenda' ? 'on' : ''} onClick={() => setView('agenda')}><WizSvg name="list" /><span><b>{tx("Agenda")}</b><small>{m.agenda.length} {tx("items")}</small></span></button>
            <button type="button" className={view === 'decisions' ? 'on' : ''} onClick={() => setView('decisions')}><WizSvg name="check" /><span><b>{tx("Decisions")}</b><small>{closedPts.length} {tx("decisions ·")} {m.actions.filter((a) => a.status === 'open').length} {tx("actions")}</small></span></button>
            <button type="button" className={view === 'docs' ? 'on' : ''} onClick={() => setView('docs')}><WizSvg name="doc" /><span><b>{tx("Documents")}</b><small>{docs.length} {tx("files · feedback")}</small></span></button>
            <div className="mx3-active"><WizSvg name="users" size={34} /><b>{tx("Meeting is active")}</b><small>{presentN} {tx("of")} {m.inviteeIds.length} {tx("present. Manage the agenda, decisions and time here.")}</small></div>
          </nav>
          <div className="mx-col mx3-main">
          {view === 'agenda' && (<>
            {active ? (
              <div className={`mx3-cur ${nearEnd ? 'warn' : ''}`}>
                <div className="mx3-cur-h">
                  <span className="mx3-n">{m.agenda.indexOf(active) + 1}</span>
                  <div><h3>{active.title}</h3><p>{active.description || (active.ownerName ? txf("Presented by {n}", { n: active.ownerName }) : `${active.plannedMinutes}${active.extendedMinutes ? ` + ${active.extendedMinutes}` : ''} ${tx("minutes allocated")}`)}</p></div>
                  <div className={`mx3-clock ${left < 0 ? 'over' : ''}`}><small>{left < 0 ? tx("Over time") : tx("In progress")}</small><b>{left < 0 ? '+' : ''}{clock(left)}</b></div>
                </div>
                {nearEnd && <p className="mt-alert">{left < 0 ? tx("The time for this point is over.") : tx("The time for this point is almost over.")} {tx("Choose what happens next.")}</p>}
                <div className="mx3-cur-b">
                  <div className="mx3-pane">
                    <h4><WizSvg name="doc" size={18} /> {tx("Decision workspace")}</h4>
                    {active && isCtl ? <DecisionForm key={active.id} point={active} busy={busy} people={m.inviteeIds.map((id) => ({ id, name: profiles[id]?.name || tx("Member") }))} onSave={(v) => run(() => ctl('complete', active.id, v), tx("Decision recorded"))} /> : <p className="mt-empty">{active ? tx("Only the coordinator records decisions.") : tx("Start an agenda point from the Agenda tab. Its decision, notes and action items are written here.")}</p>}
                  </div>
                  <div className="mx3-pane">
                    <h4><WizSvg name="clock" size={18} /> {tx("Quick actions")}</h4>
                    {isCtl ? <div className="mx3-qa">
                      <button type="button" className="mx3-q done" disabled={busy} title={tx("Close this point without recording a decision")} onClick={() => run(() => ctl('complete', active.id, { noDecision: true }), tx("Point completed"))}>{tx("✓ Complete this point")}</button>
                      <button type="button" className="mx3-q" disabled={busy} onClick={() => setDlg({ kind: 'extend', point: active })}>{tx("Extend time")}</button>
                      <button type="button" className="mx3-q" disabled={busy} onClick={() => setDlg({ kind: 'followup', point: active })}>{tx("Follow up later")}</button>
                    </div> : <p className="mt-empty">{tx("Only the coordinator controls the point.")}</p>}
                    <div className="mx3-tl"><b>{tx("Timeline")}</b><small>{total / 60} {tx("min allocated ·")} {Math.max(0, Math.round((total - left) / 60))} {tx("min elapsed")}</small><div className="mt-bar"><i style={{ width: `${Math.min(100, Math.max(0, ((total - left) / total) * 100))}%` }} /></div><em>{left < 0 ? `${Math.ceil(-left / 60)} min over` : `${Math.ceil(left / 60)} min remaining`}</em></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx3-cur idle"><div className="mx3-cur-h"><span className="mx3-n">▶</span><div><h3>{tx("No point is running")}</h3><p>{tx("Press Start on a point below. Its decision workspace and timer open here.")}</p></div></div></div>
            )}
            {plan.length > 0 && (
            <div className="mt-card mt-plan">
              <b>{tx("Follow-up plan")}</b>
              {plan.map(([ms, nums]) => <span key={ms} className="mt-chip gold">{fmtDay(ms)} {tx("→ point")}{nums.length > 1 ? 's' : ''} {nums.join(', ')}</span>)}
            </div>
          )}


            <div className="mt-card mx3-list">
              <div className="mt-sub-row"><h3 className="mt-sub">{tx("All agenda points ·")} {m.agenda.length}</h3><span className="mt-meta">{plannedTotal} {tx("min planned")}</span></div>
              <ol className="mx-ag">
            {m.agenda.map((p, i) => (
              <li key={p.id} className={`${pointTone(p.status)}${p.id === m.activePointId ? ' now' : ''}`}>
                <span className="mt-num">{i + 1}</span>
                <div><b>{p.title}</b><small>{p.actualMinutes !== undefined ? `${p.actualMinutes} of ${p.plannedMinutes + (p.extendedMinutes ?? 0)} min` : `${p.plannedMinutes} min`}{p.ownerName ? ` · ${p.ownerName}` : ''}</small></div>
                <span className={`mt-chip ${pointTone(p.status)}`}>{PSTATUS[p.status ?? 'pending']}</span>
                {isCtl && isOpen(p) && (
                  <span className="mx-ag-act">
                    {p.status !== 'active' && p.status !== 'extended' && <button type="button" className="fx2-btn" disabled={busy || !!m.activePointId} onClick={() => run(() => ctl('start', p.id), 'Point started')}>{tx("Start")}</button>}
                    <button type="button" className="mt-tick" title={tx("Mark as completed, no decision needed")} aria-label={txf("Mark point {n} completed without a decision", { n: i + 1 })} disabled={busy} onClick={() => run(() => ctl('complete', p.id, { noDecision: true }), tx("Point marked as completed"))}>✓</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
            </div>
          </>)}
          {view === 'decisions' && (<>
            <div className="mx-two">
            <div className="mt-card">
              <h3 className="mt-sub">{tx("Decisions ·")} {closedPts.length}</h3>
              {closedPts.length === 0 ? <p className="mt-empty">{tx("No decision recorded yet. Decisions appear here as each point is concluded.")}</p> : (
                <ol className="mx-dec">{closedPts.map((p) => <li key={p.id}><b>{m.agenda.indexOf(p) + 1}. {p.title}</b><span>{p.decision || tx("Completed, no decision needed")}</span>{p.notes ? <em className="mx-dn">{p.notes}</em> : null}</li>)}</ol>
              )}
            </div>
            <div className="mt-card">
              <h3 className="mt-sub">{tx("Action items ·")} {m.actions.filter((a) => a.status === 'open').length} {tx("open")}</h3>
              {m.actions.length === 0 ? <p className="mt-empty">{tx("No action item yet. They are created when a decision is recorded.")}</p> : (
                <ul className="mt-ai">{m.actions.map((a) => (
                  <li key={a.id} className={a.status === 'done' ? 'done' : ''}>
                    <button type="button" className="mt-check" disabled={busy} onClick={() => run(() => setMeetingActionStatus({ meetingId: m.id, actionId: a.id, status: a.status === 'done' ? 'open' : 'done' }), 'Updated')}>{a.status === 'done' ? '✓' : ''}</button>
                    <span>{a.text}{a.ownerName ? <> · {a.ownerId ? <PersonLink userId={a.ownerId}>{a.ownerName}</PersonLink> : a.ownerName}</> : null}{a.dueAt ? <em className={a.status === 'open' && tsMs(a.dueAt) < Date.now() ? 'mx-late' : ''}> {tx("· by")} {fmtDay(tsMs(a.dueAt))}</em> : ''}</span>
                  </li>
                ))}</ul>
              )}
            </div>
          </div>
          
          </>)}
          {view === 'docs' && (<>
            <div className="mx-two mx-rest">
          <div className="mt-card">
            <h3 className="mt-sub">{tx("Documents and media ·")} {docs.length}</h3>
            {docs.length === 0 ? <p className="mt-empty">{tx("No document attached. Add files, links, audio or books when editing the agenda.")}</p> : (
              <ul className="mx-docs">{docs.map((d, i) => (
                <li key={`${d.url}${i}`}>
                  <span className={`mx-dk ${d.kind ?? 'link'}`}>{d.kind === 'audio' ? tx("Audio") : d.kind === 'book' || d.kind === 'event_book' ? tx("Book") : d.kind === 'file' ? tx("File") : tx("Link")}</span>
                  {d.url.startsWith('http') ? <a href={d.url} target="_blank" rel="noreferrer">{d.title || tx("Document")}</a> : <span>{d.title}</span>}
                  <small>{tx("Point")} {d.n}</small>
                </li>
              ))}</ul>
            )}
          </div>

          {m.status !== 'scheduled' && m.status !== 'cancelled' ? <Feedback m={m} uid={uid} profiles={profiles} /> : (
            <div className="mt-card">
              <h3 className="mt-sub">{tx("Feedback and discussion")}</h3>
              <p className="mt-empty">{tx("Feedback opens when the meeting starts. Participants rate it and write the points they want to discuss.")}</p>
            </div>
          )}
          </div>

          </>)}
          </div>
          <aside className="mx-col mx3-side">
            {peoplePanel}
            <div className="mt-card mx3-info mx5">
              <h3 className="mt-sub"><WizSvg name="doc" size={20} /> {tx("Meeting info")}</h3>
              <p><i><WizSvg name="pin" size={18} /></i><span>{tx("Where")}</span><b>{where}</b></p>
              {m.type === 'online' && m.link && <p><i><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg></i><span>{tx("Link")}</span><b className="mx3-link">{m.link}</b><button type="button" className="mx3-copy" onClick={() => { try { void navigator.clipboard.writeText(m.link as string); notify('Link copied', 'success'); } catch { /* clipboard blocked */ } }}>{tx("Copy")}</button></p>}
              <p><i><WizSvg name="calendar" size={18} /></i><span>{tx("When")}</span><b>{fmtDate(startMs)}{endMs > startMs ? ` – ${fmtTime(endMs)}` : ''}</b></p>
              <p><i><WizSvg name="users" size={18} /></i><span>{tx("Coordinator")}</span><b>{m.coordinatorName ?? tx("not set")}</b></p>
            </div>
          </aside>
        </div>
      ) : (
      <div className="mx-body">
        <div className="mx-col">
          {plan.length > 0 && (
            <div className="mt-card mt-plan">
              <b>{tx("Follow-up plan")}</b>
              {plan.map(([ms, nums]) => <span key={ms} className="mt-chip gold">{fmtDay(ms)} {tx("→ point")}{nums.length > 1 ? 's' : ''} {nums.join(', ')}</span>)}
            </div>
          )}

          {m.parentMeetingId && <Previous parent={parentMeeting} title={m.parentMeetingTitle} onOpen={onOpen} />}

          <div className="mt-card">
            <div className="mt-sub-row">
              <h3 className="mt-sub">{tx("Agenda ·")} {plannedTotal} {tx("min planned")}{durationMin !== null ? ` of ${durationMin}` : ''}</h3>
              {isAdm && canEdit && <div className="mt-actions"><button type="button" className="fx2-btn ghost" disabled={busy || durationMin === null} title={durationMin === null ? tx("This meeting has no end time") : tx("Divide the time left equally between the open points")} onClick={autoSchedule}>{tx("Auto schedule")}</button><button type="button" className="fx2-btn ghost" onClick={() => setDlg({ kind: 'agenda' })}>{tx("Custom schedule")}</button></div>}
            </div>
            {m.agenda.length === 0 && <p className="mt-empty">{tx("No agenda yet. Add the first point.")}</p>}
            <ol className="mt-points">
              {m.agenda.map((p, i) => (
                <li key={p.id} className={`mt-point ${pointTone(p.status)}`}>
                  <div className="mt-point-top">
                    <span className="mt-num">{i + 1}</span>
                    <b>{p.title}</b>
                    <span className={`mt-chip ${pointTone(p.status)}`}>{PSTATUS[p.status ?? 'pending']}</span>
                    <span className="mt-time">{p.actualMinutes !== undefined ? `${p.actualMinutes} of ${p.plannedMinutes + (p.extendedMinutes ?? 0)} min` : `${p.plannedMinutes} min`}</span>
                  </div>
                  <p className="mt-desc">{p.description || (p.ownerName ? txf("Presented by {n}", { n: p.ownerName }) : tx("No description"))}</p>
                  {p.ownerName && p.description && <p className="mt-owner">{tx("Presented by")} {p.ownerName}</p>}
                  {p.carriedFrom && <p className="mt-carry">{tx("From “")}{p.carriedFrom.meetingTitle}”{p.carriedFrom.notes ? ` · Notes: ${p.carriedFrom.notes}` : ''}</p>}
                  {(p.documents ?? []).length > 0 && <div className="mt-docs">{p.documents!.map((d) => (d.url.startsWith('http') ? <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className={d.kind}>{d.title || tx("Document")}</a> : <span key={d.url} className={`mt-dchip ${d.kind ?? ''}`}>{d.title}</span>))}</div>}
                  {p.decision && <p className="mt-decision"><b>{tx("Decision")}</b> {p.decision}</p>}
                  {p.notes && <p className="mt-notes"><b>{tx("Notes")}</b> {p.notes}</p>}
                  {(p.actionItems ?? []).length > 0 && <ul className="mt-ai">{p.actionItems!.map((a, k) => <li key={k}>{a.text}{a.ownerName ? <> · {a.ownerId ? <PersonLink userId={a.ownerId}>{a.ownerName}</PersonLink> : a.ownerName}</> : null}{a.dueMs ? ` · by ${fmtDay(a.dueMs)}` : ''}</li>)}</ul>}
                  {p.status === 'follow_up' && p.followUpOn ? <p className="mt-notes"><b>Follow-up</b> {fmtDay(tsMs(p.followUpOn))}{p.followUpMeetingId && all.some((x) => x.id === p.followUpMeetingId) ? <> · <button type="button" className="mt-link" onClick={() => onOpen(p.followUpMeetingId!)}>{tx("Open meeting")}</button></> : null}</p> : null}
                  <div className="mt-point-actions">
                    {isCtl && running && isOpen(p) && p.status !== 'active' && p.status !== 'extended' && <button type="button" className="fx2-btn" disabled={busy || !!m.activePointId} onClick={() => run(() => ctl('start', p.id), 'Point started')}>{tx("Start point")}</button>}
                    {isCtl && running && isOpen(p) && !m.activePointId && <button type="button" className="fx2-btn ghost" onClick={() => setDlg({ kind: 'followup', point: p })}>{tx("Follow up later")}</button>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mx-two">
            <div className="mt-card">
              <h3 className="mt-sub">{tx("Decisions ·")} {closedPts.length}</h3>
              {closedPts.length === 0 ? <p className="mt-empty">{tx("No decision recorded yet. Decisions appear here as each point is concluded.")}</p> : (
                <ol className="mx-dec">{closedPts.map((p) => <li key={p.id}><b>{m.agenda.indexOf(p) + 1}. {p.title}</b><span>{p.decision || tx("Completed, no decision needed")}</span>{p.notes ? <em className="mx-dn">{p.notes}</em> : null}</li>)}</ol>
              )}
            </div>
            <div className="mt-card">
              <h3 className="mt-sub">{tx("Action items ·")} {m.actions.filter((a) => a.status === 'open').length} {tx("open")}</h3>
              {m.actions.length === 0 ? <p className="mt-empty">{tx("No action item yet. They are created when a decision is recorded.")}</p> : (
                <ul className="mt-ai">{m.actions.map((a) => (
                  <li key={a.id} className={a.status === 'done' ? 'done' : ''}>
                    <button type="button" className="mt-check" disabled={busy} onClick={() => run(() => setMeetingActionStatus({ meetingId: m.id, actionId: a.id, status: a.status === 'done' ? 'open' : 'done' }), 'Updated')}>{a.status === 'done' ? '✓' : ''}</button>
                    <span>{a.text}{a.ownerName ? <> · {a.ownerId ? <PersonLink userId={a.ownerId}>{a.ownerName}</PersonLink> : a.ownerName}</> : null}{a.dueAt ? <em className={a.status === 'open' && tsMs(a.dueAt) < Date.now() ? 'mx-late' : ''}> {tx("· by")} {fmtDay(tsMs(a.dueAt))}</em> : ''}</span>
                  </li>
                ))}</ul>
              )}
            </div>
          </div>
          <div className="mt-card">
            <h3 className="mt-sub">{tx("Documents and media ·")} {docs.length}</h3>
            {docs.length === 0 ? <p className="mt-empty">{tx("No document attached. Add files, links, audio or books when editing the agenda.")}</p> : (
              <ul className="mx-docs">{docs.map((d, i) => (
                <li key={`${d.url}${i}`}>
                  <span className={`mx-dk ${d.kind ?? 'link'}`}>{d.kind === 'audio' ? tx("Audio") : d.kind === 'book' || d.kind === 'event_book' ? tx("Book") : d.kind === 'file' ? tx("File") : tx("Link")}</span>
                  {d.url.startsWith('http') ? <a href={d.url} target="_blank" rel="noreferrer">{d.title || tx("Document")}</a> : <span>{d.title}</span>}
                  <small>{tx("Point")} {d.n}</small>
                </li>
              ))}</ul>
            )}
          </div>

          {m.status !== 'scheduled' && m.status !== 'cancelled' ? <Feedback m={m} uid={uid} profiles={profiles} /> : (
            <div className="mt-card">
              <h3 className="mt-sub">{tx("Feedback and discussion")}</h3>
              <p className="mt-empty">{tx("Feedback opens when the meeting starts. Participants rate it and write the points they want to discuss.")}</p>
            </div>
          )}
        </div>

        <aside className="mx-col mx-side mx3-side mx-done-side">
          {peoplePanel}
        </aside>
      </div>
      )}

      {dlg?.kind === 'agenda' && <AgendaDialog m={m} totalMinutes={durationMin} lockedMinutes={closedMin} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'extend' && dlg.point && <ExtendDialog point={dlg.point} onClose={() => setDlg(null)} onExtend={(minutes) => ctl('extend', dlg.point!.id, { minutes }).then(() => notify(`${minutes} minutes added`, 'success'))} />}
      {dlg?.kind === 'decision' && dlg.point && (
        <FormDialog title={tx("Take the decision")} intro={`Conclude “${dlg.point.title}”. The decision, notes and action items are stored with the point.`} submitLabel={tx("Record decision")} onClose={() => setDlg(null)}
          fields={[
            { name: 'decision', label: tx("Final decision"), type: 'textarea', required: true },
            { name: 'notes', label: tx("Discussion notes"), type: 'textarea' },
            { name: 'a1', label: tx("Action item 1") }, { name: 'o1', label: tx("Responsible for 1"), type: 'member' },
            { name: 'a2', label: tx("Action item 2") }, { name: 'o2', label: tx("Responsible for 2"), type: 'member' },
            { name: 'a3', label: tx("Action item 3") }, { name: 'o3', label: tx("Responsible for 3"), type: 'member' },
            { name: 'due', label: tx("Action items due"), type: 'date' },
          ]}
          onSubmit={(v) => ctl('complete', dlg.point!.id, {
            decision: v.decision, notes: v.notes,
            actionItems: [1, 2, 3].filter((n) => v[`a${n}`]).map((n) => ({ text: v[`a${n}`], ...(v[`o${n}`] ? { ownerId: v[`o${n}`] } : {}), ...(v.due ? { dueMs: new Date(v.due).getTime() } : {}) })),
          }).then(() => notify('Decision recorded', 'success'))} />
      )}
      {dlg?.kind === 'followup' && dlg.point && (
        <FormDialog title={tx("Follow up later")} intro={`“${dlg.point.title}” moves to a follow-up meeting. Points given the same date and time are combined into one meeting.`} submitLabel={tx("Schedule follow-up")} onClose={() => setDlg(null)}
          fields={[{ name: 'date', label: tx("Follow-up date and time"), type: 'datetime-local', required: true, initial: toLocalInput(Math.max(Date.now(), startMs) + 7 * 86400000) }, { name: 'notes', label: tx("Notes to carry forward"), type: 'textarea', initial: dlg.point.notes ?? '' }]}
          onSubmit={(v) => ctl('follow_up', dlg.point!.id, { dateMs: new Date(v.date).getTime(), notes: v.notes }).then(() => notify('Marked for follow-up', 'success'))} />
      )}
      {dlg?.kind === 'finish' && (
        <FormDialog title={tx("End the meeting")} submitLabel={tx("End and arrange follow-ups")} onClose={() => setDlg(null)}
          intro={openPts.length ? `${openPts.length} point${openPts.length === 1 ? ' is' : 's are'} still open. Give each a follow-up date, or one date for all. Points on the same date and time become one follow-up meeting, and everyone is notified.` : tx("Every point is closed. Ending now saves the full record.")}
          fields={openPts.length ? [{ name: 'all', label: tx("One date and time for all open points"), type: 'datetime-local' as const }, ...openPts.map((p) => ({ name: `d_${p.id}`, label: `${m.agenda.indexOf(p) + 1}. ${p.title}`, type: 'datetime-local' as const }))] : []}
          onSubmit={(v) => finishMeeting({
            meetingId: m.id,
            followUps: openPts.filter((p) => v[`d_${p.id}`]).map((p) => ({ pointId: p.id, dateMs: new Date(v[`d_${p.id}`]).getTime() })),
            ...(v.all ? { defaultFollowUpMs: new Date(v.all).getTime() } : {}),
          }).then((r) => notify(r.data.followUpMeetingIds.length ? `Meeting ended, ${r.data.followUpMeetingIds.length} follow-up meeting${r.data.followUpMeetingIds.length === 1 ? '' : 's'} scheduled` : 'Meeting ended', 'success'))} />
      )}
      {dlg?.kind === 'people' && <EditDetails m={m} onClose={() => setDlg(null)} />}
      {showInv && <InviteesDialog ids={m.inviteeIds} coordinatorId={m.coordinatorId} profiles={profiles} attendance={attendance} showStatus={m.status !== 'scheduled'} onClose={() => setShowInv(false)} />}
    </div>
  );
}


/** Inline decision workspace for the running point: decision, notes and up to three action items, without leaving the page. */
function DecisionForm({ point, busy, onSave }: { point: Point; busy: boolean; people?: { id: string; name: string }[]; onSave: (v: Record<string, unknown>) => void }) {
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState(point.notes ?? '');
  const [items, setItems] = useState<{ text: string; ownerIds: string[]; due: string }[]>([{ text: '', ownerIds: [], due: '' }]);
  const set = (i: number, k: 'text' | 'due', v: string) => setItems((a) => a.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const setOwners = (i: number, ids: string[]) => setItems((a) => a.map((x, n) => (n === i ? { ...x, ownerIds: ids } : x)));
  const remove = (i: number) => setItems((a) => (a.length > 1 ? a.filter((_, n) => n !== i) : [{ text: '', ownerIds: [], due: '' }]));
  return (
    <form className="mx-dform" onSubmit={(e) => { e.preventDefault(); if (!decision.trim()) return; onSave({ decision: decision.trim(), notes, actionItems: items.filter((x) => x.text.trim()).flatMap((x) => (x.ownerIds.length ? x.ownerIds : [''])).length ? items.filter((x) => x.text.trim()).flatMap((x) => (x.ownerIds.length ? x.ownerIds : ['']).map((id) => ({ text: x.text.trim(), ...(id ? { ownerId: id } : {}), ...(x.due ? { dueMs: new Date(x.due).getTime() } : {}) }))) : [] }); }}>
      <p className="mt-meta">{tx("For “")}{point.title}”</p>
      <label>{tx("Final decision")}<textarea required rows={3} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder={tx("What was decided?")} /></label>
      <label>{tx("Discussion notes")}<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tx("Key arguments, remarks…")} /></label>
      <div className="mx-dai">
        <b>{tx("Action items")}</b>
        {items.map((it, i) => (
          <div key={i} className="mx-dai-row">
            <input className="mx-dai-t" placeholder={tx("What must be done?")} value={it.text} onChange={(e) => set(i, 'text', e.target.value)} />
            <OwnerPick ids={it.ownerIds} onPick={(v) => setOwners(i, v)} />
            <div className="mx-dai-d"><DateTimePicker mode="date" value={it.due} onChange={(v) => set(i, 'due', v)} placeholder={tx("Due date")} min={new Date().toISOString().slice(0, 10)} /></div>
            {(it.text || it.ownerIds.length > 0 || it.due) && <button type="button" className="mx-dai-x" aria-label={tx("Remove this action item")} onClick={() => remove(i)}>×</button>}
          </div>
        ))}
        {items.length < 5 && <button type="button" className="fx2-btn ghost" onClick={() => setItems((a) => [...a, { text: '', ownerIds: [], due: '' }])}>{tx("+ Add an action item")}</button>}
      </div>
      <button type="submit" className="fx2-btn" disabled={busy || !decision.trim()}>{tx("Record decision and close the point")}</button>
    </form>
  );
}

/* ---------- dialogs and panels ---------- */
function Sheet({ title, onClose, children, footer, xl }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; xl?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key); };
  }, [onClose]);
  return createPortal(
    <div className="mt-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`mt-sheet wide${xl ? ' xl' : ''}`}>
        <header><h3>{title}</h3><button type="button" className="mt-x" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="mt-sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

const toDraft = (p: Point): PointDraft => ({ id: p.id, title: p.title, minutes: String(p.plannedMinutes), description: p.description ?? '', owner: p.ownerName ?? '', docs: (p.documents ?? []).map((d) => ({ title: d.title, url: d.url, kind: (d.kind as DocDraft['kind']) ?? 'link' })) });
const fromDraft = (p: PointDraft) => ({ ...(p.id ? { id: p.id } : {}), title: p.title.trim(), plannedMinutes: Number(p.minutes) || 1, ...(p.owner.trim() ? { ownerName: p.owner.trim() } : {}), description: p.description.trim(), documents: p.docs.map(docOf) });

/** Add, change or remove the points that are still open, share the time (auto or custom) and attach documents, audio and books. */
function AgendaDialog({ m, totalMinutes, lockedMinutes, onClose }: { m: Row; totalMinutes: number | null; lockedMinutes: number; onClose: () => void }) {
  const [points, setPoints] = useState<PointDraft[]>(() => { const open = m.agenda.filter(isOpen).map(toDraft); return open.length ? open : [blankPoint()]; });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setErr('');
    if (points.some((p) => !p.title.trim())) { setErr(tx("Every point needs a title.")); return; }
    const used = points.reduce((a, p) => a + (Number(p.minutes) || 0), 0);
    if (totalMinutes !== null && used + lockedMinutes > totalMinutes) { setErr(txf("The agenda takes {a} minutes but the meeting lasts {b}.", { a: used + lockedMinutes, b: totalMinutes })); return; }
    const list: unknown[] = [];
    for (const p of m.agenda) {
      if (!isOpen(p)) { list.push({ id: p.id, title: p.title, plannedMinutes: p.plannedMinutes, ownerName: p.ownerName, description: p.description ?? '', documents: (p.documents ?? []).map(docOf) }); continue; }
      const d = points.find((x) => x.id === p.id);
      if (d) list.push(fromDraft(d));
    }
    points.filter((p) => !p.id).forEach((p) => list.push(fromDraft(p)));
    setBusy(true);
    try { await updateMeetingAgenda({ meetingId: m.id, agenda: list }); notify('Agenda saved', 'success'); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : tx("Could not save")); } finally { setBusy(false); }
  }
  return (
    <Sheet title={tx("Edit the agenda")} onClose={onClose} footer={<>{err && <p className="mt-err">{err}</p>}<button type="button" className="fx2-btn ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="fx2-btn" disabled={busy} onClick={save}>{busy ? tx("Saving…") : tx("Save the agenda")}</button></>}>
      {lockedMinutes > 0 && <p className="mt-hint">{lockedMinutes} {tx("minutes are already used by points that are closed.")}</p>}
      <AgendaBuilder points={points} setPoints={setPoints} totalMinutes={totalMinutes} locked={lockedMinutes} />
    </Sheet>
  );
}

const EXTEND_STEPS = [5, 10, 15, 20, 30];
/** Extra time for the running point: quick values, or any number of minutes. */
function ExtendDialog({ point, onClose, onExtend }: { point: Point; onClose: () => void; onExtend: (minutes: number) => Promise<unknown> }) {
  const [pick, setPick] = useState<number | 'custom'>(5);
  const [custom, setCustom] = useState('');
  const mins = pick === 'custom' ? Math.floor(Number(custom)) : pick;
  const ok = Number.isInteger(mins) && mins >= 1 && mins <= 120;
  const now = point.plannedMinutes + (point.extendedMinutes ?? 0);
  return (
    <FormDialog title={tx("Extend the time")} intro={`Add minutes to “${point.title}”. The status becomes Extended and everyone sees the new time.`} submitLabel={ok ? txf("Add {n} min", { n: mins }) : tx("Extend")} onClose={onClose} fields={[]}
      onSubmit={() => (ok ? onExtend(mins) : Promise.reject(new Error(tx("Choose 1 to 120 minutes"))))}>
      <div className="ext">
        <div className="ext-row" role="radiogroup" aria-label={tx("Extra minutes")}>
          {EXTEND_STEPS.map((n) => <button type="button" key={n} role="radio" aria-checked={pick === n} className={pick === n ? 'on' : ''} onClick={() => setPick(n)}><b>{n}</b><small>{tx("min")}</small></button>)}
          <button type="button" role="radio" aria-checked={pick === 'custom'} className={`cu${pick === 'custom' ? ' on' : ''}`} onClick={() => setPick('custom')}><b>{tx("Custom")}</b><small>{tx("any value")}</small></button>
        </div>
        {pick === 'custom' && <label className="ext-c"><span>{tx("Minutes to add")}</span><input type="number" min={1} max={120} autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 25" /></label>}
        <p className="ext-sum"><span>{tx("Now")} <b>{now} {tx("min")}</b></span><i>→</i><span>{tx("After")} <b>{ok ? now + mins : '—'} {tx("min")}</b></span></p>
      </div>
    </FormDialog>
  );
}

function EditDetails({ m, onClose }: { m: Row; onClose: () => void }) {
  const startMs = tsMs(m.startAt);
  const endMs = tsMs(m.endAt);
  const [place, setPlace] = useState<Place>({ address: m.location ?? '', lat: m.lat !== undefined ? String(m.lat) : '', lng: m.lng !== undefined ? String(m.lng) : '' });
  const [ids, setIds] = useState<string[]>(m.inviteeIds);
  return (
    <FormDialog title={tx("Edit meeting details")} submitLabel={tx("Save")} onClose={onClose}
      fields={[
        { name: 'title', label: tx("Title"), required: true, initial: m.title },
        { name: 'start', label: tx("Starts"), type: 'datetime-local', required: true, initial: toLocalInput(startMs) },
        { name: 'end', label: tx("Ends"), type: 'datetime-local', required: true, initial: toLocalInput(endMs > startMs ? endMs : startMs + (m.targetMinutes || 60) * 60000) },
        ...(m.type === 'online' ? [{ name: 'link', label: tx("Meeting link"), initial: m.link ?? '' }] : []),
        { name: 'coordinator', label: tx("Change coordinator"), type: 'member' as const, hint: tx("Leave empty to keep the current coordinator.") },
      ]}
      onSubmit={(v) => {
        const s = new Date(v.start).getTime(); const e = new Date(v.end).getTime();
        if (!(e > s)) return Promise.reject(new Error(tx("The end must be after the start")));
        return updateMeetingAgenda({
          meetingId: m.id, title: v.title, startMs: s, endMs: e, ...(m.type === 'online' ? { link: v.link } : { location: place.address, lat: place.lat, lng: place.lng }),
          ...(v.coordinator ? { coordinatorId: v.coordinator } : {}), inviteeIds: ids,
        }).then(() => notify('Meeting updated', 'success'));
      }}>
      {m.type === 'in_person' && <LocationPicker value={place} onChange={setPlace} />}
      <Participants value={ids} onChange={setIds} />
    </FormDialog>
  );
}

const toIsoDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function NewMeeting({ onClose, existing }: { onClose: () => void; existing: Row[] }) {
  const [points, setPoints] = useState<PointDraft[]>([blankPoint()]);
  const [ids, setIds] = useState<string[]>([]);
  const [place, setPlace] = useState<Place>({ address: '', lat: '', lng: '' });
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'online' | 'in_person'>('online');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [link, setLink] = useState('');
  const [coordinator, setCoordinator] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // The time zone the times are typed in: an admin in another country can plan a meeting for his own clock.
  const myTz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }, []);
  const [tz, setTz] = useState(myTz);
  const tzOptions = useMemo(() => (TIME_ZONES.some((z) => z.value === myTz) ? TIME_ZONES : [{ value: myTz, label: `${myTz.replace(/_/g, ' ')} (your computer)` }, ...TIME_ZONES]), [myTz]);
  const atZone = (v: string) => (v ? zonedToUtcMs(v.slice(0, 10), v.slice(11, 16), tz) : NaN);
  const startMs = atZone(start);
  const endMs = atZone(end);
  const mine = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: myTz }) : '');
  const isoDayIn = (ms: number, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const minutes = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 60000) : null;
  // The other meetings of the chosen day, to see at a glance what overlaps.
  const dayKey = start ? start.slice(0, 10) : '';
  const sameDay = existing
    .filter((x) => (x.status === 'scheduled' || x.status === 'in_progress') && dayKey && isoDayIn(tsMs(x.startAt), tz) === dayKey)
    .sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt))
    .map((x) => { const a = tsMs(x.startAt); const b = tsMs(x.endAt) || a + 3600000; return { x, a, b, hit: minutes !== null && a < endMs && b > startMs }; });
  const coordBusy = coordinator[0] ? sameDay.filter((r) => r.hit && r.x.coordinatorId === coordinator[0]) : [];
  const clash = sameDay.filter((r) => r.hit);
  const planned = points.filter((p) => p.title.trim()).reduce((a, p) => a + (Number(p.minutes) || 0), 0);
  const filled = points.filter((p) => p.title.trim()).length;
  const over = minutes !== null && planned > minutes;

  async function create() {
    setErr('');
    if (!title.trim()) return setErr(tx("Give the meeting a title."));
    if (!(endMs > startMs)) return setErr(tx("Choose the start and the end. The end must be after the start."));
    if (type === 'in_person' && !place.address) return setErr(tx("Choose the place of the meeting."));
    if (!coordinator[0]) return setErr(tx("Choose a coordinator."));
    if (over) return setErr(txf("The agenda takes {a} minutes but the meeting lasts {b}.", { a: planned, b: minutes }));
    setBusy(true);
    try {
      await createMeeting({ title: title.trim(), type, startMs, endMs, link: link || undefined, location: place.address, lat: place.lat, lng: place.lng, coordinatorId: coordinator[0], inviteeIds: ids, timeZone: tz, agenda: points.filter((p) => p.title.trim()).map(fromDraft) });
      notify('Meeting created and invitations sent', 'success');
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : tx("Could not create the meeting")); } finally { setBusy(false); }
  }

  const [step, setStep] = useState(1);
  const [passed, setPassed] = useState<number[]>([]);
  const check = (n: number): string => {
    if (n === 1) { if (!title.trim()) return 'Give the meeting a title.'; if (!coordinator[0]) return 'Choose a coordinator.'; }
    if (n === 2 && !(endMs > startMs)) return 'Choose the start and the end. The end must be after the start.';
    if (n === 3 && type === 'in_person' && !place.address) return 'Choose the place of the meeting.';
    if (n === 5 && over) return txf("The agenda takes {a} minutes but the meeting lasts {b}.", { a: planned, b: minutes });
    return '';
  };
  const next = () => { const e = check(step); if (e) { setErr(e); return; } setErr(''); setPassed((p) => (p.includes(step) ? p : [...p, step])); setStep(step + 1); };
  const back = () => { setErr(''); setStep(Math.max(1, step - 1)); };
  const go = (n: number) => { if (n < step) { setErr(''); setStep(n); } };
  const MSTEPS = [
    { n: 1, label: tx("What"), sub: tx("Meeting details") },
    { n: 2, label: tx("When"), sub: tx("Date and time") },
    { n: 3, label: tx("Where"), sub: tx("Online / Location") },
    { n: 4, label: tx("Who"), sub: tx("Invited participants") },
    { n: 5, label: tx("Agenda"), sub: tx("Agenda points") },
  ];
  const PANELS: { t: string; s: string; i: WizIcon }[] = [
    { t: 'What is the meeting?', s: 'Name it, choose the format and the coordinator who runs it.', i: 'doc' },
    { t: 'When is it?', s: 'Choose the start and the end. The agenda must fit inside.', i: 'clock' },
    { t: type === 'online' ? 'Where is it? Online' : 'Where is it?', s: type === 'online' ? 'Share the link everyone will use.' : 'Choose the place on the map.', i: 'pin' },
    { t: 'Who is invited?', s: 'Pick people by role and by country, zone, city or kurel.', i: 'users' },
    { t: 'Agenda and time', s: 'Add the points to discuss. Each gets its own minutes.', i: 'list' },
  ];
  const setLen = (m: number) => { if (!start) return; const d = new Date(start); d.setMinutes(d.getMinutes() + m); const pad = (n: number) => String(n).padStart(2, '0'); setEnd(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`); };
  const pd2 = (n: number) => String(n).padStart(2, '0');
  const setDay = (iso: string) => { const t = start ? start.slice(11, 16) : '09:00'; const ns = `${iso}T${t}`; const keep = minutes ?? 60; setStart(ns); const d = new Date(ns); d.setMinutes(d.getMinutes() + keep); setEnd(`${d.getFullYear()}-${pd2(d.getMonth() + 1)}-${pd2(d.getDate())}T${pd2(d.getHours())}:${pd2(d.getMinutes())}`); };
  const setTime = (t: string) => { const day = start ? start.slice(0, 10) : (() => { const x = new Date(); return `${x.getFullYear()}-${pd2(x.getMonth() + 1)}-${pd2(x.getDate())}`; })(); const ns = `${day}T${t}`; const keep = minutes ?? 60; setStart(ns); const d = new Date(ns); d.setMinutes(d.getMinutes() + keep); setEnd(`${d.getFullYear()}-${pd2(d.getMonth() + 1)}-${pd2(d.getDate())}T${pd2(d.getHours())}:${pd2(d.getMinutes())}`); };
  const hm = (m: number | null) => (m === null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

  return (
    <WizardShell
      overlay
      title={tx("Manage Meetings")}
      setup={tx("Meeting Setup")}
      subtitle={tx("Create, run and follow up your meetings")}
      steps={MSTEPS.map((x) => ({ ...x, done: passed.includes(x.n) }))}
      current={step}
      onStep={go}
      panelTitle={tx(PANELS[step - 1].t)}
      panelSub={tx(PANELS[step - 1].s)}
      panelIcon={PANELS[step - 1].i}
      onClose={onClose}
      recap={[
        { label: tx("Meeting"), value: title.trim() || '—' },
        { label: tx("When"), value: start ? `${start.slice(0, 10)} · ${start.slice(11, 16)}` : '—' },
        { label: tx("Length"), value: hm(minutes) },
        { label: tx("Invited"), value: String(ids.length) },
        { label: tx("Agenda"), value: `${planned}${minutes !== null ? ` / ${minutes}` : ''} min` },
      ]}
      footer={
        <>
          <button type="button" className="wzs-btn" onClick={onClose} disabled={busy}>{tx("Cancel")}</button>
          {err ? <p className="wzs-err" role="alert">{err}</p> : <span className="sp" />}
          <button type="button" className="wzs-btn" onClick={back} disabled={step === 1 || busy}>{tx("‹ Back")}</button>
          {step < 5 ? <button type="button" className="wzs-btn go" onClick={next}>{tx("Next:")} {MSTEPS[step].label} ›</button> : <button type="button" className="wzs-btn go" disabled={busy} onClick={() => { const e = check(5); if (e) { setErr(e); return; } void create(); }}>{busy ? tx("Creating…") : tx("Create and invite ✓")}</button>}
        </>
      }
    >
      {step === 1 && (
        <div className="mw-two">
          <div className="mw-col">
            <label className="mc-f"><em>{tx("Title")}</em><input className="mc-title" autoFocus maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tx("e.g. Monthly zone managers meeting")} /><small className="mw-count">{title.length}/100</small></label>
            <div className="mw-cards" role="radiogroup" aria-label={tx("Format")}>
              <button type="button" role="radio" aria-checked={type === 'online'} className={type === 'online' ? 'on' : ''} onClick={() => setType('online')}><span className="mw-dot" /><b>{tx("Online meeting")}</b><small>{tx("Everyone joins with a link.")}</small></button>
              <button type="button" role="radio" aria-checked={type === 'in_person'} className={type === 'in_person' ? 'on' : ''} onClick={() => setType('in_person')}><span className="mw-dot" /><b>{tx("In person")}</b><small>{tx("Everyone meets at a place.")}</small></button>
            </div>
            <div className="mw-tiles"><div><b>{ids.length}</b><span>{tx("invited")}</span></div><div><b>{filled}</b><span>{tx("agenda points")}</span></div><div><b>{hm(minutes)}</b><span>{tx("length")}</span></div></div>
            <ul className="mw-check">
              <li className={title.trim() ? 'ok' : ''}><i>{title.trim() ? '✓' : '1'}</i><b>{tx("Title")}</b><span>{title.trim() ? tx("Done") : tx("Give the meeting a name")}</span></li>
              <li className={type ? 'ok' : ''}><i>✓</i><b>{tx("Format")}</b><span>{type === 'online' ? tx("Online, joined with a link") : tx("In person, at a place")}</span></li>
              <li className={coordinator[0] ? 'ok' : ''}><i>{coordinator[0] ? '✓' : '3'}</i><b>{tx("Coordinator")}</b><span>{coordinator[0] ? tx("Chosen") : tx("Search and pick who runs it")}</span></li>
              <li><i>›</i><b>{tx("Next")}</b><span>{tx("When, where, who, agenda")}</span></li>
            </ul>
          </div>
          <div className="mw-col">
            <div className="mw-coban"><WizSvg name="shield" size={34} /><div><b>{tx("The coordinator runs the meeting")}</b><small>{tx("Starts the points, runs the timers, records the decisions and marks who is present.")}</small></div></div>
            <div className="mc-f"><em>{tx("Coordinator *")} <small>{tx("runs the meeting and its timers")}</small></em><MemberPicker value={coordinator} onChange={setCoordinator} /></div>
            <ul className="mw-can"><li><WizSvg name="clock" /><b>{tx("Timers")}</b><small>{tx("Start, extend, close each point")}</small></li><li><WizSvg name="check" /><b>{tx("Decisions")}</b><small>{tx("Records them with action items")}</small></li><li><WizSvg name="users" /><b>{tx("Attendance")}</b><small>{tx("Marks present or absent, many at once")}</small></li><li><WizSvg name="list" /><b>{tx("Agenda")}</b><small>{tx("Follows the points in order")}</small></li></ul>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="mw-two">
          <div className="mw-col">
            <div className="mw-tz">
              <WizSvg name="pin" size={22} />
              <div className="mw-tz-dd"><Dropdown label={tx("Time zone")} value={tz} onChange={(v) => setTz(v || myTz)} options={tzOptions} allLabel={`Your computer (${myTz.replace(/_/g, ' ')})`} /></div>
              <p>{tz === myTz ? <>{tx("Times below are on")} <b>{tx("your clock")}</b>.</> : <>{tx("Times below are on the clock of")} <b>{tz.replace(/_/g, ' ')}</b>.{Number.isFinite(startMs) && <> {tx("For you that is")} <b>{mine(startMs)}</b>{Number.isFinite(endMs) && endMs > startMs ? <> {tx("to")} <b>{mine(endMs).slice(-5)}</b></> : null}.</>}</>}</p>
            </div>
            <div className="mc-two">
              <div className="mc-f"><em>{tx("Starts")}</em><DateTimePicker value={start} onChange={(v) => { setStart(v); if (!end && v) setEnd(v.slice(0, 11) + String(Math.min(23, Number(v.slice(11, 13)) + 1)).padStart(2, '0') + v.slice(13)); }} placeholder={tx("Choose the start")} /></div>
              <div className="mc-f"><em>{tx("Ends (required)")}</em><DateTimePicker value={end} onChange={setEnd} placeholder={tx("Choose the end")} /></div>
            </div>
            <div className="mw-quick"><span>{tx("Day")}</span>{[0, 1, 2, 7].map((d) => { const x = new Date(); x.setDate(x.getDate() + d); const pad = (n: number) => String(n).padStart(2, '0'); const iso = `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; return <button type="button" key={d} className={start.slice(0, 10) === iso ? 'on' : ''} onClick={() => setDay(iso)}>{d === 0 ? tx("Today") : d === 1 ? tx("Tomorrow") : d === 2 ? tx("In 2 days") : tx("Next week")}</button>; })}</div>
            <div className="mw-quick"><span>{tx("Start")}</span>{['07:00', '08:00', '09:00', '10:00', '12:00', '14:00', '16:00', '18:00', '19:30', '20:30'].map((t) => <button type="button" key={t} className={start.slice(11, 16) === t ? 'on' : ''} onClick={() => setTime(t)}>{t}</button>)}</div>
            <div className="mw-quick"><span>{tx("Quick length")}</span>{[30, 45, 60, 90, 120, 180].map((m) => <button type="button" key={m} className={minutes === m ? 'on' : ''} disabled={!start} onClick={() => setLen(m)}>{hm(m)}</button>)}</div>
            <div className="mw-bn">
              <div><WizSvg name="clock" /><span><small>{tx("Starts")}</small><b>{start ? start.slice(11, 16) : '—'}</b><em>{start ? new Date(start).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) : tx("Choose the start")}</em></span></div>
              <div><WizSvg name="check" /><span><small>{tx("Ends")}</small><b>{end ? end.slice(11, 16) : '—'}</b><em>{end ? new Date(end).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) : tx("Choose the end")}</em></span></div>
              <div className="gold"><WizSvg name="list" /><span><small>{tx("Duration")}</small><b>{hm(minutes)}</b><em>{minutes ? tx("Agenda must fit inside") : tx("End after the start")}</em></span></div>
            </div>
            <div className="mw-agenda-day">
              <div className="mw-ad-h"><b>{tx("Meetings that day")}</b><span>{start ? `${sameDay.length} ${sameDay.length === 1 ? 'meeting' : 'meetings'}` : tx("Choose the day")}</span></div>
              {!start ? <p className="mw-ad-none">{tx("Pick a start to see what is already planned that day.")}</p>
                : sameDay.length === 0 ? <div className="mw-ad-free"><WizSvg name="check" size={26} /><div><b>{tx("The day is free")}</b><small>{tx("No other meeting is planned on this day. Nothing can overlap.")}</small></div></div>
                : <ul className="mw-ad-list">{sameDay.map(({ x, a: sa, b: sb, hit }) => (
                  <li key={x.id} className={hit ? 'hit' : ''}>
                    <time>{fmtTime(sa)}<small>{fmtTime(sb)}</small></time>
                    <span><b>{x.title}</b><small>{x.coordinatorName ? txf("Coordinator {n}", { n: x.coordinatorName }) : x.type === 'online' ? tx("Online") : tx("In person")}</small></span>
                    <em>{hit ? tx("Overlaps") : tx("Same day")}</em>
                  </li>))}</ul>}
            </div>
          </div>
          <div className="mw-col">
            <div className="mw-sum"><small>{tx("Live summary")}</small><b>{start ? `${start.slice(0, 10)}` : tx("Choose the date")}</b><span>{start ? `${start.slice(11, 16)}${end ? ` – ${end.slice(11, 16)}` : ''}` : ''}</span><i className={minutes ? 'ok' : ''}>{minutes ? txf("The meeting lasts {t}.", { t: hm(minutes) }) : tx("The end must be after the start.")}</i></div>
            <div className="mw-day"><small>{tx("Over the day")}</small><div className="mw-bar24">
              {sameDay.map(({ x, a: sa, b: sb, hit }) => { const s0 = new Date(sa).getHours() * 60 + new Date(sa).getMinutes(); const l = Math.max(2, Math.round((sb - sa) / 60000)); return <span key={x.id} className={`o${hit ? ' hit' : ''}`} title={x.title} style={{ left: `${(s0 / 1440) * 100}%`, width: `${Math.min(100 - (s0 / 1440) * 100, (l / 1440) * 100)}%` }} />; })}
              {start && minutes ? (() => { const s0 = Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16)); const l = Math.min(minutes, 1440 - s0); return <span className="me" style={{ left: `${(s0 / 1440) * 100}%`, width: `${Math.max(2, (l / 1440) * 100)}%` }} />; })() : null}
            </div><div className="mw-hours"><em>0h</em><em>6h</em><em>12h</em><em>18h</em><em>24h</em></div><div className="mw-key"><i className="me" /> {tx("This meeting")} <i className="o" /> {tx("Others")} <i className="hit" /> {tx("Overlap")}</div></div>
            <div className={`mw-avail ${clash.length ? 'bad' : 'ok'}`}>
              <WizSvg name={clash.length ? 'shield' : 'check'} size={30} />
              <div><b>{!start || !minutes ? tx("Availability") : clash.length ? `${clash.length} meeting${clash.length === 1 ? '' : 's'} overlap${clash.length === 1 ? 's' : ''} this time` : tx("No overlap with another meeting")}</b>
                <small>{coordBusy.length ? `The coordinator already runs "${coordBusy[0].x.title}" at this time.` : coordinator[0] ? tx("The coordinator you chose is free at this time.") : tx("Choose the coordinator in step 1 to check his availability.")}</small></div>
            </div>
            <div className="mw-fit"><div><b>{tx("Agenda fit")}</b><span>{planned} {tx("of")} {minutes ?? '—'} {tx("min planned")}</span></div><div className="mw-fitbar"><i className={over ? 'bad' : ''} style={{ width: `${minutes ? Math.min(100, (planned / minutes) * 100) : 0}%` }} /></div><small>{over ? tx("The agenda is longer than the meeting.") : planned ? tx("The agenda fits inside the meeting.") : tx("Agenda points are added in the last step.")}</small></div>
          </div>
        </div>
      )}
      {step === 3 && (type === 'online' ? (
        <div className="mw-two">
          <div className="mw-col">
            <label className="mc-f"><em>{tx("Meeting link")}</em><span className="mw-linkrow"><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/…" /><button type="button" className="wzs-btn" disabled={!/^https?:\/\//.test(link)} onClick={() => window.open(link, '_blank', 'noopener')}>{tx("Test link")}</button></span></label>
            <div className="mw-quick"><span>{tx("Platform")}</span>{[['Google Meet', 'https://meet.google.com/'], ['Zoom', 'https://zoom.us/j/'], ['Teams', 'https://teams.microsoft.com/l/meetup-join/'], ['WhatsApp', 'https://chat.whatsapp.com/']].map(([n, u]) => <button type="button" key={n} className={link.startsWith(u) ? 'on' : ''} onClick={() => setLink(u)}>{n}</button>)}</div>
            <div className="mw-bn">
              <div><WizSvg name="doc" /><span><small>{tx("1 · Paste")}</small><b>{tx("The link")}</b><em>{tx("From your meeting tool")}</em></span></div>
              <div className="gold"><WizSvg name="users" /><span><small>{tx("2 · Notify")}</small><b>{tx("Invitees")}</b><em>{tx("Receive it automatically")}</em></span></div>
              <div><WizSvg name="check" /><span><small>{tx("3 · Join")}</small><b>{tx("One tap")}</b><em>{tx("From the meeting page")}</em></span></div>
            </div>
            <div className="mw-notif">
              <div className="mw-notif-h"><WizSvg name="users" size={18} /> {tx("What the invitees receive")}</div>
              <div className="mw-notif-b">
                <span className="mw-notif-ic"><WizSvg name="clock" size={22} /></span>
                <div>
                  <b>{tx("Invitation ·")} {title.trim() || tx("Your meeting")}</b>
                  <small>{start ? `${new Date(start).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })} · ${start.slice(11, 16)}${end ? ` – ${end.slice(11, 16)}` : ''}` : tx("Date to be chosen")}</small>
                  <small>{link ? txf("Join: {n}", { n: link }) : tx("The link will be added here when you set it.")}</small>
                </div>
              </div>
              <p>{tx("Sent in their notification and shown on the meeting page. You can also add or change the link later.")}</p>
            </div>
          </div>
          <div className="mw-col">
            <div className="mw-sum"><small>{tx("Format")}</small><b>{tx("Online meeting")}</b><span>{link ? link : tx("No link yet. You can add it later.")}</span></div>
            <div className={`mw-avail ${/^https?:\/\//.test(link) ? 'ok' : 'bad'}`}>
              <WizSvg name={/^https?:\/\//.test(link) ? 'check' : 'shield'} size={30} />
              <div><b>{/^https?:\/\//.test(link) ? tx("The link is valid") : tx("No valid link yet")}</b>
                <small>{/^https?:\/\//.test(link) ? (/meet\.google|zoom\.us|teams\.microsoft/.test(link) ? tx("A known meeting platform. Use Test link to check it opens.") : tx("Use Test link to check it opens before inviting people.")) : tx("Start with https://. You can also add it later.")}</small></div>
            </div>
            <ul className="mw-check mw-compact"><li className="ok"><i>✓</i><b>{tx("When")}</b><span>{start ? `${start.slice(0, 10)} · ${start.slice(11, 16)}` : '—'}</span></li><li className={ids.length ? 'ok' : ''}><i>{ids.length ? '✓' : '3'}</i><b>{tx("Invited")}</b><span>{ids.length ? `${ids.length} people` : tx("Next step")}</span></li><li><i>›</i><b>{tx("Agenda")}</b><span>{filled} {tx("point")}{filled === 1 ? '' : 's'}</span></li></ul>
          </div>
        </div>
      ) : <LocationPicker value={place} onChange={setPlace} />)}
      {step === 4 && <Participants value={ids} onChange={setIds} />}
      {step === 5 && (
        <>
          <div className="mc-sum mw-bar"><span><b>{ids.length}</b> {tx("invited")}</span><span><b>{filled}</b> {tx("point")}{filled === 1 ? '' : 's'}</span><span className={over ? 'bad' : ''}><b>{planned}</b>{minutes !== null ? ` / ${minutes}` : ''} {tx("min")}</span></div>
          <AgendaBuilder points={points} setPoints={setPoints} totalMinutes={minutes} />
        </>
      )}
    </WizardShell>
  );
}

/** What was said last time: the decisions and notes, the feedback and who attended, so the follow-up starts from there. */
function Previous({ parent, title, onOpen }: { parent?: Row; title?: string; onOpen: (id: string) => void }) {
  const fb = Object.entries(parent?.feedback ?? {});
  const att = Object.values(parent?.attendance ?? {});
  const discussed = (parent?.agenda ?? []).filter((p) => p.decision || p.notes);
  return (
    <details className="mt-card mt-prev" open>
      <summary><b>{tx("From the previous meeting")}</b><span>{parent?.title ?? title}{parent ? ` · ${fmtDate(tsMs(parent.startAt))}` : ''}</span></summary>
      {!parent ? <p className="mt-empty">{tx("The previous meeting is not in the list loaded here.")}</p> : (
        <>
          <div className="mt-prev-grid">
            <div>
              <h4>{tx("Discussion and decisions")}</h4>
              {discussed.length === 0 ? <p className="mt-empty">{tx("No decision or note was recorded.")}</p> : <ul>{discussed.map((p) => <li key={p.id}><b>{p.title}</b>{p.decision && <span><em>{tx("Decision")}</em> {p.decision}</span>}{p.notes && <span><em>{tx("Notes")}</em> {p.notes}</span>}</li>)}</ul>}
            </div>
            <div>
              <h4>{tx("Feedback")}{fb.length ? ` · ★ ${ratingOf(parent)} from ${fb.length}` : ''}</h4>
              {fb.length === 0 ? <p className="mt-empty">{tx("No feedback was given.")}</p> : <ul>{fb.map(([id, f]) => <li key={id}><b>{f.name} · {'★'.repeat(f.rating)}</b>{f.comment && <span className="mt-pre">{f.comment}</span>}</li>)}</ul>}
              {att.length > 0 && <p className="mt-hint">{tx("Attendance:")} {att.filter((a) => a.status === 'present').length} {tx("present,")} {att.filter((a) => a.status === 'absent').length} {tx("absent.")}</p>}
            </div>
          </div>
          <button type="button" className="mt-link" onClick={() => onOpen(parent.id)}>{tx("Open the previous meeting")}</button>
        </>
      )}
    </details>
  );
}

function Feedback({ m, uid, profiles }: { m: Row; uid: string; profiles: Record<string, { name: string; photoUrl: string }> }) {
  const mine = m.feedback?.[uid];
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [big, setBig] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = Object.entries(m.feedback ?? {});
  const avg = ratingOf(m);
  async function send() {
    if (!rating) { notify('Choose a rating from 1 to 5', 'error'); return; }
    setBusy(true);
    try { await submitMeetingFeedback({ meetingId: m.id, rating, comment }); notify('Feedback saved', 'success'); setBig(false); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(false); }
  }
  const stars = <div className="mt-stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={`${n} stars`}>★</button>)}</div>;
  return (
    <div className="mt-card">
      <h3 className="mt-sub">{tx("Feedback and discussion")}{avg ? ` · ★ ${avg} from ${list.length}` : ''}</h3>
      <div className="mt-fb">
        {stars}
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tx("How was the meeting? Write your feedback or the points you want to discuss.")} maxLength={4000} />
        <div className="mt-fb-btns">
          <button type="button" className="fx2-btn ghost" onClick={() => setBig(true)}>{tx("Expand")}</button>
          <button type="button" className="fx2-btn" disabled={busy} onClick={send}>{mine ? tx("Update") : tx("Send")}</button>
        </div>
      </div>
      {list.length > 0 && (
        <ul className="mt-fblist">
          {list.map(([id, f]) => <li key={id}><Avatar name={f.name} photoUrl={profiles[id]?.photoUrl} size={28} /><div><b><PersonLink userId={id}>{f.name}</PersonLink> · {'★'.repeat(f.rating)}</b>{f.comment && <span className="mt-pre">{f.comment}</span>}</div></li>)}
        </ul>
      )}
      {big && (
        <Sheet title={tx("Your feedback")} onClose={() => setBig(false)} footer={<><span className="mt-hint">{comment.length}/4000</span><button type="button" className="fx2-btn ghost" onClick={() => setBig(false)}>{tx("Close")}</button><button type="button" className="fx2-btn" disabled={busy} onClick={send}>{mine ? tx("Update") : tx("Send")}</button></>}>
          {stars}
          <textarea className="mt-bigtext" rows={16} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} placeholder={tx("Write your feedback and the points you want to discuss…")} autoFocus />
        </Sheet>
      )}
    </div>
  );
}


/** Who is responsible for an action item: one or many members of the organisation, by role, place or one by one. */
function OwnerPick({ ids, onPick }: { ids: string[]; onPick: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [tmp, setTmp] = useState<string[]>(ids);
  const profiles = useUserProfiles(ids);
  const first = ids[0];
  return (
    <>
      <button type="button" className={`mx-own${ids.length ? ' on' : ''}`} onClick={() => { setTmp(ids); setOpen(true); }}>
        {ids.length ? (
          <>
            <span className="mx-own-st">{ids.slice(0, 3).map((id) => <Avatar key={id} name={profiles[id]?.name ?? ''} photoUrl={profiles[id]?.photoUrl} size={26} />)}</span>
            <b>{ids.length === 1 ? (profiles[first]?.name || tx("Member")) : `${ids.length} people responsible`}</b>
          </>
        ) : <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg><span>{tx("Choose who is responsible")}</span></>}
        <i aria-hidden>▾</i>
      </button>
      {open && (
        <Sheet
          title={tx("Who is responsible?")}
          xl
          onClose={() => setOpen(false)}
          footer={<>
            {ids.length > 0 && <button type="button" className="fx2-btn ghost" onClick={() => { onPick([]); setOpen(false); }}>{tx("Remove everyone")}</button>}
            <button type="button" className="fx2-btn ghost" onClick={() => setOpen(false)}>{tx("Cancel")}</button>
            <button type="button" className="fx2-btn" disabled={tmp.length === 0} onClick={() => { onPick(tmp); setOpen(false); }}>{tmp.length === 0 ? tx("Choose") : `Choose ${tmp.length} ${tmp.length === 1 ? 'person' : 'people'}`}</button>
          </>}
        >
          <p className="mx-own-hint">{tx("Any member of the organisation can be responsible, not only the people who attended. Filter by role (supervisors, admins…) and by place, then add everyone who matches, or add people one by one. Each person gets their own action item and task.")}</p>
          <Participants value={tmp} onChange={setTmp} />
        </Sheet>
      )}
    </>
  );
}

/** What to show when a tab has no meeting: a clear message, a way forward, and a jump to the tabs that do have meetings. */
function EmptyTab({ tab, tabs, canCreate, onNew, onTab }: { tab: Tab; tabs: { key: Tab; name: string; n: number }[]; canCreate: boolean; onNew: () => void; onTab: (t: Tab) => void }) {
  const copy: Record<string, [string, string]> = {
    upcoming: ['No upcoming meeting', 'Meetings that are scheduled but have not started will appear here.'],
    ongoing: ['No meeting is running now', 'When a meeting is started, you run it from here, point by point.'],
    completed: ['No completed meeting yet', 'Finished meetings, with their decisions and actions, are kept here.'],
    followups: ['No follow-up meeting', 'Points postponed during a meeting are grouped into follow-up meetings here.'],
    history: ['No meeting yet', 'Every meeting ever planned will be listed here.'],
  };
  const [t, d] = copy[tab] ?? copy.history;
  const others = tabs.filter((x) => x.key !== tab && x.n > 0 && x.key !== 'pending');
  return (
    <div className="mx-empty">
      <span className="mx-empty-ic" aria-hidden><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18M8 15h3" /></svg></span>
      <b>{tx(t)}</b>
      <p>{tx(d)}</p>
      <div className="mx-empty-a">
        {canCreate && <button type="button" className="fx2-btn" onClick={onNew}>{tx("+ Schedule a meeting")}</button>}
        {others.map((x) => <button key={x.key} type="button" className="mx-empty-t" onClick={() => onTab(x.key)}>{x.name}<em>{x.n}</em></button>)}
      </div>
    </div>
  );
}


/** The complete invited list: search, filter by attendance, open every profile. */
function InviteesDialog({ ids, coordinatorId, profiles, attendance, showStatus, onClose }: {
  ids: string[]; coordinatorId?: string; profiles: Record<string, { name?: string; photoUrl?: string } | undefined>;
  attendance: Record<string, { status?: string } | undefined>; showStatus: boolean; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'present' | 'absent' | 'none'>('all');
  const [n, setN] = useState(40);
  const st = (id: string) => attendance[id]?.status;
  const cnt = { all: ids.length, present: ids.filter((i) => st(i) === 'present').length, absent: ids.filter((i) => st(i) === 'absent').length, none: ids.filter((i) => !st(i)).length };
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ids
      .filter((i) => (f === 'all' || (f === 'none' ? !st(i) : st(i) === f)) && (!t || (profiles[i]?.name ?? '').toLowerCase().includes(t)))
      .sort((a, b) => Number(b === coordinatorId) - Number(a === coordinatorId) || (profiles[a]?.name ?? '').localeCompare(profiles[b]?.name ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, q, f, profiles, attendance, coordinatorId]);
  const tabs: [typeof f, string][] = showStatus ? [['all', 'All'], ['present', 'Present'], ['absent', 'Absent'], ['none', 'Not marked']] : [['all', 'All']];
  return (
    <Sheet title={txf("Invited people · {n}", { n: ids.length })} onClose={onClose}>
      <div className="inv-d">
        <label className="inv-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={q} onChange={(e) => { setQ(e.target.value); setN(40); }} placeholder={tx("Search by name")} aria-label={tx("Search the invited people")} /></label>
        {tabs.length > 1 && <div className="inv-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={f === k} className={`${k}${f === k ? ' on' : ''}`} onClick={() => { setF(k); setN(40); }}>{tx(l)}<em>{cnt[k]}</em></button>)}</div>}
        <ul className="inv-list">
          {list.length === 0 && <li className="none">{tx("Nobody matches.")}</li>}
          {list.slice(0, n).map((id) => (
            <li key={id}>
              <Avatar name={profiles[id]?.name ?? ''} photoUrl={profiles[id]?.photoUrl} size={42} />
              <span className="inv-who"><PersonLink userId={id}><b>{profiles[id]?.name || tx("Member")}</b></PersonLink><small>{id === coordinatorId && <em className="mt-co">{tx("Coordinator")}</em>}{showStatus && <span className={`mt-chip att ${st(id) === 'present' ? 'pres' : st(id) === 'absent' ? 'abs' : 'idle'}`}>{st(id) === 'present' ? tx("Present") : st(id) === 'absent' ? tx("Absent") : tx("Not marked")}</span>}</small></span>
              <ViewProfile userId={id} />
            </li>
          ))}
        </ul>
        {list.length > n && <button type="button" className="pf-more" onClick={() => setN(n + 40)}>{tx("Show 40 more ·")} {list.length - n} {tx("left")}</button>}
      </div>
    </Sheet>
  );
}


type Preset = 'all' | 'today' | 'week' | 'month' | '3m' | 'year' | 'custom';
const PRESETS: [Preset, string][] = [['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['custom', 'Choose dates']];

/** The period a preset stands for, in milliseconds (start of the first day to the end of the last). null = no period. */
function presetRange(p: Preset, from: string, to: string): { from: number; to: number } | null {
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const eod = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const now = new Date();
  if (p === 'today') return { from: sod(now).getTime(), to: eod(now).getTime() };
  if (p === 'week') { const d = sod(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const e = new Date(d); e.setDate(e.getDate() + 6); return { from: d.getTime(), to: eod(e).getTime() }; }
  if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: eod(new Date(now.getFullYear(), now.getMonth() + 1, 0)).getTime() };
  if (p === '3m') { const d = sod(now); d.setMonth(d.getMonth() - 3); return { from: d.getTime(), to: eod(now).getTime() }; }
  if (p === 'year') return { from: new Date(now.getFullYear(), 0, 1).getTime(), to: eod(new Date(now.getFullYear(), 11, 31)).getTime() };
  if (p === 'custom' && (from || to)) {
    const f = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const t = to ? new Date(`${to}T23:59:59`).getTime() : Date.now() + 5 * 365 * 86400000;
    return { from: f, to: Math.max(f, t) };
  }
  return null;
}

/** Many meetings: filter by period, search, sort, grouped by month, a scrolling list, 30 at a time. */
function MeetingBrowser({ list, months, month, setMonth, total, selectedId, onPick, preset, setPreset, from, to, setFrom, setTo, q, setQ, asc, setAsc, shown, setShown, loading, capped }: {
  list: Row[]; months: { key: string; label: string; n: number }[]; month: string; setMonth: (v: string) => void; total: number; selectedId?: string; onPick: (id: string) => void;
  preset: Preset; setPreset: (p: Preset) => void; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
  q: string; setQ: (v: string) => void; asc: boolean; setAsc: (v: boolean) => void; shown: number; setShown: (n: number) => void;
  loading: boolean; capped: boolean;
}) {
  const vis = list.slice(0, shown);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const firstId = list[0]?.id;
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [firstId, asc]);
  const groups: { label: string; items: Row[] }[] = [];
  for (const m of vis) {
    const label = new Date(orderMs(m)).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(m); else groups.push({ label, items: [m] });
  }
  const filtered = preset !== 'all' || q.trim() !== '';
  const idx = list.findIndex((m) => m.id === selectedId);
  const cur = idx >= 0 ? list[idx] : undefined;
  if (!open && cur) {
    const d = new Date(tsMs(cur.startAt));
    return (
      <section className="mb mb-min" aria-label={tx("Current meeting")}>
        <span className="mb-date"><b>{d.getDate()}</b><small>{d.toLocaleDateString(dateLocale(), { month: 'short' })}</small></span>
        <span className="mb-main"><b>{cur.title}</b><small>{d.toLocaleDateString(dateLocale(), { weekday: 'short' })} {fmtTime(d.getTime())} · {idx + 1} {tx("of")} {list.length}{filtered ? tx(" (filtered)") : ''}</small></span>
        <span className={`mt-chip ${cur.status}`}>{STATUS[cur.status]}</span>
        <div className="mb-nav">
          <button type="button" aria-label={tx("Previous meeting in the list")} disabled={idx <= 0} onClick={() => onPick(list[idx - 1].id)}>‹</button>
          <button type="button" aria-label={tx("Next meeting in the list")} disabled={idx >= list.length - 1} onClick={() => onPick(list[idx + 1].id)}>›</button>
        </div>
        <button type="button" className="mb-browse" onClick={() => setOpen(true)}>{tx("Browse all")} {total} {tx("meetings ▾")}</button>
      </section>
    );
  }
  return (
    <section className="mb" aria-label={tx("Find a meeting")}>
      <div className="mb-bar">
        {cur && <button type="button" className="mb-hide" onClick={() => setOpen(false)}>{tx("Hide the list ▴")}</button>}
        <div className="mb-row2">
          <div className="mb-per"><Dropdown label={tx("Period")} value={preset === 'all' ? '' : preset} onChange={(v) => setPreset((v || 'all') as Preset)} allLabel={tx("All dates")} options={PRESETS.filter(([k]) => k !== 'all').map(([k, l]) => ({ value: k, label: tx(l) }))} /></div>
          <label className="mb-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search by title, coordinator or place")} aria-label={tx("Search meetings")} />{q && <button type="button" aria-label={tx("Clear the search")} onClick={() => setQ('')}>×</button>}</label>
          {preset === 'custom' && (
            <div className="mb-dates">
              <div><DateTimePicker mode="date" value={from} onChange={setFrom} placeholder={tx("From")} /></div>
              <span aria-hidden>→</span>
              <div><DateTimePicker mode="date" value={to} onChange={setTo} placeholder={tx("To")} min={from || undefined} /></div>
            </div>
          )}
          <button type="button" className="mb-sort" onClick={() => setAsc(!asc)} title={tx("Change the order")}>{asc ? tx("↑ Oldest first") : tx("↓ Most recent first")}</button>
          {filtered && <button type="button" className="mb-reset" onClick={() => { setPreset('all'); setQ(''); setFrom(''); setTo(''); }}>{tx("Reset")}</button>}
        </div>
        {months.length > 1 && (
          <div className="mb-months" role="tablist" aria-label={tx("Month")}>
            <button type="button" role="tab" aria-selected={!month} className={!month ? 'on' : ''} onClick={() => setMonth('')}>{tx("All months")}</button>
            {months.map((x) => <button key={x.key} type="button" role="tab" aria-selected={month === x.key} className={month === x.key ? 'on' : ''} onClick={() => setMonth(x.key)}>{x.label}<em>{x.n}</em></button>)}
          </div>
        )}
        <p className="mb-count">{loading ? tx("Searching…") : <><b>{list.length}</b> {tx("meeting")}{list.length === 1 ? '' : 's'}{list.length !== total ? ` of ${total}` : ''}{preset !== 'all' ? tx(" in this period") : ''}</>}{capped && !filtered && <span> {tx("· Showing the latest 150. Choose a period to search further back.")}</span>}</p>
      </div>
      {list.length === 0 && !loading ? (
        <div className="mb-none"><b>{tx("No meeting matches")}</b><span>{tx("Try another period or a shorter search.")}</span></div>
      ) : (
        <div className="mb-list" role="list" ref={listRef}>
          {groups.map((g) => (
            <div key={g.label} className="mb-month">
              {groups.length > 1 && <h4>{g.label}<em>{g.items.length}</em></h4>}
              {g.items.map((m) => {
                const d = new Date(tsMs(m.startAt));
                const done = m.agenda.filter((p) => p.status === 'completed').length;
                const pct = m.agenda.length ? Math.round((done / m.agenda.length) * 100) : 0;
                const rate = ratingOf(m);
                return (
                  <button type="button" role="listitem" key={m.id} className={`mb-item${selectedId === m.id ? ' on' : ''}`} onClick={() => { onPick(m.id); setOpen(false); }}>
                    <span className="mb-date"><b>{d.getDate()}</b><small>{d.toLocaleDateString(dateLocale(), { month: 'short' })}</small></span>
                    <span className="mb-main"><b>{m.title}</b><small>{d.toLocaleDateString(dateLocale(), { weekday: 'short' })} {fmtTime(d.getTime())} · {m.type === 'online' ? tx("Online") : (m.location || tx("In person"))} · {m.inviteeIds.length} {tx("invited")}{m.coordinatorName ? ` · ${m.coordinatorName}` : ''}</small></span>
                    <span className="mb-prog" title={`${done} of ${m.agenda.length} points done`}><i><u style={{ width: `${pct}%` }} /></i><small>{done}/{m.agenda.length}</small></span>
                    {rate ? <span className="mb-rate">★ {rate}</span> : <span className="mb-rate none">—</span>}
                    <span className={`mt-chip ${m.status}`}>{STATUS[m.status]}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {list.length > shown && <button type="button" className="pf-more" onClick={() => setShown(shown + 30)}>{tx("Show 30 more ·")} {list.length - shown} {tx("left")}</button>}
        </div>
      )}
    </section>
  );
}

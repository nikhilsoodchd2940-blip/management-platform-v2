'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useUserProfiles } from '@/lib/useUserNames';
import { PersonLink, MemberProfileDialog } from '@/components/MemberProfile';
import { sendAnnouncement } from '@/lib/functions';
import { money, frDate, type Currency } from '@/lib/finance';
import { Shell } from '../donations/AllocDialogs';
import { Avatar } from '@/components/MemberPicker';
import { tx } from '@/lib/i18n/tr';

export type HubTab = 'overview' | 'activities' | 'progress' | 'schedule' | 'attendance' | 'social' | 'finance';

export interface EventRow { id: string; subGroupIds?: string[]; title: string; status: string; kind?: string; startAt?: unknown; endAt?: unknown; purpose?: string; location?: { address?: string } }
export interface AttRow { eventId: string; userId: string; status: string; ms: number }
interface WelfareRow { id: string; userId: string; userName?: string; category: string; eventDate?: unknown; explanation?: string; status: string; createdAt?: unknown; beneficiary?: string }
interface ProgressRow { id: string; period: string; masteryPct: number; melodyPct: number; timingPct: number; directivesPct: number; submittedAt?: unknown }
interface AllocRow { id: string; programId: string; amountCents: number }
interface ContribRow { id: string; programId: string; amountCents: number; status: string; userId?: string; userName?: string; method?: string; createdAt?: unknown }
interface FAllocRow { programId: string; level: string; nodeId: string; amountCents: number; status: string }
interface ProgramRow { id: string; name: string; currency?: Currency; status?: string }

const DAY = 86400000;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WCAT: Record<string, string> = { marriage: 'Weddings', birth: 'Births', death: 'Deaths', illness: 'Sickness', prayer_request: 'Prayer requests', financial_assistance: 'Financial aid', other: 'Other news' };
const WCOL: Record<string, string> = { marriage: '#d6428a', birth: '#3b82f6', death: '#5d6e66', illness: '#e0841b', prayer_request: '#7c4dbd', financial_assistance: '#1f9d63', other: '#0b8a8f' };
const WCAT_ONE: Record<string, string> = { marriage: 'Wedding', birth: 'Birth', death: 'Death', illness: 'Sickness', prayer_request: 'Prayer request', financial_assistance: 'Financial aid', other: 'Other news' };
const WSTATUS: Record<string, string> = { new: 'New', in_progress: 'Being handled', escalated: 'Escalated', closed: 'Closed' };
export const PRESENT = new Set(['PRESENT', 'LATE', 'LATE_APPROVED']);

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dayIdx = (ms: number) => (new Date(ms).getDay() + 6) % 7;
const when = (ms: number) => (ms ? `${frDate(ms)} · ${hhmm(ms)}` : '—');
export const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
export const band = (p: number) => (p >= 80 ? 'good' : p >= 50 ? 'mid' : 'low');

/** Everything the kurel sections show, read live for one kurel. */
export function useKurelHub(kurelId: string, memberIds: string[]) {
  const events = useCollection<EventRow>('events', [where('subGroupIds', 'array-contains', kurelId)], kurelId);
  const welfare = useCollection<WelfareRow>('welfareRequests', [where('groupId', '==', kurelId)], kurelId);
  const progress = useCollection<ProgressRow>('progressReports', [where('groupId', '==', kurelId)], kurelId);
  const allocs = useCollection<AllocRow>('programAllocations', [where('groupId', '==', kurelId)], kurelId);
  const contribs = useCollection<ContribRow>('contributions', [where('groupId', '==', kurelId)], kurelId);
  const shares = useCollection<{ amountCents: number; programId: string; userId?: string }>('memberShares', [where('groupId', '==', kurelId)], kurelId);
  const fAllocs = useCollection<FAllocRow>('financeAllocations', [where('groupId', '==', kurelId)], kurelId);
  const programs = useCollection<ProgramRow>('financialPrograms', []);

  const evKey = (events ?? []).map((e) => e.id).sort().join(',');
  const memKey = memberIds.slice().sort().join(',');
  const [att, setAtt] = useState<AttRow[] | null>(null);
  useEffect(() => {
    if (events === null) return;
    const ids = evKey ? evKey.split(',') : [];
    if (ids.length === 0) { setAtt([]); return; }
    let off = false;
    const members = new Set(memKey ? memKey.split(',') : []);
    setAtt(null);
    (async () => {
      try {
        const parts = await Promise.all(chunk(ids, 30).map((c) => getDocs(query(collection(db, 'attendance'), where('eventId', 'in', c)))));
        if (off) return;
        const rows: AttRow[] = [];
        parts.forEach((p) => p.docs.forEach((d) => {
          const x = d.data();
          // Only this kurel's own members: an event can gather several kurels.
          if (members.size && !members.has(x.userId as string)) return;
          rows.push({ eventId: x.eventId as string, userId: x.userId as string, status: x.status as string, ms: tsMs(x.serverTimestamp) });
        }));
        setAtt(rows);
      } catch {
        if (!off) setAtt([]);
      }
    })();
    return () => { off = true; };
  }, [evKey, memKey, events]);

  return useMemo(() => {
    const ev = [...(events ?? [])].sort((a, b) => tsMs(b.startAt) - tsMs(a.startAt));
    const rehearsals = ev.filter((e) => e.kind === 'rehearsal');
    const others = ev.filter((e) => e.kind !== 'rehearsal');
    const now = Date.now();
    const paidBy: Record<string, number> = {};
    (contribs ?? []).filter((c) => c.status === 'validated').forEach((c) => (paidBy[c.programId] = (paidBy[c.programId] ?? 0) + c.amountCents));
    const goals = (allocs ?? []).map((a) => {
      const p = (programs ?? []).find((x) => x.id === a.programId);
      const paid = paidBy[a.programId] ?? 0;
      return { programId: a.programId, name: p?.name ?? 'Program', currency: (p?.currency ?? 'XOF') as Currency, open: p?.status !== 'closed', goal: a.amountCents, paid, pct: a.amountCents ? Math.min(100, Math.round((paid / a.amountCents) * 100)) : 0 };
    });
    const success = goals.length ? Math.round(goals.reduce((n, g) => n + g.pct, 0) / goals.length) : null;
    // Each member: what was asked of them, what they paid (checked payments only), and the rating that follows.
    const key = (u: string, p: string) => `${u}|${p}`;
    const asked = new Map<string, number>();
    (shares ?? []).forEach((x) => { if (x.userId) asked.set(key(x.userId, x.programId), (asked.get(key(x.userId, x.programId)) ?? 0) + x.amountCents); });
    const fa = new Map<string, number>();
    (fAllocs ?? []).filter((a) => a.level === 'member' && ['offered', 'accepted', 'change_requested', 'escalated'].includes(a.status)).forEach((a) => fa.set(key(a.nodeId, a.programId), (fa.get(key(a.nodeId, a.programId)) ?? 0) + a.amountCents));
    fa.forEach((v, k) => asked.set(k, Math.max(v, asked.get(k) ?? 0)));
    const paidU = new Map<string, number>();
    const pendU = new Map<string, number>();
    (contribs ?? []).forEach((c) => { if (!c.userId) return; const k = key(c.userId, c.programId); if (c.status === 'validated') paidU.set(k, (paidU.get(k) ?? 0) + c.amountCents); else if (c.status === 'pending_review') pendU.set(k, (pendU.get(k) ?? 0) + c.amountCents); });
    const uids = new Set<string>([...memberIds, ...(contribs ?? []).map((c) => c.userId ?? '').filter(Boolean), ...[...asked.keys()].map((k) => k.split('|')[0])]);
    const progIds = new Set<string>([...asked.keys(), ...paidU.keys(), ...pendU.keys()].map((k) => k.split('|')[1]));
    const memberFin = [...uids].map((userId) => {
      const lines = [...progIds].map((programId) => {
        const target = asked.get(key(userId, programId)) ?? 0;
        const paid = paidU.get(key(userId, programId)) ?? 0;
        const pending = pendU.get(key(userId, programId)) ?? 0;
        const p = (programs ?? []).find((x) => x.id === programId);
        return { programId, name: p?.name ?? 'Program', currency: (p?.currency ?? 'XOF') as Currency, target, paid, pending, pct: target ? Math.min(100, Math.round((paid / target) * 100)) : paid > 0 ? 100 : 0 };
      }).filter((l) => l.target || l.paid || l.pending);
      const rated = lines.filter((l) => l.target > 0);
      const rating = rated.length ? Math.round(rated.reduce((n, l) => n + l.pct, 0) / rated.length) : null;
      return { userId, lines, rating, paidAny: lines.some((l) => l.paid > 0), pendingAny: lines.some((l) => l.pending > 0) };
    });
    const open = (welfare ?? []).filter((w) => w.status !== 'closed');
    const lastProgress = [...(progress ?? [])].sort((a, b) => tsMs(b.submittedAt) - tsMs(a.submittedAt));
    return {
      loading: events === null,
      kurelId, events: ev, rehearsals, others, now,
      upcoming: (list: EventRow[]) => list.filter((e) => e.status !== 'cancelled' && tsMs(e.endAt || e.startAt) >= now),
      goals, success, memberFin, payments: (contribs ?? []).filter((c) => !!c.userId),
      welfare: [...(welfare ?? [])].sort((a, b) => tsMs(b.eventDate || b.createdAt) - tsMs(a.eventDate || a.createdAt)),
      openWelfare: open.length,
      progress: lastProgress,
      shared: (shares ?? []).reduce((n, s) => n + s.amountCents, 0),
      att,
    };
  }, [kurelId, events, welfare, progress, allocs, contribs, shares, fAllocs, programs, att, memberIds]);
}
export type KurelHubData = ReturnType<typeof useKurelHub>;

/** Regular meeting slots, worked out from the kurel's rehearsals: same weekday, same hours. */
function regularSlots(rehearsals: EventRow[]) {
  const map = new Map<string, { day: number; from: string; to: string; n: number; place: string; lastMs: number }>();
  rehearsals.filter((e) => e.status !== 'cancelled' && tsMs(e.startAt)).forEach((e) => {
    const s = tsMs(e.startAt);
    const f = tsMs(e.endAt);
    const key = `${dayIdx(s)}|${hhmm(s)}|${f ? hhmm(f) : ''}`;
    const cur = map.get(key) ?? { day: dayIdx(s), from: hhmm(s), to: f ? hhmm(f) : '', n: 0, place: e.location?.address ?? '', lastMs: 0 };
    cur.n += 1;
    cur.lastMs = Math.max(cur.lastMs, s);
    if (!cur.place && e.location?.address) cur.place = e.location.address;
    map.set(key, cur);
  });
  return [...map.values()].sort((a, b) => a.day - b.day || a.from.localeCompare(b.from));
}

export type Period = 'week' | 'month' | 'quarter' | 'year';
export function bucketsOf(period: Period, now: Date) {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'week') {
    const mon = new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7)).getTime();
    return { title: tx("This week"), list: Array.from({ length: 7 }, (_, i) => ({ label: DAYS_SHORT[i], start: mon + i * DAY, end: mon + (i + 1) * DAY })) };
  }
  if (period === 'month') {
    const first = new Date(y, m, 1).getTime();
    const end = new Date(y, m + 1, 1).getTime();
    const n = Math.ceil((end - first) / (7 * DAY));
    return { title: `${MONTHS[m]} ${y}`, list: Array.from({ length: n }, (_, i) => ({ label: `Week ${i + 1}`, start: first + i * 7 * DAY, end: Math.min(end, first + (i + 1) * 7 * DAY) })) };
  }
  if (period === 'quarter') {
    const q = Math.floor(m / 3);
    return { title: `Quarter ${q + 1}, ${y}`, list: [0, 1, 2].map((i) => ({ label: MONTHS[q * 3 + i], start: new Date(y, q * 3 + i, 1).getTime(), end: new Date(y, q * 3 + i + 1, 1).getTime() })) };
  }
  return { title: String(y), list: Array.from({ length: 12 }, (_, i) => ({ label: MONTHS[i], start: new Date(y, i, 1).getTime(), end: new Date(y, i + 1, 1).getTime() })) };
}
export const attStats = (rows: AttRow[]) => {
  const present = rows.filter((r) => PRESENT.has(r.status)).length;
  const late = rows.filter((r) => r.status === 'LATE' || r.status === 'LATE_APPROVED').length;
  const excused = rows.filter((r) => r.status === 'EXCUSED').length;
  const absent = rows.filter((r) => r.status === 'UNEXCUSED').length;
  const counted = present + excused + absent;
  return { present, late, excused, absent, counted, rate: counted ? Math.round((present / counted) * 100) : null };
};
const monthRate = (rows: AttRow[] | null) => {
  if (!rows) return null;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return attStats(rows.filter((r) => r.ms >= from)).rate;
};

/* ------------------------------------------------------------------ overview blocks */

function Block({ tone, icon, title, onOpen, children }: { tone: string; icon: ReactNode; title: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`hb-block ${tone}`} onClick={onOpen}>
      <span className="hb-head"><i className="hb-ico">{icon}</i><strong>{title}</strong><u>{tx("Open ›")}</u></span>
      {children}
    </button>
  );
}
const I = {
  act: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>,
  prog: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V9M10 19V5M16 19v-8M22 19H2" /></svg>,
  sched: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  att: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>,
  soc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z" /></svg>,
  fin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M14.500 9.200c-.6-.8-1.500-1.200-2.600-1.200-1.500 0-2.500.8-2.500 2s1 1.700 2.600 2 2.600.8 2.600 2-1 2-2.600 2c-1.200 0-2.200-.5-2.800-1.300M12 6.500V8M12 16v1.500" /></svg>,
};

export function HubOverview({ hub, open, kurelId, kurelName }: { hub: KurelHubData; open: (t: HubTab) => void; kurelId: string; kurelName: string }) {
  const [prof, setProf] = useState<string | null>(null);
  const [abs, setAbs] = useState<string | null>(null);
  const evMap = useMemo(() => new Map(hub.events.map((e) => [e.id, e] as [string, EventRow])), [hub.events]);
  const [remind, setRemind] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rErr, setRErr] = useState('');
  const [sent, setSent] = useState('');
  const closeRemind = () => { setRemind(null); setRErr(''); setSent(''); };
  const send = async () => {
    if (!remind) return;
    setBusy(true); setRErr('');
    try { const r = await sendAnnouncement({ title: remind.title.trim(), body: remind.body.trim(), target: 'group', targetGroupId: kurelId }); setSent(`Sent to ${r.data.recipientCount} member${r.data.recipientCount === 1 ? '' : 's'} of ${kurelName}.`); }
    catch (e) { setRErr((e as { message?: string }).message || 'The reminder could not be sent.'); }
    finally { setBusy(false); }
  };
  const askAttend = () => setRemind({ title: tx("Attendance reminder"), body: `Please be present at the sessions of ${kurelName}. If you cannot come, tell your kurel team before the session.` });
  const askPay = () => setRemind({ title: tx("Contribution reminder"), body: `Please settle your contribution for the current programs of ${kurelName}. If you have already paid, thank you.` });
  const upR = hub.upcoming(hub.rehearsals);
  const upE = hub.upcoming(hub.others);
  const next = [...upR, ...upE].sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt))[0];
  const slots = regularSlots(hub.rehearsals);
  const mastery = hub.progress[0];
  const avg = mastery ? Math.round((mastery.masteryPct + mastery.melodyPct + mastery.timingPct + mastery.directivesPct) / 4) : null;
  const lesson = hub.rehearsals[0];
  const rate = monthRate(hub.att);
  const social = hub.welfare;
  const coming = [...upR.map((e) => ({ e, k: 'Rehearsal' })), ...upE.map((e) => ({ e, k: 'Event' }))].sort((a, b) => tsMs(a.e.startAt) - tsMs(b.e.startAt)).slice(0, 4);
  const absent = useMemo(() => {
    const m = new Map<string, number>();
    (hub.att ?? []).filter((r) => r.status === 'UNEXCUSED').forEach((r) => m.set(r.userId, (m.get(r.userId) ?? 0) + 1));
    return [...m.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3);
  }, [hub.att]);
  const people = useUserProfiles(absent.map(([u]) => u));
  const behind = hub.memberFin.filter((m) => m.rating !== null && m.rating < 50).length;
  const lowest = [...hub.goals].sort((a, b) => a.pct - b.pct).slice(0, 4);
  return (
    <>
    <div className="hb-grid">
      <Block tone="g" icon={I.act} title={tx("Activities")} onOpen={() => open('activities')}>
        <span className="hb-tiles"><span><b>{hub.rehearsals.length}</b><small>{tx("Rehearsals")}</small></span><span><b>{hub.others.length}</b><small>{tx("Events")}</small></span></span>
        <span className="hb-line">{next ? <>{tx("Next:")} <b>{next.title}</b> · {frDate(tsMs(next.startAt))}</> : tx("Nothing planned.")}</span>
        <span className="hb-foot">{upR.length} {tx("rehearsals and")} {upE.length} {tx("events to come")}</span>
      </Block>
      <Block tone="b" icon={I.prog} title={tx("Progress report")} onOpen={() => open('progress')}>
        <span className="hb-big">{avg === null ? '—' : `${avg}%`}<small>{avg === null ? tx("no report yet") : `average · ${mastery?.period}`}</small></span>
        <span className="hb-bar"><i style={{ width: `${avg ?? 0}%` }} /></span>
        <span className="hb-line">{lesson ? <>{tx("Rehearsing:")} <b>{lesson.purpose || lesson.title}</b></> : tx("No rehearsal recorded yet.")}</span>
        <span className="hb-foot">{tx("Curriculum: not assigned yet")}</span>
      </Block>
      <Block tone="y" icon={I.sched} title={tx("Schedule")} onOpen={() => open('schedule')}>
        {slots.length === 0 ? <span className="hb-line">{tx("No regular meeting yet.")}</span> : slots.slice(0, 3).map((s) => <span className="hb-slot" key={`${s.day}${s.from}`}><b>{DAYS[s.day]}</b><em>{s.from}{s.to ? ` – ${s.to}` : ''}</em></span>)}
        {slots[0]?.place && <span className="hb-line">{tx("Where:")} <b>{slots[0].place}</b></span>}
        <span className="hb-foot">{slots.length} {tx("regular meeting")}{slots.length === 1 ? '' : 's'} {tx("a week")}</span>
      </Block>
      <Block tone="p" icon={I.att} title={tx("Attendance")} onOpen={() => open('attendance')}>
        <span className="hb-big">{hub.att === null ? '…' : rate === null ? '—' : `${rate}%`}<small>{tx("this month")}</small></span>
        <span className="hb-bar"><i style={{ width: `${rate ?? 0}%` }} /></span>
        <span className="hb-foot">{hub.att ? `${attStats(hub.att).counted} records in all` : tx("Loading…")}</span>
      </Block>
      <Block tone="r" icon={I.soc} title={tx("Social")} onOpen={() => open('social')}>
        <span className="hb-tiles"><span><b>{hub.openWelfare}</b><small>{tx("Open")}</small></span><span><b>{social.length}</b><small>{tx("All time")}</small></span></span>
        <span className="hb-line">{social[0] ? <>{tx("Latest:")} <b>{WCAT_ONE[social[0].category] ?? tx("News")}</b> · {social[0].userName || tx("a member")}</> : tx("No social news.")}</span>
        <span className="hb-foot">{hub.openWelfare} {tx("open request")}{hub.openWelfare === 1 ? '' : 's'} {tx("to follow")}</span>
      </Block>
      <Block tone="t" icon={I.fin} title={tx("Financial overview")} onOpen={() => open('finance')}>
        <span className="hb-big">{hub.success === null ? '—' : `${hub.success}%`}<small>{hub.success === null ? tx("no goal yet") : tx("success rating")}</small></span>
        <span className={`hb-bar ${hub.success === null ? '' : band(hub.success)}`}><i style={{ width: `${hub.success ?? 0}%` }} /></span>
        <span className="hb-foot">{hub.goals.length} {tx("objective")}{hub.goals.length === 1 ? '' : 's'}</span>
      </Block>
    </div>
    <div className="ov2">
      <section className="ov2-c g">
        <header><h3>{tx("Coming up")}</h3><button type="button" onClick={() => open('activities')}>{tx("All activities ›")}</button></header>
        <ul>
          {coming.map(({ e, k }) => <li key={e.id}><button type="button" onClick={() => open('activities')}><span className={`ov2-k ${k === 'Rehearsal' ? 'r' : 'e'}`}>{k}</span><b>{e.title}</b><small>{frDate(tsMs(e.startAt))}</small></button></li>)}
          {coming.length === 0 && <li className="ov2-none">{tx("Nothing is planned yet.")}</li>}
        </ul>
      </section>
      <section className="ov2-c r">
        <header><h3>{tx("Needs attention")}</h3></header>
        <ul className="ov2-act">
          {absent.map(([u, n]) => (
            <li key={u} className="ov2-row">
              <span className="ov2-info"><Avatar name={people[u]?.name || '…'} photoUrl={people[u]?.photoUrl} size={30} /><span><b>{people[u]?.name || '…'}</b><small>{n} {tx("unexcused absence")}{n === 1 ? '' : 's'}</small></span></span>
              <span className="ov2-btns"><button type="button" onClick={() => setProf(u)}>{tx("Profile")}</button><button type="button" onClick={() => setAbs(u)}>{tx("Absences")}</button></span>
            </li>
          ))}
          {absent.length > 0 && <li className="ov2-row ov2-sub"><span className="ov2-info"><span className="ov2-k r">{tx("Attendance")}</span><span><b>{tx("Remind the kurel to attend")}</b></span></span><span className="ov2-btns"><button type="button" className="pri" onClick={askAttend}>{tx("Send reminder")}</button></span></li>}
          <li className={`ov2-row${behind === 0 ? ' ok' : ''}`}>
            <span className="ov2-info"><span className="ov2-k f">{tx("Finance")}</span><span><b>{behind === 0 ? tx("Everyone is on track") : `${behind} member${behind === 1 ? '' : 's'} behind on contributions`}</b></span></span>
            {behind > 0 && <span className="ov2-btns"><button type="button" onClick={() => open('finance')}>{tx("See who")}</button><button type="button" className="pri" onClick={askPay}>{tx("Remind")}</button></span>}
          </li>
          <li className={`ov2-row${hub.openWelfare === 0 ? ' ok' : ''}`}>
            <span className="ov2-info"><span className="ov2-k s">{tx("Social")}</span><span><b>{hub.openWelfare === 0 ? tx("No open request") : `${hub.openWelfare} open request${hub.openWelfare === 1 ? '' : 's'}`}</b></span></span>
            {hub.openWelfare > 0 && <span className="ov2-btns"><button type="button" className="pri" onClick={() => open('social')}>{tx("Review")}</button></span>}
          </li>
        </ul>
      </section>
      <section className="ov2-c t">
        <header><h3>{tx("Funding progress")}</h3><button type="button" onClick={() => open('finance')}>{tx("Finance ›")}</button></header>
        <ul>
          {lowest.map((g) => <li key={g.programId}><button type="button" onClick={() => open('finance')}><b>{g.name}</b><span className={`hb-bar ${band(g.pct)}`}><i style={{ width: `${g.pct}%` }} /></span><small>{g.pct}%</small></button></li>)}
          {lowest.length === 0 && <li className="ov2-none">{tx("No financial program yet.")}</li>}
        </ul>
      </section>
    </div>
    {prof && <MemberProfileDialog userId={prof} kurelId={kurelId} onClose={() => setProf(null)} />}
    {abs && <AttDetail title={`${people[abs]?.name || 'Member'} · absences`} sub={tx("All the sessions of this kurel on record")} rows={(hub.att ?? []).filter((r) => r.userId === abs)} events={evMap} start="absent" onClose={() => setAbs(null)} />}
    {remind && (
      <Shell title={tx("Send a reminder")} sub={`To every active member of ${kurelName}`} onClose={closeRemind}
        footer={sent ? <><span className="fm-err" style={{ color: '#0b5d3b' }}>{sent}</span><button type="button" className="fm-go" onClick={closeRemind}>{tx("Close")}</button></> : <>{rErr && <span className="fm-err">{rErr}</span>}<button type="button" className="fm-ghost" onClick={closeRemind}>{tx("Cancel")}</button><button type="button" className="fm-go" disabled={busy || !remind.title.trim() || !remind.body.trim()} onClick={send}>{busy ? tx("Sending…") : tx("Send reminder")}</button></>}>
        <label className="fm-f">{tx("Title")}<input value={remind.title} onChange={(e) => setRemind({ ...remind, title: e.target.value })} /></label>
        <label className="fm-f">{tx("Message")}<textarea rows={5} value={remind.body} onChange={(e) => setRemind({ ...remind, body: e.target.value })} /></label>
      </Shell>
    )}
    </>
  );
}

/* ------------------------------------------------------------------ sections */

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return <div className="hb-seg" role="tablist">{options.map(([k, l]) => <button type="button" role="tab" aria-selected={value === k} key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
const Empty = ({ text }: { text: string }) => <p className="hb-empty">{text}</p>;

function Activities({ hub }: { hub: KurelHubData }) {
  const [f, setF] = useState<'all' | 'coming' | 'past'>('all');
  const part = (list: EventRow[]) => (f === 'all' ? list : f === 'coming' ? hub.upcoming(list) : list.filter((e) => !hub.upcoming([e]).length));
  const col = (title: string, tone: string, list: EventRow[]) => {
    const shown = part(list);
    const done = list.filter((e) => e.status !== 'cancelled' && tsMs(e.endAt || e.startAt) < hub.now).length;
    return (
      <section className={`hb-col ${tone}`}>
        <header><h3>{title}</h3><span>{list.length}</span></header>
        <div className="hb-mini"><span><b>{hub.upcoming(list).length}</b>{tx("coming")}</span><span><b>{done}</b>{tx("held")}</span><span><b>{list.filter((e) => e.status === 'cancelled').length}</b>{tx("cancelled")}</span></div>
        <ul className="hb-list">
          {shown.slice(0, 40).map((e) => (
            <li key={e.id}><span><b>{e.title}</b><small>{when(tsMs(e.startAt))}{e.location?.address ? ` · ${e.location.address}` : ''}</small></span><em className={e.status === 'cancelled' ? 'no' : tsMs(e.endAt || e.startAt) >= hub.now ? 'ok' : ''}>{e.status === 'cancelled' ? tx("Cancelled") : tsMs(e.endAt || e.startAt) >= hub.now ? tx("Coming") : tx("Held")}</em></li>
          ))}
          {shown.length === 0 && <li className="hb-none">{tx("Nothing to show.")}</li>}
        </ul>
      </section>
    );
  };
  return (
    <>
      <div className="hb-bar-top"><h3>{tx("Activities of this kurel")}</h3><Seg value={f} onChange={setF} options={[['all', 'All'], ['coming', 'Coming'], ['past', 'Past']]} /></div>
      <div className="hb-two">{col('Rehearsals', 'g', hub.rehearsals)}{col('Events', 'b', hub.others)}</div>
    </>
  );
}

function Progress({ hub }: { hub: KurelHubData }) {
  const now = hub.rehearsals.slice(0, 4);
  return (
    <>
      <div className="hb-bar-top"><h3>{tx("Progress of this kurel")}</h3></div>
      <div className="hb-two">
        <section className="hb-col b">
          <header><h3>{tx("Lessons being rehearsed")}</h3><span>{now.length}</span></header>
          <ul className="hb-list">
            {now.map((r) => <li key={r.id}><span><b>{r.purpose || r.title}</b><small>{r.purpose ? `${r.title} · ` : ''}{when(tsMs(r.startAt))}</small></span><em>{tsMs(r.startAt) >= hub.now ? tx("Next") : tx("Last")}</em></li>)}
            {now.length === 0 && <li className="hb-none">{tx("No rehearsal recorded yet.")}</li>}
          </ul>
        </section>
        <section className="hb-col y">
          <header><h3>{tx("Curriculum")}</h3><span>—</span></header>
          <div className="hb-curr"><span className="hb-bar"><i style={{ width: '0%' }} /></span><p>{tx("No curriculum is assigned to this kurel yet. Once it is created and assigned, the lessons completed and the share of the curriculum covered appear here.")}</p></div>
        </section>
      </div>
      <section className="hb-col g hb-wide">
        <header><h3>{tx("Reports from the pedagogy committee")}</h3><span>{hub.progress.length}</span></header>
        <div className="hb-reports">
          {hub.progress.slice(0, 6).map((p) => (
            <div key={p.id} className="hb-rep"><strong>{p.period}</strong>
              {([['Mastery', p.masteryPct], ['Melody', p.melodyPct], ['Timing', p.timingPct], ['Directives', p.directivesPct]] as [string, number][]).map(([l, v]) => <span key={l}><em>{l}<b>{v}%</b></em><span className={`hb-bar ${band(v)}`}><i style={{ width: `${v}%` }} /></span></span>)}
            </div>
          ))}
          {hub.progress.length === 0 && <Empty text="No report yet." />}
        </div>
      </section>
    </>
  );
}

function Schedule({ hub }: { hub: KurelHubData }) {
  const slots = regularSlots(hub.rehearsals);
  const coming = hub.upcoming(hub.rehearsals).sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt)).slice(0, 6);
  return (
    <>
      <div className="hb-bar-top"><h3>{tx("Regular meetings")}</h3><span className="hb-note">{tx("Worked out from the rehearsals of this kurel")}</span></div>
      <div className="hb-days">
        {DAYS.map((d, i) => {
          const list = slots.filter((s) => s.day === i);
          return (
            <section key={d} className={`hb-day${list.length ? ' on' : ''}`}>
              <h4>{d}</h4>
              {list.length === 0 ? <small>{tx("No meeting")}</small> : list.map((s) => <div key={s.from} className="hb-time"><b>{s.from}{s.to ? ` – ${s.to}` : ''}</b>{s.place && <small>{s.place}</small>}<small>{s.n} {tx("session")}{s.n === 1 ? '' : 's'}</small></div>)}
            </section>
          );
        })}
      </div>
      <section className="hb-col y hb-wide">
        <header><h3>{tx("Next meetings")}</h3><span>{coming.length}</span></header>
        <ul className="hb-list">
          {coming.map((e) => <li key={e.id}><span><b>{DAYS[dayIdx(tsMs(e.startAt))]} {frDate(tsMs(e.startAt))}</b><small>{hhmm(tsMs(e.startAt))}{tsMs(e.endAt) ? ` – ${hhmm(tsMs(e.endAt))}` : ''}{e.location?.address ? ` · ${e.location.address}` : ''}</small></span><em className="ok">{tx("Coming")}</em></li>)}
          {coming.length === 0 && <li className="hb-none">{tx("No meeting is planned.")}</li>}
        </ul>
      </section>
    </>
  );
}

type AttFilter = 'all' | 'present' | 'late' | 'excused' | 'absent';
const ATT_LABEL: Record<AttFilter, string> = { all: 'All', present: 'Present', late: 'Late', excused: 'Excused', absent: 'Absent' };
const ATT_TONE: Record<AttFilter, string> = { all: 'p', present: 'g', late: 'y', excused: 'b', absent: 'r' };
const attMatch = (r: AttRow, f: AttFilter) => f === 'all' || (f === 'present' ? PRESENT.has(r.status) : f === 'late' ? r.status === 'LATE' || r.status === 'LATE_APPROVED' : f === 'excused' ? r.status === 'EXCUSED' : r.status === 'UNEXCUSED');
const attWord = (s: string) => (s === 'PRESENT' ? 'Present' : s === 'LATE' ? 'Late' : s === 'LATE_APPROVED' ? 'Late, approved' : s === 'EXCUSED' ? 'Excused' : s === 'UNEXCUSED' ? 'Absent' : s);
const attTone = (s: string) => (s === 'PRESENT' ? 'ok' : s === 'LATE' || s === 'LATE_APPROVED' ? 'late' : s === 'EXCUSED' ? 'exc' : 'no');

/** Who was present, late, excused or absent, with the session each record belongs to. */
function AttDetail({ title, sub, rows, events, start, onClose }: { title: string; sub?: string; rows: AttRow[]; events: Map<string, EventRow>; start: AttFilter; onClose: () => void }) {
  const [f, setF] = useState<AttFilter>(start);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'session' | 'member'>('session');
  const [exp, setExp] = useState<Set<string>>(new Set());
  const single = new Set(rows.map((r) => r.userId)).size === 1;
  const split = (items: { k: string; w: number; el: JSX.Element }[], n = 2) => { const cols: JSX.Element[][] = Array.from({ length: n }, () => []); const h: number[] = Array(n).fill(0); items.forEach((it) => { const c = h.indexOf(Math.min(...h)); cols[c].push(<div key={it.k} className="ad-slot">{it.el}</div>); h[c] += it.w; }); return cols.map((c, n) => <div className="ad-col" key={n}>{c}</div>); };
  const flip = (id: string) => setExp((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const profiles = useUserProfiles(rows.map((r) => r.userId));
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => attMatch(r, f) && (!t || (profiles[r.userId]?.name ?? '').toLowerCase().includes(t) || (events.get(r.eventId)?.title ?? '').toLowerCase().includes(t))).sort((a, b) => (tsMs(events.get(b.eventId)?.startAt) || b.ms) - (tsMs(events.get(a.eventId)?.startAt) || a.ms));
  }, [rows, f, q, profiles, events]);
  const blocks = useMemo(() => {
    const m = new Map<string, { id: string; ev?: EventRow; ms: number; rows: AttRow[]; all: AttRow[] }>();
    list.forEach((r) => { const ev = events.get(r.eventId); const cur = m.get(r.eventId) ?? { id: r.eventId, ev, ms: tsMs(ev?.startAt) || r.ms, rows: [], all: rows.filter((x) => x.eventId === r.eventId) }; cur.rows.push(r); m.set(r.eventId, cur); });
    return [...m.values()].sort((a, b) => b.ms - a.ms);
  }, [list, events, rows]);
  const people = useMemo(() => {
    const m = new Map<string, { userId: string; rows: AttRow[]; all: AttRow[] }>();
    list.forEach((r) => { const cur = m.get(r.userId) ?? { userId: r.userId, rows: [], all: rows.filter((x) => x.userId === r.userId) }; cur.rows.push(r); m.set(r.userId, cur); });
    return [...m.values()].sort((a, b) => (profiles[a.userId]?.name ?? '').localeCompare(profiles[b.userId]?.name ?? ''));
  }, [list, rows, profiles]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fm hb-att" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="fm-body">
          <div className="hb-attf">
            {(Object.keys(ATT_LABEL) as AttFilter[]).map((k) => <button type="button" key={k} className={`${ATT_TONE[k]}${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{ATT_LABEL[k]}<b>{rows.filter((r) => attMatch(r, k)).length}</b></button>)}
          </div>
          {!single && <input type="search" className="hb-attq" placeholder={tx("Search a member or a session")} value={q} onChange={(e) => setQ(e.target.value)} />}
          {!single && <div className="ad-view"><button type="button" className={view === 'session' ? 'on' : ''} onClick={() => setView('session')}>{tx("By session")} <b>{blocks.length}</b></button><button type="button" className={view === 'member' ? 'on' : ''} onClick={() => setView('member')}>{tx("By member")} <b>{people.length}</b></button></div>}
          <div className={single ? 'ad-single' : 'ad-plain'}>
          <div className="ad-grid">
            {(single || view === 'session') && split(blocks.slice(0, 60).map((bk) => {
              const st = attStats(bk.all);
              const ev = bk.ev;
              if (single) {
                const r0 = bk.rows[0];
                return { k: bk.id, w: 4, el: (
                  <article className={`ad-card ad-srow ${attTone(r0.status)}`}>
                    <header>
                      <span className={`ad-kind ${ev?.kind === 'rehearsal' ? 'r' : 'e'}`}>{ev?.kind === 'rehearsal' ? tx("Rehearsal") : tx("Event")}</span>
                      <b>{ev?.title ?? tx("Session")}</b>
                      <small>{when(bk.ms)}{ev?.location?.address ? ` · ${ev.location.address}` : ''}</small>
                    </header>
                    <span className={`ad-status ${attTone(r0.status)}`}>{attWord(r0.status)}</span>
                  </article>
                ) };
              }
              return { k: bk.id, w: 7 + Math.ceil(Math.min(bk.rows.length, exp.has(bk.id) ? 999 : 8) / 2), el: (
                <article className={`ad-card ${st.rate === null ? 'na' : band(st.rate)}`} key={bk.id}>
                  <header>
                    <span className={`ad-kind ${ev?.kind === 'rehearsal' ? 'r' : 'e'}`}>{ev?.kind === 'rehearsal' ? tx("Rehearsal") : tx("Event")}</span>
                    <b>{ev?.title ?? tx("Session")}</b>
                    <small>{when(bk.ms)}{ev?.location?.address ? ` · ${ev.location.address}` : ''}</small>
                  </header>
                  <div className="ad-nums"><span className="g"><b>{st.present}</b>{tx("Present")}</span><span className="y"><b>{st.late}</b>{tx("Late")}</span><span className="b"><b>{st.excused}</b>{tx("Excused")}</span><span className="r"><b>{st.absent}</b>{tx("Absent")}</span></div>
                  <span className="ad-bar"><i className="g" style={{ width: `${bk.all.length ? (st.present / bk.all.length) * 100 : 0}%` }} /><i className="b" style={{ width: `${bk.all.length ? (st.excused / bk.all.length) * 100 : 0}%` }} /><i className="r" style={{ width: `${bk.all.length ? (st.absent / bk.all.length) * 100 : 0}%` }} /></span>
                  <div className="ad-chips">
                    {bk.rows.slice(0, exp.has(bk.id) ? 999 : 8).map((r, i) => <span key={r.userId + i} className={attTone(r.status)}><PersonLink userId={r.userId}><span className="ad-pl"><Avatar name={profiles[r.userId]?.name || '…'} photoUrl={profiles[r.userId]?.photoUrl} size={22} /><b>{profiles[r.userId]?.name || '…'}</b></span></PersonLink><em>{attWord(r.status)}</em></span>)}
                    {bk.rows.length > 8 && <span className="more" role="button" tabIndex={0} onClick={() => flip(bk.id)} onKeyDown={(e) => e.key === 'Enter' && flip(bk.id)}>{exp.has(bk.id) ? tx("Show fewer") : `+${bk.rows.length - 8} more`}</span>}
                  </div>
                  <span className="ad-foot">{tx("Attendance rate")} <b>{st.rate === null ? '—' : `${st.rate}%`}</b> · {bk.all.length} {tx("member")}{bk.all.length === 1 ? '' : 's'} {tx("counted")}</span>
                </article>
              ) };
            }), single ? 1 : 2)}
            {!single && view === 'member' && split(people.slice(0, 80).map((p) => {
              const st = attStats(p.all);
              return { k: p.userId, w: 5 + Math.ceil(Math.min(p.rows.length, 10) / 2), el: (
                <article className={`ad-card ${st.rate === null ? 'na' : band(st.rate)}`} key={p.userId}>
                  <header className="ad-who"><PersonLink userId={p.userId}><span className="ad-pl"><Avatar name={profiles[p.userId]?.name || '…'} photoUrl={profiles[p.userId]?.photoUrl} size={36} /><span className="ad-pn"><b>{profiles[p.userId]?.name || '…'}</b><small>{p.all.length} {tx("session")}{p.all.length === 1 ? '' : 's'} · {st.rate === null ? tx("no rate yet") : `${st.rate}% present`}</small></span></span></PersonLink></header>
                  <div className="ad-nums"><span className="g"><b>{st.present}</b>{tx("Present")}</span><span className="y"><b>{st.late}</b>{tx("Late")}</span><span className="b"><b>{st.excused}</b>{tx("Excused")}</span><span className="r"><b>{st.absent}</b>{tx("Absent")}</span></div>
                  <span className="ad-bar"><i className="g" style={{ width: `${p.all.length ? (st.present / p.all.length) * 100 : 0}%` }} /><i className="b" style={{ width: `${p.all.length ? (st.excused / p.all.length) * 100 : 0}%` }} /><i className="r" style={{ width: `${p.all.length ? (st.absent / p.all.length) * 100 : 0}%` }} /></span>
                  <div className="ad-chips">
                    {p.rows.slice(0, 10).map((r, i) => { const ev = events.get(r.eventId); return <span key={r.eventId + i} className={attTone(r.status)} title={ev?.title}>{ev?.title ?? tx("Session")} · {frDate(tsMs(ev?.startAt) || r.ms)}<em>{attWord(r.status)}</em></span>; })}
                    {p.rows.length > 10 && <span className="more">+{p.rows.length - 10} {tx("more")}</span>}
                  </div>
                </article>
              ) };
            }))}
            {list.length === 0 && <p className="hb-none">{tx("No record for this choice.")}</p>}
          </div>
          {single && (() => {
            const st = attStats(rows);
            const parts: [AttFilter, string, string, number][] = [['present', 'On time', '#1f9d63', st.present - st.late], ['late', 'Late', '#d9a21b', st.late], ['excused', 'Excused', '#3b82f6', st.excused], ['absent', 'Absent', '#d64535', st.absent]];
            const sum = parts.reduce((n, x) => n + x[3], 0);
            let at = 0;
            const stops = sum ? parts.filter((x) => x[3] > 0).map((x) => { const from = at; at += (x[3] / sum) * 100; return `${x[2]} ${from}% ${at}%`; }).join(',') : '#e4ece8 0 100%';
            return (
              <aside className="ad-pie">
                <h4>{tx("Attendance")}</h4>
                <div className="ad-donut" style={{ background: `conic-gradient(${stops})` }}><div><b>{st.rate === null ? '—' : `${st.rate}%`}</b><small>{tx("present")}</small></div></div>
                <p>{sum} {tx("session")}{sum === 1 ? '' : 's'} {tx("counted")}</p>
                <ul>{parts.map(([k, l, col, n]) => <li key={k}><button type="button" style={{ ['--c' as string]: col }} onClick={() => setF(k)}><i />{l}<b>{n}</b></button></li>)}</ul>
              </aside>
            );
          })()}
          </div>
        </div>
        <footer><span className="fm-err" style={{ color: '#4a5c53' }}>{list.length} {tx("record")}{list.length === 1 ? '' : 's'} {tx("in")} {view === 'session' ? `${blocks.length} session${blocks.length === 1 ? '' : 's'}` : `${people.length} member${people.length === 1 ? '' : 's'}`}</span><button type="button" className="fm-go" onClick={onClose}>{tx("Close")}</button></footer>
      </div>
    </div>,
    document.body
  );
}

function Attendance({ hub }: { hub: KurelHubData }) {
  const [period, setPeriod] = useState<Period>('month');
  const [detail, setDetail] = useState<{ title: string; sub?: string; rows: AttRow[]; start: AttFilter } | null>(null);
  const att = hub.att;
  const b = useMemo(() => bucketsOf(period, new Date()), [period]);
  const rows = useMemo(() => (att ?? []).filter((r) => r.ms >= b.list[0].start && r.ms < b.list[b.list.length - 1].end), [att, b]);
  const evMap = useMemo(() => new Map(hub.events.map((e) => [e.id, e] as [string, EventRow])), [hub.events]);
  const st = attStats(rows);
  const profiles = useUserProfiles(rows.filter((r) => r.status === 'UNEXCUSED').map((r) => r.userId));
  const missing = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter((r) => r.status === 'UNEXCUSED').forEach((r) => m.set(r.userId, (m.get(r.userId) ?? 0) + 1));
    return [...m.entries()].sort((a, c) => c[1] - a[1]).slice(0, 6);
  }, [rows]);
  const kinds = useMemo(() => {
    const make = (rehearsal: boolean) => {
      const mine = rows.filter((r) => (evMap.get(r.eventId)?.kind === 'rehearsal') === rehearsal);
      const by = new Map<string, AttRow[]>();
      mine.forEach((r) => by.set(r.eventId, [...(by.get(r.eventId) ?? []), r]));
      const sessions = [...by.entries()].map(([id, list]) => ({ id, ev: evMap.get(id), list, s: attStats(list) })).sort((x, y) => tsMs(y.ev?.startAt) - tsMs(x.ev?.startAt));
      return { rows: mine, s: attStats(mine), sessions };
    };
    return { rehearsal: make(true), event: make(false) };
  }, [rows, evMap]);
  const open = (title: string, list: AttRow[], start: AttFilter, sub?: string) => setDetail({ title, sub, rows: list, start });
  const kpi: [AttFilter, string, string][] = [['all', 'Attendance rate', st.rate === null ? '—' : `${st.rate}%`], ['present', 'Present', String(st.present)], ['late', 'Late', String(st.late)], ['excused', 'Excused', String(st.excused)], ['absent', 'Absent', String(st.absent)]];
  const col = (title: string, tone: string, k: typeof kinds.rehearsal, key: 'rehearsal' | 'event') => (
    <section className={`hb-col ${tone}`}>
      <header><h3>{title}</h3><span>{k.sessions.length} {tx("session")}{k.sessions.length === 1 ? '' : 's'}</span></header>
      <div className="hb-mini four">
        <button type="button" onClick={() => open(`${title} · all records`, k.rows, 'all', b.title)}><b>{k.s.rate === null ? '—' : `${k.s.rate}%`}</b>{tx("rate")}</button>
        <button type="button" onClick={() => open(`${title} · present`, k.rows, 'present', b.title)}><b>{k.s.present}</b>{tx("present")}</button>
        <button type="button" onClick={() => open(`${title} · excused`, k.rows, 'excused', b.title)}><b>{k.s.excused}</b>{tx("excused")}</button>
        <button type="button" onClick={() => open(`${title} · absent`, k.rows, 'absent', b.title)}><b>{k.s.absent}</b>{tx("absent")}</button>
      </div>
      <ul className="hb-list">
        {k.sessions.slice(0, 30).map((x) => (
          <li key={x.id}>
            <button type="button" className="hb-rowbtn" onClick={() => open(x.ev?.title ?? 'Session', x.list, 'all', `${key === 'rehearsal' ? 'Rehearsal' : 'Event'} · ${when(tsMs(x.ev?.startAt))}`)}>
              <span><b>{x.ev?.title ?? tx("Session")}</b><small>{when(tsMs(x.ev?.startAt))} · {x.s.present} {tx("present ·")} {x.s.excused} {tx("excused ·")} {x.s.absent} {tx("absent")}</small></span>
              <em className={x.s.rate === null ? '' : band(x.s.rate)}>{x.s.rate === null ? '—' : `${x.s.rate}%`}</em>
            </button>
          </li>
        ))}
        {k.sessions.length === 0 && <li className="hb-none">{tx("No")} {key === 'rehearsal' ? tx("rehearsal") : tx("event")} {tx("attendance in this period.")}</li>}
      </ul>
    </section>
  );
  return (
    <>
      <div className="hb-bar-top"><h3>{tx("Attendance ·")} {b.title}</h3><Seg value={period} onChange={setPeriod} options={[['week', 'Weekly'], ['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']]} /></div>
      {att === null ? <Empty text="Loading…" /> : (
        <>
          <div className="hb-kpis">
            {kpi.map(([k, l, v]) => <button type="button" key={k} className={ATT_TONE[k]} onClick={() => open(`${l === 'Attendance rate' ? 'All attendance' : l}`, rows, k, b.title)}><small>{l}</small><b>{v}</b><u>{tx("See the list ›")}</u></button>)}
          </div>
          <div className="hb-two">{col('Rehearsals', 'g', kinds.rehearsal, 'rehearsal')}{col('Events', 'b', kinds.event, 'event')}</div>
          <section className="hb-col p hb-wide">
            <header><h3>{tx("Rate for each")} {period === 'week' ? tx("day") : period === 'month' ? tx("week") : tx("month")}</h3><span>{st.rate === null ? tx("No record yet") : `Average ${st.rate}% · tap a bar for the list`}</span></header>
            <div className="ac">
              <div className="ac-y" aria-hidden><span style={{ top: 22 }}>100%</span><span style={{ top: 102 }}>50%</span><span style={{ top: 182 }}>0%</span></div>
              <div className="ac-plot" style={{ gridTemplateColumns: `repeat(${b.list.length}, minmax(0, 1fr))` }}>
                {b.list.map((x) => {
                  const list = rows.filter((r) => r.ms >= x.start && r.ms < x.end);
                  const s = attStats(list);
                  const d1 = new Date(x.start); const d2 = new Date(x.end - 1);
                  const range = period === 'week' ? `${d1.getDate()} ${MONTHS[d1.getMonth()]}` : period === 'month' ? (d1.getMonth() === d2.getMonth() ? `${d1.getDate()}–${d2.getDate()} ${MONTHS[d1.getMonth()]}` : `${d1.getDate()} ${MONTHS[d1.getMonth()]} – ${d2.getDate()} ${MONTHS[d2.getMonth()]}`) : String(d1.getFullYear());
                  return (
                    <button type="button" key={x.label} className={`ac-col${list.length === 0 ? ' none' : ''}`} disabled={list.length === 0} onClick={() => open(`${x.label} · ${b.title}`, list, 'all')} title={s.rate === null ? tx("No record") : `${s.rate}% present · see the list`}>
                      <span className="ac-bar">{s.rate === null ? <em className="ac-no">{tx("No session")}</em> : <i className={band(s.rate)} style={{ height: `${Math.max(3, s.rate)}%` }}><em>{s.rate}%</em></i>}</span>
                      <span className="ac-lab"><b>{x.label}</b><small>{range}</small><u>{list.length} {tx("record")}{list.length === 1 ? '' : 's'}</u></span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
          <section className="hb-col r hb-wide">
            <header><h3>{tx("Most absences")}</h3><span>{missing.length}</span></header>
            <ul className="hb-list">
              {missing.map(([uid, n]) => <li key={uid}><button type="button" className="hb-rowbtn" onClick={() => open(`${profiles[uid]?.name || 'Member'} · absences`, rows.filter((r) => r.userId === uid), 'absent', b.title)}><span className="hb-who"><Avatar name={profiles[uid]?.name || '…'} photoUrl={profiles[uid]?.photoUrl} size={30} /><b>{profiles[uid]?.name || '…'}</b></span><em className="no">{n} {tx("absence")}{n === 1 ? '' : 's'}</em></button></li>)}
              {missing.length === 0 && <li className="hb-none">{tx("No unexcused absence in this period.")}</li>}
            </ul>
          </section>
        </>
      )}
      {detail && <AttDetail title={detail.title} sub={detail.sub} rows={detail.rows} events={evMap} start={detail.start} onClose={() => setDetail(null)} />}
    </>
  );
}

function Social({ hub }: { hub: KurelHubData }) {
  const [cat, setCat] = useState('');
  const profiles = useUserProfiles(hub.welfare.map((w) => w.userId));
  const [when_, setWhen] = useState<'all' | 'upcoming' | 'past'>('all');
  const cats = Object.keys(WCAT);
  const today = new Date().setHours(0, 0, 0, 0);
  const dateOf = (w: { eventDate?: unknown; createdAt?: unknown }) => tsMs(w.eventDate || w.createdAt);
  const inTime = (w: { eventDate?: unknown; createdAt?: unknown }, t: 'all' | 'upcoming' | 'past') => t === 'all' || (t === 'upcoming' ? dateOf(w) >= today : dateOf(w) < today);
  const timed = hub.welfare.filter((w) => inTime(w, when_));
  const list = timed.filter((w) => !cat || w.category === cat).sort((a, b) => (when_ === 'upcoming' ? dateOf(a) - dateOf(b) : dateOf(b) - dateOf(a)));
  return (
    <>
      <div className="hb-bar-top"><h3>{tx("Social news of this kurel")}</h3>{cat && <button type="button" className="hb-clear" onClick={() => setCat('')}>{tx("Show all")}</button>}</div>
      <div className="hb-seg sn-tabs">{(['all', 'upcoming', 'past'] as const).map((t) => <button type="button" key={t} className={when_ === t ? 'on' : ''} onClick={() => setWhen(t)}>{t === 'all' ? tx("All") : t === 'upcoming' ? tx("Upcoming") : tx("Past")} <b>{hub.welfare.filter((w) => inTime(w, t)).length}</b></button>)}</div>
      <div className="hb-cats">
        {cats.map((c) => <button type="button" key={c} style={{ ['--c' as string]: WCOL[c] }} className={`hb-cat${cat === c ? ' on' : ''}`} onClick={() => setCat(cat === c ? '' : c)}><b>{timed.filter((w) => w.category === c).length}</b><span>{WCAT[c]}</span></button>)}
      </div>
      <section className="hb-col r hb-wide">
        <header><h3>{cat ? WCAT[cat] : when_ === 'upcoming' ? tx("Upcoming news") : when_ === 'past' ? tx("Past news") : tx("All news")}</h3><span>{list.length}</span></header>
        <ul className="hb-list">
          {list.slice(0, 50).map((w) => {
            const name = profiles[w.userId]?.name || w.userName || '…';
            return (
              <li key={w.id}><span className="hb-who"><PersonLink userId={w.userId} kurelId={hub.kurelId}><span className="mf-pl"><Avatar name={name} photoUrl={profiles[w.userId]?.photoUrl} size={32} /><span><b>{name}</b><small>{WCAT_ONE[w.category] ?? tx("News")} · {frDate(tsMs(w.eventDate || w.createdAt))}{w.explanation ? ` · ${w.explanation.slice(0, 90)}` : ''}</small></span></span></PersonLink></span><em className={w.status === 'closed' ? '' : w.status === 'escalated' ? 'no' : 'ok'}>{WSTATUS[w.status] ?? w.status}</em></li>
            );
          })}
          {list.length === 0 && <li className="hb-none">{when_ === 'upcoming' ? tx("No upcoming news.") : when_ === 'past' ? tx("No past news.") : tx("No social news.")}</li>}
        </ul>
      </section>
    </>
  );
}

const CUR_NAME: Record<string, string> = { USD: 'US dollars', XOF: 'CFA francs', EUR: 'euros', GBP: 'pounds', CAD: 'Canadian dollars' };
function Finance({ hub }: { hub: KurelHubData }) {
  const s = hub.success;
  const [gf, setGf] = useState<'all' | 'done' | 'going' | 'none'>('all');
  const cur = [...new Set(hub.goals.map((g) => g.currency))];
  const tot = cur.map((c) => { const gs = hub.goals.filter((g) => g.currency === c); const goal = gs.reduce((n, g) => n + g.goal, 0); const paid = gs.reduce((n, g) => n + g.paid, 0); return { c, k: gs.length, goal, paid, pct: goal ? Math.min(100, Math.round((paid / goal) * 100)) : 0 }; });
  const n = hub.goals.length;
  const inGroup = (g: { pct: number }, k: typeof gf) => k === 'all' || (k === 'done' ? g.pct >= 100 : k === 'going' ? g.pct > 0 && g.pct < 100 : g.pct === 0);
  const done = hub.goals.filter((g) => inGroup(g, 'done')).length;
  const going = hub.goals.filter((g) => inGroup(g, 'going')).length;
  const none = hub.goals.filter((g) => inGroup(g, 'none')).length;
  const shown = hub.goals.filter((g) => inGroup(g, gf)).sort((a, b) => b.pct - a.pct);
  const paidPeople = hub.memberFin.filter((m) => m.paidAny).length;
  const tile = (k: typeof gf, tone: string, label: string, v: number) => <button type="button" key={k} className={`${tone}${gf === k ? ' on' : ''}`} onClick={() => setGf(k)} aria-pressed={gf === k}><small>{label}</small><b>{v}</b><span>{n ? `${Math.round((v / n) * 100)}% of programs` : tx("no program yet")}</span></button>;
  const gname = gf === 'all' ? 'Every program' : gf === 'done' ? 'Programs reached (100%)' : gf === 'going' ? 'Programs in progress' : 'Programs not started';
  return (
    <>
      <div className="hb-bar-top"><h3>{tx("Financial overview")}</h3></div>
      <div className="fg-top">
        <section className="hb-col t fg-score">
          <header><h3>{tx("Success rating")}</h3></header>
          <div className="hb-ring" style={{ background: `conic-gradient(${s === null ? '#e4ece8' : s >= 80 ? '#1f9d63' : s >= 50 ? '#d9a21b' : '#d64535'} 0 ${s ?? 0}%, #e4ece8 ${s ?? 0}% 100%)` }}><div><b>{s === null ? '—' : `${s}%`}</b><small>{s === null ? tx("no goal") : s >= 80 ? tx("excellent") : s >= 50 ? tx("on the way") : tx("behind")}</small></div></div>
          <p className="hb-note">{tx("Average of what this kurel has collected against each goal it was given.")}</p>
          <div className="fg-facts">
            <span><small>{tx("Programs reached")}</small><b>{done} {tx("of")} {n}</b></span>
            <span><small>{tx("Members who paid")}</small><b>{paidPeople} {tx("of")} {hub.memberFin.length}</b></span>
            {tot.map((t) => <span key={t.c}><small>{tx("Reached in")} {CUR_NAME[t.c] ?? t.c}</small><b>{t.pct}%</b></span>)}
          </div>
        </section>
        <section className="hb-col t fg-fig">
          <header><h3>{tx("In figures")}</h3><span>{n} {tx("program")}{n === 1 ? '' : 's'} {tx("· tap a block to filter")}</span></header>
          <div className="fg-tiles">
            {tile('all', 'g', 'Objectives', n)}
            {tile('done', 'b', 'Reached (100%)', done)}
            {tile('going', 'y', 'In progress', going)}
            {tile('none', 'r', 'Not started', none)}
          </div>
          {n > 0 && <span className="fg-split"><i className="b" style={{ width: `${(done / n) * 100}%` }} /><i className="y" style={{ width: `${(going / n) * 100}%` }} /><i className="r" style={{ width: `${(none / n) * 100}%` }} /></span>}
          <div className="fg-listhead"><b>{gname}</b><span>{shown.length}</span></div>
          <ul className="fg-plist">
            {shown.map((g) => (
              <li key={g.programId} className={band(g.pct)}>
                <span className="fg-pn"><b>{g.name}</b><small>{money(g.paid, g.currency)} {tx("collected of")} {money(g.goal, g.currency)}</small></span>
                <span className={`hb-bar ${band(g.pct)}`}><i style={{ width: `${g.pct}%` }} /></span>
                <em>{g.pct}%</em>
              </li>
            ))}
            {shown.length === 0 && <li className="fg-empty">{n === 0 ? tx("No financial program has been given to this kurel yet.") : tx("No program in this group.")}</li>}
          </ul>
          {tot.length > 0 && (
            <div className="fg-money">
              {tot.map((t) => <span key={t.c}><u>{tx("Total in")} {CUR_NAME[t.c] ?? t.c} · {t.k} {tx("program")}{t.k === 1 ? '' : 's'}</u><b>{money(t.paid, t.c)}</b> {tx("collected so far, out of a goal of")} {money(t.goal, t.c)} ({t.pct}{tx("% reached)")}</span>)}
            </div>
          )}
        </section>
      </div>
      <MemberFinance hub={hub} />
    </>
  );
}

const RATING = (r: number | null) => (r === null ? { w: 'No amount set', t: 'gray' } : r >= 80 ? { w: 'Excellent', t: 'g' } : r >= 50 ? { w: 'On the way', t: 'y' } : { w: 'Behind', t: 'r' });

/** Who paid what in this kurel, and how each member rates against the amount asked of them. */
function MemberFinance({ hub }: { hub: KurelHubData }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'paid' | 'unpaid' | 'behind' | 'noset'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const people = useUserProfiles(hub.memberFin.map((m) => m.userId));
  const name = (id: string) => people[id]?.name || '…';
  const dupNames = useMemo(() => { const c = new Map<string, number>(); hub.memberFin.forEach((m) => { const k = (people[m.userId]?.name || '').trim().toLowerCase(); if (k) c.set(k, (c.get(k) ?? 0) + 1); }); return new Set([...c.entries()].filter(([, n]) => n > 1).map(([k]) => k)); }, [hub.memberFin, people]);
  const match = (m: (typeof hub.memberFin)[number], k: typeof f) => k === 'all' || (k === 'paid' ? m.paidAny : k === 'unpaid' ? !m.paidAny : k === 'behind' ? m.rating !== null && m.rating < 50 : m.rating === null);
  const list = hub.memberFin.filter((m) => match(m, f) && (!q.trim() || name(m.userId).toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (b.lines.reduce((n, l) => n + l.paid, 0) - a.lines.reduce((n, l) => n + l.paid, 0)) || name(a.userId).localeCompare(name(b.userId)));
  const rated = hub.memberFin.filter((m) => m.rating !== null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const rank = new Map(rated.map((m, i) => [m.userId, i + 1] as [string, number]));
  const cur = hub.memberFin.find((m) => m.userId === open);
  const pays = open ? hub.payments.filter((c) => c.userId === open).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)) : [];
  const chips: [typeof f, string][] = [['all', 'All members'], ['paid', 'Have paid'], ['unpaid', 'Not paid yet'], ['behind', 'Behind'], ['noset', 'No amount set']];
  return (
    <section className="hb-col t hb-wide mf">
      <header><h3>{tx("Members and their contributions")}</h3><span>{hub.memberFin.filter((m) => m.paidAny).length} {tx("of")} {hub.memberFin.length} {tx("have paid")}</span></header>
      <div className="mf-bar">
        <div className="mf-chips">{chips.map(([k, l]) => <button type="button" key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}<b>{hub.memberFin.filter((m) => match(m, k)).length}</b></button>)}</div>
        <input type="search" className="hb-attq" placeholder={tx("Search a member")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mf-grid">
        {list.slice(0, 60).map((m) => {
          const r = RATING(m.rating);
          return (
            <div role="button" tabIndex={0} key={m.userId} className={`mf-card ${r.t}`} onClick={() => setOpen(m.userId)} onKeyDown={(e) => e.key === 'Enter' && setOpen(m.userId)}>
              <span className="mf-head"><span className="mf-stop" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><PersonLink userId={m.userId} kurelId={hub.kurelId}><span className="mf-pl"><Avatar name={name(m.userId)} photoUrl={people[m.userId]?.photoUrl} size={40} /><span><b>{name(m.userId)}</b><small>{people[m.userId]?.phone || tx("No phone on file")} {tx("· ID")} {m.userId.slice(-4).toUpperCase()}</small></span></span></PersonLink></span></span>
              <span className="mf-tags"><em className={`mf-badge ${r.t}`}>{m.rating === null ? r.w : `RANK ${rank.get(m.userId) ?? '—'} OF ${rated.length} · ${m.rating}%`}</em><em className="mf-tag">{m.lines.length ? `${m.lines.length} program${m.lines.length === 1 ? '' : 's'}` : tx("Nothing asked yet")}</em>{dupNames.has(name(m.userId).trim().toLowerCase()) && <em className="mf-tag dup" title={tx("Another member of this kurel has the same name. Use the phone number or ID to tell them apart.")}>{tx("Same name as another member")}</em>}<em className="mf-tag open">{tx("Contributions ›")}</em></span>
              {m.lines.map((l) => (
                <span className="mf-ach" key={l.programId}>
                  <span className="mf-ach-t"><b>{l.name}</b><em className={band(l.pct)}>{l.target ? `${l.pct}%` : tx("paid")}</em></span>
                  <span className={`hb-bar ${band(l.pct)}`}><i style={{ width: `${l.pct}%` }} /></span>
                  <small>{l.target ? `Contributed ${l.pct}% · ${money(l.paid, l.currency)} of ${money(l.target, l.currency)}` : `Paid ${money(l.paid, l.currency)}, no amount was set`}{l.pending > 0 ? ` · ${money(l.pending, l.currency)} to check` : ''}</small>
                </span>
              ))}
              {m.rating !== null && <span className={`mf-overall ${r.t}`}><span>{tx("Overall rating")}</span><b>{m.rating}%</b><em>{rank.get(m.userId) ? `RANK ${rank.get(m.userId)} OF ${rated.length}` : r.w}</em></span>}
              {m.lines.length === 0 && <span className="mf-none">{tx("No amount has been asked of this member, and no payment yet.")}</span>}
            </div>
          );
        })}
        {list.length === 0 && <p className="hb-none">{tx("No member matches.")}</p>}
      </div>
      {cur && (
        <Shell title={name(cur.userId)} sub={`${RATING(cur.rating).w}${cur.rating === null ? '' : ` · ${cur.rating}% of what was asked`}`} onClose={() => setOpen(null)} footer={<button type="button" className="fm-ghost" onClick={() => setOpen(null)}>{tx("Close")}</button>}>
          <div className={`mf-big ${RATING(cur.rating).t}`}><b>{cur.rating === null ? '—' : `${cur.rating}%`}</b><span><strong>{tx("Overall rating")}</strong>{cur.rating === null ? tx("Nothing has been asked of this member yet.") : `${RATING(cur.rating).w} · ${rank.get(cur.userId)} of ${rated.length} in this kurel. Average of the programs below.`}</span></div>
          <b style={{ display: 'block', margin: '12px 0 6px', fontSize: '.85rem' }}>{tx("Achievements")}</b>
          <ul className="mf-achl">
            {cur.lines.map((l) => <li key={l.programId} className={band(l.pct)}><span><b>{l.name}</b><small>{l.target ? `Contributed ${l.pct}% of what was asked: ${money(l.paid, l.currency)} of ${money(l.target, l.currency)}.` : `Paid ${money(l.paid, l.currency)}. No amount was set for this member.`}{l.pending > 0 ? ` ${money(l.pending, l.currency)} is waiting to be checked.` : ''}</small><span className={`hb-bar ${band(l.pct)}`}><i style={{ width: `${l.pct}%` }} /></span></span><em className={band(l.pct)}>{l.target ? `${l.pct}%` : tx("paid")}</em></li>)}
            {cur.lines.length === 0 && <li className="cm-nobody">{tx("Nothing asked of this member yet.")}</li>}
          </ul>
          <b style={{ display: 'block', margin: '12px 0 6px', fontSize: '.85rem' }}>{tx("Payments (")}{pays.length})</b>
          <ul className="gs-list">
            {pays.map((c) => <li key={c.id}><b>{money(c.amountCents, (hub.goals.find((g) => g.programId === c.programId)?.currency ?? 'XOF') as Currency)} · {c.method === 'orange_money' ? tx("Orange Money") : c.method === 'wave' ? tx("Wave") : c.method === 'cash' ? tx("Cash") : c.method ?? ''}</b><small>{frDate(tsMs(c.createdAt))} · {c.status === 'validated' ? tx("Checked") : c.status === 'pending_review' ? tx("To check") : tx("Rejected")}</small></li>)}
            {pays.length === 0 && <li className="cm-nobody">{tx("No payment yet.")}</li>}
          </ul>
        </Shell>
      )}
    </section>
  );
}

export function HubSection({ tab, hub }: { tab: Exclude<HubTab, 'overview'>; hub: KurelHubData }) {
  if (tab === 'activities') return <Activities hub={hub} />;
  if (tab === 'progress') return <Progress hub={hub} />;
  if (tab === 'schedule') return <Schedule hub={hub} />;
  if (tab === 'attendance') return <Attendance hub={hub} />;
  if (tab === 'social') return <Social hub={hub} />;
  return <Finance hub={hub} />;
}

export const HUB_TABS: [HubTab, string][] = [['overview', 'Overview'], ['activities', 'Activities'], ['progress', 'Progress'], ['schedule', 'Schedule'], ['attendance', 'Attendance'], ['social', 'Social'], ['finance', 'Finance']];

/** The clickable banner at the top of the page: the chosen kurel at a glance. */
export function HubBanner({ hub, name, where, level, team, members, open, onSwitch }: { onSwitch: () => void; hub: KurelHubData; name: string; where: string; level: string; team: number; members: number; open: (t: HubTab | 'team' | 'members') => void }) {
  const rate = monthRate(hub.att);
  const chips: [string, string, string, () => void][] = [
    ['g', `${hub.rehearsals.length + hub.others.length}`, 'Activities', () => open('activities')],
    ['b', hub.progress[0] ? `${Math.round((hub.progress[0].masteryPct + hub.progress[0].melodyPct + hub.progress[0].timingPct + hub.progress[0].directivesPct) / 4)}%` : '—', 'Progress', () => open('progress')],
    ['y', `${new Set(regularSlots(hub.rehearsals).map((s) => s.day)).size}/wk`, 'Meeting days', () => open('schedule')],
    ['p', rate === null ? '—' : `${rate}%`, 'Attendance', () => open('attendance')],
    ['r', `${hub.openWelfare}`, 'Open social', () => open('social')],
    ['t', hub.success === null ? '—' : `${hub.success}%`, 'Finance rating', () => open('finance')],
  ];
  return (
    <section className="hb-banner">
      <div className="hb-id">
        <span className="hb-kicker">{tx("Selected kurel")}<button type="button" className="hb-switch" onClick={onSwitch}>{tx("Change kurel ⇄")}</button></span>
        <strong>{name}</strong>
        <small>{where}{level ? ` · ${level}` : ''}</small>
        <span className="hb-links"><button type="button" onClick={() => open('members')}>{members} {tx("members")}</button><button type="button" onClick={() => open('team')}>{tx("Team")} {team}/6</button></span>
      </div>
      <div className="hb-chips">
        {chips.map(([t, v, l, fn]) => <button type="button" key={l} className={t} onClick={fn}><b>{v}</b><span>{l}</span></button>)}
      </div>
    </section>
  );
}

/** Every detail of one kurel in a pop-up, so a report can be read without leaving it. */
export function KurelPop({ id, name, where, members, rosterIds, onClose, onOpenPage }: { id: string; name: string; where: string; members: number; rosterIds: string[]; onClose: () => void; onOpenPage: () => void }) {
  const hub = useKurelHub(id, rosterIds);
  const [tab, setTab] = useState<HubTab>('overview');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 1990 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fm hb-pop" role="dialog" aria-modal="true" aria-label={name}>
        <header><div><h2>{name}</h2><p>{where || '—'} · {members} {tx("member")}{members === 1 ? '' : 's'}</p></div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="hb-pop-tabs" role="tablist">
          {HUB_TABS.map(([k, l]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="fm-body hb-pop-body">
          {tab === 'overview' ? <HubOverview hub={hub} open={setTab} kurelId={id} kurelName={name} /> : <HubSection tab={tab} hub={hub} />}
        </div>
        <footer><span className="fm-err" style={{ color: '#4a5c53' }}>{tx("Live figures of this kurel")}</span><span style={{ display: 'flex', gap: 8 }}><button type="button" className="fx-btn" onClick={onOpenPage}>{tx("Open the kurel page")}</button><button type="button" className="fm-go" onClick={onClose}>{tx("Close")}</button></span></footer>
      </div>
    </div>,
    document.body
  );
}

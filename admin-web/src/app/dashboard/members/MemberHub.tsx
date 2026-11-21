'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { tsMs } from '@/lib/useCollection';
import { tx, dateLocale } from '@/lib/i18n/tr';

type Rec = { id: string; [k: string]: unknown };
export type Tab = 'attendance' | 'social' | 'finance' | 'tasks' | 'meetings' | 'conduct';

const rows = async (q: ReturnType<typeof query>): Promise<Rec[]> => {
  try { return (await getDocs(q)).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })); } catch { return []; }
};
const day = (ms: number) => (ms ? new Date(ms).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const nice = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const money = (cents: number, cur: string) => `${(cents / 100).toLocaleString(dateLocale(), { maximumFractionDigits: 2 })} ${cur}`.trim();
const PRESENT = new Set(['PRESENT', 'LATE', 'LATE_APPROVED']);

export interface Data {
  attendance: { id: string; title: string; status: string; ms: number }[];
  absences: { id: string; title: string; status: string; reason: string; ms: number }[];
  welfare: { id: string; category: string; status: string; ms: number }[];
  contributions: { id: string; program: string; amount: number; cur: string; status: string; ms: number }[];
  donations: { id: string; amount: number; cur: string; status: string; ms: number }[];
  tasks: { id: string; title: string; status: string; progress: number; due: number }[];
  meetings: { id: string; title: string; status: string; ms: number; present?: string }[];
  cases: { id: string; reason: string; status: string; ms: number }[];
  evaluations: { id: string; period: string; average: number; stage: string }[];
}

export type Hub = { data: Data | null; k: ReturnType<typeof makeK> | null };
export type MTab = Tab | 'overview';

function makeK(data: Data) {
  const present = data.attendance.filter((a) => PRESENT.has(a.status)).length;
  const rate = data.attendance.length ? Math.round((present / data.attendance.length) * 100) : null;
  const openTasks = data.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const late = openTasks.filter((t) => t.due && t.due < Date.now()).length;
  const paid = data.contributions.filter((c) => c.status === 'validated').reduce((s, c) => s + c.amount, 0)
    + data.donations.filter((d) => d.status === 'succeeded' || d.status === 'paid' || d.status === 'completed').reduce((s, d) => s + d.amount, 0);
  const cur = data.contributions.find((c) => c.cur)?.cur || data.donations.find((d) => d.cur)?.cur || '';
  const mDone = data.meetings.filter((m) => m.status === 'completed');
  const mPresent = mDone.filter((m) => m.present === 'present').length;
  const next = data.meetings.filter((m) => m.status === 'scheduled' && m.ms >= Date.now()).sort((a, b) => a.ms - b.ms)[0];
  return { present, rate, openTasks: openTasks.length, doneTasks: data.tasks.length - openTasks.length, late, paid, cur, mDone: mDone.length, mPresent, next, social: data.absences.length + data.welfare.length, pendingSocial: data.absences.filter((a) => a.status === 'pending').length + data.welfare.filter((w) => w.status !== 'closed').length, open: data.cases.filter((c) => c.status !== 'closed').length };
}

/** Everything that concerns one member, read once when they are selected. */
export function useMemberHub(userId: string): Hub {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    if (!userId) return;
    let off = false;
    setData(null);
    (async () => {
      const [att, abs, wel, con, don, tsk, mt, dis, ev] = await Promise.all([
        rows(query(collection(db, 'attendance'), where('userId', '==', userId), limit(60))),
        rows(query(collection(db, 'absenceRequests'), where('userId', '==', userId), limit(30))),
        rows(query(collection(db, 'welfareRequests'), where('userId', '==', userId), limit(30))),
        rows(query(collection(db, 'contributions'), where('userId', '==', userId), limit(40))),
        rows(query(collection(db, 'donations'), where('userId', '==', userId), limit(40))),
        rows(query(collection(db, 'tasks'), where('assigneeIds', 'array-contains', userId), limit(40))),
        rows(query(collection(db, 'meetings'), where('inviteeIds', 'array-contains', userId), limit(40))),
        rows(query(collection(db, 'disciplinaryCases'), where('memberId', '==', userId), limit(20))),
        rows(query(collection(db, 'evaluations'), where('memberId', '==', userId), limit(20))),
      ]);
      const one = async (path: string, id: string) => { try { return (await getDoc(doc(db, path, id))).data() as Record<string, unknown> | undefined; } catch { return undefined; } };
      const evIds = Array.from(new Set([...att, ...abs].map((r) => r.eventId as string).filter(Boolean))).slice(0, 40);
      const evs: Record<string, string> = {};
      await Promise.all(evIds.map(async (id) => { const e = await one('events', id); if (e) evs[id] = (e.title as string) || tx("Event"); }));
      const progIds = Array.from(new Set(con.map((c) => c.programId as string).filter(Boolean))).slice(0, 20);
      const progs: Record<string, { n: string; c: string }> = {};
      await Promise.all(progIds.map(async (id) => { const p = await one('financialPrograms', id); if (p) progs[id] = { n: (p.name as string) || (p.title as string) || tx("Contribution"), c: (p.currency as string) || '' }; }));
      if (off) return;
      const by = <T extends { ms: number }>(a: T[]) => a.sort((x, y) => y.ms - x.ms);
      setData({
        attendance: by(att.map((r) => ({ id: r.id, title: evs[r.eventId as string] ?? tx("Event"), status: String(r.status ?? ''), ms: tsMs(r.serverTimestamp) }))),
        absences: by(abs.map((r) => ({ id: r.id, title: evs[r.eventId as string] ?? tx("Event"), status: String(r.status ?? ''), reason: String(r.reason ?? ''), ms: tsMs(r.requestedAt) }))),
        welfare: by(wel.map((r) => ({ id: r.id, category: String(r.category ?? ''), status: String(r.status ?? ''), ms: tsMs(r.createdAt) }))),
        contributions: by(con.map((r) => ({ id: r.id, program: progs[r.programId as string]?.n ?? tx("Contribution"), amount: Number(r.amountCents ?? 0), cur: progs[r.programId as string]?.c ?? '', status: String(r.status ?? ''), ms: tsMs(r.createdAt) || tsMs(r.createdMs) }))),
        donations: by(don.map((r) => ({ id: r.id, amount: Number(r.amountCents ?? 0), cur: String(r.currency ?? '').toUpperCase(), status: String(r.status ?? ''), ms: tsMs(r.paidAt) || tsMs(r.createdAt) }))),
        tasks: tsk.map((r) => ({ id: r.id, title: String(r.title ?? ''), status: String(r.status ?? ''), progress: Number(r.progress ?? 0), due: tsMs(r.dueAt) })).sort((a, b) => (a.due || 9e15) - (b.due || 9e15)),
        meetings: by(mt.map((r) => ({ id: r.id, title: String(r.title ?? ''), status: String(r.status ?? ''), ms: tsMs(r.startAt), present: ((r.attendance as Record<string, { status?: string }> | undefined)?.[userId]?.status) }))),
        cases: by(dis.map((r) => ({ id: r.id, reason: String(r.reason ?? ''), status: String(r.status ?? ''), ms: tsMs(r.openedAt) }))),
        evaluations: ev.map((r) => ({ id: r.id, period: String(r.period ?? ''), average: Number(r.average ?? 0), stage: String(r.stage ?? '') })),
      });
    })();
    return () => { off = true; };
  }, [userId]);

  const k = useMemo(() => (data ? makeK(data) : null), [data]);
  return { data, k };
}

const pill = (s: string) => <span className={`ma-pill ${/(approved|validated|present|done|succeeded|paid|completed|closed)/i.test(s) ? 'ok' : /(reject|absent|blocked|failed|cancel|open)/i.test(s) ? 'bad' : ''}`}>{nice(s) || '—'}</span>;
function Row({ a, b, c }: { a: string; b?: string; c: React.ReactNode }) {
  return <div className="ma-row"><div><strong>{a}</strong>{b ? <small>{b}</small> : null}</div>{c}</div>;
}

/** Coloured cards, one per area: each shows the key figure and opens its section. */
export function MemberTiles({ hub, open }: { hub: Hub; open: (t: Tab) => void }) {
  const { data, k } = hub;
  if (!data || !k) return <div className="mm-empty">{tx("Loading…")}</div>;
  const T = ({ cls, icon, title, tab, children, foot }: { cls: string; icon: string; title: string; tab: Tab; children: React.ReactNode; foot: string }) => (
    <button type="button" className={`mh-card ${cls}`} onClick={() => open(tab)}>
      <header><i>{icon}</i><b>{title}</b><em>{tx("Open")} ›</em></header>
      <div className="mh-body">{children}</div>
      <footer>{foot}</footer>
    </button>
  );
  return (
    <div className="mh-grid">
      <T cls="g" icon="✔" title={tx("Attendance")} tab="attendance" foot={`${data.attendance.length} ${tx("records")}`}>
        <div className="mh-big"><b>{k.rate === null ? '—' : `${k.rate}%`}</b><span>{tx("present at events")}</span></div>
        <div className="mh-bar"><i style={{ width: `${k.rate ?? 0}%` }} /></div>
      </T>
      <T cls="b" icon="✉" title={tx("Social")} tab="social" foot={`${k.pendingSocial} ${tx("open requests to follow")}`}>
        <div className="mh-duo"><div><b>{data.absences.length}</b><span>{tx("Absences")}</span></div><div><b>{data.welfare.length}</b><span>{tx("Welfare")}</span></div></div>
      </T>
      <T cls="y" icon="$" title={tx("Finance")} tab="finance" foot={`${data.contributions.length + data.donations.length} ${tx("payments")}`}>
        <div className="mh-big"><b>{k.paid ? money(k.paid, k.cur) : '—'}</b><span>{tx("paid so far")}</span></div>
      </T>
      <T cls="p" icon="☑" title={tx("Tasks")} tab="tasks" foot={k.late ? `${k.late} ${tx("late")}` : tx("Nothing late")}>
        <div className="mh-duo"><div><b>{k.openTasks}</b><span>{tx("Open")}</span></div><div><b>{k.doneTasks}</b><span>{tx("Done")}</span></div></div>
      </T>
      <T cls="t" icon="◷" title={tx("Meetings")} tab="meetings" foot={k.next ? `${tx("Next:")} ${k.next.title} · ${day(k.next.ms)}` : tx("No meeting planned")}>
        <div className="mh-big"><b>{k.mDone ? `${k.mPresent}/${k.mDone}` : '—'}</b><span>{tx("meetings attended")}</span></div>
      </T>
      <T cls="r" icon="⚖" title={tx("Conduct")} tab="conduct" foot={`${data.evaluations.length} ${tx("evaluations")}`}>
        <div className="mh-big"><b>{k.open}</b><span>{tx("open disciplinary cases")}</span></div>
      </T>
    </div>
  );
}

/** One full section of the member's detail page. */
export function MemberSection({ tab, hub }: { tab: Tab; hub: Hub }) {
  const { data, k } = hub;
  if (!data || !k) return <div className="mm-empty">{tx("Loading…")}</div>;
  return (
    <div className="ma-list">
      {tab === 'attendance' && (data.attendance.length === 0 ? <div className="mm-empty">{tx("No event attendance recorded.")}</div> : data.attendance.slice(0, 60).map((a) => <Row key={a.id} a={a.title} b={day(a.ms)} c={pill(a.status)} />))}
      {tab === 'social' && (data.absences.length + data.welfare.length === 0 ? <div className="mm-empty">{tx("No absence or welfare request.")}</div> : <>
        {data.absences.map((a) => <Row key={a.id} a={`${tx("Absence")} · ${a.title}`} b={a.reason || day(a.ms)} c={pill(a.status)} />)}
        {data.welfare.map((w) => <Row key={w.id} a={`${tx("Welfare")} · ${nice(w.category) || '—'}`} b={day(w.ms)} c={pill(w.status)} />)}
      </>)}
      {tab === 'finance' && (data.contributions.length + data.donations.length === 0 ? <div className="mm-empty">{tx("No contribution or donation.")}</div> : <>
        {data.contributions.map((c) => <Row key={c.id} a={c.program} b={day(c.ms)} c={<span className="ma-amt">{money(c.amount, c.cur)} {pill(c.status)}</span>} />)}
        {data.donations.map((d) => <Row key={d.id} a={tx("Donation")} b={day(d.ms)} c={<span className="ma-amt">{money(d.amount, d.cur)} {pill(d.status)}</span>} />)}
      </>)}
      {tab === 'tasks' && (data.tasks.length === 0 ? <div className="mm-empty">{tx("No task assigned.")}</div> : data.tasks.map((t) => (
        <Row key={t.id} a={t.title} b={t.due ? `${tx("Due")} ${day(t.due)}` : undefined} c={<span className="ma-amt"><span className="ma-bar"><i style={{ width: `${Math.min(100, t.progress)}%` }} /></span>{pill(t.status)}</span>} />
      )))}
      {tab === 'meetings' && (data.meetings.length === 0 ? <div className="mm-empty">{tx("No meeting invitation.")}</div> : data.meetings.map((m) => <Row key={m.id} a={m.title} b={day(m.ms)} c={pill(m.status === 'completed' ? (m.present ?? 'completed') : m.status)} />))}
      {tab === 'conduct' && (data.cases.length + data.evaluations.length === 0 ? <div className="mm-empty">{tx("No disciplinary case or evaluation.")}</div> : <>
        {data.cases.map((c) => <Row key={c.id} a={`${tx("Case")} · ${c.reason}`} b={day(c.ms)} c={pill(c.status)} />)}
        {data.evaluations.map((e) => <Row key={e.id} a={`${tx("Evaluation")} · ${e.period}`} b={`${tx("Average")} ${e.average.toFixed(1)}`} c={pill(e.stage)} />)}
      </>)}
    </div>
  );
}

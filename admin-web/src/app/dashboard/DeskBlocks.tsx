'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, CalendarDays, CheckCircle2, ChevronRight, FileText, FolderOpen, Gavel, Scale, Upload, Users, Vote } from 'lucide-react';
import { where } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useCount } from '@/lib/liveStats';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { formatMoney } from '@/lib/money';
import { tx, dateLocale } from '@/lib/i18n/tr';

/* ---------- the shared layout: the same as Event planning ---------- */
interface Tile { label: string; value: string | number | null; hint: string; href: string; hot?: boolean }
interface Row { pill: string; tone?: 'warn' | 'bad' | 'ok'; text: ReactNode }


const ACCENT: Record<string, { c: string; icon: ReactNode }> = {
  'Local zones': { c: '#0f766e', icon: <path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21zm0-8.5a3 3 0 110-6 3 3 0 010 6z" /> },
  Rehearsals: { c: '#6d3fa8', icon: <path d="M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zm10-2a3 3 0 11-6 0 3 3 0 016 0z" /> },
  'Attendance report': { c: '#15803d', icon: <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /> },
  'Social': { c: '#be185d', icon: <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /> },
  Finance: { c: '#1d4ed8', icon: <path d="M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2" /> },
  'Logistics management': { c: '#b45309', icon: <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" /> },
  'Audio and archives': { c: '#4f46e5', icon: <path d="M4 14v-2a8 8 0 0116 0v2M4 14h3v6H4zm13 0h3v6h-3z" /> },
  Administration: { c: '#0b5d3b', icon: <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" /> },
  Announcements: { c: '#c2410c', icon: <path d="M4 10v4h3l8 4V6L7 10H4zm14-1a4 4 0 010 6" /> },
};
const Head = ({ title, desc, href }: { title: string; desc?: string; href: string }) => {
  const a = ACCENT[title];
  return (
    <header>
      <span className="dk-ico" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{a?.icon}</svg></span>
      <div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
      <Link href={href} className="dx-more">{tx("Open →")}</Link>
    </header>
  );
};
const accentStyle = (title: string) => ({ ['--ac' as string]: ACCENT[title]?.c ?? '#0b5d3b' });
const Clear = ({ text }: { text: string }) => (
  <li className="dk-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg><span>{text}</span></li>
);

function Desk(p: { col?: boolean; title: string; desc: string; href: string; tiles: Tile[]; leftTitle: string; left: ReactNode; rightTitle: string; rows: Row[]; empty: string; loading?: boolean }) {
  if (p.col) {
    return (
      <section className="card dx-card dk-col" style={accentStyle(p.title)}>
        <Head title={p.title} desc={p.desc} href={p.href} />
        <div className="dk-tiles" data-n={p.tiles.length}>
          {p.tiles.map((t) => (
            <Link key={t.label} href={t.href} className={`dk-tile${t.hot ? ' hot' : ''}`} title={t.hint}>
              <strong>{p.loading || t.value === null ? '—' : t.value}</strong><span>{t.label}</span>
            </Link>
          ))}
        </div>
        <div className="dk-sum"><h3>{p.leftTitle}</h3>{p.left}</div>
        <div className="dk-listbox">
          <h3>{p.rightTitle}</h3>
          <ul className="dk-rows">
            {p.rows.map((r, i) => <li key={i}><span className={`fx2-pill ${r.tone ?? 'warn'}`}>{r.pill}</span><span>{r.text}</span></li>)}
            {!p.loading && p.rows.length === 0 && <Clear text={p.empty} />}
          </ul>
        </div>
        <footer><span><b>{p.rows.length}</b> {tx("in the list")}</span><Link href={p.href}>{tx("Open")} {p.title.toLowerCase()}</Link></footer>
      </section>
    );
  }
  return (
    <article className="card command-card dx-events dk">
      <div className="command-card-head">
        <div><h2>{p.title}</h2><p>{p.desc}</p></div>
        <Link href={p.href} className="dx-more">{tx("Open")} {p.title.toLowerCase()} →</Link>
      </div>
      <div className="event-desk">
        <div className="event-desk-tiles">
          {p.tiles.map((t) => (
            <Link key={t.label} href={t.href} className={`event-desk-tile${t.hot ? ' hot' : ''}`}>
              <strong>{p.loading || t.value === null ? '—' : t.value}</strong>
              <span>{t.label}</span>
              <small>{t.hint}</small>
            </Link>
          ))}
        </div>
        <div className="event-desk-cols">
          <div className="event-desk-box">
            <h3>{p.leftTitle}</h3>
            {p.left}
            <Link href={p.href} className="dash-link">{tx("Open →")}</Link>
          </div>
          <div className="event-desk-box">
            <h3>{p.rightTitle}</h3>
            <ul className="event-desk-list">
              {p.rows.map((r, i) => (
                <li key={i}><span className={`fx2-pill ${r.tone ?? 'warn'}`}>{r.pill}</span><span>{r.text}</span></li>
              ))}
              {!p.loading && p.rows.length === 0 && <li className="event-desk-empty">{p.empty}</li>}
            </ul>
          </div>
        </div>
      </div>
    </article>
  );
}

const day = 24 * 3600 * 1000;
const dateOf = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (ms: number, now: number) => { const d = Math.max(0, now - ms); return d < 3600000 ? `${Math.max(1, Math.round(d / 60000))} min ago` : d < day ? `${Math.round(d / 3600000)} h ago` : `${Math.round(d / day)} d ago`; };
const money = (c: number) => formatMoney(c, undefined, 'en-US');
const Big = ({ children }: { children: ReactNode }) => <p className="event-desk-big">{children}</p>;

/* ---------- Disciplinary council ---------- */
const CASE_LABEL: Record<string, string> = { open: 'Open', hearing_requested: 'Hearing Requested', vote_required: 'Vote Required', escalated: 'Escalated' };
export function DisciplinaryDesk({ now }: { now: number }) {
  const { byId } = useGroupHierarchy();
  const cases = useCollection<{ memberName: string; groupId: string; reason: string; status: string; openedAt?: unknown }>('disciplinaryCases', []);
  const d = useMemo(() => {
    const all = cases ?? [];
    const open = all.filter((c) => c.status !== 'resolved').sort((a, b) => tsMs(b.openedAt) - tsMs(a.openedAt));
    return { open, hearings: open.filter((c) => c.status === 'hearing_requested'), voting: open.filter((c) => c.status === 'vote_required'), escalated: open.filter((c) => c.status === 'escalated'), resolved: all.filter((c) => c.status === 'resolved').length };
  }, [cases]);
  const first = d.open[0];
  const agoLong = (ms: number) => { const n = Math.max(0, Math.round((now - ms) / day)); return n === 0 ? tx("today") : `${n} ${n === 1 ? tx("day") : tx("days")} ${tx("ago")}`; };
  const label = (st: string) => tx(CASE_LABEL[st] ?? st);
  const href = '/dashboard/disciplinary#cases';
  const tiles = [
    { cls: 'g', icon: <FolderOpen size={26} />, n: d.open.length, t: tx("Open Cases"), h: tx("Not closed yet") },
    { cls: 'b', icon: <Users size={26} />, n: d.hearings.length, t: tx("Hearings Requested"), h: tx("Members asking to be heard") },
    { cls: 'a', icon: <Vote size={26} />, n: d.voting.length, t: tx("Waiting for a Vote"), h: tx("Council votes needed") },
    { cls: 'p', icon: <Upload size={26} />, n: d.escalated.length, t: tx("Escalated"), h: tx("Sent to the national direction") },
    { cls: 'r', icon: <CheckCircle2 size={26} />, n: d.resolved, t: tx("Resolved"), h: tx("Closed cases") },
  ];
  return (
    <section className="dc2">
      <header className="dc2-h">
        <i aria-hidden><Scale size={30} /></i>
        <div><h2>{tx("Disciplinary Council")}</h2><p>{tx("Cases that wait for a hearing, a vote or a decision")}</p></div>
        <Link href="/dashboard/disciplinary" className="dc2-open">{tx("Open Disciplinary Council")} <ArrowRight size={17} aria-hidden /></Link>
      </header>
      <div className="dc2-tiles">
        {tiles.map((t) => (
          <Link key={t.t} href={href} className={`dc2-tile ${t.cls}`}>
            <i aria-hidden>{t.icon}</i>
            <span><strong>{cases === null ? '—' : t.n}</strong><b>{t.t}</b><small>{t.h}</small></span>
          </Link>
        ))}
      </div>
      <div className="dc2-cols">
        <article className="dc2-box">
          <h3><FileText size={22} aria-hidden />{tx("Latest Case")}</h3>
          <div className="dc2-body">
            {first ? (<>
              <h4>{first.memberName}</h4>
              <p><Users size={18} aria-hidden /> <span>{byId[first.groupId]?.name ?? tx("A kurel")}</span> <u>·</u> <em className="dc2-pill">{label(first.status)}</em></p>
              <p><Gavel size={18} aria-hidden /> <span>{first.reason || tx("No reason written")}</span></p>
              <p><CalendarDays size={18} aria-hidden /> <span>{tx("Opened")} {agoLong(tsMs(first.openedAt))}</span></p>
              <Link href={href} className="dc2-case">{tx("Open Case")} <ArrowRight size={17} aria-hidden /></Link>
            </>) : <p className="dc2-empty">{cases === null ? tx("Loading…") : tx("No open case. Nothing is waiting for the council.")}</p>}
          </div>
        </article>
        <article className="dc2-box">
          <h3><Bell size={22} aria-hidden />{tx("Needs Your Attention")}</h3>
          <ul className="dc2-rows">
            {d.open.slice(0, 5).map((c, i) => (
              <li key={i}><Link href={href}><em className={`dc2-pill ${c.status === 'vote_required' || c.status === 'escalated' ? 'red' : ''}`}>{label(c.status)}</em><span><b>{c.memberName}</b> {tx("of")} {byId[c.groupId]?.name ?? tx("a kurel")}, {tx("opened")} {agoLong(tsMs(c.openedAt))}</span><ChevronRight size={18} aria-hidden /></Link></li>
            ))}
            {cases !== null && d.open.length === 0 && <li className="dc2-empty">{tx("Every case is closed.")}</li>}
          </ul>
        </article>
      </div>
    </section>
  );
}

export function FinanceDesk() {
  const { byId } = useGroupHierarchy();
  const programs = useCollection<{ name: string; goalAmountCents: number; status: string }>('financialPrograms', []);
  const contribs = useCollection<{ programId: string; groupId: string; userName: string; amountCents: number; status: string; method: string }>('contributions', []);
  const d = useMemo(() => {
    const open = (programs ?? []).filter((p) => p.status === 'open');
    const openIds = new Set(open.map((p) => p.id));
    const mine = (contribs ?? []).filter((c) => openIds.has(c.programId));
    const validated = mine.filter((c) => c.status === 'validated');
    const sum = (a: { amountCents: number }[]) => a.reduce((n, c) => n + (Number(c.amountCents) || 0), 0);
    const goal = open.reduce((n, p) => n + (Number(p.goalAmountCents) || 0), 0);
    const collected = sum(validated);
    const review = (contribs ?? []).filter((c) => c.status === 'pending_review');
    return { open, review, reviewTotal: sum(review), collected, goal, rate: goal ? Math.round((collected / goal) * 100) : 0, rejected: (contribs ?? []).filter((c) => c.status === 'rejected').length, main: open[0], mainCollected: open[0] ? sum(validated.filter((c) => c.programId === open[0].id)) : 0 };
  }, [programs, contribs]);
  return (
    <Desk col title={tx("Finance")} desc="Collections, contributions and what is still to validate" href="/dashboard/donations" loading={programs === null || contribs === null}
      tiles={[
        { label: tx("Open collections"), value: d.open.length, hint: tx("still collecting"), href: '/dashboard/donations' },
        { label: tx("To validate"), value: d.review.length, hint: `${money(d.reviewTotal)} waiting`, href: '/dashboard/donations', hot: d.review.length > 0 },
        { label: tx("Collected"), value: money(d.collected), hint: tx("validated, open collections"), href: '/dashboard/donations' },
        { label: tx("Goal reached"), value: `${d.rate}%`, hint: d.goal ? `of ${money(d.goal)}` : tx("no goal set"), href: '/dashboard/donations' },
        { label: tx("Rejected"), value: d.rejected, hint: tx("contributions refused"), href: '/dashboard/donations' },
      ]}
      leftTitle="Main collection"
      left={d.main ? (<><Big>{d.main.name}</Big><p>{money(d.mainCollected)} {tx("collected")}{d.main.goalAmountCents ? ` of ${money(Number(d.main.goalAmountCents))}` : ''}</p><div className="dk-bar"><i style={{ width: `${d.main.goalAmountCents ? Math.min(100, Math.round((d.mainCollected / Number(d.main.goalAmountCents)) * 100)) : 0}%` }} /></div></>) : <p className="event-desk-empty">{tx("No collection is open. Start one from the finance page.")}</p>}
      rightTitle="Needs your attention"
      rows={d.review.slice(0, 5).map((c) => ({ pill: 'Validate', text: <><strong>{c.userName || tx("A member")}</strong> {tx("of")} {byId[c.groupId]?.name ?? tx("a kurel")} {tx("sent")} {money(Number(c.amountCents) || 0)}</> }))}
      empty={tx("No contribution is waiting for validation.")} />
  );
}

/* ---------- Logistics management ---------- */
const STAGE_LABEL: Record<string, string> = { admin_review: 'Administration', national_review: 'National', city_review: 'City', group_review: 'Kurel' };
export function LogisticsDesk() {
  const { byId } = useGroupHierarchy();
  const reqs = useCollection<{ groupId: string; itemsDescription: string; stage: string; neededAt?: unknown }>('resourceRequests', []);
  const items = useCollection<{ name: string; status: string; quantityAvailable?: number }>('equipment', []);
  const d = useMemo(() => {
    const all = reqs ?? [];
    const pending = all.filter((r) => String(r.stage).endsWith('_review')).sort((a, b) => (tsMs(a.neededAt) || Infinity) - (tsMs(b.neededAt) || Infinity));
    const active = (items ?? []).filter((i) => i.status !== 'retired');
    return { pending, approved: all.filter((r) => r.stage === 'approved').length, rejected: all.filter((r) => r.stage === 'rejected').length, catalog: active.length, low: active.filter((i) => typeof i.quantityAvailable === 'number' && i.quantityAvailable <= 2) };
  }, [reqs, items]);
  const first = d.pending[0];
  return (
    <Desk col title={tx("Logistics management")} desc="Equipment requests and stock" href="/dashboard/logistics" loading={reqs === null || items === null}
      tiles={[
        { label: tx("Requests to decide"), value: d.pending.length, hint: tx("waiting for an answer"), href: '/dashboard/logistics', hot: d.pending.length > 0 },
        { label: tx("Approved"), value: d.approved, hint: tx("delivery created"), href: '/dashboard/logistics' },
        { label: tx("Rejected"), value: d.rejected, hint: 'closed', href: '/dashboard/logistics' },
        { label: tx("Catalog items"), value: d.catalog, hint: tx("in use"), href: '/dashboard/logistics' },
        { label: tx("Low stock"), value: d.low.length, hint: tx("2 or fewer left"), href: '/dashboard/logistics', hot: d.low.length > 0 },
      ]}
      leftTitle="Next request to decide"
      left={first ? (<><Big>{first.itemsDescription || tx("Equipment")}</Big><p>{byId[first.groupId]?.name ?? tx("A kurel")} {tx("· with")} <strong>{STAGE_LABEL[first.stage] ?? tx("review")}</strong></p><p>{tsMs(first.neededAt) ? `Needed by ${new Date(tsMs(first.neededAt)).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })}` : tx("No date given")}</p></>) : <p className="event-desk-empty">{tx("No request is waiting.")}</p>}
      rightTitle="Needs your attention"
      rows={[...d.pending.slice(0, 4).map((r) => ({ pill: 'Decide', text: <><strong>{r.itemsDescription || tx("Equipment")}</strong> {tx("for")} {byId[r.groupId]?.name ?? tx("a kurel")}</> })), ...d.low.slice(0, 3).map((i) => ({ pill: 'Low stock', tone: 'bad' as const, text: <><strong>{i.name}</strong>: {i.quantityAvailable} {tx("left")}</> }))]}
      empty={tx("Every request is answered and stock is fine.")} />
  );
}

/* ---------- Member welfare ---------- */
export function WelfareDesk({ now }: { now: number }) {
  const { byId } = useGroupHierarchy();
  const welfare = useCollection<{ groupId: string; status: string; beneficiary?: string; collectedCents?: number; spentCents?: number; createdAt?: unknown }>('welfareRequests', []);
  const absences = useCollection<{ status: string }>('absenceRequests', [where('status', '==', 'pending')]);
  const events = useCollection<{ status: string }>('eventRequests', [where('status', '==', 'pending')]);
  const d = useMemo(() => {
    const w = welfare ?? [];
    const fresh = w.filter((x) => x.status === 'new').sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    const sum = (k: 'collectedCents' | 'spentCents') => w.filter((x) => x.status !== 'closed').reduce((n, x) => n + (Number(x[k]) || 0), 0);
    return { fresh, local: w.filter((x) => x.status === 'in_progress').length, escalated: w.filter((x) => x.status === 'escalated'), collected: sum('collectedCents'), spent: sum('spentCents') };
  }, [welfare]);
  return (
    <Desk col title={tx("Social")} desc="Help requests, absences and event requests" href="/dashboard/requests" loading={welfare === null}
      tiles={[
        { label: tx("New welfare cases"), value: d.fresh.length, hint: tx("not taken yet"), href: '/dashboard/requests#all-requests', hot: d.fresh.length > 0 },
        { label: tx("Handled locally"), value: d.local, hint: tx("in progress"), href: '/dashboard/requests#all-requests' },
        { label: tx("Escalated"), value: d.escalated.length, hint: tx("sent up to you"), href: '/dashboard/requests#all-requests', hot: d.escalated.length > 0 },
        { label: tx("Absence requests"), value: absences === null ? null : absences.length, hint: tx("waiting for an answer"), href: '/dashboard/requests#all-requests', hot: (absences?.length ?? 0) > 0 },
        { label: tx("Event requests"), value: events === null ? null : events.length, hint: tx("waiting for an answer"), href: '/dashboard/requests#all-requests', hot: (events?.length ?? 0) > 0 },
      ]}
      leftTitle="Welfare funds"
      left={<><Big>{money(d.collected)} {tx("collected")}</Big><p>{money(d.spent)} {tx("spent on open cases")}</p><p>{money(Math.max(0, d.collected - d.spent))} {tx("still available")}</p></>}
      rightTitle="Needs your attention"
      rows={[...d.escalated.slice(0, 3).map((x) => ({ pill: 'Escalated', tone: 'bad' as const, text: <><strong>{x.beneficiary || tx("A member")}</strong> {tx("of")} {byId[x.groupId]?.name ?? tx("a kurel")}</> })), ...d.fresh.slice(0, 4).map((x) => ({ pill: 'New', text: <><strong>{x.beneficiary || tx("A member")}</strong> {tx("of")} {byId[x.groupId]?.name ?? tx("a kurel")}{tx(", sent")} {ago(tsMs(x.createdAt), now)}</> }))]}
      empty={tx("No welfare case is waiting.")} />
  );
}

/* ---------- Attendance report ---------- */
export function AttendanceDesk() {
  const weekStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }, []);
  const f = (s: string): [string, '==' | '>=', unknown][] => [['status', '==', s], ['serverTimestamp', '>=', weekStart]];
  const present = useCount('attendance', f('PRESENT'), 60000);
  const late = useCount('attendance', f('LATE'), 60000);
  const excused = useCount('attendance', f('EXCUSED'), 60000);
  const unexcused = useCount('attendance', f('UNEXCUSED'), 60000);
  const all = present === null || late === null || excused === null || unexcused === null ? null : present + late + excused + unexcused;
  const pct = (n: number | null) => (all && n !== null ? Math.round((n / all) * 100) : 0);
  const rate = all ? Math.round((((present ?? 0) + (late ?? 0)) / all) * 100) : null;
  return (
    <Desk col title={tx("Attendance report")} desc="This week, Monday until now" href="/dashboard/reports" loading={all === null}
      tiles={[
        { label: tx("Present"), value: present, hint: tx("on time"), href: '/dashboard/reports' },
        { label: tx("Late"), value: late, hint: tx("arrived after the start"), href: '/dashboard/reports', hot: (late ?? 0) > 0 },
        { label: tx("Excused"), value: excused, hint: tx("absent with a reason"), href: '/dashboard/reports' },
        { label: tx("No show"), value: unexcused, hint: tx("absent without a reason"), href: '/dashboard/reports', hot: (unexcused ?? 0) > 0 },
        { label: tx("Attendance rate"), value: rate === null ? null : `${rate}%`, hint: tx("present or late"), href: '/dashboard/reports' },
      ]}
      leftTitle="This week"
      left={<><Big>{all ?? '—'} {tx("marks recorded")}</Big><div className="dk-stack"><i className="ok" style={{ width: `${pct(present)}%` }} /><i className="warn" style={{ width: `${pct(late)}%` }} /><i className="info" style={{ width: `${pct(excused)}%` }} /><i className="bad" style={{ width: `${pct(unexcused)}%` }} /></div><p>{pct(present)}{tx("% present ·")} {pct(late)}{tx("% late ·")} {pct(excused)}{tx("% excused ·")} {pct(unexcused)}{tx("% no show")}</p></>}
      rightTitle="Needs your attention"
      rows={[...((unexcused ?? 0) > 0 ? [{ pill: 'No show', tone: 'bad' as const, text: <><strong>{unexcused}</strong> {tx("member mark")}{unexcused === 1 ? '' : 's'} {tx("absent without a reason this week")}</> }] : []), ...((late ?? 0) > 0 ? [{ pill: 'Late', text: <><strong>{late}</strong> {tx("arrival")}{late === 1 ? '' : 's'} {tx("after the start this week")}</> }] : [])]}
      empty={tx("No absence or late arrival this week.")} />
  );
}

/* ---------- Rehearsals ---------- */
export function RehearsalsDesk({ now }: { now: number }) {
  const { byId } = useGroupHierarchy();
  const rows = useCollection<{ title: string; status: string; startAt: unknown; endAt: unknown; subGroupIds: string[]; location?: { address?: string } }>('events', [where('kind', '==', 'rehearsal')]);
  const d = useMemo(() => {
    const all = (rows ?? []).filter((e) => e.status !== 'cancelled').map((e) => ({ ...e, s: tsMs(e.startAt), e: tsMs(e.endAt) }));
    const upcoming = all.filter((e) => e.status === 'published' && e.s > now).sort((a, b) => a.s - b.s);
    const sameDay = (ms: number) => new Date(ms).toDateString() === new Date(now).toDateString();
    return { upcoming, today: all.filter((e) => e.status === 'published' && sameDay(e.s)).length, live: all.filter((e) => e.status === 'published' && e.s <= now && e.e >= now).length, week: upcoming.filter((e) => e.s - now <= 7 * day).length, drafts: all.filter((e) => e.status === 'draft').length, done: all.filter((e) => e.status === 'published' && e.e < now).length };
  }, [rows, now]);
  const next = d.upcoming[0];
  return (
    <Desk col title={tx("Rehearsals")} desc="Rehearsals that run, are coming up or still to publish" href="/dashboard/rehearsals" loading={rows === null}
      tiles={[
        { label: tx("In progress"), value: d.live, hint: tx("rehearsals on now"), href: '/dashboard/rehearsals' },
        { label: tx("Today"), value: d.today, hint: tx("rehearsals today"), href: '/dashboard/rehearsals' },
        { label: tx("Upcoming"), value: d.week, hint: tx("in the next 7 days"), href: '/dashboard/rehearsals' },
        { label: tx("Drafts"), value: d.drafts, hint: tx("not published yet"), href: '/dashboard/rehearsals', hot: d.drafts > 0 },
        { label: tx("Finished"), value: d.done, hint: tx("already held"), href: '/dashboard/rehearsals' },
      ]}
      leftTitle="Next rehearsal"
      left={next ? (<><Big>{next.title}</Big><p>{dateOf(next.s)}</p><p>{next.subGroupIds.length} {tx("kurel")}{next.subGroupIds.length === 1 ? '' : 's'}{next.location?.address ? ` · ${next.location.address}` : ''}</p></>) : <p className="event-desk-empty">{tx("No rehearsal is coming up.")}</p>}
      rightTitle="Coming up"
      rows={d.upcoming.slice(0, 5).map((e) => ({ pill: 'Upcoming', tone: 'ok' as const, text: <><strong>{e.title}</strong>, {dateOf(e.s)} · {e.subGroupIds.map((g) => byId[g]?.name).filter(Boolean).slice(0, 2).join(', ') || tx("no kurel")}</> }))}
      empty={tx("No rehearsal is planned.")} />
  );
}

/* ---------- Local zones ---------- */
export function LocalZonesDesk() {
  const { groups, byId, cities } = useGroupHierarchy();
  const zones = useCollection<{ name: string; cityId: string; active: boolean }>('localZones', []);
  const d = useMemo(() => {
    const z = zones ?? [];
    const kurels = groups.filter((g) => g.type === 'group' && g.status === 'active');
    const placed = kurels.filter((g) => g.localZoneId);
    const perZone = new Map<string, number>();
    placed.forEach((g) => perZone.set(g.localZoneId as string, (perZone.get(g.localZoneId as string) ?? 0) + 1));
    const biggest = z.map((x) => ({ z: x, n: perZone.get(x.id) ?? 0 })).sort((a, b) => b.n - a.n)[0];
    const zoneCities = new Set(z.map((x) => x.cityId));
    const loose = new Map<string, number>();
    kurels.filter((g) => !g.localZoneId && zoneCities.has(g.parentGroupId ?? '')).forEach((g) => loose.set(g.parentGroupId as string, (loose.get(g.parentGroupId as string) ?? 0) + 1));
    return { total: z.length, active: z.filter((x) => x.active).length, placed: placed.length, unplaced: kurels.length - placed.length, citiesWith: zoneCities.size, biggest, loose: Array.from(loose.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }, [zones, groups]);
  return (
    <Desk col title={tx("Local zones")} desc="Areas inside a city and the kurels placed in them" href="/dashboard/local-zones" loading={zones === null}
      tiles={[
        { label: tx("Active zones"), value: d.active, hint: `${d.total - d.active} switched off`, href: '/dashboard/local-zones' },
        { label: tx("Cities with zones"), value: d.citiesWith, hint: `of ${cities.length} cities`, href: '/dashboard/local-zones' },
        { label: tx("Kurels placed"), value: d.placed, hint: tx("in a local zone"), href: '/dashboard/local-zones' },
        { label: tx("Kurels without a zone"), value: d.unplaced, hint: tx("not placed yet"), href: '/dashboard/local-zones', hot: d.unplaced > 0 },
        { label: tx("Zones in total"), value: d.total, hint: tx("active and off"), href: '/dashboard/local-zones' },
      ]}
      leftTitle="Biggest zone"
      left={d.biggest ? (<><Big>{d.biggest.z.name}</Big><p>{byId[d.biggest.z.cityId]?.name ?? tx("A city")}</p><p><strong>{d.biggest.n}</strong> {tx("kurel")}{d.biggest.n === 1 ? '' : 's'} {tx("placed in it")}</p></>) : <p className="event-desk-empty">{tx("No local zone yet. Draw the first one on the map.")}</p>}
      rightTitle="Needs your attention"
      rows={d.loose.map(([cityId, n]) => ({ pill: 'Place', text: <><strong>{n}</strong> {tx("kurel")}{n === 1 ? '' : 's'} {tx("of")} {byId[cityId]?.name ?? tx("a city")} {tx("not placed in a zone yet")}</> }))}
      empty={tx("Every kurel of a city with zones is placed.")} />
  );
}

/* ---------- The other sections: three columns, each with three tiles and a short list ---------- */
function Mini(p: { title: string; href: string; tiles: { label: string; value: string | number | null; hot?: boolean }[]; listTitle: string; rows: ReactNode[]; empty: string; loading?: boolean }) {
  return (
    <section className="card dx-card dk-col" style={accentStyle(p.title)}>
      <Head title={p.title} href={p.href} />
      <div className="dk-tiles" data-n={p.tiles.length}>
        {p.tiles.map((t) => <Link key={t.label} href={p.href} className={`dk-tile${t.hot ? ' hot' : ''}`}><strong>{p.loading || t.value === null ? '—' : t.value}</strong><span>{t.label}</span></Link>)}
      </div>
      <div className="dk-listbox">
        <h3>{p.listTitle}</h3>
        <ul className="dk-rows">{p.rows.map((r, i) => <li key={i}>{r}</li>)}{!p.loading && p.rows.length === 0 && <Clear text={p.empty} />}</ul>
      </div>
      <footer><span><b>{p.rows.length}</b> {tx("shown")}</span><Link href={p.href}>{tx("Open")} {p.title.toLowerCase()}</Link></footer>
    </section>
  );
}

export function OtherSections({ now, registrations, phoneChanges }: { now: number; registrations: number | null; phoneChanges: number | null }) {
  const tracks = useCollection<{ title: string; qacaidTitle?: string; melodyLabel?: string; status: string }>('audioTracks', []);
  const meetings = useCollection<{ title: string; status: string; startAt?: unknown; actions?: { status: string }[] }>('meetings', []);
  const news = useCollection<{ title: string; recipientCount: number; createdAt?: unknown }>('announcements', []);
  const audio = useMemo(() => { const t = tracks ?? []; return { pending: t.filter((x) => x.status === 'pending'), approved: t.filter((x) => x.status === 'approved').length, total: t.length }; }, [tracks]);
  const adm = useMemo(() => { const m = (meetings ?? []).filter((x) => x.status !== 'completed' && x.status !== 'cancelled').sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt)); return { upcoming: m, open: (meetings ?? []).reduce((n, x) => n + (x.actions ?? []).filter((a) => a.status === 'open').length, 0) }; }, [meetings]);
  const msg = useMemo(() => { const n = [...(news ?? [])].sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)); return { latest: n, week: n.filter((x) => now - tsMs(x.createdAt) <= 7 * day).length, reach: n[0]?.recipientCount ?? 0 }; }, [news, now]);
  return (
    <div className="dx-grid dk-row">
      <Mini title={tx("Audio and archives")} href="/dashboard/audio" loading={tracks === null}
        tiles={[{ label: tx("To validate"), value: audio.pending.length, hot: audio.pending.length > 0 }, { label: tx("Approved archive"), value: audio.approved }, { label: tx("All recordings"), value: audio.total }]}
        listTitle="Waiting for validation" empty={tx("Every recording is validated.")}
        rows={audio.pending.slice(0, 5).map((t) => <><span className="fx2-pill warn">{tx("Validate")}</span><span><strong>{t.qacaidTitle ?? t.title}</strong>{t.melodyLabel ? `, ${t.melodyLabel}` : ''}</span></>)} />
      <Mini title={tx("Administration")} href="/dashboard/approvals" loading={meetings === null}
        tiles={[{ label: tx("Upcoming meetings"), value: adm.upcoming.length }, { label: tx("Open follow-ups"), value: adm.open, hot: adm.open > 0 }, { label: tx("Registrations"), value: registrations, hot: (registrations ?? 0) > 0 }]}
        listTitle={`Next meetings${phoneChanges ? ` · ${phoneChanges} phone change${phoneChanges === 1 ? '' : 's'} waiting` : ''}`} empty={tx("No meeting is planned.")}
        rows={adm.upcoming.slice(0, 5).map((m) => <><span className="fx2-pill ok">{m.status === 'in_progress' ? tx("Now") : tx("Planned")}</span><span><strong>{m.title}</strong>, {dateOf(tsMs(m.startAt))}</span></>)} />
      <Mini title={tx("Announcements")} href="/dashboard/announcements" loading={news === null}
        tiles={[{ label: tx("Sent"), value: msg.latest.length }, { label: tx("This week"), value: msg.week }, { label: tx("Last reached"), value: msg.reach }]}
        listTitle="Latest announcements" empty={tx("No announcement sent yet.")}
        rows={msg.latest.slice(0, 5).map((n, i) => <><span className="fx2-pill ok">{ago(tsMs(n.createdAt), now)}</span><span key={i}><strong>{n.title}</strong>, {n.recipientCount} {tx("reached")}</span></>)} />
    </div>
  );
}

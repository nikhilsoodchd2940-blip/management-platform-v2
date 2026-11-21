'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEventAttendance, markAttendance, reviewLateArrival, type AttendanceGroup, type AttendanceMember, type AttendanceState, type EventAttendance } from '@/lib/functions';
import { Avatar } from '@/components/MemberPicker';
import { downloadCsv } from '@/lib/download';
import { notify } from '@/lib/notify';
import { tx, dateLocale } from '@/lib/i18n/tr';

const hm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '');
const LABEL: Record<AttendanceState, string> = { PRESENT: 'Present', LATE: 'Late', LATE_APPROVED: 'Late, approved', PENDING: 'Waiting for approval', ABSENT: 'Absent', EXCUSED: 'Excused', NONE: 'No show' };
const CLS: Record<AttendanceState, string> = { PRESENT: 'p', LATE: 'l', LATE_APPROVED: 'a', PENDING: 'w', ABSENT: 'x', EXCUSED: 'x', NONE: 'n' };

export function Tick({ state, size = 22 }: { state: AttendanceState; size?: number }) {
  return (
    <svg className={`at-tick ${CLS[state]}`} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={LABEL[state]}>
      <circle cx="12" cy="12" r="11" />
      {state === 'NONE' ? null : state === 'PENDING' ? <path d="M12 6v6l4 2" fill="none" /> : <path d="M6.5 12.5l3.6 3.6 7.4-8" fill="none" />}
    </svg>
  );
}

/**
 * The attendance of the people who perform: who arrived, who is late, who waits for approval and who is absent,
 * group by group, with the problems to look at first. Used by the supervisors and by the administration.
 */
export default function AttendancePanel({ eventId, title }: { eventId: string; title?: string }) {
  const [d, setD] = useState<EventAttendance | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | AttendanceState | 'problems'>('all');
  const [group, setGroup] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    try { setD((await getEventAttendance({ eventId })).data); setErr(''); } catch (e) { const m = e instanceof Error ? e.message : ''; setErr(!m || /^(internal|not-found|unavailable|failed-precondition)$/i.test(m.trim()) ? tx("The attendance service did not answer. It usually means the latest Firebase functions have not been deployed yet, or an index is still building.") : m); }
  }, [eventId]);
  useEffect(() => { setD(null); void load(); const h = window.setInterval(() => void load(), 10000); return () => window.clearInterval(h); }, [load]);

  async function decide(userId: string, approve: boolean) {
    setBusy(userId);
    try { await reviewLateArrival({ eventId, userId, approve }); notify(approve ? 'Late arrival approved' : 'Marked absent', 'success'); await load(); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(''); }
  }
  async function mark(userId: string, status: 'PRESENT' | 'LATE' | 'UNEXCUSED' | 'EXCUSED') {
    setBusy(userId);
    try { await markAttendance({ eventId, userId, status }); notify('Saved', 'success'); await load(); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(''); }
  }

  async function bulk(status: 'PRESENT' | 'LATE' | 'UNEXCUSED' | 'EXCUSED') {
    const ids = [...sel];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const res = await Promise.allSettled(ids.map((userId) => markAttendance({ eventId, userId, status })));
    const bad = res.filter((r) => r.status === 'rejected').length;
    notify(bad ? `${ids.length - bad} saved, ${bad} could not be saved` : `${ids.length} member${ids.length > 1 ? 's' : ''} updated`, bad ? 'error' : 'success');
    setSel(new Set());
    setBulkBusy(false);
    await load();
  }
  const toggle = (ids: string[], on: boolean) => setSel((p) => { const n = new Set(p); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });

  const term = q.trim().toLowerCase();
  const groups = useMemo(() => (d?.groups ?? []).filter((g) => !group || g.groupId === group).map((g) => ({
    ...g,
    members: g.members.filter((m) => (!term || m.name.toLowerCase().includes(term)) && (only === 'all' || (only === 'problems' ? ['PENDING', 'ABSENT', 'NONE'].includes(m.state) && (m.state !== 'NONE' || g.status === 'in_progress' || g.status === 'ready') : m.state === only))),
  })).filter((g) => g.members.length > 0 || (!term && only === 'all')), [d, term, only, group]);

  if (err && !d) return (
    <div className="at-error" role="alert">
      <span aria-hidden>⚠</span>
      <div><b>{tx("Attendance could not be loaded")}</b><p>{err}</p></div>
      <button type="button" className="btn btn-secondary" onClick={() => void load()}>{tx("Try again")}</button>
    </div>
  );
  if (!d) return <p className="fx3-note">{tx("Loading the attendance…")}</p>;
  const t = d.totals;
  const pct = (n: number) => (t.total ? (n / t.total) * 100 : 0);
  const cards: { k: AttendanceState; n: number; l: string }[] = [
    { k: 'PRESENT', n: t.present, l: 'Present' }, { k: 'LATE', n: t.late, l: 'Late' }, { k: 'LATE_APPROVED', n: t.lateApproved, l: 'Late, approved' },
    { k: 'ABSENT', n: t.absent, l: 'Absent' }, { k: 'PENDING', n: t.pending, l: 'Waiting for approval' }, { k: 'NONE', n: t.notYet, l: 'No show' },
  ];
  const pending = d.conflicts.filter((c) => c.kind === 'pending');
  const others = d.conflicts.filter((c) => c.kind !== 'pending');

  const rowOf = (g: AttendanceGroup, m: AttendanceMember) => (
    <li key={m.userId} className={`at-m s-${CLS[m.state]}${sel.has(m.userId) ? ' picked' : ''}${d.canDecide ? ' sel' : ''}`}>
      {d.canDecide && <input type="checkbox" className="at-cb" checked={sel.has(m.userId)} onChange={(e) => toggle([m.userId], e.target.checked)} aria-label={`Select ${m.name}`} />}
      <Avatar name={m.name} photoUrl={m.photoUrl} size={34} />
      <div className="at-n"><b>{m.name}</b><small><span className={`at-tag ${m.substitute ? 'sub' : 'perm'}`}>{m.substitute ? tx("Substitute") : tx("Permanent")}</span></small></div>
      <div className="at-s"><Tick state={m.state} /><span><b>{LABEL[m.state]}</b>{m.atMs ? <small>{tx("checked in")} {hm(m.atMs)}{m.minutesLate ? ` · ${m.minutesLate} min after the start` : ''}</small> : <small>{m.state === 'NONE' ? `performs at ${hm(g.startMs)}` : ''}</small>}</span></div>
      {d.canDecide && (
        <div className="at-act">
          {m.state === 'PENDING' ? (<>
            <button type="button" className="btn btn-primary" disabled={busy === m.userId} onClick={() => void decide(m.userId, true)}>{tx("Approve")}</button>
            <button type="button" className="btn btn-secondary danger" disabled={busy === m.userId} onClick={() => void decide(m.userId, false)}>{tx("Absent")}</button>
          </>) : (
            <details className="at-more"><summary>{tx("Change")}</summary><div>
              <button type="button" onClick={() => void mark(m.userId, 'PRESENT')}>{tx("Present")}</button>
              <button type="button" onClick={() => void mark(m.userId, 'LATE')}>{tx("Late")}</button>
              <button type="button" onClick={() => void mark(m.userId, 'EXCUSED')}>{tx("Excused")}</button>
              <button type="button" onClick={() => void mark(m.userId, 'UNEXCUSED')}>{tx("Absent")}</button>
            </div></details>
          )}
        </div>
      )}
    </li>
  );

  return (
    <div className="at">
      <div className="at-top">
        <p>{t.total} {tx("members perform. Check-in opens 60 minutes before a group performs. Present: at least 15 minutes before. Late: in the last 15 minutes before. Up to 15 minutes after the start a supervisor decides. After that: absent.")}</p>
        <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(`${title ?? 'event'} attendance`, [['Group', 'Place', 'Member', 'Tag', 'Status', 'Checked in', 'Minutes after start'], ...d.groups.flatMap((g) => g.members.map((m) => [g.groupName, g.place, m.name, m.substitute ? 'Substitute' : 'Permanent', LABEL[m.state], hm(m.atMs), m.minutesLate ?? '']))])}>{tx("Download")}</button>
      </div>

      <div className="at-cards">
        {cards.map((c) => (
          <button type="button" key={c.k} className={`at-card ${CLS[c.k]}${only === c.k ? ' on' : ''}`} onClick={() => setOnly(only === c.k ? 'all' : c.k)} aria-pressed={only === c.k}>
            <Tick state={c.k} size={26} /><b>{c.n}</b><span>{c.l}</span>
          </button>
        ))}
      </div>
      <div className="at-bar" aria-hidden="true">
        <i className="p" style={{ width: `${pct(t.present)}%` }} /><i className="l" style={{ width: `${pct(t.late)}%` }} /><i className="a" style={{ width: `${pct(t.lateApproved)}%` }} /><i className="w" style={{ width: `${pct(t.pending)}%` }} /><i className="x" style={{ width: `${pct(t.absent)}%` }} />
      </div>

      {pending.length > 0 && (
        <section className="at-alert">
          <h3>{pending.length} {tx("late arrival")}{pending.length === 1 ? '' : 's'} {tx("waiting for you")}</h3>
          <ul>{pending.map((c) => (
            <li key={c.key}><div><b>{c.name}</b><small>{c.groupName}. {c.detail}</small></div>
              {d.canDecide && <div className="at-act"><button type="button" className="btn btn-primary" disabled={busy === c.userId} onClick={() => void decide(c.userId, true)}>{tx("Approve")}</button><button type="button" className="btn btn-secondary danger" disabled={busy === c.userId} onClick={() => void decide(c.userId, false)}>{tx("Absent")}</button></div>}
            </li>))}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section className="at-alert red">
          <h3>{tx("Attendance conflicts")} <span>{others.length}</span></h3>
          <ul>{others.slice(0, 12).map((c) => <li key={c.key}><div><b>{c.name}</b><small>{c.groupName}. {c.detail}</small></div></li>)}</ul>
          {others.length > 12 && <small>{tx("and")} {others.length - 12} {tx("more")}</small>}
        </section>
      )}

      <div className="at-filters">
        <input type="search" placeholder={tx("Search a member")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Search a member")} />
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label={tx("Group")}><option value="">{tx("All groups")}</option>{d.groups.map((g) => <option key={g.groupId} value={g.groupId}>{g.groupName}</option>)}</select>
        <button type="button" className={`at-chip${only === 'problems' ? ' on' : ''}`} onClick={() => setOnly(only === 'problems' ? 'all' : 'problems')}>{tx("Only what needs attention")}</button>
        {(only !== 'all' || q || group) && <button type="button" className="at-chip" onClick={() => { setOnly('all'); setQ(''); setGroup(''); }}>{tx("Reset")}</button>}
      </div>

      {d.canDecide && (
        <div className={`at-bulk${sel.size ? ' on' : ''}`}>
          <label><input type="checkbox" className="at-cb" checked={groups.length > 0 && groups.every((g) => g.members.every((m) => sel.has(m.userId))) && sel.size > 0} onChange={(e) => toggle(groups.flatMap((g) => g.members.map((m) => m.userId)), e.target.checked)} /> {tx("Select everyone shown")}</label>
          <b>{sel.size ? `${sel.size} selected` : tx("Tick members to change their status all at once")}</b>
          <div>
            <button type="button" className="btn btn-primary" disabled={!sel.size || bulkBusy} onClick={() => void bulk('PRESENT')}>{tx("Present")}</button>
            <button type="button" className="btn btn-secondary" disabled={!sel.size || bulkBusy} onClick={() => void bulk('LATE')}>{tx("Late")}</button>
            <button type="button" className="btn btn-secondary" disabled={!sel.size || bulkBusy} onClick={() => void bulk('EXCUSED')}>{tx("Excused")}</button>
            <button type="button" className="btn btn-secondary danger" disabled={!sel.size || bulkBusy} onClick={() => void bulk('UNEXCUSED')}>{tx("Absent")}</button>
            {sel.size > 0 && <button type="button" className="at-chip" onClick={() => setSel(new Set())}>{tx("Clear")}</button>}
          </div>
        </div>
      )}

      {groups.length === 0 ? <p className="fx3-note">{tx("No member matches.")}</p> : groups.map((g) => {
        const isOpen = open[g.groupId] ?? (!!term || only !== 'all' || g.status === 'in_progress' || g.status === 'ready' || groups.length <= 3);
        return (
          <section key={g.groupId + g.startMs} className="at-g">
            <div className="at-ghw">
            {d.canDecide && <input type="checkbox" className="at-cb" checked={g.members.length > 0 && g.members.every((m) => sel.has(m.userId))} onChange={(e) => toggle(g.members.map((m) => m.userId), e.target.checked)} aria-label={`Select every member of ${g.groupName}`} />}
            <button type="button" className="at-gh" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.groupId]: !isOpen }))}>
              <span className="at-gt"><b>{g.groupName}</b><small>{hm(g.startMs)} {tx("to")} {hm(g.endMs)}{g.place ? ` · ${g.place}` : ''}</small></span>
              <span className="at-gc"><em className="p">{g.counts.present}</em><em className="l">{g.counts.late}</em><em className="a">{g.counts.lateApproved}</em><em className="w">{g.counts.pending}</em><em className="x">{g.counts.absent}</em><em className="n">{g.counts.notYet}</em></span>
              <i aria-hidden="true">{isOpen ? '▾' : '▸'}</i>
            </button>
            </div>
            {isOpen && <ul className="at-list">{g.members.map((m) => rowOf(g, m))}</ul>}
          </section>
        );
      })}
    </div>
  );
}

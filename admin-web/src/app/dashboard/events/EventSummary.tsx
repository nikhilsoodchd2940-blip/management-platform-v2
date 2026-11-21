'use client';

import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { downloadCsv } from '@/lib/download';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Row { id: string; group: string; place: string; plannedMs: number; endMs: number; startedMs?: number; endedMs?: number; status: string; delay: number; audio: string }
interface Data { rows: Row[]; attendance: Record<string, number>; invited: number; reports: number; resolved: number; log: { atMs: number; type: string; by: string; detail: string; group: string }[] }

const hm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '—');
const dt = (ms?: number) => (ms ? new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS: Record<string, string> = { completed: 'Performed', in_progress: 'On stage', cancelled: 'Did not perform', upcoming: 'Not marked', ready: 'Not marked', delayed: 'Not marked' };

/** What happened at the event: planned against real times, delays, attendance and reports, with Excel downloads. */
export default function EventSummary({ eventId, title }: { eventId: string; title: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const [sl, sel, lg, at, inv, msg] = await Promise.all([
        getDocs(query(collection(db, 'eventSlots'), where('eventId', '==', eventId))),
        getDocs(query(collection(db, 'performanceSelections'), where('eventId', '==', eventId))),
        getDocs(query(collection(db, 'eventLog'), where('eventId', '==', eventId))),
        getDocs(query(collection(db, 'attendance'), where('eventId', '==', eventId))),
        getDocs(query(collection(db, 'eventAttendees'), where('eventId', '==', eventId))),
        getDocs(query(collection(db, 'supervisorMessages'), where('eventId', '==', eventId))),
      ]);
      const audioOf = new Map<string, string>();
      sel.docs.forEach((s) => {
        const x = s.data() as { slotId?: string; status?: string; items?: { title?: string }[] };
        if (x.status === 'approved') audioOf.set(x.slotId ?? s.id, (x.items ?? []).map((i) => i.title).filter(Boolean).join(' · '));
      });
      const ms = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.();
      const rows: Row[] = sl.docs.map((s) => {
        const x = s.data() as Record<string, unknown>;
        const startMs = ms(x.startAt) ?? 0;
        const planned = ms(x.originalStartAt) ?? startMs;
        const status = (x.liveStatus as string) ?? (x.performanceStatus === 'completed' ? 'completed' : x.performanceStatus === 'started' ? 'in_progress' : 'upcoming');
        const started = ms(x.actualStartAt);
        return { id: s.id, group: (x.groupName as string) ?? '', place: '', plannedMs: planned, endMs: ms(x.endAt) ?? 0, startedMs: started, endedMs: ms(x.actualEndAt), status, delay: started ? Math.round((started - planned) / 60000) : 0, audio: audioOf.get(s.id) ?? '' };
      }).sort((a, b) => a.plannedMs - b.plannedMs);
      const attendance: Record<string, number> = {};
      at.docs.forEach((a) => { const k = String(a.data().status ?? ''); attendance[k] = (attendance[k] ?? 0) + 1; });
      const roots = msg.docs.filter((m) => m.data().handler !== undefined);
      setD({
        rows, attendance, invited: inv.size, reports: roots.length, resolved: roots.filter((m) => m.data().status === 'resolved').length,
        log: lg.docs.map((l) => { const x = l.data() as Record<string, unknown>; return { atMs: ms(x.at) ?? 0, type: (x.type as string) ?? '', by: (x.byName as string) ?? '', detail: (x.detail as string) ?? '', group: (x.groupName as string) ?? '' }; }).sort((a, b) => a.atMs - b.atMs),
      });
    } catch {
      setErr(tx("Could not load the summary."));
    }
  }, [eventId]);
  useEffect(() => { setD(null); void load(); }, [load]);

  if (err) return <p className="es-wait">{err} <button type="button" className="btn btn-secondary" onClick={() => void load()}>{tx("Try again")}</button></p>;
  if (!d) return <p className="es-wait">{tx("Loading the summary…")}</p>;

  const performed = d.rows.filter((r) => r.status === 'completed');
  const skipped = d.rows.filter((r) => r.status === 'cancelled');
  const open = d.rows.filter((r) => !['completed', 'cancelled'].includes(r.status));
  const onTime = performed.filter((r) => r.delay <= 5).length;
  const late = performed.filter((r) => r.delay > 5);
  const avgDelay = performed.length ? Math.round(performed.reduce((n, r) => n + Math.max(0, r.delay), 0) / performed.length) : 0;
  const present = (d.attendance.PRESENT ?? 0) + (d.attendance.LATE ?? 0);
  const absent = (d.attendance.EXCUSED ?? 0) + (d.attendance.UNEXCUSED ?? 0);

  const cards: { n: string | number; l: string; t?: string }[] = [
    { n: `${performed.length} of ${d.rows.length}`, l: 'Groups performed', t: performed.length === d.rows.length && d.rows.length > 0 ? 'good' : '' },
    { n: skipped.length, l: 'Did not perform', t: skipped.length ? 'bad' : '' },
    { n: open.length, l: 'Not marked', t: open.length ? 'warn' : '' },
    { n: performed.length ? `${Math.round((onTime / performed.length) * 100)}%` : '—', l: 'Started on time' },
    { n: performed.length ? `${avgDelay} min` : '—', l: 'Average delay' },
    { n: d.invited ? `${present} of ${d.invited}` : present, l: 'Members present' },
    { n: absent, l: 'Absent' },
    { n: `${d.resolved} of ${d.reports}`, l: 'Reports dealt with' },
  ];

  return (
    <div className="es">
      <div className="es-bar">
        <p>{tx("Everything that happened, from the live board and the attendance. It updates when you press Refresh.")}</p>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>{tx("Refresh")}</button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(`${title} schedule`, [['Group', 'Planned start', 'Planned end', 'Real start', 'Real end', 'Delay (min)', 'Result', 'Audio'], ...d.rows.map((r) => [r.group, dt(r.plannedMs), hm(r.endMs), hm(r.startedMs), hm(r.endedMs), r.delay, STATUS[r.status] ?? r.status, r.audio])])}>{tx("Download schedule")}</button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(`${title} history`, [['Time', 'Type', 'By', 'Group', 'What happened'], ...d.log.map((l) => [dt(l.atMs), l.type, l.by, l.group, l.detail])])}>{tx("Download history")}</button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(`${title} attendance`, [['Result', 'Members'], ['Present', d.attendance.PRESENT ?? 0], ['Late', d.attendance.LATE ?? 0], ['Excused', d.attendance.EXCUSED ?? 0], ['Absent', d.attendance.UNEXCUSED ?? 0], ['Invited', d.invited]])}>{tx("Download attendance")}</button>
        </div>
      </div>

      <div className="es-cards">
        {cards.map((c) => <div key={c.l} className={`es-card ${c.t ?? ''}`}><b>{c.n}</b><span>{c.l}</span></div>)}
      </div>

      {late.length > 0 && (
        <section className="es-sec">
          <h3>{tx("Started late")} <span className="fx2-pill warn">{late.length}</span></h3>
          <ul className="es-late">{late.sort((a, b) => b.delay - a.delay).slice(0, 8).map((r) => <li key={r.id}><b>{r.group}</b><span>{tx("planned")} {hm(r.plannedMs)}{tx(", started")} {hm(r.startedMs)}</span><em>{r.delay} {tx("min late")}</em></li>)}</ul>
        </section>
      )}

      <section className="es-sec">
        <h3>{tx("Group by group")}</h3>
        {d.rows.length === 0 ? <p className="es-wait">{tx("No performance time was set for this event.")}</p> : (
          <div className="es-table">
            <div className="es-th"><span>{tx("Group")}</span><span>{tx("Planned")}</span><span>{tx("Real times")}</span><span>{tx("Delay")}</span><span>{tx("Result")}</span><span>{tx("Books")}</span></div>
            {d.rows.map((r) => (
              <div key={r.id} className={`es-tr s-${r.status}`}>
                <b>{r.group}</b>
                <span>{dt(r.plannedMs)}</span>
                <span>{r.startedMs ? `${hm(r.startedMs)} to ${hm(r.endedMs)}` : '—'}</span>
                <span>{r.startedMs ? (r.delay > 0 ? `+${r.delay} min` : tx("On time")) : '—'}</span>
                <em>{STATUS[r.status] ?? r.status}</em>
                <span className="es-audio">{r.audio || tx("No audio")}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

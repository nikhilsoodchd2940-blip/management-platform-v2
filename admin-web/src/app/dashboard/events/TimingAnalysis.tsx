'use client';

import { useMemo, useState } from 'react';
import { formatInZone } from '@/lib/timeZones';
import type { Slot } from './LiveBoard';
import { tx, dateLocale } from '@/lib/i18n/tr';

const LIMIT = 5; // minutes: less than this counts as on time
const mins = (ms: number) => Math.round(ms / 60000);
const hm = (ms: number | undefined, tz?: string) => (ms ? (tz ? formatInZone(ms, tz, false) : new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })) : '—');
const dev = (m: number) => (Math.abs(m) < LIMIT ? 'On time' : `${Math.abs(m)} min ${m < 0 ? 'early' : 'late'}`);
const cls = (m: number | null) => (m === null ? 'na' : Math.abs(m) < LIMIT ? 'ok' : m < 0 ? 'early' : 'late');
const STATUS: Record<string, string> = { upcoming: 'Upcoming', ready: 'Ready', in_progress: 'In progress', completed: 'Completed', delayed: 'Delayed', cancelled: 'Cancelled' };

type Filter = 'all' | 'early' | 'late' | 'delayed' | 'cancelled' | 'open';

/** Planned time against real time for every performance of the event, with totals. */
export default function TimingAnalysis({ slots, eventTitle }: { slots: Slot[]; eventTitle?: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useMemo(() => slots.slice().sort((a, b) => a.startMs - b.startMs).map((s) => {
    const startDev = s.actualStartMs ? mins(s.actualStartMs - s.startMs) : null;
    const endDev = s.actualEndMs ? mins(s.actualEndMs - s.endMs) : null;
    const planned = mins(s.endMs - s.startMs);
    const real = s.actualStartMs && s.actualEndMs ? mins(s.actualEndMs - s.actualStartMs) : null;
    return { s, startDev, endDev, planned, real, moved: s.originalStartMs && s.originalStartMs !== s.startMs ? mins(s.startMs - s.originalStartMs) : 0 };
  }), [slots]);

  const sum = useMemo(() => {
    const started = rows.filter((r) => r.startDev !== null);
    const done = rows.filter((r) => r.s.status === 'completed');
    const delayed = rows.filter((r) => (r.s.delayMinutes ?? 0) > 0 || r.s.status === 'delayed');
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    return {
      total: rows.length,
      done: done.length,
      cancelled: rows.filter((r) => r.s.status === 'cancelled').length,
      open: rows.filter((r) => !['completed', 'cancelled'].includes(r.s.status)).length,
      onTime: started.filter((r) => Math.abs(r.startDev as number) < LIMIT).length,
      early: started.filter((r) => (r.startDev as number) <= -LIMIT).length,
      late: started.filter((r) => (r.startDev as number) >= LIMIT).length,
      endEarly: rows.filter((r) => r.endDev !== null && (r.endDev as number) <= -LIMIT).length,
      endLate: rows.filter((r) => r.endDev !== null && (r.endDev as number) >= LIMIT).length,
      delayedCount: delayed.length,
      delayMin: delayed.reduce((a, r) => a + (r.s.delayMinutes ?? 0), 0),
      avgStart: avg(started.map((r) => r.startDev as number)),
      avgOver: avg(done.map((r) => (r.real ?? r.planned) - r.planned)),
      moved: rows.filter((r) => r.moved !== 0).length,
    };
  }, [rows]);

  const shown = rows.filter((r) => {
    if (filter === 'early') return (r.startDev !== null && r.startDev <= -LIMIT) || (r.endDev !== null && r.endDev <= -LIMIT);
    if (filter === 'late') return (r.startDev !== null && r.startDev >= LIMIT) || (r.endDev !== null && r.endDev >= LIMIT);
    if (filter === 'delayed') return (r.s.delayMinutes ?? 0) > 0 || r.s.status === 'delayed';
    if (filter === 'cancelled') return r.s.status === 'cancelled';
    if (filter === 'open') return !['completed', 'cancelled'].includes(r.s.status);
    return true;
  });

  function exportCsv() {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Group', 'City', 'Status', 'Planned start', 'Planned end', 'Actual start', 'Actual end', 'Start difference (min)', 'End difference (min)', 'Planned length (min)', 'Real length (min)', 'Delay (min)', 'Delay reason'].map(q).join(',')];
    rows.forEach((r) => lines.push([r.s.groupName, r.s.cityName, STATUS[r.s.status] ?? r.s.status, hm(r.s.startMs, r.s.timeZone), hm(r.s.endMs, r.s.timeZone), hm(r.s.actualStartMs, r.s.timeZone), hm(r.s.actualEndMs, r.s.timeZone), r.startDev ?? '', r.endDev ?? '', r.planned, r.real ?? '', r.s.delayMinutes ?? '', r.s.delayReason ?? ''].map(q).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `${(eventTitle || 'event').replace(/[^\w-]+/g, '-')}-timing-analysis.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (rows.length === 0) return <p className="fx3-note">{tx("No performance is scheduled yet, so there is nothing to analyse.")}</p>;

  const tiles: { k: string; v: string | number; sub: string; tone?: string }[] = [
    { k: 'Performances', v: sum.total, sub: `${sum.done} done · ${sum.open} to come${sum.cancelled ? ` · ${sum.cancelled} cancelled` : ''}` },
    { k: 'Started on time', v: sum.onTime, sub: `within ${LIMIT} min of the plan`, tone: 'ok' },
    { k: 'Started early', v: sum.early, sub: `${sum.endEarly} finished early`, tone: 'early' },
    { k: 'Started late', v: sum.late, sub: `${sum.endLate} finished late`, tone: 'late' },
    { k: 'Delays reported', v: sum.delayedCount, sub: `${sum.delayMin} min in total`, tone: sum.delayedCount ? 'late' : '' },
    { k: 'Average start', v: sum.avgStart === 0 ? '0 min' : `${Math.abs(sum.avgStart)} min ${sum.avgStart < 0 ? 'early' : 'late'}`, sub: sum.done ? `length ${sum.avgOver > 0 ? '+' : ''}${sum.avgOver} min vs plan` : tx("no performance finished yet") },
  ];
  const chips: [Filter, string][] = [['all', `All ${rows.length}`], ['open', `Still to come ${sum.open}`], ['early', 'Early'], ['late', 'Late'], ['delayed', `Delayed ${sum.delayedCount}`], ['cancelled', `Cancelled ${sum.cancelled}`]];

  return (
    <div className="ta">
      <div className="ta-tiles">
        {tiles.map((t) => <div key={t.k} className={`ta-tile ${t.tone ?? ''}`}><span>{t.k}</span><b>{t.v}</b><small>{t.sub}</small></div>)}
      </div>
      {sum.moved > 0 && <p className="ta-note">{sum.moved} {tx("performance")}{sum.moved === 1 ? tx(" was") : tx("s were")} {tx("moved from the original schedule.")}</p>}
      <div className="ta-bar">
        <div className="ta-chips">{chips.map(([k, l]) => <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <button type="button" className="btn btn-secondary" onClick={exportCsv}>{tx("Download (CSV)")}</button>
      </div>
      <div className="ta-scroll">
        <table className="ta-table">
          <thead><tr><th>{tx("Group")}</th><th>{tx("Planned")}</th><th>{tx("Real")}</th><th>{tx("Start")}</th><th>{tx("End")}</th><th>{tx("Length")}</th><th>{tx("Status")}</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="ta-empty">{tx("Nothing matches this filter.")}</td></tr>}
            {shown.map((r) => (
              <tr key={r.s.id}>
                <td><b>{r.s.groupName}</b>{r.s.cityName && <small>{r.s.cityName}</small>}</td>
                <td>{hm(r.s.startMs, r.s.timeZone)} – {hm(r.s.endMs, r.s.timeZone)}{r.moved !== 0 && <small>{tx("moved")} {Math.abs(r.moved)} {tx("min")} {r.moved < 0 ? tx("earlier") : tx("later")}</small>}</td>
                <td>{r.s.actualStartMs ? `${hm(r.s.actualStartMs, r.s.timeZone)} – ${hm(r.s.actualEndMs, r.s.timeZone)}` : '—'}</td>
                <td>{r.startDev === null ? <span className="ta-b na">—</span> : <span className={`ta-b ${cls(r.startDev)}`}>{dev(r.startDev)}</span>}</td>
                <td>{r.endDev === null ? <span className="ta-b na">—</span> : <span className={`ta-b ${cls(r.endDev)}`}>{dev(r.endDev)}</span>}</td>
                <td>{r.real === null ? `${r.planned} min planned` : <>{r.real} {tx("min")}<small>{r.planned} {tx("planned (")}{r.real - r.planned > 0 ? '+' : ''}{r.real - r.planned})</small></>}</td>
                <td>{STATUS[r.s.status] ?? r.s.status}{r.s.auto && <small>{tx("moved by the clock")}</small>}{(r.s.delayMinutes ?? 0) > 0 && <small>{tx("delayed")} {r.s.delayMinutes} {tx("min")}{r.s.delayReason ? `: ${r.s.delayReason}` : ''}</small>}{r.s.status === 'cancelled' && r.s.delayReason ? <small>{r.s.delayReason}</small> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

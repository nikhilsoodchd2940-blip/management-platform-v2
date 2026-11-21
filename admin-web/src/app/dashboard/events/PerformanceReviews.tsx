'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { downloadCsv } from '@/lib/download';
import { RemarkDialog } from './LiveSections';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Run { startedAt?: { toMillis(): number }; endedAt?: { toMillis(): number }; pausedMs?: number; remark?: string; rating?: number }
interface SlotRow { id: string; groupName: string; startMs: number; status: string; runs: Record<string, Run>; remark: string; remarkBy: string }
interface Item { title: string; artist: string; seconds: number }

const stars = (n: number) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const day = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Everything the supervisors wrote during the performances: the rating and the remark of each book, and the remark on the whole performance. Saved with the event so it can be reviewed later. */
export default function PerformanceReviews({ eventId, title }: { eventId: string; title: string }) {
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'rated' | 'remarks'>('all');
  const [read, setRead] = useState<{ title: string; text: string } | null>(null);

  useEffect(() => {
    const a = onSnapshot(query(collection(db, 'eventSlots'), where('eventId', '==', eventId)), (snap) => {
      setSlots(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown> & { startAt?: { toMillis(): number } };
        return { id: d.id, groupName: (x.groupName as string) ?? '', startMs: x.startAt?.toMillis() ?? 0, status: (x.liveStatus as string) ?? (x.performanceStatus as string) ?? '', runs: (x.audioRuns as Record<string, Run>) ?? {}, remark: (x.performanceRemark as string) ?? '', remarkBy: (x.performanceRemarkBy as string) ?? '' };
      }).sort((p, r) => p.startMs - r.startMs));
    }, () => setSlots([]));
    const b = onSnapshot(query(collection(db, 'performanceSelections'), where('eventId', '==', eventId)), (snap) => {
      const m: Record<string, Item[]> = {};
      snap.docs.forEach((d) => { const x = d.data() as { slotId?: string; items?: { title?: string; artist?: string; durationSeconds?: number }[] }; m[x.slotId ?? d.id] = (x.items ?? []).map((i) => ({ title: i.title ?? '', artist: i.artist ?? '', seconds: i.durationSeconds ?? 0 })); });
      setItems(m);
    }, () => undefined);
    return () => { a(); b(); };
  }, [eventId]);

  const cards = useMemo(() => (slots ?? []).map((s) => {
    const list = items[s.id] ?? [];
    const rows = list.map((it, n) => ({ it, r: s.runs[String(n)] ?? {} }));
    const rated = rows.map((x) => x.r.rating ?? 0).filter((x) => x > 0);
    const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
    return { s, rows, avg, rated: rated.length, remarks: rows.filter((x) => x.r.remark).length + (s.remark ? 1 : 0) };
  }).filter((c) => (c.rows.length > 0 || c.s.remark) && (!q.trim() || c.s.groupName.toLowerCase().includes(q.trim().toLowerCase())) && (only === 'all' || (only === 'rated' ? c.rated > 0 : c.remarks > 0))), [slots, items, q, only]);

  if (slots === null) return <p className="fx3-note">{tx("Loading the reviews…")}</p>;
  const total = cards.length, rated = cards.filter((c) => c.avg > 0);
  const global = rated.length ? rated.reduce((a, c) => a + c.avg, 0) / rated.length : 0;

  return (
    <div className="pr">
      <div className="pr-top">
        <div className="pr-kpi"><b>{total}</b><span>{tx("Performances with books")}</span></div>
        <div className="pr-kpi"><b>{rated.length}</b><span>{tx("Rated")}</span></div>
        <div className="pr-kpi"><b>{global ? (Math.round(global * 10) / 10).toFixed(1) : '—'}</b><span>{tx("Average rating")}{global ? ` · ${stars(global)}` : ''}</span></div>
        <div className="pr-kpi"><b>{cards.reduce((n, c) => n + c.remarks, 0)}</b><span>{tx("Remarks written")}</span></div>
        <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(`${title} performance reviews`, [['Group', 'Start', 'Book', 'Artist', 'Duration', 'Rating', 'Remark', 'Remark on the whole performance'], ...cards.flatMap((c) => c.rows.map((x) => [c.s.groupName, day(c.s.startMs), x.it.title, x.it.artist, mmss(x.it.seconds), x.r.rating ?? '', x.r.remark ?? '', c.s.remark]))])}>{tx("Download")}</button>
      </div>
      <div className="at-filters">
        <input type="search" placeholder={tx("Search a group")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Search a group")} />
        {(['all', 'rated', 'remarks'] as const).map((k) => <button key={k} type="button" className={`at-chip${only === k ? ' on' : ''}`} onClick={() => setOnly(k)}>{k === 'all' ? tx("All") : k === 'rated' ? tx("Rated only") : tx("With remarks")}</button>)}
      </div>
      {cards.length === 0 && <p className="fx3-note">{tx("Nothing has been rated or written yet. Supervisors add ratings and remarks from the Live board while a group is on stage.")}</p>}
      <div className="pr-grid">
        {cards.map(({ s, rows, avg, rated: nRated }) => (
          <article key={s.id} className="mm-card pr-card">
            <header>
              <div><b>{s.groupName}</b><small>{day(s.startMs)} · {rows.length} {tx("book")}{rows.length === 1 ? '' : 's'}</small></div>
              <span className={`pr-avg${avg ? '' : ' none'}`}>{avg ? <><b>{(Math.round(avg * 10) / 10).toFixed(1)}</b><em>{stars(avg)}</em><small>{nRated} {tx("of")} {rows.length} {tx("rated")}</small></> : <small>{tx("Not rated")}</small>}</span>
            </header>
            <div className="mm-tbl pr-tbl">
              <div className="mm-th"><span>{tx("Book")}</span><span>{tx("Artist")}</span><span>{tx("Played")}</span><span>{tx("Rating")}</span><span>{tx("Remark")}</span></div>
              {rows.map(({ it, r }, n) => {
                const played = r.startedAt ? ((r.endedAt?.toMillis() ?? r.startedAt.toMillis()) - r.startedAt.toMillis() - (r.pausedMs ?? 0)) / 1000 : 0;
                return (
                  <div className="mm-tr" key={n}>
                    <b>{it.title}</b><span>{it.artist || '—'}</span><span>{r.startedAt ? `${mmss(Math.max(0, played))} of ${mmss(it.seconds)}` : `not played · ${mmss(it.seconds)}`}</span>
                    <span className="pr-st">{r.rating ? stars(r.rating) : '—'}</span>
                    <span>{r.remark ? <button type="button" className="pr-rem" onClick={() => setRead({ title: `${s.groupName}: ${it.title}`, text: r.remark ?? '' })}>{r.remark}</button> : '—'}</span>
                  </div>
                );
              })}
            </div>
            <div className="pr-whole"><b>{tx("Remark on the whole performance")}</b>{s.remark ? <button type="button" className="pr-rem" onClick={() => setRead({ title: `${s.groupName}: whole performance`, text: s.remark })}>{s.remark}</button> : <small>{tx("No remark")}</small>}{s.remarkBy && <small>{tx("by")} {s.remarkBy}</small>}</div>
          </article>
        ))}
      </div>
      {read && <RemarkDialog title={tx("Remark")} subtitle={read.title} value={read.text} editable={false} onSave={() => undefined} onClose={() => setRead(null)} />}
    </div>
  );
}

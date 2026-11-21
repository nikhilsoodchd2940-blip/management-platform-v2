'use client';

import { useState } from 'react';
import { tx, dateLocale } from '@/lib/i18n/tr';

export interface HistoryRow { id: string; type: string; byName: string; detail: string; before?: string; after?: string; groupName?: string; atMs: number }

const TONE: Record<string, string> = { delay: 'amber', status: 'green', schedule_adjusted: 'blue', conflicts_found: 'red', escalation: 'red', note: 'grey', event_created: 'grey', shifts_set: 'grey', sites_set: 'grey', conflicts_accepted: 'amber' };
const day = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
const hm = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

/** The event history as a readable timeline: one line per event, long texts folded, grouped by day. */
export default function HistoryList({ rows, labels }: { rows: HistoryRow[]; labels: Record<string, string> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(40);
  const shown = rows.slice(0, limit);
  const days: [string, HistoryRow[]][] = [];
  shown.forEach((r) => { const k = day(r.atMs); const h = days.find((d) => d[0] === k); if (h) h[1].push(r); else days.push([k, [r]]); });
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="hl">
      {days.map(([d, list]) => (
        <section key={d}>
          <h4>{d}</h4>
          <ul>
            {list.map((l) => {
              const long = l.detail.length > 150;
              const isOpen = open.has(l.id);
              const detail = long && !isOpen ? `${l.detail.slice(0, 150)}…` : l.detail;
              const change = l.before && l.after && l.before !== l.after && l.before.length < 40 && l.after.length < 40 ? `${l.before} → ${l.after}` : '';
              return (
                <li key={l.id} className={TONE[l.type] ?? 'grey'}>
                  <time>{hm(l.atMs)}</time>
                  <span className="hl-chip">{labels[l.type] ?? l.type}</span>
                  <div>
                    <p><b>{l.byName}</b> {detail}</p>
                    {change && <small>{change}</small>}
                    {long && <button type="button" onClick={() => toggle(l.id)}>{isOpen ? tx("Show less") : tx("Show more")}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {rows.length > limit && <button type="button" className="btn btn-secondary" onClick={() => setLimit(limit + 60)}>{tx("Show 60 more (")}{rows.length - limit} {tx("left)")}</button>}
    </div>
  );
}

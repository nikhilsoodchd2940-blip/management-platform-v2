'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { limit as fsLimit, orderBy, where, Timestamp } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useMyScope } from '@/lib/useMyScope';
import { formatDuration, formatInZone } from '@/lib/timeZones';
import { PerformanceControls, RemarksBox, SELECTION_LABEL, type Remark, type Selection, type Slot } from './planParts';
import { tx, dateLocale } from '@/lib/i18n/tr';

export interface LiveEventInfo { id: string; title: string; startMs: number; endMs: number; location: string; groupCount: number }

const dm = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const hm = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

/**
 * Event-day control. The admin picks the event, then the group that is on stage (whatever its planned time),
 * presses Start, and later End. Nothing changes by itself when the clock moves.
 */
export default function LiveMonitor({ titleOf, liveEventIds, events = [] }: { titleOf: (eventId: string) => string; liveEventIds: string[]; events?: LiveEventInfo[] }) {
  const { byId } = useGroupHierarchy();
  const { allows } = useMyScope();
  const [picked, setPicked] = useState('');
  const [evFilter, setEvFilter] = useState('');
  const since = useMemo(() => Timestamp.fromMillis(Math.floor(Date.now() / 86400000) * 86400000 - 30 * 86400000), []);
  const slots = useCollection<Slot>('eventSlots', [where('endAt', '>=', since), orderBy('endAt', 'asc'), fsLimit(300)], 'live');
  const sel = useCollection<Selection>('performanceSelections', [where('status', 'in', ['approved', 'submitted', 'rejected', 'needs_revision', 'draft']), fsLimit(500)], 'live-sel');
  const remarks = useCollection<Remark & { eventId: string }>('performanceRemarks', [orderBy('createdAt', 'desc'), fsLimit(500)], 'live-rem');

  // Only events that are published and running (never drafts, upcoming or cancelled events).
  const all = (slots ?? []).filter((s) => liveEventIds.includes(s.eventId) && allows(s)).sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt));
  const visible = evFilter ? all.filter((s) => s.eventId === evFilter) : all;
  const selOf = (id: string) => (sel ?? []).find((x) => x.id === id);
  const statusOf = (s: Slot) => s.performanceStatus ?? 'scheduled';
  const onStage = visible.filter((s) => statusOf(s) === 'started');
  const waiting = visible.filter((s) => statusOf(s) === 'scheduled');
  const done = visible.filter((s) => statusOf(s) === 'completed');
  const chosen = visible.find((s) => s.id === picked) ?? onStage[0] ?? waiting[0] ?? visible[0];
  const infoOf = (id: string) => events.find((e) => e.id === id);
  const countOf = (id: string, st: string) => all.filter((s) => s.eventId === id && statusOf(s) === st).length;
  const byEvent = liveEventIds.map((id) => ({ id, rows: visible.filter((s) => s.eventId === id) })).filter((g) => g.rows.length > 0);

  function stage(s: Slot) {
    const sl = selOf(s.id);
    const approved = sl?.status === 'approved' ? sl : undefined;
    const st = SELECTION_LABEL[sl?.status ?? 'none'];
    const ps = statusOf(s);
    const ev = infoOf(s.eventId);
    return (
      <div className={`lpc-stage s-${ps}`}>
        <div className="lpc-evbar">
          <div>
            <small>{tx("Event")}</small>
            <b>{titleOf(s.eventId) || '—'}</b>
            {ev && <span>{dm(ev.startMs)}{dm(ev.endMs) !== dm(ev.startMs) ? ` to ${dm(ev.endMs)}` : ''} · {ev.groupCount} {tx("kurel")}{ev.groupCount === 1 ? '' : 's'}{ev.location ? ` · ${ev.location}` : ''}</span>}
          </div>
          <Link href={`/dashboard/events/${s.eventId}`}>{tx("Open the event plan →")}</Link>
        </div>
        <div className="lpc-who">
          <div>
            <h3>{s.groupName}</h3>
            <span>{byId[s.cityId]?.name ?? '—'}</span>
          </div>
          <span className={`lpc-pill ${ps}`}>{ps === 'started' ? tx("On stage now") : ps === 'completed' ? tx("Finished") : tx("Waiting")}</span>
        </div>
        <div className="lpc-facts">
          <div><small>{tx("Date")}</small><b>{dm(tsMs(s.startAt))}</b></div>
          <div><small>{tx("Your time")}</small><b>{hm(tsMs(s.startAt))} {tx("to")} {hm(tsMs(s.endAt))}</b></div>
          <div><small>{tx("Local time (")}{s.timeZone})</small><b>{formatInZone(tsMs(s.startAt), s.timeZone, false)} {tx("to")} {formatInZone(tsMs(s.endAt), s.timeZone, false)}</b></div>
          <div><small>{tx("Time allowed")}</small><b>{formatDuration(s.allocatedSeconds)}</b></div>
        </div>
        <div className="lpc-mat">
          <small>{tx("Approved material")}</small>
          {approved ? (
            <ul>{approved.items.map((x) => <li key={`${x.type}:${x.id}`}><span>{x.type === 'audio' ? '🎵' : '📖'}</span><b>{x.title}</b><em>{formatDuration(x.durationSeconds)}</em></li>)}</ul>
          ) : <span className={`fx2-pill ${st.cls}`}>{sl ? st.text : tx("No selection yet")}</span>}
        </div>
        <div className="lpc-act">
          <PerformanceControls slot={s} approved={!!approved} />
        </div>
        <RemarksBox slot={s} remarks={remarks ?? []} />
      </div>
    );
  }

  return (
    <section className="card lpc">
      <div className="lpc-head">
        <div>
          <h2>{tx("Live performance control")}</h2>
          <p>{tx("Choose the event, then the group that is performing. Press Start, and End when it finishes. Nothing starts by itself.")}</p>
        </div>
        <div className="lpc-counts"><span className="on">{onStage.length} {tx("on stage")}</span><span>{waiting.length} {tx("waiting")}</span><span>{done.length} {tx("finished")}</span></div>
      </div>
      {slots === null ? <p>{tx("Loading…")}</p> : liveEventIds.length === 0 ? (
        <p className="fx2-empty" style={{ padding: '0.6rem 0' }}>{tx("No event is in progress, so there is nothing to supervise.")}</p>
      ) : all.length === 0 ? (
        <p className="fx2-empty" style={{ padding: '0.6rem 0' }}>{tx("The events in progress have no group slots yet. Add them on the event plan.")}</p>
      ) : (
        <>
          {liveEventIds.length > 1 && (
            <div className="lpc-events" role="tablist" aria-label={tx("Events in progress")}>
              <button type="button" className={!evFilter ? 'on' : ''} onClick={() => setEvFilter('')}><b>{tx("All events")}</b><small>{all.length} {tx("performances")}</small></button>
              {liveEventIds.map((id) => (
                <button type="button" key={id} className={evFilter === id ? 'on' : ''} onClick={() => { setEvFilter(id); setPicked(''); }}>
                  <b>{titleOf(id) || tx("Event")}</b>
                  <small>{countOf(id, 'started')} {tx("on stage ·")} {countOf(id, 'scheduled')} {tx("waiting ·")} {countOf(id, 'completed')} {tx("finished")}</small>
                </button>
              ))}
            </div>
          )}
          <div className="lpc-grid">
            <div className="lpc-side"><aside className="lpc-queue">
              {byEvent.map((g) => (
                <div key={g.id} className="lpc-qgroup">
                  <h4>{titleOf(g.id) || tx("Event")}<em>{g.rows.length}</em></h4>
                  {g.rows.map((s) => {
                    const ps = statusOf(s);
                    return (
                      <button type="button" key={s.id} className={`lpc-q s-${ps}${chosen?.id === s.id ? ' on' : ''}`} onClick={() => setPicked(s.id)}>
                        <time>{dm(tsMs(s.startAt))}<b>{hm(tsMs(s.startAt))}</b></time>
                        <span><b>{s.groupName}</b><small>{byId[s.cityId]?.name ?? '—'} · {formatDuration(s.allocatedSeconds)}</small></span>
                        <i className={`lpc-pill ${ps}`}>{ps === 'started' ? tx("On stage") : ps === 'completed' ? tx("Finished") : tx("Waiting")}</i>
                      </button>
                    );
                  })}
                </div>
              ))}
            </aside></div>
            <div className="lpc-pane">{chosen ? stage(chosen) : <p className="fx2-empty">{tx("Choose a group on the left.")}</p>}</div>
          </div>
        </>
      )}
    </section>
  );
}

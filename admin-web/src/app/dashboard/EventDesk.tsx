'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { where } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { formatDuration } from '@/lib/timeZones';
import { tx, dateLocale } from '@/lib/i18n/tr';

export interface DeskEvent { id: string; title: string; status: string; startMs: number; endMs: number }

type Slot = { id: string; eventId: string; groupId?: string; groupName: string; startAt: unknown; allocatedSeconds: number; performanceStatus?: string };
type Sel = { id: string; slotId?: string; eventId: string; groupId?: string; status: string; totalSeconds: number; allocatedSeconds: number };
type Track = { title: string; qacaidTitle?: string; melodyLabel?: string; status: string; createdAt?: unknown };

const DAY = 24 * 3600 * 1000;

function when(ms: number, now: number) {
  const diff = ms - now;
  if (diff <= 0) return 'now';
  if (diff < 3600 * 1000) return `in ${Math.max(1, Math.round(diff / 60000))} min`;
  if (diff < DAY) return `in ${Math.round(diff / 3600000)} h`;
  const days = Math.round(diff / DAY);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** What an admin needs to act on for event planning: what is coming, what waits for approval, who has not chosen yet. */
export default function EventDesk({ events, now }: { events: DeskEvent[]; now: number }) {
  const { byId } = useGroupHierarchy();
  const slots = useCollection<Slot>('eventSlots', []);
  const sels = useCollection<Sel>('performanceSelections', []);
  const pendingAudio = useCollection<Track>('audioTracks', [where('status', '==', 'pending')]);

  const d = useMemo(() => {
    const live = events.filter((e) => e.status === 'published');
    const upcoming = live.filter((e) => e.startMs > now).sort((a, b) => a.startMs - b.startMs);
    const nowEvents = live.filter((e) => e.startMs <= now && e.endMs >= now);
    const next = upcoming[0];
    const futureIds = new Set([...upcoming, ...nowEvents].map((e) => e.id));
    const titleOf = (id: string) => events.find((e) => e.id === id)?.title ?? 'Event';
    const selByKey = new Map((sels ?? []).map((s) => [s.slotId ?? s.id, s]));
    const futureSlots = (slots ?? []).filter((s) => futureIds.has(s.eventId) && s.performanceStatus !== 'completed');
    const submitted = (sels ?? []).filter((s) => s.status === 'submitted' && futureIds.has(s.eventId));
    const notChosen = futureSlots.filter((s) => {
      const sel = selByKey.get(s.id);
      return !sel || sel.status === 'draft' || sel.status === 'rejected' || sel.status === 'needs_revision';
    });
    const soon = upcoming.filter((e) => e.startMs - now <= 7 * DAY);
    const nextSlots = next ? futureSlots.filter((s) => s.eventId === next.id) : [];
    const nextApproved = nextSlots.filter((s) => selByKey.get(s.id)?.status === 'approved').length;
    const nextWaiting = nextSlots.filter((s) => selByKey.get(s.id)?.status === 'submitted').length;
    return { upcoming, nowEvents, next, soon, submitted, notChosen, nextSlots, nextApproved, nextWaiting, titleOf };
  }, [events, slots, sels, now]);

  const audioWaiting = pendingAudio ?? [];
  const loading = slots === null || sels === null;

  const tiles: { label: string; value: number; href: string; hot?: boolean; hint: string }[] = [
    { label: tx("In progress"), value: d.nowEvents.length, href: '/dashboard/events', hint: tx("events in progress") },
    { label: tx("Upcoming"), value: d.soon.length, href: '/dashboard/events', hint: tx("events in the next 7 days") },
    { label: tx("Books to approve"), value: d.submitted.length, href: '/dashboard/events', hot: d.submitted.length > 0, hint: tx("books sent by groups") },
    { label: tx("Audio to approve"), value: audioWaiting.length, href: '/dashboard/audio', hot: audioWaiting.length > 0, hint: tx("new audio uploads") },
    { label: tx("Groups yet to choose"), value: d.notChosen.length, href: '/dashboard/events', hot: d.notChosen.length > 0, hint: tx("no approved books yet") },
  ];

  return (
    <div className="event-desk">
      <div className="event-desk-tiles">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`event-desk-tile${t.hot ? ' hot' : ''}`}>
            <strong>{loading ? '—' : t.value}</strong>
            <span>{t.label}</span>
            <small>{t.hint}</small>
          </Link>
        ))}
      </div>

      <div className="event-desk-cols">
        <div className="event-desk-box">
          <h3>{tx("Next event")}</h3>
          {d.next ? (
            <>
              <p className="event-desk-big">{d.next.title}</p>
              <p>
                {new Date(d.next.startMs).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })} · <strong>{when(d.next.startMs, now)}</strong>
              </p>
              <p>
                {d.nextSlots.length} {tx("performance slot")}{d.nextSlots.length === 1 ? '' : 's'}: {d.nextApproved} {tx("ready,")} {d.nextWaiting} {tx("waiting for approval,")} {d.nextSlots.length - d.nextApproved - d.nextWaiting} {tx("not chosen yet.")}
              </p>
            </>
          ) : (
            <p className="event-desk-empty">{tx("No event is coming up. Create one from the planning page.")}</p>
          )}
          <Link href="/dashboard/events" className="dash-link">{tx("Open the planning →")}</Link>
        </div>

        <div className="event-desk-box">
          <h3>{tx("Needs your attention")}</h3>
          <ul className="event-desk-list">
            {d.submitted.slice(0, 4).map((s, i) => (
              <li key={`s${i}`}>
                <span className="fx2-pill warn">{tx("Approve")}</span>
                <span>{byId[s.groupId ?? '']?.name ?? tx("A group")} {tx("sent its choice for")} <strong>{d.titleOf(s.eventId)}</strong> ({formatDuration(s.totalSeconds)} {tx("of")} {formatDuration(s.allocatedSeconds)})</span>
              </li>
            ))}
            {audioWaiting.slice(0, 3).map((t, i) => (
              <li key={`a${i}`}>
                <span className="fx2-pill warn">{tx("Books")}</span>
                <span><strong>{t.qacaidTitle ?? t.title}</strong>{t.melodyLabel ? ` — ${t.melodyLabel}` : ''} {tx("is waiting for approval")}</span>
              </li>
            ))}
            {d.notChosen
              .filter((s) => tsMs(s.startAt) - now <= 3 * DAY)
              .slice(0, 4)
              .map((s, i) => (
                <li key={`n${i}`}>
                  <span className="fx2-pill bad">{tx("Missing")}</span>
                  <span>{s.groupName} {tx("has no approved books for")} <strong>{d.titleOf(s.eventId)}</strong> ({when(tsMs(s.startAt), now)})</span>
                </li>
              ))}
            {!loading && d.submitted.length === 0 && audioWaiting.length === 0 && d.notChosen.filter((s) => tsMs(s.startAt) - now <= 3 * DAY).length === 0 && (
              <li className="event-desk-empty">{tx("Everything is up to date. Nothing needs your action.")}</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

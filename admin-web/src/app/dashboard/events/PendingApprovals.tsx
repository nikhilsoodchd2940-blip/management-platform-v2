'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { where } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { formatInZone } from '@/lib/timeZones';
import { tsMs } from '@/lib/useCollection';
import { othersFor, type Selection } from './planParts';
import SelectionReview from './SelectionReview';
import { tx } from '@/lib/i18n/tr';

type Row = Selection & { eventId: string; groupId: string; slotId?: string; itemKeys?: string[] };
type SlotRow = { eventId: string; groupName: string; startAt: unknown; endAt: unknown; timeZone: string };

/** Everything groups have submitted that still needs a decision, across all events, in one place. */
export default function PendingApprovals({ titleOf }: { titleOf: (eventId: string) => string }) {
  const { byId, activeLeafGroups } = useGroupHierarchy();
  const live = useMemo(() => new Set(activeLeafGroups.map((g) => g.id)), [activeLeafGroups]);
  const rows = useCollection<Row>('performanceSelections', [where('status', '==', 'submitted')]);
  const slots = useCollection<SlotRow>('eventSlots', []);
  const active = useCollection<Row>('performanceSelections', [where('status', 'in', ['submitted', 'approved'])], 'active');

  // Only current data: groups that no longer exist are never listed.
  const list = (rows ?? []).filter((r) => live.has(r.groupId));
  const name = (id: string) => byId[id]?.name ?? 'A group';
  return (
    <section className="card pa">
      <div className="pa-head">
        <div>
          <h2>{tx("Waiting for your approval")} {list.length > 0 && <span className="pa-count">{list.length}</span>}</h2>
          <p>{tx("Books chosen by group managers. Decide on each book on its own: approve one, reject another with a reason that goes to the group manager.")}</p>
        </div>
      </div>
      {rows === null ? <p>{tx("Loading…")}</p> : list.length === 0 ? <p className="fx2-empty">{tx("Nothing is waiting. New submissions appear here and in your notifications.")}</p> : (
        <div className="pa-list">
          {list.map((r) => {
            const slot = (slots ?? []).find((x) => (x as unknown as { id: string }).id === (r.slotId ?? r.id));
            const others = othersFor((active ?? []).filter((o) => o.eventId === r.eventId && live.has(o.groupId)), r, name);
            return (
              <article key={r.id} className="pa-card">
                <header>
                  <div className="pa-who">
                    <span className="pa-av">{name(r.groupId).slice(0, 2).toUpperCase()}</span>
                    <div>
                      <strong>{name(r.groupId)}</strong>
                      <small>{titleOf(r.eventId) || tx("Event")}</small>
                    </div>
                  </div>
                  <div className="pa-when">
                    {slot ? <><span>🕒 {formatInZone(tsMs(slot.startAt), slot.timeZone)}</span><span>→ {formatInZone(tsMs(slot.endAt), slot.timeZone)}</span></> : <span>{tx("No time set")}</span>}
                  </div>
                  <Link href={`/dashboard/events/${r.eventId}`} className="pa-open">{tx("Open plan →")}</Link>
                </header>
                <SelectionReview slotId={r.id} selection={r} others={others} onDone={() => undefined} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

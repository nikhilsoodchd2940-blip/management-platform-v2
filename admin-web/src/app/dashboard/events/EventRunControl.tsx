'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import type { RunState } from '@/lib/functions';
import { RunBar, runEventAction, type Slot } from './LiveBoard';

/** Start, pause, resume and end of an event, shown at the top of the event page so nobody has to open the live board. */
export default function EventRunControl({ eventId }: { eventId: string }) {
  const [run, setRun] = useState<RunState>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRun({}); setSlots([]);
    const u1 = onSnapshot(doc(db, 'events', eventId), (snap) => {
      const lr = (snap.data()?.liveRun ?? {}) as Record<string, { state: 'running' | 'paused' | 'ended'; at?: { toMillis(): number } }>;
      setRun(Object.fromEntries(Object.entries(lr).map(([k, v]) => [k, { state: v.state, atMs: v.at?.toMillis() ?? 0 }])));
    });
    const u2 = onSnapshot(query(collection(db, 'eventSlots'), where('eventId', '==', eventId)), (snap) => {
      setSlots(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown> & { startAt?: { toMillis(): number }; endAt?: { toMillis(): number }; originalStartAt?: { toMillis(): number } };
        return {
          id: d.id, groupId: x.groupId as string, groupName: (x.groupName as string) ?? '', startMs: x.startAt?.toMillis() ?? 0, endMs: x.endAt?.toMillis() ?? 0, originalStartMs: x.originalStartAt?.toMillis(),
          status: (x.liveStatus as Slot['status']) ?? (x.performanceStatus === 'completed' ? 'completed' : x.performanceStatus === 'started' ? 'in_progress' : 'upcoming'),
        } as Slot;
      }));
    });
    return () => { u1(); u2(); };
  }, [eventId]);
  useEffect(() => { const h = window.setInterval(() => setTick((t) => t + 1), 15000); return () => window.clearInterval(h); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [tick, slots]);

  return <RunBar run={run} slots={slots} now={now} can={() => true} busy={busy} onAction={(a) => void runEventAction({ eventId, action: a, slots, runState: run, setBusy })} />;
}

'use client';

import { scopeSnap } from '@/lib/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { reportDataError } from './notify';
import { bucketOf, type Bucket } from './attendancePolicy';

export interface EventAttendance {
  loading: boolean;
  /** eventId -> invited user IDs */
  attendees: Record<string, string[]>;
  /** `${eventId}_${userId}` -> bucket */
  bucket: Record<string, Bucket>;
  refresh: () => void;
}

/** Invited members + attendance records + approved leave for a set of events, bucketed by the shared counting policy. */
export function useEventAttendance(eventIds: string[]): EventAttendance {
  const key = useMemo(() => Array.from(new Set(eventIds)).sort().join(','), [eventIds]);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<EventAttendance, 'refresh'>>({ loading: false, attendees: {}, bucket: {} });

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setState({ loading: false, attendees: {}, bucket: {} });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const attendees: Record<string, string[]> = {};
        const status: Record<string, string> = {};
        const leave = new Set<string>();
        for (let i = 0; i < ids.length; i += 30) {
          const chunk = ids.slice(i, i + 30);
          const [inv, att, abs] = await Promise.all([
            getDocs(query(collection(db, 'eventAttendees'), where('eventId', 'in', chunk))),
            getDocs(query(collection(db, 'attendance'), where('eventId', 'in', chunk))),
            getDocs(query(collection(db, 'absenceRequests'), where('eventId', 'in', chunk), where('status', '==', 'approved'))),
          ]);
          scopeSnap(inv).docs.forEach((d) => {
            const x = d.data() as { eventId: string; userId: string };
            (attendees[x.eventId] ??= []).push(x.userId);
          });
          scopeSnap(att).docs.forEach((d) => {
            const x = d.data() as { eventId: string; userId: string; status?: string };
            status[`${x.eventId}_${x.userId}`] = x.status ?? 'PRESENT'; // older records had no status field: they were on-time scans
          });
          scopeSnap(abs).docs.forEach((d) => {
            const x = d.data() as { eventId: string; userId: string };
            leave.add(`${x.eventId}_${x.userId}`);
          });
        }
        const bucket: Record<string, Bucket> = {};
        for (const [eventId, users] of Object.entries(attendees)) {
          for (const u of users) bucket[`${eventId}_${u}`] = bucketOf(status[`${eventId}_${u}`], leave.has(`${eventId}_${u}`));
        }
        if (!cancelled) setState({ loading: false, attendees, bucket });
      } catch (err) {
        reportDataError(err);
        if (!cancelled) setState({ loading: false, attendees: {}, bucket: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { EventDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { validateEventInput, populateAttendeesAndPublish } from './events';
import { requireAdminPermission } from '../admin/authorize';
import { resolveMainGroupId } from '../groups/hierarchy';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

interface RecurringEventInput {
  title: string;
  mainGroupId: string;
  subGroupIds: string[];
  location: { lat: number; lng: number; address?: string };
  geofenceRadiusMeters: number;
  startAtMs: number; // first occurrence's start
  endAtMs: number; // first occurrence's end
  frequency: RecurrenceFrequency;
  daysOfWeek?: number[]; // 0 (Sun) - 6 (Sat), only used when frequency === 'weekly'; if omitted, just repeats startAtMs's own weekday
  occurrenceCount?: number; // including the first — one of occurrenceCount/endByDateMs is required
  endByDateMs?: number; // alternative to occurrenceCount — generate occurrences up to (and not past) this date
  publish?: boolean; // publish every occurrence immediately instead of leaving them as drafts
  /** Group, Event & Approval Management module — copied onto every occurrence, see EventDoc. */
  kind?: EventDoc['kind'];
  purpose?: string;
  requirements?: string;
  expectedAttendees?: number;
}

const MAX_OCCURRENCES = 90; // roughly a quarter of daily events, or ~1.7 years weekly — a deliberate ceiling, not a technical limit

export function addOccurrence(date: Date, frequency: RecurrenceFrequency, n: number): Date {
  const result = new Date(date);
  if (frequency === 'daily') {
    result.setDate(result.getDate() + n);
  } else if (frequency === 'weekly') {
    result.setDate(result.getDate() + 7 * n);
  } else if (frequency === 'biweekly') {
    result.setDate(result.getDate() + 14 * n);
  } else {
    result.setMonth(result.getMonth() + n);
  }
  return result;
}

/**
 * Builds the list of occurrence start times. Two ways to bound the
 * series (exactly one is required, enforced by the caller): a fixed
 * occurrenceCount, or generating until the next occurrence would land
 * after endByDateMs. For weekly with daysOfWeek given (e.g. every
 * Mon/Wed/Fri instead of just repeating the first occurrence's own
 * weekday), occurrences are generated week-by-week, emitting one per
 * matching weekday in order — this is the "more options for recurring"
 * piece: a plain "weekly" series before this only ever repeated on the
 * single day the admin happened to pick as the first occurrence.
 */
export function buildOccurrences(input: RecurringEventInput): Date[] {
  const first = new Date(input.startAtMs);
  const cap = input.occurrenceCount ?? MAX_OCCURRENCES;

  if (input.frequency === 'weekly' && input.daysOfWeek && input.daysOfWeek.length > 0) {
    const days = [...new Set(input.daysOfWeek)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    const occurrences: Date[] = [];
    let weekStart = new Date(first);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday of the first occurrence's week

    let weeksScanned = 0;
    while (occurrences.length < cap && weeksScanned < MAX_OCCURRENCES * 2) {
      for (const day of days) {
        const candidate = new Date(weekStart);
        candidate.setDate(candidate.getDate() + day);
        candidate.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), first.getMilliseconds());
        if (candidate.getTime() < first.getTime()) continue; // before the series actually starts
        if (input.endByDateMs && candidate.getTime() > input.endByDateMs) return occurrences;
        occurrences.push(candidate);
        if (occurrences.length >= cap) break;
      }
      weekStart = addOccurrence(weekStart, 'weekly', 1);
      weeksScanned++;
    }
    return occurrences.slice(0, MAX_OCCURRENCES);
  }

  const occurrences: Date[] = [];
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const candidate = addOccurrence(first, input.frequency, i);
    if (input.endByDateMs && candidate.getTime() > input.endByDateMs) break;
    occurrences.push(candidate);
    if (occurrences.length >= cap) break;
  }
  return occurrences;
}

/**
 * Creates N draft (or, if `publish` is set, immediately published)
 * events sharing a generated `seriesId`, one per occurrence. Each
 * occurrence is otherwise an ordinary event — it still goes through the
 * normal per-event publishEvent/cancelEvent individually afterward if
 * not auto-published. This is deliberately NOT a single "recurring
 * event" document with computed instances: Firestore querying/rules/
 * attendance all already work in terms of one document per event, and
 * duplicating that model for a special recurring case would mean two
 * code paths everywhere else instead of one.
 */
export const createRecurringEvent = onCall(async (request) => {
  await requireAdminPermission(request, 'events');

  const input = request.data as RecurringEventInput;
  validateEventInput(input);

  const validFrequencies: RecurrenceFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly'];
  if (!validFrequencies.includes(input.frequency)) {
    throw new HttpsError('invalid-argument', `frequency must be one of: ${validFrequencies.join(', ')}`);
  }
  if (!input.occurrenceCount && !input.endByDateMs) {
    throw new HttpsError('invalid-argument', 'Provide either occurrenceCount or endByDateMs');
  }
  if (input.occurrenceCount !== undefined) {
    const count = Number(input.occurrenceCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES) {
      throw new HttpsError('invalid-argument', `occurrenceCount must be an integer from 1 to ${MAX_OCCURRENCES}`);
    }
  }
  if (input.daysOfWeek) {
    if (input.frequency !== 'weekly') {
      throw new HttpsError('invalid-argument', 'daysOfWeek only applies to weekly recurrence');
    }
    if (input.daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new HttpsError('invalid-argument', 'daysOfWeek must be integers 0 (Sun) through 6 (Sat)');
    }
  }

  // Groups must resolve, walking group -> city -> country -> main, up to
  // the given mainGroupId — see modules/groups/hierarchy.ts. Uses the
  // shared resolver rather than re-duplicating the check a second time.
  const groupSnaps = await Promise.all(input.subGroupIds.map((id) => db.collection('groups').doc(id).get()));
  for (const [i, snap] of groupSnaps.entries()) {
    if (!snap.exists || snap.data()?.type !== 'group') {
      throw new HttpsError('failed-precondition', `Group ${input.subGroupIds[i]} is invalid`);
    }
    const resolvedMainGroupId = await resolveMainGroupId(input.subGroupIds[i]);
    if (resolvedMainGroupId !== input.mainGroupId) {
      throw new HttpsError(
        'failed-precondition',
        `Group ${input.subGroupIds[i]} does not belong to the selected Main Group`
      );
    }
  }

  const occurrenceStarts = buildOccurrences(input);
  if (occurrenceStarts.length === 0) {
    throw new HttpsError('invalid-argument', 'This produces zero occurrences — check the dates given');
  }

  const seriesId = db.collection('events').doc().id; // borrow Firestore's ID generator for a grouping key, no doc written at this ID
  const durationMs = input.endAtMs - input.startAtMs;
  const batch = db.batch();
  const eventRefs: FirebaseFirestore.DocumentReference[] = [];
  const eventDocs: EventDoc[] = [];

  for (const occurrenceStart of occurrenceStarts) {
    const doc: EventDoc = {
      title: input.title.trim(),
      mainGroupId: input.mainGroupId,
      subGroupIds: input.subGroupIds,
      location: input.location,
      geofenceRadiusMeters: input.geofenceRadiusMeters,
      startAt: Timestamp.fromMillis(occurrenceStart.getTime()),
      endAt: Timestamp.fromMillis(occurrenceStart.getTime() + durationMs),
      status: 'draft',
      createdBy: request.auth!.uid,
      createdAt: FieldValue.serverTimestamp() as unknown as EventDoc['createdAt'],
      seriesId,
      kind: input.kind ?? 'event',
      ...(input.purpose?.trim() ? { purpose: input.purpose.trim() } : {}),
      ...(input.requirements?.trim() ? { requirements: input.requirements.trim() } : {}),
      ...(input.expectedAttendees !== undefined ? { expectedAttendees: input.expectedAttendees } : {}),
    };
    const ref = db.collection('events').doc();
    batch.set(ref, doc);
    eventRefs.push(ref);
    eventDocs.push(doc);
  }

  await batch.commit();

  if (input.publish) {
    // Same underlying helper publishEvent/publishEventSeries use — a
    // fresh read-after-write isn't needed since we already have the
    // doc contents in memory from just above.
    for (let i = 0; i < eventRefs.length; i++) {
      await populateAttendeesAndPublish(eventRefs[i], eventDocs[i], request.auth!.uid);
    }
  }

  await recordAudit({
    action: 'createRecurringEvent',
    actorUserId: request.auth!.uid,
    targetId: seriesId,
    result: 'SUCCESS',
    metadata: { count: occurrenceStarts.length, frequency: input.frequency, published: !!input.publish },
  });

  return { seriesId, eventIds: eventRefs.map((r) => r.id), published: !!input.publish };
});

/**
 * Cancels every FUTURE, non-cancelled event in a series — deliberately
 * leaves past/ongoing occurrences alone (their attendance already
 * happened or is happening; cancelling them would be historically wrong
 * and wouldn't undo checked-in attendance anyway).
 */
export const cancelEventSeries = onCall(async (request) => {
  await requireAdminPermission(request, 'events');

  const seriesId = String(request.data?.seriesId ?? '');
  if (!seriesId) throw new HttpsError('invalid-argument', 'seriesId is required');

  const snap = await db
    .collection('events')
    .where('seriesId', '==', seriesId)
    .where('status', 'in', ['draft', 'published'])
    .get();

  const nowMs = Date.now();
  const toCancel = snap.docs.filter((d) => (d.data() as EventDoc).startAt.toMillis() > nowMs);

  if (toCancel.length === 0) {
    return { ok: true, cancelledCount: 0 };
  }

  const batch = db.batch();
  toCancel.forEach((d) => batch.update(d.ref, { status: 'cancelled' }));
  await batch.commit();

  await recordAudit({
    action: 'cancelEventSeries',
    actorUserId: request.auth!.uid,
    targetId: seriesId,
    result: 'SUCCESS',
    metadata: { cancelledCount: toCancel.length },
  });

  return { ok: true, cancelledCount: toCancel.length };
});

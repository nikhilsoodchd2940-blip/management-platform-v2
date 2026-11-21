import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { ConflictDoc, EventAttendeeDoc, EventDoc } from '../../types/models';
import { rangesOverlap, conflictDocId } from './overlap';
import { log } from '../../utils/logger';

/**
 * System-detected conflicts (blueprint §7) — never user-submitted, so
 * this is a Firestore trigger rather than a callable: it fires whenever
 * `publishEvent`/`addEventAttendee` (Phase 2) creates a new
 * `eventAttendees` doc, and reconciles that one new invitation against
 * every OTHER event the same person is already on the attendee list for.
 * Deliberately does not scan every member for every event — it only
 * needs to check the one person + one event that just got a new row.
 */
export const onEventAttendeeCreated = onDocumentCreated('eventAttendees/{attendeeDocId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const newAttendee = snap.data() as EventAttendeeDoc;

  const [newEventSnap, otherAttendeeSnaps] = await Promise.all([
    db.collection('events').doc(newAttendee.eventId).get(),
    db.collection('eventAttendees').where('userId', '==', newAttendee.userId).get(),
  ]);

  if (!newEventSnap.exists) return;
  const newEvent = newEventSnap.data() as EventDoc;
  if (newEvent.status === 'cancelled') return;

  const otherEventIds = otherAttendeeSnaps.docs
    .map((d) => (d.data() as EventAttendeeDoc).eventId)
    .filter((id) => id !== newAttendee.eventId);

  if (otherEventIds.length === 0) return;

  const otherEventSnaps = await Promise.all(
    [...new Set(otherEventIds)].map((id) => db.collection('events').doc(id).get())
  );

  const writes: Promise<unknown>[] = [];
  for (const otherSnap of otherEventSnaps) {
    if (!otherSnap.exists) continue;
    const otherEvent = otherSnap.data() as EventDoc;
    if (otherEvent.status === 'cancelled') continue;
    if (otherSnap.id === newAttendee.eventId) continue;

    const overlaps = rangesOverlap(
      newEvent.startAt.toMillis(),
      newEvent.endAt.toMillis(),
      otherEvent.startAt.toMillis(),
      otherEvent.endAt.toMillis()
    );
    if (!overlaps) continue;

    const docId = conflictDocId(newAttendee.userId, newAttendee.eventId, otherSnap.id);
    const doc: ConflictDoc = {
      userId: newAttendee.userId,
      eventIdA: newAttendee.eventId,
      eventIdB: otherSnap.id,
      detectedAt: FieldValue.serverTimestamp() as unknown as ConflictDoc['detectedAt'],
    };
    writes.push(db.collection('conflicts').doc(docId).set(doc, { merge: true }));
  }

  if (writes.length > 0) {
    await Promise.all(writes);
    log.info('onEventAttendeeCreated: conflicts detected', {
      userId: newAttendee.userId,
      eventId: newAttendee.eventId,
      count: writes.length,
    });
  }
});

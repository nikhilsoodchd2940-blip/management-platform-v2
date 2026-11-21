import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { EventAttendeeDoc, EventDoc, GroupDoc, GroupMembershipDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { requireAdminPermission } from '../admin/authorize';
import { resolveMainGroupId } from '../groups/hierarchy';

const attendeeId = (eventId: string, userId: string) => `${eventId}_${userId}`;

interface EventInput {
  title: string;
  mainGroupId: string;
  subGroupIds: string[];
  location: { lat: number; lng: number; address?: string };
  geofenceRadiusMeters: number;
  startAtMs: number;
  endAtMs: number;
  /** Group, Event & Approval Management module — all optional, see EventDoc. */
  kind?: EventDoc['kind'];
  purpose?: string;
  requirements?: string;
  expectedAttendees?: number;
}

const VALID_EVENT_KINDS: readonly NonNullable<EventDoc['kind']>[] = ['event', 'rehearsal', 'meeting', 'special_program'];

/**
 * `subGroupIds` are leaf 'group' nodes (see modules/groups/hierarchy.ts —
 * the field name predates the Country/City levels being introduced and
 * is kept as-is to avoid an unnecessary rename across every caller;
 * conceptually these are "the leaf groups this event is for"). Each one
 * must resolve, by walking group -> city -> country -> main, up to the
 * given mainGroupId — this replaced a direct parentGroupId check now
 * that there are two organizational levels in between.
 */
async function validateSubGroups(mainGroupId: string, subGroupIds: string[]): Promise<void> {
  if (subGroupIds.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one group is required');
  }
  const snaps = await Promise.all(subGroupIds.map((id) => db.collection('groups').doc(id).get()));
  for (const [i, snap] of snaps.entries()) {
    if (!snap.exists) {
      throw new HttpsError('failed-precondition', `Group ${subGroupIds[i]} does not exist`);
    }
    const group = snap.data() as GroupDoc;
    if (group.type !== 'group') {
      throw new HttpsError('failed-precondition', `${subGroupIds[i]} is not a leaf group`);
    }
    const resolvedMainGroupId = await resolveMainGroupId(subGroupIds[i]);
    if (resolvedMainGroupId !== mainGroupId) {
      throw new HttpsError(
        'failed-precondition',
        `Group ${subGroupIds[i]} does not belong to the selected Main Group`
      );
    }
  }
}

export function validateEventInput(input: EventInput): void {
  if (!input.title?.trim()) throw new HttpsError('invalid-argument', 'title is required');
  if (!input.mainGroupId) throw new HttpsError('invalid-argument', 'mainGroupId is required');
  if (!Number.isFinite(input.location?.lat) || !Number.isFinite(input.location?.lng)) {
    throw new HttpsError('invalid-argument', 'location.lat and location.lng are required numbers');
  }
  if (!Number.isFinite(input.geofenceRadiusMeters) || input.geofenceRadiusMeters <= 0) {
    throw new HttpsError('invalid-argument', 'geofenceRadiusMeters must be a positive number');
  }
  if (!Number.isFinite(input.startAtMs) || !Number.isFinite(input.endAtMs)) {
    throw new HttpsError('invalid-argument', 'startAtMs and endAtMs are required');
  }
  if (input.endAtMs <= input.startAtMs) {
    throw new HttpsError('invalid-argument', 'endAt must be after startAt');
  }
  if (input.kind !== undefined && !VALID_EVENT_KINDS.includes(input.kind)) {
    throw new HttpsError('invalid-argument', `kind must be one of ${VALID_EVENT_KINDS.join(', ')}`);
  }
  if (input.expectedAttendees !== undefined && (!Number.isInteger(input.expectedAttendees) || input.expectedAttendees < 0)) {
    throw new HttpsError('invalid-argument', 'expectedAttendees must be a non-negative whole number');
  }
}

/**
 * Shared by publishEvent (single event) and the auto-publish path in
 * createEvent/createRecurringEvent (the new "Publish immediately"
 * option) — same attendee-eligibility snapshot logic either way, so
 * there's exactly one place that decides who gets swept in.
 */
export async function populateAttendeesAndPublish(
  eventRef: FirebaseFirestore.DocumentReference,
  event: Pick<EventDoc, 'subGroupIds'>,
  actorUid: string
): Promise<number> {
  if (event.subGroupIds.length > 30) {
    throw new HttpsError('failed-precondition', 'Publishing supports at most 30 Sub Groups per event');
  }

  const membershipSnap = await db
    .collection('groupMemberships')
    .where('groupId', 'in', event.subGroupIds)
    .where('status', '==', 'active')
    .get();

  const userIds = new Set(membershipSnap.docs.map((d) => (d.data() as GroupMembershipDoc).userId));

  const batch = db.batch();
  for (const userId of userIds) {
    const attendeeRef = db.collection('eventAttendees').doc(attendeeId(eventRef.id, userId));
    const doc: EventAttendeeDoc = {
      eventId: eventRef.id,
      userId,
      invitedAt: FieldValue.serverTimestamp() as unknown as EventAttendeeDoc['invitedAt'],
      invitedBy: actorUid,
    };
    batch.set(attendeeRef, doc, { merge: true });
  }
  batch.update(eventRef, { status: 'published' });
  await batch.commit();

  return userIds.size;
}

export const createEvent = onCall(async (request) => {
  await requireAdminPermission(request, 'events');

  const input = request.data as EventInput & { publish?: boolean };
  validateEventInput(input);
  await validateSubGroups(input.mainGroupId, input.subGroupIds);

  const doc: EventDoc = {
    title: input.title.trim(),
    mainGroupId: input.mainGroupId,
    subGroupIds: input.subGroupIds,
    location: input.location,
    geofenceRadiusMeters: input.geofenceRadiusMeters,
    startAt: Timestamp.fromMillis(input.startAtMs),
    endAt: Timestamp.fromMillis(input.endAtMs),
    status: 'draft',
    createdBy: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as EventDoc['createdAt'],
    kind: input.kind ?? 'event',
    ...(input.purpose?.trim() ? { purpose: input.purpose.trim() } : {}),
    ...(input.requirements?.trim() ? { requirements: input.requirements.trim() } : {}),
    ...(input.expectedAttendees !== undefined ? { expectedAttendees: input.expectedAttendees } : {}),
  };

  const ref = await db.collection('events').add(doc);

  let attendeeCount: number | undefined;
  if (input.publish) {
    attendeeCount = await populateAttendeesAndPublish(ref, doc, request.auth!.uid);
  }

  await recordAudit({
    action: 'createEvent',
    actorUserId: request.auth!.uid,
    targetId: ref.id,
    result: 'SUCCESS',
    metadata: { title: doc.title, subGroupIds: doc.subGroupIds, published: !!input.publish },
  });

  return { eventId: ref.id, published: !!input.publish, attendeeCount };
});

/** Only draft events are editable — a published event's attendee list has already been committed. */
export const updateEvent = onCall(async (request) => {
  await requireAdminPermission(request, 'events');

  const eventId = String(request.data?.eventId ?? '');
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required');

  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Event not found');
  const existing = snap.data() as EventDoc;
  if (existing.status !== 'draft') {
    throw new HttpsError('failed-precondition', 'Only draft events can be edited — cancel and recreate instead');
  }

  // Full replacement of the editable fields, same shape as createEvent —
  // simpler and safer than a partial merge across two different shapes
  // (EventDoc's Timestamps vs EventInput's millis).
  const input = request.data as EventInput;
  validateEventInput(input);
  await validateSubGroups(input.mainGroupId, input.subGroupIds);

  const patch: Partial<EventDoc> = {
    title: input.title.trim(),
    mainGroupId: input.mainGroupId,
    subGroupIds: input.subGroupIds,
    location: input.location,
    geofenceRadiusMeters: input.geofenceRadiusMeters,
    startAt: Timestamp.fromMillis(input.startAtMs),
    endAt: Timestamp.fromMillis(input.endAtMs),
    kind: input.kind ?? existing.kind ?? 'event',
    purpose: input.purpose?.trim() || FieldValue.delete() as unknown as string,
    requirements: input.requirements?.trim() || FieldValue.delete() as unknown as string,
    expectedAttendees: input.expectedAttendees !== undefined ? input.expectedAttendees : FieldValue.delete() as unknown as number,
  };
  await ref.update(patch);

  await recordAudit({
    action: 'updateEvent',
    actorUserId: request.auth!.uid,
    targetId: eventId,
    result: 'SUCCESS',
  });

  return { ok: true };
});

/**
 * Publishing does two things atomically-in-spirit (batched, not a single
 * transaction — attendee count can be large): flips status to 'published',
 * and populates `eventAttendees` from every ACTIVE groupMembership of the
 * event's Sub Groups at that moment. This is the "attendee eligibility
 * list" docs/QR_DATAFLOW.md checks — publishing is what commits it.
 * Admin can still add/remove individual attendees afterward (below).
 */
export const publishEvent = onCall({ timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireAdminPermission(request, 'events');

  const eventId = String(request.data?.eventId ?? '');
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required');

  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Event not found');
  const event = snap.data() as EventDoc;
  if (event.status !== 'draft') {
    throw new HttpsError('failed-precondition', `Event is already ${event.status}`);
  }

  const attendeeCount = await populateAttendeesAndPublish(ref, event, request.auth!.uid);

  await recordAudit({
    action: 'publishEvent',
    actorUserId: request.auth!.uid,
    targetId: eventId,
    result: 'SUCCESS',
    metadata: { attendeeCount },
  });

  return { ok: true, attendeeCount };
});

/**
 * Bulk version of publishEvent for a whole recurring series — the
 * "Publish all in this series" button, so an admin doesn't have to
 * click Publish on every occurrence individually. Only touches
 * still-draft occurrences; already-published or cancelled ones are left
 * alone.
 */
export const publishEventSeries = onCall({ timeoutSeconds: 300, memory: '256MiB' }, async (request) => {
  await requireAdminPermission(request, 'events');

  const seriesId = String(request.data?.seriesId ?? '');
  if (!seriesId) throw new HttpsError('invalid-argument', 'seriesId is required');

  const snap = await db.collection('events').where('seriesId', '==', seriesId).where('status', '==', 'draft').get();

  let publishedCount = 0;
  for (const doc of snap.docs) {
    const event = doc.data() as EventDoc;
    await populateAttendeesAndPublish(doc.ref, event, request.auth!.uid);
    publishedCount++;
  }

  await recordAudit({
    action: 'publishEventSeries',
    actorUserId: request.auth!.uid,
    targetId: seriesId,
    result: 'SUCCESS',
    metadata: { publishedCount },
  });

  return { ok: true, publishedCount };
});

export const cancelEvent = onCall(async (request) => {
  await requireAdminPermission(request, 'events');

  const eventId = String(request.data?.eventId ?? '');
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required');

  const ref = db.collection('events').doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Event not found');

  await ref.update({ status: 'cancelled' });

  await recordAudit({
    action: 'cancelEvent',
    actorUserId: request.auth!.uid,
    targetId: eventId,
    result: 'SUCCESS',
  });

  return { ok: true };
});

/** Manual override — add someone to the eligibility list who wasn't swept in by publishEvent's membership snapshot. */
export const addEventAttendee = onCall(async (request) => {
  await requireAdminPermission(request, 'events');

  const eventId = String(request.data?.eventId ?? '');
  const userId = String(request.data?.userId ?? '');
  if (!eventId || !userId) throw new HttpsError('invalid-argument', 'eventId and userId are required');

  const eventSnap = await db.collection('events').doc(eventId).get();
  if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found');

  const doc: EventAttendeeDoc = {
    eventId,
    userId,
    invitedAt: FieldValue.serverTimestamp() as unknown as EventAttendeeDoc['invitedAt'],
    invitedBy: request.auth!.uid,
  };
  await db.collection('eventAttendees').doc(attendeeId(eventId, userId)).set(doc);

  await recordAudit({
    action: 'addEventAttendee',
    actorUserId: request.auth!.uid,
    targetId: `${eventId}_${userId}`,
    result: 'SUCCESS',
  });

  return { ok: true };
});

export const removeEventAttendee = onCall(async (request) => {
  await requireAdminPermission(request, 'events');

  const eventId = String(request.data?.eventId ?? '');
  const userId = String(request.data?.userId ?? '');
  if (!eventId || !userId) throw new HttpsError('invalid-argument', 'eventId and userId are required');

  await db.collection('eventAttendees').doc(attendeeId(eventId, userId)).delete();

  await recordAudit({
    action: 'removeEventAttendee',
    actorUserId: request.auth!.uid,
    targetId: `${eventId}_${userId}`,
    result: 'SUCCESS',
  });

  return { ok: true };
});

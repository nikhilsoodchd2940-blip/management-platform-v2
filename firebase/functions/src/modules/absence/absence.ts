import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { AbsenceRequestDoc, EventDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { hasAdminPermission } from '../admin/authorize';

const requestId = (eventId: string, userId: string) => `${eventId}_${userId}`;

/**
 * Member submits an absence request for an event they're on the attendee
 * list for (blueprint §7). One request per person per event — the
 * deterministic doc ID means resubmitting after a rejection overwrites
 * the previous request rather than piling up duplicates.
 */
export const submitAbsenceRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const eventId = String(request.data?.eventId ?? '');
  const reason = String(request.data?.reason ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required');
  if (!reason) throw new HttpsError('invalid-argument', 'reason is required');
  if (reason.length > 500) throw new HttpsError('invalid-argument', 'reason must be under 500 characters');

  const userId = request.auth.uid;

  const attendeeSnap = await db.collection('eventAttendees').doc(`${eventId}_${userId}`).get();
  if (!attendeeSnap.exists) {
    throw new HttpsError('failed-precondition', 'You are not on the attendee list for this event');
  }

  const existing = await db.collection('absenceRequests').doc(requestId(eventId, userId)).get();
  if (existing.exists && (existing.data() as AbsenceRequestDoc).status !== 'rejected') {
    throw new HttpsError('already-exists', 'You already have a request for this event');
  }

  const doc: AbsenceRequestDoc = {
    eventId,
    userId,
    reason,
    status: 'pending',
    requestedAt: FieldValue.serverTimestamp() as unknown as AbsenceRequestDoc['requestedAt'],
  };
  await db.collection('absenceRequests').doc(requestId(eventId, userId)).set(doc);

  return { ok: true };
});

/**
 * Host reviews a request for an event in one of their assigned Sub
 * Groups. Approval doesn't remove the person from `eventAttendees` (they
 * could still show up) — it's a record the Host has excused the absence,
 * which is what a later "who's missing and why" report reads.
 */
export const reviewAbsenceRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const eventId = String(request.data?.eventId ?? '');
  const userId = String(request.data?.userId ?? '');
  const decision = request.data?.decision; // 'approved' | 'rejected'
  if (!eventId || !userId) throw new HttpsError('invalid-argument', 'eventId and userId are required');
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new HttpsError('invalid-argument', 'decision must be "approved" or "rejected"');
  }

  const callerRole = request.auth.token.role;
  const hostGroupIds = (request.auth.token.hostGroupIds as string[] | undefined) ?? [];

  const eventSnap = await db.collection('events').doc(eventId).get();
  if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found');
  const event = eventSnap.data() as EventDoc;

  const isAssignedHost = callerRole === 'host' && event.subGroupIds.some((id) => hostGroupIds.includes(id));
  const isAuthorizedAdmin = callerRole === 'admin' && (await hasAdminPermission(request, 'requests'));
  if (!isAuthorizedAdmin && !isAssignedHost) {
    throw new HttpsError('permission-denied', 'You are not authorized to review this request');
  }

  const ref = db.collection('absenceRequests').doc(requestId(eventId, userId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Request not found');

  await ref.update({
    status: decision,
    reviewedBy: request.auth.uid,
    reviewedAt: FieldValue.serverTimestamp(),
  });

  await recordAudit({
    action: 'reviewAbsenceRequest',
    actorUserId: request.auth.uid,
    targetId: `${eventId}_${userId}`,
    result: 'SUCCESS',
    metadata: { decision },
  });

  return { ok: true };
});

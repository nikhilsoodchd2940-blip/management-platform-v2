import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { EventRequestDoc, GroupMembershipDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { requireAdminPermission } from '../admin/authorize';

/**
 * Member proposes an event for a Sub Group they belong to (blueprint §7).
 * This does NOT create a real `events` doc — it's a proposal Admin
 * reviews and, if approved, turns into an actual event via the normal
 * `createEvent`/`publishEvent` flow from Phase 2. Keeping these as two
 * separate steps (propose, then Admin explicitly creates) avoids a
 * member's input ever becoming a published event without an Admin
 * actively choosing to do so.
 */
export const submitEventRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const groupId = String(request.data?.groupId ?? '');
  const proposedTitle = String(request.data?.proposedTitle ?? '').trim();
  const startAtMs = Number(request.data?.proposedStartAtMs);
  const endAtMs = Number(request.data?.proposedEndAtMs);
  const notes = String(request.data?.notes ?? '').trim();

  if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required');
  if (!proposedTitle) throw new HttpsError('invalid-argument', 'proposedTitle is required');
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs <= startAtMs) {
    throw new HttpsError('invalid-argument', 'proposedStartAtMs and proposedEndAtMs must be valid, end after start');
  }
  if (notes.length > 1000) throw new HttpsError('invalid-argument', 'notes must be under 1000 characters');

  const membershipSnap = await db.collection('groupMemberships').doc(`${groupId}_${request.auth.uid}`).get();
  if (!membershipSnap.exists || (membershipSnap.data() as GroupMembershipDoc).status !== 'active') {
    throw new HttpsError('failed-precondition', 'You are not a member of this group');
  }

  const doc: EventRequestDoc = {
    requestedBy: request.auth.uid,
    groupId,
    proposedTitle,
    proposedStartAt: Timestamp.fromMillis(startAtMs),
    proposedEndAt: Timestamp.fromMillis(endAtMs),
    notes: notes || undefined,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp() as unknown as EventRequestDoc['createdAt'],
  };

  const ref = await db.collection('eventRequests').add(doc);
  return { eventRequestId: ref.id };
});

/** Admin-only review — approving is a status change, not an automatic event creation (see comment above). */
export const reviewEventRequest = onCall(async (request) => {
  await requireAdminPermission(request, 'requests');

  const eventRequestId = String(request.data?.eventRequestId ?? '');
  const decision = request.data?.decision;
  if (!eventRequestId) throw new HttpsError('invalid-argument', 'eventRequestId is required');
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new HttpsError('invalid-argument', 'decision must be "approved" or "rejected"');
  }

  const ref = db.collection('eventRequests').doc(eventRequestId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Event request not found');

  await ref.update({
    status: decision,
    reviewedBy: request.auth!.uid,
    reviewedAt: FieldValue.serverTimestamp(),
  });

  await recordAudit({
    action: 'reviewEventRequest',
    actorUserId: request.auth!.uid,
    targetId: eventRequestId,
    result: 'SUCCESS',
    metadata: { decision },
  });

  return { ok: true };
});
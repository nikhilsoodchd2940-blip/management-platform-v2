import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { auth, db } from '../../config/firebase';
import { requireE164 } from '../../utils/phone';
import { checkRateLimit } from '../../utils/rateLimit';
import { recordAudit } from '../../utils/logger';
import { requireAdminPermission } from '../admin/authorize';
import type { MemberIdIndexDoc, PhoneUpdateRequestDoc, UserDoc } from '../../types/models';

const REQUEST_MAX_PER_WINDOW = 3;
const REQUEST_WINDOW_SECONDS = 60 * 60 * 24; // 1/day — this is a "tell an admin" action, not something legitimate use needs often

/**
 * Submitted from the mobile app's registration-mismatch screen — the
 * one path someone whose phone changed has, since they can't complete
 * registration (that's exactly what's mismatched) and therefore can't
 * get a session to call an authenticated function. Gated only by
 * knowing their own Member ID; no session required. Doesn't touch the
 * member's record itself — an Admin has to explicitly approve it (see
 * reviewPhoneUpdateRequest below), same as any other identity change.
 */
export const requestPhoneUpdate = onCall(async (request) => {
  const memberId = String(request.data?.memberId ?? '').trim();
  const requestedPhone = requireE164(String(request.data?.requestedPhone ?? ''));
  const note = String(request.data?.note ?? '').trim();

  if (!memberId) throw new HttpsError('invalid-argument', 'memberId is required');

  const { allowed } = await checkRateLimit(`requestPhoneUpdate:${memberId}`, REQUEST_MAX_PER_WINDOW, REQUEST_WINDOW_SECONDS);
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Too many requests for this Member ID. Try again tomorrow, or contact your admin directly.');
  }

  const indexSnap = await db.collection('memberIdIndex').doc(memberId).get();
  if (!indexSnap.exists) {
    throw new HttpsError('not-found', 'We could not find that Member ID. Check it and try again.');
  }

  const doc: PhoneUpdateRequestDoc = {
    memberId,
    requestedPhone,
    ...(note ? { note } : {}),
    status: 'pending',
    createdAt: FieldValue.serverTimestamp() as unknown as PhoneUpdateRequestDoc['createdAt'],
  };
  const ref = await db.collection('phoneUpdateRequests').add(doc);

  await recordAudit({
    action: 'requestPhoneUpdate',
    actorUserId: null,
    targetId: ref.id,
    result: 'SUCCESS',
    metadata: { memberId },
  });

  return { ok: true as const };
});

/**
 * Admin approves/rejects a phone-update request. Approving applies the
 * SAME phone-change logic updateMember uses (modules/groups/members.ts)
 * — updates the Firebase Auth identity, not just the Firestore mirror —
 * so the member can actually register/log in with the new number
 * immediately afterward.
 */
export const reviewPhoneUpdateRequest = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const requestId = String(request.data?.requestId ?? '').trim();
  const decision = request.data?.decision as 'approved' | 'rejected';
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required');
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new HttpsError('invalid-argument', "decision must be 'approved' or 'rejected'");
  }

  const reqRef = db.collection('phoneUpdateRequests').doc(requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new HttpsError('not-found', 'Request not found');
  const phoneRequest = reqSnap.data() as PhoneUpdateRequestDoc;
  if (phoneRequest.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'This request has already been reviewed');
  }

  if (decision === 'approved') {
    const indexSnap = await db.collection('memberIdIndex').doc(phoneRequest.memberId).get();
    if (!indexSnap.exists) {
      throw new HttpsError('not-found', 'That Member ID no longer exists — the member record may have been deleted');
    }
    const userId = (indexSnap.data() as MemberIdIndexDoc).userId;
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'Member not found');
    const current = userSnap.data() as UserDoc;

    if (phoneRequest.requestedPhone !== current.phone) {
      try {
        await auth.updateUser(userId, { phoneNumber: phoneRequest.requestedPhone });
      } catch (err) {
        if ((err as { code?: string })?.code === 'auth/phone-number-already-exists') {
          throw new HttpsError('already-exists', 'That phone number is already in use by another account');
        }
        throw new HttpsError('internal', 'Could not update phone number');
      }
      await userRef.update({ phone: phoneRequest.requestedPhone, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  await reqRef.update({
    status: decision,
    reviewedBy: request.auth!.uid,
    reviewedAt: FieldValue.serverTimestamp(),
  });

  await recordAudit({
    action: 'reviewPhoneUpdateRequest',
    actorUserId: request.auth!.uid,
    targetId: requestId,
    result: 'SUCCESS',
    metadata: { decision, memberId: phoneRequest.memberId },
  });

  return { ok: true as const };
});

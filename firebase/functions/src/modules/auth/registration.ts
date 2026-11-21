import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { auth, db } from '../../config/firebase';
import { twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid, APP_CHECK_ENFORCED } from '../../config/env';
import { recordAudit } from '../../utils/logger';
import { requireE164 } from '../../utils/phone';
import { checkRateLimit } from '../../utils/rateLimit';
import { sendVerificationCode, checkVerificationCode } from './otp';
import type { MemberIdIndexDoc, UserDoc } from '../../types/models';
import { requireAdminPermission } from '../admin/authorize';

/**
 * Closed registration (Phase 6, see docs/DATA_MODEL.md "RegistrationStatus"):
 * a person can only reach the app after an Admin has pre-loaded their
 * Member ID + phone (addMember/importMembers — modules/groups/members.ts)
 * AND they've completed this three-step flow:
 *   1. beginRegistration    — memberId + phone must match the pre-loaded
 *      record; on success, sends the OTP.
 *   2. completeRegistrationOtp — verifies the OTP, mints a sign-in token
 *      for the EXISTING (Admin-provisioned) Auth identity. Never creates
 *      a new Auth user — that already happened in addMember/importMembers.
 *   3. submitRegistration   — called once already signed in (so Storage
 *      rules can be checked against a real uid); records the mandatory
 *      profile photo + optional email and flips registrationStatus to
 *      'pending_approval'.
 * An Admin then calls reviewRegistration to approve or reject.
 */

const REG_MAX_PER_WINDOW = 5;
const REG_WINDOW_SECONDS = 60 * 60;

function requireMemberId(raw: unknown): string {
  const memberId = String(raw ?? '').trim();
  if (!memberId) throw new HttpsError('invalid-argument', 'memberId is required');
  return memberId;
}

/** Looks up the pre-loaded record for a memberId and confirms it matches the given phone. Throws with a caller-safe message on any mismatch. */
async function matchMemberRecord(memberId: string, phone: string): Promise<{ userId: string; user: UserDoc }> {
  const indexSnap = await db.collection('memberIdIndex').doc(memberId).get();
  if (!indexSnap.exists) {
    throw new HttpsError('not-found', 'We could not find that Member ID. Check it and try again, or contact your admin.');
  }
  const userId = (indexSnap.data() as MemberIdIndexDoc).userId;
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'We could not find that Member ID. Check it and try again, or contact your admin.');
  }
  const user = userSnap.data() as UserDoc;
  if (user.phone !== phone) {
    throw new HttpsError('permission-denied', 'That Member ID and phone number do not match our records.');
  }
  return { userId, user };
}

export const beginRegistration = onCall(
  { secrets: [twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid], enforceAppCheck: APP_CHECK_ENFORCED },
  async (request) => {
    const memberId = requireMemberId(request.data?.memberId);
    const phone = requireE164(String(request.data?.phone ?? ''));

    const { allowed } = await checkRateLimit(`beginRegistration:${phone}`, REG_MAX_PER_WINDOW, REG_WINDOW_SECONDS);
    if (!allowed) {
      throw new HttpsError('resource-exhausted', 'Too many attempts for this number. Try again later.');
    }

    const { user } = await matchMemberRecord(memberId, phone);

    if (user.status === 'disabled') {
      throw new HttpsError('permission-denied', 'This account has been deactivated. Contact your admin.');
    }
    if (user.registrationStatus === 'approved') {
      throw new HttpsError('already-exists', 'This Member ID is already registered — please sign in instead.');
    }
    if (user.registrationStatus === 'pending_approval') {
      throw new HttpsError('already-exists', 'Registration already submitted and is awaiting admin approval.');
    }

    await sendVerificationCode(phone);
    return { sent: true };
  }
);

export const completeRegistrationOtp = onCall(
  { secrets: [twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid], enforceAppCheck: APP_CHECK_ENFORCED },
  async (request) => {
    const memberId = requireMemberId(request.data?.memberId);
    const phone = requireE164(String(request.data?.phone ?? ''));
    const code = String(request.data?.code ?? '');
    if (!/^\d{4,10}$/.test(code)) {
      throw new HttpsError('invalid-argument', 'code is required');
    }

    // Re-check the match — cheap, and closes the gap where someone's
    // record changed (e.g. Admin corrected the phone) between step 1 and
    // step 2 of a multi-minute OTP round trip.
    const { userId, user } = await matchMemberRecord(memberId, phone);
    if (user.registrationStatus === 'approved' || user.registrationStatus === 'pending_approval') {
      throw new HttpsError('already-exists', 'This Member ID is already registered.');
    }

    const approved = await checkVerificationCode(phone, code);
    if (!approved) {
      await recordAudit({ action: 'completeRegistrationOtp', actorUserId: null, result: 'DENIED', metadata: { phone, memberId } });
      throw new HttpsError('permission-denied', 'Invalid or expired code');
    }

    const customToken = await auth.createCustomToken(userId);

    await recordAudit({
      action: 'completeRegistrationOtp',
      actorUserId: userId,
      result: 'SUCCESS',
      metadata: { phone, memberId },
    });

    return { customToken, uid: userId };
  }
);

/**
 * Final step, called once already signed in with the token from
 * completeRegistrationOtp (or by someone who logged in via plain
 * verifyOtp but never finished registration — same end state either
 * way). photoUrl must be a Storage download URL already uploaded to
 * `profilePhotos/{uid}/...` (see firebase/storage.rules) — this
 * function just records it, it doesn't accept raw image bytes.
 */
export const submitRegistration = onCall({ enforceAppCheck: APP_CHECK_ENFORCED }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first');
  const uid = request.auth.uid;

  const photoUrl = String(request.data?.photoUrl ?? '').trim();
  const email = String(request.data?.email ?? '').trim() || undefined;

  if (!photoUrl) throw new HttpsError('invalid-argument', 'A profile photo is required');
  if (!photoUrl.includes(`profilePhotos%2F${uid}%2F`) && !photoUrl.includes(`profilePhotos/${uid}/`)) {
    throw new HttpsError('invalid-argument', 'photoUrl must point to your own uploaded photo');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'That email address does not look valid');
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Profile not found');
  const user = userSnap.data() as UserDoc;

  if (user.registrationStatus === 'approved') {
    throw new HttpsError('already-exists', 'You are already registered.');
  }
  if (user.registrationStatus === 'pending_approval') {
    throw new HttpsError('already-exists', 'Your registration is already awaiting admin approval.');
  }

  const updates: Record<string, unknown> = {
    photoUrl,
    registrationStatus: 'pending_approval',
    rejectionReason: FieldValue.delete(), // clear a prior rejection's reason on resubmission
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (email) updates.email = email;
  await userRef.set(updates, { merge: true });

  await recordAudit({ action: 'submitRegistration', actorUserId: uid, result: 'SUCCESS', metadata: {} });

  return { ok: true as const };
});

/** Admin approves or rejects a pending registration. `reason` is shown to the member on the app's pending/rejected screen when rejecting (e.g. "photo was blurry" or "photo didn't match ID"). */
export const reviewRegistration = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '').trim();
  const decision = request.data?.decision as 'approved' | 'rejected';
  const reason = String(request.data?.reason ?? '').trim();
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new HttpsError('invalid-argument', "decision must be 'approved' or 'rejected'");
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Member not found');
  const user = userSnap.data() as UserDoc;
  if (user.registrationStatus !== 'pending_approval') {
    throw new HttpsError('failed-precondition', 'This member is not awaiting approval');
  }

  await userRef.update({
    registrationStatus: decision,
    rejectionReason: decision === 'rejected' && reason ? reason : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await recordAudit({
    action: 'reviewRegistration',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { decision, reason: reason || null },
  });

  return { ok: true as const };
});

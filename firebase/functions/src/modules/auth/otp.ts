import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Twilio } from 'twilio';
import { auth, db } from '../../config/firebase';
import { twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid, twilioTestMode, OTP_TEST_MODE_FIXED_CODE, APP_CHECK_ENFORCED } from '../../config/env';
import { getIntegrationConfig } from '../../config/integrationConfig';
import { log, recordAudit } from '../../utils/logger';
import { requireE164 } from '../../utils/phone';
import { checkRateLimit } from '../../utils/rateLimit';
import type { UserDoc } from '../../types/models';

/**
 * OTP login, Twilio-backed per the fixed stack (blueprint §2 — Twilio, not
 * Firebase's own phone auth, to avoid two SMS providers). Two-step:
 * sendOtp() triggers a Twilio Verify code; verifyOtp() checks it and, only
 * on success, mints a Firebase custom token. The custom token is exchanged
 * client-side for a real Firebase session — Functions never hand back a
 * long-lived credential directly.
 *
 * Phase 5: sendOtp is rate-limited per phone number (Twilio Verify has its
 * own internal rate limiting too, but that's Twilio's cost-protection, not
 * ours — this stops one phone number from being used to run up our Twilio
 * bill or spam a real person via repeated callable invocations).
 *
 * TEST MODE — added to unblock development when Twilio isn't upgradeable
 * yet (trial accounts can't create a Verify Service without billing).
 * When TWILIO_TEST_MODE is exactly 'true', both functions below skip
 * Twilio entirely: sendOtp always "succeeds" without sending a real SMS,
 * and verifyOtp accepts ONLY the fixed code OTP_TEST_MODE_FIXED_CODE
 * ('123456'). Every use logs a loud warning so it's unmissable in Cloud
 * Logging. This must be OFF (unset) before any real launch — see
 * docs/LAUNCH_CHECKLIST.md. The Twilio secrets are still required at
 * deploy time (Functions v2 binds secret versions at deploy regardless
 * of which code path runs) — set them to any placeholder value while in
 * test mode; they're never read.
 */

function twilioClient(sid: string, token: string): Twilio {
  return new Twilio(sid, token);
}

function isTestMode(): boolean {
  return twilioTestMode.value() === 'true';
}

const OTP_MAX_PER_WINDOW = 5;
const OTP_WINDOW_SECONDS = 60 * 60; // 1 hour

/**
 * Shared Twilio Verify "send" call, factored out so
 * modules/auth/registration.ts (Member ID-gated registration OTP) uses
 * the exact same send path as plain login — one place to change if the
 * provider or test-mode behavior ever changes.
 */
export async function sendVerificationCode(phone: string): Promise<void> {
  if (isTestMode()) {
    log.warn('sendVerificationCode: TWILIO_TEST_MODE is active — no real SMS sent. This must be off before launch.', {
      phone,
    });
    return;
  }
  const config = await getIntegrationConfig();
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioVerifyServiceSid) {
    log.error('sendVerificationCode: Twilio is not configured (set it in the admin panel\'s Intégrations page)', { phone });
    throw new HttpsError('failed-precondition', 'SMS delivery is not configured yet. Ask an admin to set Twilio credentials.');
  }
  const client = twilioClient(config.twilioAccountSid, config.twilioAuthToken);
  try {
    await client.verify.v2.services(config.twilioVerifyServiceSid).verifications.create({ to: phone, channel: 'sms' });
  } catch (err) {
    log.error('sendVerificationCode: Twilio Verify request failed', { phone, err: String(err) });
    throw new HttpsError('internal', 'Could not send verification code. Try again shortly.');
  }
}

/** Shared Twilio Verify "check" call — see sendVerificationCode above. */
export async function checkVerificationCode(phone: string, code: string): Promise<boolean> {
  if (isTestMode()) {
    log.warn('checkVerificationCode: TWILIO_TEST_MODE is active — bypassing real verification. This must be off before launch.', {
      phone,
    });
    return code === OTP_TEST_MODE_FIXED_CODE;
  }
  const config = await getIntegrationConfig();
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioVerifyServiceSid) {
    log.error('checkVerificationCode: Twilio is not configured (set it in the admin panel\'s Intégrations page)', { phone });
    return false;
  }
  const client = twilioClient(config.twilioAccountSid, config.twilioAuthToken);
  try {
    const check = await client.verify.v2.services(config.twilioVerifyServiceSid).verificationChecks.create({ to: phone, code });
    return check.status === 'approved';
  } catch (err) {
    log.warn('checkVerificationCode: Twilio Verify check failed', { phone, err: String(err) });
    return false;
  }
}

export const sendOtp = onCall(
  { secrets: [twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid], enforceAppCheck: APP_CHECK_ENFORCED },
  async (request) => {
    const phone = requireE164(String(request.data?.phone ?? ''));

    const { allowed } = await checkRateLimit(`sendOtp:${phone}`, OTP_MAX_PER_WINDOW, OTP_WINDOW_SECONDS);
    if (!allowed) {
      throw new HttpsError('resource-exhausted', 'Too many codes requested for this number. Try again later.');
    }

    await sendVerificationCode(phone);
    return { sent: true };
  }
);

/**
 * On successful code verification: sign in to an EXISTING profile only.
 *
 * Phase 6 (closed registration): this used to find-or-create a fresh
 * Auth user + users/{uid} doc for any phone number that could receive an
 * SMS — that was the open self-registration hole. Now every profile is
 * provisioned exactly once, up front, by an Admin (addMember /
 * importMembers, see modules/groups/members.ts) or by the member
 * completing modules/auth/registration.ts's Member ID + phone flow. This
 * function is login only: if there's no Auth user for this phone, or no
 * matching users/{uid} doc, that means nobody has registered this number
 * yet, and we refuse rather than silently creating an account.
 */
export const verifyOtp = onCall(
  { secrets: [twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid], enforceAppCheck: APP_CHECK_ENFORCED },
  async (request) => {
    const phone = requireE164(String(request.data?.phone ?? ''));
    const code = String(request.data?.code ?? '');
    if (!/^\d{4,10}$/.test(code)) {
      throw new HttpsError('invalid-argument', 'code is required');
    }

    const approved = await checkVerificationCode(phone, code);
    if (!approved) {
      await recordAudit({ action: 'verifyOtp', actorUserId: null, result: 'DENIED', metadata: { phone } });
      throw new HttpsError('permission-denied', 'Invalid or expired code');
    }

    let userRecord;
    try {
      userRecord = await auth.getUserByPhoneNumber(phone);
    } catch {
      await recordAudit({ action: 'verifyOtp', actorUserId: null, result: 'DENIED', metadata: { phone, reason: 'not_registered' } });
      throw new HttpsError('permission-denied', 'This phone number is not registered. Complete registration with your Member ID first.');
    }

    const userSnap = await db.collection('users').doc(userRecord.uid).get();
    if (!userSnap.exists) {
      await recordAudit({ action: 'verifyOtp', actorUserId: null, result: 'DENIED', metadata: { phone, reason: 'no_profile' } });
      throw new HttpsError('permission-denied', 'This phone number is not registered. Complete registration with your Member ID first.');
    }

    // Deactivated members (modules/groups/members.ts setMemberStatus)
    // are also disabled at the Auth level, which would already block
    // signInWithCustomToken client-side — this check just gives a
    // clearer error and stops us minting a token for them at all.
    if ((userSnap.data() as UserDoc).status === 'disabled') {
      await recordAudit({ action: 'verifyOtp', actorUserId: userRecord.uid, result: 'DENIED', metadata: { phone, reason: 'disabled' } });
      throw new HttpsError('permission-denied', 'This account has been deactivated. Contact your admin.');
    }

    const customToken = await auth.createCustomToken(userRecord.uid);

    await recordAudit({
      action: 'verifyOtp',
      actorUserId: userRecord.uid,
      result: 'SUCCESS',
      metadata: { phone },
    });

    return { customToken, uid: userRecord.uid, isNewUser: false };
  }
);
import { defineSecret, defineString } from 'firebase-functions/params';

/**
 * All third-party credentials are declared here as Functions v2 secrets —
 * never read from process.env directly and never given default values,
 * so a missing secret fails loudly at deploy time instead of silently
 * running with an empty string. Set real values with:
 *   firebase functions:secrets:set TWILIO_ACCOUNT_SID
 * See docs/ENVIRONMENT.md for the full list and rationale.
 */

/**
 * Phase 1 assumption: single-organization deployment (one Main Group per
 * Firebase project — see docs/ARCHITECTURE.md §3, one project per
 * environment, not per tenant). Every identity gets this same `orgId`
 * claim. If a future phase needs multiple organizations in one Firebase
 * project, this becomes a lookup instead of a constant — deliberately
 * not built now since nothing in the blueprint asks for multi-tenancy.
 */
export const DEFAULT_ORG_ID = 'default-org';

/**
 * How far outside an event's [startAt, endAt] window a check-in is still
 * allowed (blueprint's own QR flow says "+ grace config" — see
 * docs/QR_DATAFLOW.md). Applied symmetrically before start and after end.
 * A single shared constant for now; if different event types need
 * different grace windows later, this becomes a per-event field instead
 * of being generalized speculatively now.
 */
export const CHECK_IN_GRACE_MINUTES = 15;

export const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
export const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
export const twilioVerifyServiceSid = defineSecret('TWILIO_VERIFY_SERVICE_SID');

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

// HMAC key used to sign/verify personal QR payloads (modules/qr/personalQr.ts).
export const qrSigningSecret = defineSecret('QR_SIGNING_SECRET');

/**
 * The Twilio phone number reminders are sent FROM (Messages API, not
 * Verify — see modules/reminders/reminders.ts). Not a secret (it's a
 * public phone number), so this is a regular Functions v2 string param
 * rather than a Secret Manager entry — set via a
 * firebase/functions/.env.<project-id> file (gitignored) or the CLI's
 * interactive prompt on first deploy. See docs/ENVIRONMENT.md.
 */
export const twilioFromNumber = defineString('TWILIO_FROM_NUMBER');

/**
 * TEMPORARY, EXPLICIT bypass for OTP delivery when Twilio isn't set up
 * yet (e.g. can't upgrade off a trial account) — see modules/auth/otp.ts.
 * When set to the exact string 'true', sendOtp/verifyOtp skip real Twilio
 * calls entirely and accept a fixed code instead. Defaults to unset
 * (disabled) so it can never be accidentally on — this must be
 * DELIBERATELY set to 'true' in firebase/functions/.env.<project-id> to
 * activate, and every use of it is logged loudly (log.warn) so it shows
 * up unmistakably in Cloud Logging. MUST be unset before a real launch —
 * see docs/LAUNCH_CHECKLIST.md.
 */
export const twilioTestMode = defineString('TWILIO_TEST_MODE', { default: '' });
export const OTP_TEST_MODE_FIXED_CODE = '123456';

/**
 * App Check enforcement toggle (Phase 5). `onCall`'s `enforceAppCheck`
 * option is resolved when the function is *defined*, not per-request, so
 * it can't be a Functions v2 param read at runtime (defineString().value()
 * only works inside a handler) — it has to be a plain boolean known at
 * module load. That means it has to come from `process.env` directly
 * rather than `defineString()`.
 *
 * Originally this was derived from the project ID (`<app>-dev` vs
 * `-staging`/`-prod`), assuming three separate Firebase projects per
 * docs/ENVIRONMENT.md. In practice this codebase is currently deployed to
 * a single Firebase project (`management-software-f48fc`), so that
 * project-name convention doesn't apply here — this now uses an explicit
 * opt-out env var instead:
 *
 *   APP_CHECK_DISABLED=true  -> enforcement OFF. Any client (any device,
 *                               any number of testers) can call sendOtp,
 *                               verifyOtp, checkIn, assignRole,
 *                               setAdminPermissions, createDonationIntent
 *                               with no App Check token at all — no debug
 *                               tokens, no per-device Console step.
 *   unset / anything else    -> enforcement ON (the safe default).
 *
 * Set it in `firebase/functions/.env.management-software-f48fc` (Cloud
 * Functions v2 auto-loads a `.env.<project-id>` file into process.env at
 * both deploy and runtime — see docs/ENVIRONMENT.md for the existing
 * TWILIO_FROM_NUMBER precedent):
 *
 *   APP_CHECK_DISABLED=true
 *
 * MUST be removed (or set to anything other than 'true') before a real
 * launch — this is a development convenience, not a production
 * configuration. If/when this project moves to separate dev/staging/prod
 * Firebase projects, only set this in the dev project's .env file. See
 * docs/LAUNCH_CHECKLIST.md.
 */
const appCheckDisabledRaw = (process.env.APP_CHECK_DISABLED ?? '').trim().toLowerCase();
export const APP_CHECK_ENFORCED = appCheckDisabledRaw !== 'true';

// One-time startup log (visible in Cloud Logging under this function's
// logs, severity INFO) so this can be verified directly instead of
// guessed at — shows exactly what value was read and what it resolved
// to, character-for-character.
console.log(
  `[env] APP_CHECK_DISABLED raw="${process.env.APP_CHECK_DISABLED ?? '(unset)'}" ` +
  `normalized="${appCheckDisabledRaw}" -> APP_CHECK_ENFORCED=${APP_CHECK_ENFORCED}`
);

/**
 * How far ahead of an event's start time reminders go out, and the
 * scheduler's run interval — both single global constants for now, same
 * "generalize later if actually needed" reasoning as CHECK_IN_GRACE_MINUTES.
 */
export const REMINDER_LEAD_MINUTES = 60;
export const REMINDER_SCHEDULE = 'every 15 minutes';
import { db } from './firebase';
import { twilioAccountSid, twilioAuthToken, twilioVerifyServiceSid, twilioFromNumber, stripeSecretKey, stripeWebhookSecret } from './env';

/**
 * Live, admin-editable third-party credentials — set from the admin
 * panel's Intégrations page (see modules/integrations/integrations.ts),
 * stored in this one locked Firestore doc rather than Secret Manager.
 * Firestore rules deny ALL client read/write on `config/integrations`
 * (see firestore.rules) — only Cloud Functions (Admin SDK, bypasses
 * rules) ever touch it, and only the two callables in
 * modules/integrations/integrations.ts ever write to it. The admin
 * panel itself never reads the raw values back — see getIntegrationStatus.
 *
 * Precedence: a value set here WINS over the old `defineSecret`/env
 * value, so switching a Twilio/Stripe key from the admin panel takes
 * effect on the next call, no redeploy. If this doc has nothing set for
 * a field, the function falls back to the Secret Manager value/env param
 * exactly as before — existing deployments that only ever used
 * `firebase functions:secrets:set` keep working unchanged.
 *
 * Cached in memory per function instance for a short window, since
 * Cloud Functions instances are reused across invocations and this
 * would otherwise mean one extra Firestore read per sendOtp/donation
 * call — acceptable staleness for credentials that change rarely.
 */
export interface IntegrationConfig {
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioVerifyServiceSid: string;
  twilioFromNumber: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripePublishableKey: string; // safe to expose client-side; stored here purely so the admin panel has one place to set it
  googleMapsApiKey: string;
}

const CACHE_TTL_MS = 30_000;
let cached: { value: Partial<IntegrationConfig>; expiresAt: number } | null = null;

async function readFirestoreConfig(): Promise<Partial<IntegrationConfig>> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const snap = await db.collection('config').doc('integrations').get();
  const value = (snap.exists ? snap.data() : {}) as Partial<IntegrationConfig>;
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Clears the in-memory cache immediately after a save, so the very
 *  next call (e.g. an admin's own "send test OTP") sees the new value
 *  instead of waiting out the TTL. */
export function invalidateIntegrationConfigCache(): void {
  cached = null;
}

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Reads the effective config: Firestore value if set, else the
 * Secret-Manager-bound value. Callers must still declare the relevant
 * `defineSecret`s in their `onCall({ secrets: [...] })` for the fallback
 * to work AND because Functions v2 requires that declaration to grant
 * the secret's IAM access in the first place.
 */
export async function getIntegrationConfig(): Promise<IntegrationConfig> {
  const stored = await readFirestoreConfig();

  // .value() on a defineSecret/defineString is safe to call even when
  // nothing was ever set via `firebase functions:secrets:set` — it
  // just returns ''. Wrapped so one unset secret can't throw and take
  // down a field that Firestore DOES have a value for.
  const secretValue = (secret: { value(): string }): string => {
    try {
      return secret.value();
    } catch {
      return '';
    }
  };

  return {
    twilioAccountSid: firstNonEmpty(stored.twilioAccountSid, secretValue(twilioAccountSid)),
    twilioAuthToken: firstNonEmpty(stored.twilioAuthToken, secretValue(twilioAuthToken)),
    twilioVerifyServiceSid: firstNonEmpty(stored.twilioVerifyServiceSid, secretValue(twilioVerifyServiceSid)),
    twilioFromNumber: firstNonEmpty(stored.twilioFromNumber, secretValue(twilioFromNumber)),
    stripeSecretKey: firstNonEmpty(stored.stripeSecretKey, secretValue(stripeSecretKey)),
    stripeWebhookSecret: firstNonEmpty(stored.stripeWebhookSecret, secretValue(stripeWebhookSecret)),
    stripePublishableKey: firstNonEmpty(stored.stripePublishableKey),
    googleMapsApiKey: firstNonEmpty(stored.googleMapsApiKey),
  };
}

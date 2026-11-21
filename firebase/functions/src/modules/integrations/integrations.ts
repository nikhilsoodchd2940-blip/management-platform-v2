import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission } from '../admin/authorize';
import { recordAudit } from '../../utils/logger';
import { getIntegrationConfig, invalidateIntegrationConfigCache, type IntegrationConfig } from '../../config/integrationConfig';

type FieldKey = keyof IntegrationConfig;

/** Which fields are genuinely secret (never echoed back to the admin
 *  panel, only a "configured" flag + masked last-4) vs. safe to show in
 *  full (public phone number, Stripe's publishable key is documented by
 *  Stripe itself as safe for client-side exposure, and a Maps key is
 *  restricted by HTTP referrer/app package rather than by secrecy). */
const SECRET_FIELDS: readonly FieldKey[] = [
  'twilioAccountSid',
  'twilioAuthToken',
  'twilioVerifyServiceSid',
  'stripeSecretKey',
  'stripeWebhookSecret',
];

const VALIDATORS: Partial<Record<FieldKey, (v: string) => string | null>> = {
  twilioAccountSid: (v) => (/^AC[a-zA-Z0-9]{30,}$/.test(v) ? null : 'Twilio Account SID should start with "AC"'),
  twilioVerifyServiceSid: (v) => (/^VA[a-zA-Z0-9]{30,}$/.test(v) ? null : 'Twilio Verify Service SID should start with "VA"'),
  twilioAuthToken: (v) => (v.length >= 20 ? null : 'That looks too short for a Twilio Auth Token'),
  twilioFromNumber: (v) => (/^\+[1-9]\d{6,14}$/.test(v) ? null : 'Use E.164 format, e.g. +15551234567'),
  stripeSecretKey: (v) => (/^sk_(test|live)_/.test(v) ? null : 'Stripe secret keys start with "sk_test_" or "sk_live_"'),
  stripeWebhookSecret: (v) => (/^whsec_/.test(v) ? null : 'Stripe webhook signing secrets start with "whsec_"'),
  stripePublishableKey: (v) => (/^pk_(test|live)_/.test(v) ? null : 'Stripe publishable keys start with "pk_test_" or "pk_live_"'),
  googleMapsApiKey: (v) => (v.length >= 20 ? null : 'That looks too short for a Google Maps API key'),
};

const ALL_FIELDS: readonly FieldKey[] = [
  'twilioAccountSid',
  'twilioAuthToken',
  'twilioVerifyServiceSid',
  'twilioFromNumber',
  'stripeSecretKey',
  'stripeWebhookSecret',
  'stripePublishableKey',
  'googleMapsApiKey',
];

/**
 * Returns, per field: whether it's configured, and for non-secret
 * fields the actual value (so the admin sees what's set); for secret
 * fields only a last-4 hint, never the value itself. The admin panel
 * renders this — it never has another way to read `config/integrations`
 * (Firestore rules deny it outright).
 */
export const getIntegrationStatus = onCall(async (request) => {
  await requireAdminPermission(request, 'integrations');

  const config = await getIntegrationConfig();
  const result: Record<string, { configured: boolean; value?: string; hint?: string }> = {};

  for (const field of ALL_FIELDS) {
    const value = config[field];
    const configured = value.length > 0;
    if (!configured) {
      result[field] = { configured: false };
    } else if (SECRET_FIELDS.includes(field)) {
      result[field] = { configured: true, hint: `•••• ${value.slice(-4)}` };
    } else {
      result[field] = { configured: true, value };
    }
  }

  return result;
});

/**
 * Sets/clears one or more integration fields. Only fields present in
 * the request are touched — omit a field to leave it as-is. Send an
 * empty string for a field to clear it (falls back to the Secret
 * Manager value, if any — see getIntegrationConfig).
 */
export const updateIntegrationSettings = onCall(async (request) => {
  await requireAdminPermission(request, 'integrations');

  const data = (request.data ?? {}) as Partial<Record<FieldKey, unknown>>;
  const patch: Record<string, string | FirebaseFirestore.FieldValue> = {};
  const changedFields: string[] = [];

  for (const field of ALL_FIELDS) {
    if (!(field in data)) continue; // not touched
    const raw = data[field];
    if (raw === null || raw === '') {
      patch[field] = FieldValue.delete();
      changedFields.push(`${field}: cleared`);
      continue;
    }
    if (typeof raw !== 'string') {
      throw new HttpsError('invalid-argument', `${field} must be a string`);
    }
    const trimmed = raw.trim();
    const validator = VALIDATORS[field];
    if (validator) {
      const error = validator(trimmed);
      if (error) throw new HttpsError('invalid-argument', `${field}: ${error}`);
    }
    patch[field] = trimmed;
    changedFields.push(field);
  }

  if (changedFields.length === 0) {
    throw new HttpsError('invalid-argument', 'Nothing to update');
  }

  await db.collection('config').doc('integrations').set(patch, { merge: true });
  invalidateIntegrationConfigCache();

  await recordAudit({
    action: 'updateIntegrationSettings',
    actorUserId: request.auth!.uid,
    targetId: 'config/integrations',
    result: 'SUCCESS',
    // Never log actual secret values — just which fields changed and
    // whether each was set or cleared.
    metadata: { changedFields },
  });

  return { ok: true };
});

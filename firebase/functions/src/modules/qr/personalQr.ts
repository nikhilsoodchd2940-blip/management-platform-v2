import * as crypto from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { qrSigningSecret } from '../../config/env';

/**
 * Every Member/Host gets ONE stable personal QR (blueprint §5 — "Display
 * one unique personal QR tied to the account"), not a rotating one. It
 * encodes only the user's own ID plus an HMAC signature — nothing else
 * (no group membership, no attendance state), so scanning it never
 * exposes sensitive personal data even if the QR image itself leaks.
 *
 * Deliberately stateless: no Firestore write, no issuedAt stored anywhere.
 * The signature is stable for as long as QR_SIGNING_SECRET is unchanged.
 * Revocation-by-rotation and any per-QR expiry are Phase 2/5 hardening
 * concerns (see docs/QR_DATAFLOW.md) — out of scope here.
 *
 * The signing/verification functions are pure and exported separately
 * from the callable specifically so they're unit-testable without the
 * Secret Manager / emulator (see test/personalQr.test.ts).
 */

export function signQrPayload(userId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(userId).digest('hex');
}

export function verifyQrPayload(userId: string, signature: string, secret: string): boolean {
  const expected = signQrPayload(userId, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  // Reject before timingSafeEqual if lengths differ — timingSafeEqual
  // throws on mismatched lengths rather than returning false.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface QrPayload {
  userId: string;
  sig: string;
}

export const getPersonalQr = onCall({ secrets: [qrSigningSecret] }, (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  const userId = request.auth.uid;
  const sig = signQrPayload(userId, qrSigningSecret.value());
  const payload: QrPayload = { userId, sig };
  return { qrData: JSON.stringify(payload) };
});

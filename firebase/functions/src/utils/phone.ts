import { HttpsError } from 'firebase-functions/v2/https';

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string): boolean {
  return E164_RE.test(value);
}

/** Throws HttpsError('invalid-argument') rather than guessing a country code. */
export function requireE164(phone: string): string {
  if (!isE164(phone)) {
    throw new HttpsError('invalid-argument', `phone must be in E.164 format, e.g. +15551234567 (got: ${phone})`);
  }
  return phone;
}

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { recordAudit } from '../../utils/logger';
import { requireAdminPermission } from '../admin/authorize';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * Sets the org's support contact — shown to a member on the mobile
 * registration screen when their Member ID + phone don't match records
 * (e.g. their number changed and the admin hasn't updated it yet), so
 * that error has an actual next step instead of being a dead end.
 * Reuses the 'groups' admin permission scope (hierarchy/org-level
 * config) rather than adding a whole new permission type for one
 * settings form — see types/models.ts AdminPermission if that ever
 * needs to change.
 */
export const updateOrgSettings = onCall(async (request) => {
  await requireAdminPermission(request, 'groups');

  const supportEmail = String(request.data?.supportEmail ?? '').trim();
  const supportPhone = String(request.data?.supportPhone ?? '').trim();

  if (supportEmail && !EMAIL_RE.test(supportEmail)) {
    throw new HttpsError('invalid-argument', 'That email address does not look valid');
  }
  if (supportPhone && !E164_RE.test(supportPhone)) {
    throw new HttpsError('invalid-argument', 'Phone must be in E.164 format, e.g. +15551234567');
  }

  const doc: Record<string, unknown> = {
    supportEmail: supportEmail || FieldValue.delete(),
    supportPhone: supportPhone || FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection('orgSettings').doc('default').set(doc, { merge: true });

  await recordAudit({
    action: 'updateOrgSettings',
    actorUserId: request.auth!.uid,
    result: 'SUCCESS',
    metadata: { hasEmail: !!supportEmail, hasPhone: !!supportPhone },
  });

  return { ok: true as const };
});

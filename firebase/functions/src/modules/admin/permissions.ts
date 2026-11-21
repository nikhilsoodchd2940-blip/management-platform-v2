import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { AdminPermission, AdminRoleDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { APP_CHECK_ENFORCED } from '../../config/env';

const VALID_PERMISSIONS: readonly AdminPermission[] = [
  'groups',
  'members',
  'events',
  'requests',
  'donations',
  'reports',
  'content',
  'integrations',
  'logistics',
];

export function isValidPermission(value: unknown): value is AdminPermission {
  return typeof value === 'string' && (VALID_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Every Admin already has full access via the `role: 'admin'` custom
 * claim (docs/ARCHITECTURE.md §1) — this is an ADDITIVE, optional
 * restriction layered on top for the admin web UI, not a replacement
 * authorization mechanism. Only a super-admin can grant/restrict another
 * admin's sections; the very first super-admin is set the same
 * out-of-band way as the very first Admin (docs/PHASE1_COMPLETION.md) —
 * there's no self-service bootstrap here either, for the same reason.
 */
export const setAdminPermissions = onCall({ enforceAppCheck: APP_CHECK_ENFORCED }, async (request) => {
  if (request.auth?.token?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }

  const callerRoleSnap = await db.collection('adminRoles').doc(request.auth.uid).get();
  const callerIsSuperAdmin = (callerRoleSnap.data() as AdminRoleDoc | undefined)?.isSuperAdmin ?? false;
  if (!callerIsSuperAdmin) {
    throw new HttpsError('permission-denied', 'Only a super-admin can manage admin permissions');
  }

  const targetUserId = String(request.data?.targetUserId ?? '');
  const isSuperAdmin = Boolean(request.data?.isSuperAdmin);
  const permissions: unknown[] = Array.isArray(request.data?.permissions) ? request.data.permissions : [];

  if (!targetUserId) throw new HttpsError('invalid-argument', 'targetUserId is required');
  if (!permissions.every(isValidPermission)) {
    throw new HttpsError('invalid-argument', `permissions must be a subset of ${VALID_PERMISSIONS.join(', ')}`);
  }

  const targetUserSnap = await db.collection('users').doc(targetUserId).get();
  if (!targetUserSnap.exists) throw new HttpsError('not-found', 'User not found');

  const doc: AdminRoleDoc = {
    userId: targetUserId,
    isSuperAdmin,
    permissions: permissions as AdminPermission[],
    updatedBy: request.auth.uid,
    updatedAt: FieldValue.serverTimestamp() as unknown as AdminRoleDoc['updatedAt'],
  };
  await db.collection('adminRoles').doc(targetUserId).set(doc);

  await recordAudit({
    action: 'setAdminPermissions',
    actorUserId: request.auth.uid,
    targetId: targetUserId,
    result: 'SUCCESS',
    metadata: { isSuperAdmin, permissions },
  });

  return { ok: true };
});

/**
 * Sets which City-type groups an admin is the Zone Manager for (Group,
 * Event & Approval Management module — see the doc comment on
 * ResourceRequestDoc in types/models.ts for why a Zone is a City node).
 * Same super-admin-only gate as setAdminPermissions, since this is the
 * same kind of role assignment.
 */
export const setZoneManagerCities = onCall({ enforceAppCheck: APP_CHECK_ENFORCED }, async (request) => {
  if (request.auth?.token?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }

  const callerRoleSnap = await db.collection('adminRoles').doc(request.auth.uid).get();
  const callerIsSuperAdmin = (callerRoleSnap.data() as AdminRoleDoc | undefined)?.isSuperAdmin ?? false;
  if (!callerIsSuperAdmin) {
    throw new HttpsError('permission-denied', 'Only a super-admin can assign Zone Managers');
  }

  const targetUserId = String(request.data?.targetUserId ?? '');
  const cityIds: unknown[] = Array.isArray(request.data?.cityIds) ? request.data.cityIds : [];
  if (!targetUserId) throw new HttpsError('invalid-argument', 'targetUserId is required');
  if (!cityIds.every((id) => typeof id === 'string')) {
    throw new HttpsError('invalid-argument', 'cityIds must be an array of group IDs');
  }

  const targetUserSnap = await db.collection('users').doc(targetUserId).get();
  if (!targetUserSnap.exists) throw new HttpsError('not-found', 'User not found');

  // Verify every ID is actually an active City node — a Zone Manager
  // assignment for a non-existent or wrong-type group would silently
  // never match any Resource Request's routing lookup.
  const citySnaps = await Promise.all((cityIds as string[]).map((id) => db.collection('groups').doc(id).get()));
  for (const [i, snap] of citySnaps.entries()) {
    if (!snap.exists || snap.data()?.type !== 'city') {
      throw new HttpsError('invalid-argument', `${cityIds[i]} is not a City group`);
    }
  }

  const ref = db.collection('adminRoles').doc(targetUserId);
  const existing = await ref.get();
  const base = existing.exists ? (existing.data() as AdminRoleDoc) : undefined;

  const doc: AdminRoleDoc = {
    userId: targetUserId,
    isSuperAdmin: base?.isSuperAdmin ?? false,
    permissions: base?.permissions ?? [],
    zoneManagerCityIds: cityIds as string[],
    updatedBy: request.auth.uid,
    updatedAt: FieldValue.serverTimestamp() as unknown as AdminRoleDoc['updatedAt'],
  };
  await ref.set(doc);

  await recordAudit({
    action: 'setZoneManagerCities',
    actorUserId: request.auth.uid,
    targetId: targetUserId,
    result: 'SUCCESS',
    metadata: { cityIds },
  });

  return { ok: true };
});

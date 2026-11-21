import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { db } from '../../config/firebase';
import type { AdminPermission, AdminRoleDoc } from '../../types/models';

/**
 * Phase 4 shipped `adminRoles` and the Permissions web page, but flagged
 * honestly in docs/PHASE4_COMPLETION.md that no Function other than
 * setAdminPermissions itself actually checked a caller's permission list
 * — every admin Function just checked the base `role === 'admin'` claim.
 * This is the fix: one shared helper, used everywhere an admin Function
 * previously did a bare role check, so the enforcement point can't drift
 * out of sync with what the Permissions UI promises.
 *
 * A missing `adminRoles` doc, or `isSuperAdmin: true`, means unrestricted
 * — this matches the "additive, optional" design from Phase 4. Most
 * admins have no adminRoles doc at all and are simply unrestricted,
 * which is why this reads that doc rather than requiring one to exist.
 */
export async function requireAdminPermission(
  request: Pick<CallableRequest, 'auth'>,
  permission: AdminPermission
): Promise<void> {
  if (request.auth?.token?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }

  const roleSnap = await db.collection('adminRoles').doc(request.auth.uid).get();
  if (!roleSnap.exists) return; // no restriction recorded — unrestricted admin

  const role = roleSnap.data() as AdminRoleDoc;
  if (role.isSuperAdmin) return;

  if (!role.permissions.includes(permission)) {
    throw new HttpsError('permission-denied', `Your admin access does not include "${permission}"`);
  }
}

/**
 * Non-throwing variant for the few places (e.g. reviewAbsenceRequest)
 * where the caller might legitimately be authorized a different way
 * (an assigned Host, not an Admin) — the caller checks this boolean
 * alongside its own other authorization path instead of this helper
 * throwing and short-circuiting that other path.
 */
export async function hasAdminPermission(
  request: Pick<CallableRequest, 'auth'>,
  permission: AdminPermission
): Promise<boolean> {
  if (request.auth?.token?.role !== 'admin') return false;
  const roleSnap = await db.collection('adminRoles').doc(request.auth.uid).get();
  if (!roleSnap.exists) return true;
  const role = roleSnap.data() as AdminRoleDoc;
  return role.isSuperAdmin || role.permissions.includes(permission);
}

/** "Top Management" in the Group, Event & Approval Management module's hierarchy — an unrestricted super-admin. */
export async function isTopManagement(uid: string): Promise<boolean> {
  const roleSnap = await db.collection('adminRoles').doc(uid).get();
  if (!roleSnap.exists) return false; // no adminRoles doc = ordinary unrestricted admin, not specifically Top Management
  return (roleSnap.data() as AdminRoleDoc).isSuperAdmin === true;
}

/** "Zone Manager" of a specific City-type group — see the doc comment on ResourceRequestDoc in types/models.ts. */
export async function isZoneManagerOfCity(uid: string, cityId: string): Promise<boolean> {
  const roleSnap = await db.collection('adminRoles').doc(uid).get();
  if (!roleSnap.exists) return false;
  const role = roleSnap.data() as AdminRoleDoc;
  if (role.isSuperAdmin) return true; // Top Management can act as Zone Manager for any city
  return (role.zoneManagerCityIds ?? []).includes(cityId);
}

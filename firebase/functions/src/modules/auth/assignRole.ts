import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config/firebase';
import { isValidRole, setUserRoleClaims, type RoleClaims } from './roles';
import { recordAudit } from '../../utils/logger';
import { DEFAULT_ORG_ID, APP_CHECK_ENFORCED } from '../../config/env';
import { hasAdminPermission } from '../admin/authorize';

/**
 * Admin "Basic role management" (blueprint §5), with a Phase 5 tightening
 * on top: granting the 'admin' role itself requires super-admin (it's the
 * most powerful thing this callable can do — an unrestricted-but-not-
 * super admin could otherwise mint themselves a peer with equal access),
 * while granting 'host'/'member' requires the 'members' permission,
 * matching the rest of member management (modules/groups/members.ts).
 * The caller's own claims are re-verified server-side on every call — a
 * client cannot grant itself admin by editing a Firestore doc, because
 * claims are the only signal (docs/ARCHITECTURE.md §1) and this Function
 * is the only place that writes them for an *existing* user.
 *
 * Bootstrapping the very first Admin is deliberately NOT possible through
 * this callable (a non-admin caller is always rejected) — that has to be
 * done once, out-of-band, via the Firebase Console or Admin SDK from a
 * trusted operator machine. See docs/ENVIRONMENT.md.
 */
export const assignRole = onCall({ enforceAppCheck: APP_CHECK_ENFORCED }, async (request) => {
  const callerRole = request.auth?.token?.role;
  if (callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an Admin can assign roles');
  }

  const targetUserId = String(request.data?.targetUserId ?? '');
  const role = request.data?.role;
  const orgId = String(request.data?.orgId ?? '') || DEFAULT_ORG_ID;
  const hostGroupIds: string[] | undefined = request.data?.hostGroupIds;

  if (!targetUserId) {
    throw new HttpsError('invalid-argument', 'targetUserId is required');
  }
  if (!isValidRole(role)) {
    throw new HttpsError('invalid-argument', 'role must be one of admin, host, member');
  }

  if (role === 'admin') {
    // Deliberate exception to the "missing adminRoles doc = unrestricted"
    // rule that governs every other permission check in this codebase
    // (see modules/admin/authorize.ts): granting the admin role itself is
    // privilege escalation, so it requires an EXPLICIT isSuperAdmin: true
    // doc, not just "no restriction on file". This means the first
    // bootstrapped Admin (docs/ENVIRONMENT.md) must also have an
    // adminRoles doc with isSuperAdmin: true set the same out-of-band way
    // before they can grant admin to anyone else — see
    // docs/LAUNCH_CHECKLIST.md.
    const roleSnap = await db.collection('adminRoles').doc(request.auth!.uid).get();
    const isSuperAdmin = roleSnap.exists && (roleSnap.data()?.isSuperAdmin ?? false);
    if (!isSuperAdmin) {
      throw new HttpsError('permission-denied', 'Only a super-admin can grant the admin role');
    }
  } else if (!(await hasAdminPermission(request, 'members'))) {
    throw new HttpsError('permission-denied', 'Your admin access does not include "members"');
  }

  const targetSnap = await db.collection('users').doc(targetUserId).get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'No user with that ID');
  }

  const claims: RoleClaims = { role, orgId };
  if (role === 'host') {
    if (!hostGroupIds || hostGroupIds.length === 0) {
      throw new HttpsError('invalid-argument', 'hostGroupIds is required when role is host');
    }
    claims.hostGroupIds = hostGroupIds;
  }

  await setUserRoleClaims(targetUserId, claims);

  await recordAudit({
    action: 'assignRole',
    actorUserId: request.auth!.uid,
    targetId: targetUserId,
    result: 'SUCCESS',
    metadata: { role, hostGroupIds: hostGroupIds ?? null },
  });

  return { ok: true };
});

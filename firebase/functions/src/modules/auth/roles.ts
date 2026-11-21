import { auth } from '../../config/firebase';
import type { Role } from '../../types/models';

const VALID_ROLES: readonly Role[] = ['admin', 'host', 'member'];

export function isValidRole(value: unknown): value is Role {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

export interface RoleClaims {
  role: Role;
  orgId: string;
  hostGroupIds?: string[]; // only meaningful when role === 'host'
}

/**
 * Sets the auth custom claims that every Firestore Security Rule and every
 * other Function relies on (see firebase/firestore.rules, docs/ARCHITECTURE.md
 * §1). This is the ONLY place claims are set — never client-side, and never
 * inferred from a Firestore document a client could have written.
 *
 * Full admin-facing "assign role" callable (with its own authorization
 * check on the caller) is implemented in Phase 1 alongside "Basic role
 * management" (blueprint §5) — this module is the shared primitive it will
 * call, established now so Phase 1 doesn't invent a second way to set claims.
 */
export async function setUserRoleClaims(uid: string, claims: RoleClaims): Promise<void> {
  if (!isValidRole(claims.role)) {
    throw new Error(`Invalid role: ${String(claims.role)}`);
  }
  if (claims.role === 'host' && (!claims.hostGroupIds || claims.hostGroupIds.length === 0)) {
    throw new Error('hostGroupIds is required and non-empty when role is "host"');
  }
  await auth.setCustomUserClaims(uid, claims);
}

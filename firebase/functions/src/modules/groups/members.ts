import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, auth, storageBucket } from '../../config/firebase';
import type { GroupMembershipDoc, MemberIdIndexDoc, UserDoc } from '../../types/models';
import { setUserRoleClaims } from '../auth/roles';
import { recordAudit } from '../../utils/logger';
import { requireE164 } from '../../utils/phone';
import { DEFAULT_ORG_ID } from '../../config/env';
import { requireAdminPermission } from '../admin/authorize';

const membershipId = (groupId: string, userId: string) => `${groupId}_${userId}`;

function requireMemberId(raw: unknown): string {
  const memberId = String(raw ?? '').trim();
  if (!memberId) throw new HttpsError('invalid-argument', 'memberId is required');
  if (memberId.length > 64) throw new HttpsError('invalid-argument', 'memberId is too long');
  return memberId;
}

/**
 * Find-or-create the single canonical user record for a (memberId, phone)
 * pair — this is the ONLY place a member record is provisioned
 * (addMember and importMembers both call this), so it's the one place
 * that has to get uniqueness right. Two constraints, both enforced here:
 *   1. blueprint §13 rule 1 — one phone = one profile (via Firebase Auth,
 *      same as before).
 *   2. new: one memberId = one profile, enforced with a
 *      memberIdIndex/{memberId} doc used as a create-if-absent lock —
 *      Firestore has no native unique-field constraint, so the doc ID
 *      itself IS the constraint.
 * Re-uploading the same memberId (e.g. a CSV re-import to add more
 * groups) is idempotent as long as the phone still matches; a memberId
 * bound to a DIFFERENT phone, or a phone already bound to a DIFFERENT
 * memberId, is a hard error surfaced to the caller/row rather than
 * silently overwritten.
 *
 * New records start life at registrationStatus 'not_registered' — the
 * person hasn't opened the app yet. This function never advances that
 * status; only modules/auth/registration.ts (member's own registration
 * call) and the approve/reject Function move it forward.
 */
async function findOrCreateUserByMemberId(
  memberId: string,
  phone: string,
  displayName: string,
  email?: string
): Promise<string> {
  // Auth lookups/writes can't participate in a Firestore transaction, so
  // resolve (or create) the Auth identity for this phone number first...
  let userRecord;
  try {
    userRecord = await auth.getUserByPhoneNumber(phone);
  } catch {
    userRecord = await auth.createUser({ phoneNumber: phone, displayName: displayName || undefined });
  }
  const uid = userRecord.uid;

  // ...then do the memberId<->user linking as one atomic Firestore
  // transaction, so two concurrent imports can never both "win" the same
  // memberId.
  await db.runTransaction(async (tx) => {
    const indexRef = db.collection('memberIdIndex').doc(memberId);
    const userRef = db.collection('users').doc(uid);
    const [indexSnap, userSnap] = await Promise.all([tx.get(indexRef), tx.get(userRef)]);

    if (indexSnap.exists) {
      const boundUserId = (indexSnap.data() as MemberIdIndexDoc).userId;
      if (boundUserId !== uid) {
        throw new HttpsError(
          'already-exists',
          `Member ID "${memberId}" is already registered to a different phone number`
        );
      }
    } else {
      const indexDoc: MemberIdIndexDoc = {
        userId: uid,
        createdAt: FieldValue.serverTimestamp() as unknown as MemberIdIndexDoc['createdAt'],
      };
      tx.set(indexRef, indexDoc);
    }

    if (userSnap.exists) {
      const existing = userSnap.data() as UserDoc;
      if (existing.memberId && existing.memberId !== memberId) {
        throw new HttpsError(
          'already-exists',
          `This phone number is already registered under a different Member ID ("${existing.memberId}")`
        );
      }
      // Idempotent update: refresh the identifying fields an admin might
      // be correcting via re-upload, but never touch registrationStatus
      // — that belongs to the registration/approval flow, not imports.
      const updates: Partial<UserDoc> = {
        memberId,
        updatedAt: FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
      };
      if (displayName) {
        updates.displayName = displayName;
        updates.displayNameLower = displayName.toLowerCase();
      }
      if (email) updates.email = email;
      tx.set(userRef, updates, { merge: true });
    } else {
      const doc: UserDoc = {
        authUid: uid,
        phone,
        memberId,
        ...(email ? { email } : {}),
        displayName,
        displayNameLower: displayName.toLowerCase(),
        registrationStatus: 'not_registered',
        status: 'active',
        createdAt: FieldValue.serverTimestamp() as unknown as UserDoc['createdAt'],
        updatedAt: FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
      };
      tx.set(userRef, doc);
    }
  });

  if (!userRecord.customClaims || !('role' in userRecord.customClaims)) {
    await auth.setCustomUserClaims(uid, { role: 'member', orgId: DEFAULT_ORG_ID });
  }

  return uid;
}

async function upsertMembership(userId: string, groupId: string): Promise<void> {
  const ref = db.collection('groupMemberships').doc(membershipId(groupId, userId));
  const snap = await ref.get();
  if (snap.exists && (snap.data() as GroupMembershipDoc).status === 'active') return; // idempotent

  const doc: GroupMembershipDoc = {
    userId,
    groupId,
    role: 'member',
    status: 'active',
    joinedAt: FieldValue.serverTimestamp() as unknown as GroupMembershipDoc['joinedAt'],
  };
  await ref.set(doc);
}

/** Add a single pre-loaded member record and optionally assign them to one or more Sub Groups. */
export const addMember = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const phone = requireE164(String(request.data?.phone ?? ''));
  const memberId = requireMemberId(request.data?.memberId);
  const displayName = String(request.data?.displayName ?? '').trim();
  const email = String(request.data?.email ?? '').trim() || undefined;
  const groupIds: string[] = Array.isArray(request.data?.groupIds) ? request.data.groupIds : [];

  if (!displayName) throw new HttpsError('invalid-argument', 'displayName is required');

  const userId = await findOrCreateUserByMemberId(memberId, phone, displayName, email);
  await Promise.all(groupIds.map((groupId) => upsertMembership(userId, groupId)));

  await recordAudit({
    action: 'addMember',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { phone, memberId, groupIds },
  });

  return { userId };
});

interface ImportRow {
  memberId: string;
  phone: string;
  displayName: string;
  email?: string;
  groupIds?: string[];
}

/**
 * Bulk import — same find-or-create + membership logic, one row at a
 * time (Firestore has no bulk-idempotent upsert). Every row needs its
 * own memberId; rows are independent, so one bad row (duplicate
 * memberId, malformed phone, etc.) fails that row only and the rest
 * still import — see `results` for a per-row report.
 */
export const importMembers = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  await requireAdminPermission(request, 'members');

  const rows: ImportRow[] = Array.isArray(request.data?.rows) ? request.data.rows : [];
  if (rows.length === 0) throw new HttpsError('invalid-argument', 'rows must be a non-empty array');
  if (rows.length > 500) {
    throw new HttpsError('invalid-argument', 'Max 500 rows per import call — split into batches');
  }

  const results: Array<{ memberId: string; phone: string; userId?: string; error?: string }> = [];

  for (const row of rows) {
    try {
      const phone = requireE164(String(row.phone ?? ''));
      const memberId = requireMemberId(row.memberId);
      const displayName = String(row.displayName ?? '').trim();
      const email = String(row.email ?? '').trim() || undefined;
      if (!displayName) throw new Error('displayName is required');
      const userId = await findOrCreateUserByMemberId(memberId, phone, displayName, email);
      await Promise.all((row.groupIds ?? []).map((groupId) => upsertMembership(userId, groupId)));
      results.push({ memberId, phone, userId });
    } catch (err) {
      results.push({
        memberId: row.memberId,
        phone: row.phone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordAudit({
    action: 'importMembers',
    actorUserId: request.auth!.uid,
    result: 'SUCCESS',
    metadata: { rowCount: rows.length, failureCount: results.filter((r) => r.error).length },
  });

  return { results };
});

/**
 * Prefix search on name (case-insensitive via displayNameLower) or exact
 * phone match. Firestore has no native full-text search — this is
 * intentionally a prefix range query, not a substring search. If richer
 * search is needed later, that's an Algolia/Typesense integration, not a
 * Phase 1 concern.
 */
export const searchMembers = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const query = String(request.data?.query ?? '').trim();
  if (!query) throw new HttpsError('invalid-argument', 'query is required');

  if (/^\+[1-9]\d{6,14}$/.test(query)) {
    const snap = await db.collection('users').where('phone', '==', query).limit(10).get();
    return { results: snap.docs.map((d) => ({ userId: d.id, ...d.data() })) };
  }

  const lower = query.toLowerCase();
  const snap = await db
    .collection('users')
    .where('displayNameLower', '>=', lower)
    .where('displayNameLower', '<=', lower + '\uf8ff')
    .limit(20)
    .get();

  return { results: snap.docs.map((d) => ({ userId: d.id, ...d.data() })) };
});

/** Assign an existing member to one or more Sub Groups (as a plain member of each). */
export const assignMemberToGroups = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  const groupIds: string[] = Array.isArray(request.data?.groupIds) ? request.data.groupIds : [];
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  if (groupIds.length === 0) throw new HttpsError('invalid-argument', 'groupIds must be non-empty');

  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');

  await Promise.all(groupIds.map((groupId) => upsertMembership(userId, groupId)));

  // Primary Group is required once a member belongs to any group (see
  // setPrimaryGroup and the admin panel's Members table "Primary Group"
  // column) — auto-set here so an admin assigning someone's first group
  // doesn't have to remember a second, separate step for the common
  // case. Only fires when nothing is set yet; an admin explicitly
  // choosing a different Primary Group later (setPrimaryGroup) is never
  // overridden by a later group assignment.
  if (!(userSnap.data() as UserDoc).primaryGroupId) {
    await db.collection('users').doc(userId).update({
      primaryGroupId: groupIds[0],
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await recordAudit({
    action: 'assignMemberToGroups',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { groupIds },
  });

  return { ok: true };
});

/**
 * Assign a member as Host of one or more Sub Groups. Updates BOTH the
 * per-group `groupMemberships.role` (what Firestore rules check for
 * group-scoped reads) AND the auth custom claim `hostGroupIds` (what
 * every other Function and rule checks). These two must never drift —
 * this is the one function that writes both, together, in that order.
 */
export const assignHostToGroups = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  const groupIds: string[] = Array.isArray(request.data?.groupIds) ? request.data.groupIds : [];
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  if (groupIds.length === 0) throw new HttpsError('invalid-argument', 'groupIds must be non-empty');

  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');

  const batch = db.batch();
  for (const groupId of groupIds) {
    const ref = db.collection('groupMemberships').doc(membershipId(groupId, userId));
    const doc: GroupMembershipDoc = {
      userId,
      groupId,
      role: 'host',
      status: 'active',
      joinedAt: FieldValue.serverTimestamp() as unknown as GroupMembershipDoc['joinedAt'],
    };
    batch.set(ref, doc, { merge: true });
  }
  await batch.commit();

  // Same as assignMemberToGroups: Primary Group is required once a
  // member belongs to any group, so being made Host of their first
  // group also needs to satisfy that, not just a plain member
  // assignment.
  if (!(userSnap.data() as UserDoc).primaryGroupId) {
    await db.collection('users').doc(userId).update({
      primaryGroupId: groupIds[0],
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // Recompute the full set of groups this person hosts (not just the ones
  // in this call) so hostGroupIds never falls out of sync with reality.
  const hostMemberships = await db
    .collection('groupMemberships')
    .where('userId', '==', userId)
    .where('role', '==', 'host')
    .where('status', '==', 'active')
    .get();
  const allHostGroupIds = hostMemberships.docs.map((d) => (d.data() as GroupMembershipDoc).groupId);

  const authUser = await auth.getUser(userId);
  const orgId = (authUser.customClaims?.orgId as string | undefined) ?? DEFAULT_ORG_ID;

  await setUserRoleClaims(userId, { role: 'host', orgId, hostGroupIds: allHostGroupIds });

  await recordAudit({
    action: 'assignHostToGroups',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { allHostGroupIds },
  });

  return { ok: true, hostGroupIds: allHostGroupIds };
});

/**
 * Deactivate/reactivate a member. Unlike deleteMember (below), this is
 * fully reversible: it flips users/{uid}.status AND disables the
 * underlying Firebase Auth account (so login itself is blocked, not
 * just app-level checks that a client could bypass), and revokes any
 * outstanding session immediately via revokeRefreshTokens — so
 * deactivating someone mid-session actually kicks them out, not just
 * blocks their next login.
 */
export const setMemberStatus = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  const status = request.data?.status as 'active' | 'disabled';
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  if (status !== 'active' && status !== 'disabled') {
    throw new HttpsError('invalid-argument', "status must be 'active' or 'disabled'");
  }

  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Member not found');

  await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
  await auth.updateUser(userId, { disabled: status === 'disabled' });
  if (status === 'disabled') {
    await auth.revokeRefreshTokens(userId);
  }

  await recordAudit({
    action: 'setMemberStatus',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { status },
  });

  return { ok: true as const };
});

/**
 * Hard delete — permanently removes the member's Auth account, profile,
 * every groupMembership they hold, and their memberIdIndex slot (so the
 * Member ID becomes reusable). Irreversible, unlike setMemberStatus
 * above — if you just want to block someone temporarily, deactivate
 * instead.
 */
export const deleteMember = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');

  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Member not found');
  const user = snap.data() as UserDoc;

  const membershipsSnap = await db.collection('groupMemberships').where('userId', '==', userId).get();
  const batch = db.batch();
  membershipsSnap.docs.forEach((d) => batch.delete(d.ref));
  if (user.memberId) batch.delete(db.collection('memberIdIndex').doc(user.memberId));
  batch.delete(ref);
  await batch.commit();

  // Auth deletion is best-effort — if it's already gone (or somehow
  // never existed), that shouldn't block the Firestore cleanup above,
  // which is the part that actually matters for the admin's data.
  await auth.deleteUser(userId).catch(() => {});

  await recordAudit({
    action: 'deleteMember',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { memberId: user.memberId ?? null },
  });

  return { ok: true as const };
});

/**
 * Edit an existing member's on-file details — the fields originally set
 * by addMember/importMembers (matching, so a mismatch that's blocking
 * someone's registration can be corrected here rather than requiring a
 * delete + re-add). Every field is optional/independent: only the ones
 * present in request.data are touched.
 *   - memberId: re-points memberIdIndex transactionally (same
 *     uniqueness guarantee as findOrCreateUserByMemberId).
 *   - phone: updates the underlying Firebase Auth identity too, so a
 *     phone fix actually takes effect for login/registration matching,
 *     not just the Firestore mirror of it.
 */
export const updateMember = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');

  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Member not found');
  const current = snap.data() as UserDoc;

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (request.data?.displayName !== undefined) {
    const displayName = String(request.data.displayName).trim();
    if (!displayName) throw new HttpsError('invalid-argument', 'displayName cannot be empty');
    updates.displayName = displayName;
    updates.displayNameLower = displayName.toLowerCase();
  }

  if (request.data?.email !== undefined) {
    const email = String(request.data.email).trim();
    updates.email = email ? email : FieldValue.delete();
  }

  if (request.data?.memberId !== undefined) {
    const newMemberId = requireMemberId(request.data.memberId);
    if (newMemberId !== current.memberId) {
      await db.runTransaction(async (tx) => {
        const newIndexRef = db.collection('memberIdIndex').doc(newMemberId);
        const newIndexSnap = await tx.get(newIndexRef);
        if (newIndexSnap.exists && (newIndexSnap.data() as MemberIdIndexDoc).userId !== userId) {
          throw new HttpsError('already-exists', `Member ID "${newMemberId}" is already in use`);
        }
        if (current.memberId) {
          tx.delete(db.collection('memberIdIndex').doc(current.memberId));
        }
        tx.set(newIndexRef, { userId, createdAt: FieldValue.serverTimestamp() } as MemberIdIndexDoc);
      });
      updates.memberId = newMemberId;
    }
  }

  if (request.data?.phone !== undefined) {
    const newPhone = requireE164(String(request.data.phone));
    if (newPhone !== current.phone) {
      try {
        await auth.updateUser(userId, { phoneNumber: newPhone });
      } catch (err) {
        if ((err as { code?: string })?.code === 'auth/phone-number-already-exists') {
          throw new HttpsError('already-exists', 'That phone number is already in use by another account');
        }
        throw new HttpsError('internal', 'Could not update phone number');
      }
      updates.phone = newPhone;
    }
  }

  await ref.update(updates);

  await recordAudit({
    action: 'updateMember',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { fields: Object.keys(updates) },
  });

  return { ok: true as const };
});

/** Removes a member from one group (soft — status: 'removed', keeps history). Recomputes hostGroupIds claims if the removed role was 'host'. Also clears primaryGroupId if this was it, since a Primary Group must always be one of the member's active groups (see setPrimaryGroup). */
export const removeMemberFromGroup = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  const groupId = String(request.data?.groupId ?? '');
  if (!userId || !groupId) throw new HttpsError('invalid-argument', 'userId and groupId are required');

  const ref = db.collection('groupMemberships').doc(membershipId(groupId, userId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Membership not found');
  const membership = snap.data() as GroupMembershipDoc;

  await ref.update({ status: 'removed' });

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (userSnap.exists && (userSnap.data() as UserDoc).primaryGroupId === groupId) {
    await userRef.update({ primaryGroupId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  }

  if (membership.role === 'host') {
    const hostMemberships = await db
      .collection('groupMemberships')
      .where('userId', '==', userId)
      .where('role', '==', 'host')
      .where('status', '==', 'active')
      .get();
    const allHostGroupIds = hostMemberships.docs.map((d) => (d.data() as GroupMembershipDoc).groupId);
    const authUser = await auth.getUser(userId);
    const orgId = (authUser.customClaims?.orgId as string | undefined) ?? DEFAULT_ORG_ID;
    const role = allHostGroupIds.length > 0 ? 'host' : 'member';
    await setUserRoleClaims(userId, { role, orgId, hostGroupIds: allHostGroupIds });
  }

  await recordAudit({
    action: 'removeMemberFromGroup',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { groupId },
  });

  return { ok: true as const };
});

/**
 * Admin sets/replaces a member's profile photo directly (e.g. fixing a
 * bad upload on someone's behalf). The file itself is uploaded from the
 * admin panel straight to Storage (firebase/storage.rules now allows an
 * Admin to write to any profilePhotos/{uid}/ path) — this function just
 * records the resulting URL, same as submitRegistration does for a
 * member's own upload. Doesn't touch registrationStatus: an admin
 * correcting a photo isn't the same signal as the photo being removed
 * entirely (see adminRemoveMemberPhoto below).
 */
export const adminSetMemberPhoto = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  const photoUrl = String(request.data?.photoUrl ?? '').trim();
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  if (!photoUrl) throw new HttpsError('invalid-argument', 'photoUrl is required');
  if (!photoUrl.includes(`profilePhotos%2F${userId}%2F`) && !photoUrl.includes(`profilePhotos/${userId}/`)) {
    throw new HttpsError('invalid-argument', "photoUrl must point to this member's own profilePhotos path");
  }

  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Member not found');

  await ref.update({ photoUrl, updatedAt: FieldValue.serverTimestamp() });

  await recordAudit({
    action: 'adminSetMemberPhoto',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: {},
  });

  return { ok: true as const };
});

/**
 * Admin removes a member's profile photo. Since a photo is mandatory at
 * registration (the whole point being an Admin can visually verify who
 * they're approving), removing it means that verification no longer
 * holds — so this doesn't just clear the field, it also:
 *   - deletes the actual file from Storage (server-side, since the
 *     client has no delete permission on this path — see storage.rules)
 *   - resets registrationStatus to 'not_registered', the same state a
 *     freshly-imported member starts in, so they're routed back through
 *     CompleteRegistrationScreen (mobile) to upload a NEW photo before
 *     they can reach PendingApprovalScreen/approval again
 *   - revokes their refresh tokens so an active session can't keep
 *     using the app past this point (their current ID token stays valid
 *     until it naturally expires — Firebase has no server-side way to
 *     invalidate an already-issued ID token immediately)
 * The net effect: no path back into the app without an Admin's photo
 * review happening again.
 */
export const adminRemoveMemberPhoto = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');

  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Member not found');

  await storageBucket
    .file(`profilePhotos/${userId}/photo.jpg`)
    .delete({ ignoreNotFound: true })
    .catch(() => {}); // best-effort — a missing/already-deleted file shouldn't block the Firestore update below

  await ref.update({
    photoUrl: FieldValue.delete(),
    registrationStatus: 'not_registered',
    rejectionReason: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await auth.revokeRefreshTokens(userId).catch(() => {});

  await recordAudit({
    action: 'adminRemoveMemberPhoto',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: {},
  });

  return { ok: true as const };
});

/**
 * Sets one membership's role explicitly, in either direction — unlike
 * assignMemberToGroups (which no-ops if a membership already exists at
 * all, active in any role — see upsertMembership's idempotent
 * early-return above) or assignHostToGroups (promote-only, bulk-
 * oriented), this always writes the requested role. That gap mattered
 * in practice: without this, there was no way to demote an existing
 * Host back to a plain member — assignMemberToGroups would silently do
 * nothing. Used by the inline role toggle on each group chip in the
 * Members table.
 */
export const setMembershipRole = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  const groupId = String(request.data?.groupId ?? '');
  const role = request.data?.role as 'member' | 'host';
  if (!userId || !groupId) throw new HttpsError('invalid-argument', 'userId and groupId are required');
  if (role !== 'member' && role !== 'host') {
    throw new HttpsError('invalid-argument', "role must be 'member' or 'host'");
  }

  const ref = db.collection('groupMemberships').doc(membershipId(groupId, userId));
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as GroupMembershipDoc).status !== 'active') {
    throw new HttpsError('not-found', 'This membership does not exist or is not active');
  }

  await ref.update({ role });

  // Recompute the full hostGroupIds claim either way — promoting adds
  // this group to it, demoting removes it, and doing a full recompute
  // (rather than push/splice) means it's always derived fresh from
  // Firestore rather than trusted to stay in sync incrementally.
  const hostMemberships = await db
    .collection('groupMemberships')
    .where('userId', '==', userId)
    .where('role', '==', 'host')
    .where('status', '==', 'active')
    .get();
  const allHostGroupIds = hostMemberships.docs.map((d) => (d.data() as GroupMembershipDoc).groupId);

  const authUser = await auth.getUser(userId);
  const orgId = (authUser.customClaims?.orgId as string | undefined) ?? DEFAULT_ORG_ID;
  const claimRole = allHostGroupIds.length > 0 ? 'host' : 'member';
  await setUserRoleClaims(userId, { role: claimRole, orgId, hostGroupIds: allHostGroupIds });

  await recordAudit({
    action: 'setMembershipRole',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { groupId, role },
  });

  return { ok: true as const };
});

/**
 * Sets (or clears) a member's Primary Group — the one group, out of the
 * possibly several they belong to, shown on the mobile Home header
 * ("Member of {group}"). Validates the target group is actually one of
 * the member's ACTIVE memberships first: this is the one place that
 * invariant can be enforced (a client-side self-edit can't — see
 * firestore.rules' `users` match, which blocks primaryGroupId from
 * isSelf() updates for exactly this reason).
 *
 * Pass groupId: null to clear a member's Primary Group without setting
 * a new one (e.g. from the admin panel's member editor, if the admin
 * wants "no primary group" rather than picking a replacement
 * immediately) — see also removeMemberFromGroup above, which does this
 * automatically when the group being removed was the primary.
 */
export const setPrimaryGroup = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const userId = String(request.data?.userId ?? '');
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  const rawGroupId = request.data?.groupId;
  const groupId = rawGroupId === null || rawGroupId === undefined ? null : String(rawGroupId);

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Member not found');

  if (groupId !== null) {
    const membershipSnap = await db.collection('groupMemberships').doc(membershipId(groupId, userId)).get();
    if (!membershipSnap.exists || (membershipSnap.data() as GroupMembershipDoc).status !== 'active') {
      throw new HttpsError(
        'failed-precondition',
        'A member\'s Primary Group must be one of the groups they currently belong to'
      );
    }
  }

  await userRef.update({
    primaryGroupId: groupId === null ? FieldValue.delete() : groupId,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await recordAudit({
    action: 'setPrimaryGroup',
    actorUserId: request.auth!.uid,
    targetId: userId,
    result: 'SUCCESS',
    metadata: { groupId },
  });

  return { ok: true as const };
});

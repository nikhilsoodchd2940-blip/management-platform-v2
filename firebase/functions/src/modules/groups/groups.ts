import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import type { GroupDoc, ChatRoomDoc } from '../../types/models';
import { recordAudit } from '../../utils/logger';
import { requireAdminPermission } from '../admin/authorize';
import { validateParent, getGroupOrThrow, type GroupType } from './hierarchy';

const VALID_TYPES: readonly GroupType[] = ['main', 'country', 'city', 'group'];

/**
 * Creates one node in the 4-level tree: Main Group -> Country -> City ->
 * Group (leaf). type='main' has no parent; every other type requires a
 * parentGroupId of the correct type (see hierarchy.ts). Only a leaf
 * 'group' gets a chat room and can ever have members/events attached to
 * it — 'country' and 'city' are purely organizational.
 */
export const createGroup = onCall(async (request) => {
  await requireAdminPermission(request, 'groups');

  const name = String(request.data?.name ?? '').trim();
  const type = request.data?.type as GroupType;
  const parentGroupId: string | undefined = request.data?.parentGroupId;
  const capacityRaw = request.data?.capacity;

  if (!name) throw new HttpsError('invalid-argument', 'name is required');
  if (!VALID_TYPES.includes(type)) {
    throw new HttpsError('invalid-argument', `type must be one of ${VALID_TYPES.join(', ')}`);
  }

  if (type === 'main') {
    if (parentGroupId) throw new HttpsError('invalid-argument', 'A Main Group must not have a parentGroupId');
  } else {
    if (!parentGroupId) throw new HttpsError('invalid-argument', `parentGroupId is required for type "${type}"`);
    await validateParent(type, parentGroupId);
  }

  let capacity: number | undefined;
  if (capacityRaw !== undefined && capacityRaw !== null && capacityRaw !== '') {
    if (type !== 'group') {
      throw new HttpsError('invalid-argument', 'capacity only applies to a leaf group, not a country/city/main node');
    }
    capacity = Number(capacityRaw);
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new HttpsError('invalid-argument', 'capacity must be a positive whole number');
    }
  }

  const doc: GroupDoc = {
    name,
    type,
    status: 'active',
    createdAt: FieldValue.serverTimestamp() as unknown as GroupDoc['createdAt'],
    ...(parentGroupId ? { parentGroupId } : {}),
    ...(capacity !== undefined ? { capacity } : {}),
  };

  const ref = await db.collection('groups').add(doc);

  // Only a leaf 'group' gets a chat room — Main/Country/City are purely
  // organizational and nobody is ever a member of them directly.
  if (type === 'group') {
    const roomDoc: ChatRoomDoc = {
      groupId: ref.id,
      createdAt: FieldValue.serverTimestamp() as unknown as ChatRoomDoc['createdAt'],
    };
    await db.collection('chatRooms').doc(ref.id).set(roomDoc);
  }

  await recordAudit({
    action: 'createGroup',
    actorUserId: request.auth!.uid,
    targetId: ref.id,
    result: 'SUCCESS',
    metadata: { name, type, parentGroupId: parentGroupId ?? null },
  });

  return { groupId: ref.id };
});

export const updateGroup = onCall(async (request) => {
  await requireAdminPermission(request, 'groups');

  const groupId = String(request.data?.groupId ?? '');
  const name: string | undefined = request.data?.name;
  const capacityRaw = request.data?.capacity;
  if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required');

  const ref = db.collection('groups').doc(groupId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Group not found');
  const existing = snap.data() as GroupDoc;

  const patch: Omit<Partial<GroupDoc>, 'capacity'> & { capacity?: number | FirebaseFirestore.FieldValue } = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim();

  // capacity: undefined in the request means "field not touched" (leave
  // as-is); null or '' means "clear the limit" (delete the field, not
  // set it to 0 — 0 would read as "capacity of zero", i.e. full always).
  if (capacityRaw !== undefined) {
    if (capacityRaw === null || capacityRaw === '') {
      patch.capacity = FieldValue.delete();
    } else {
      if (existing.type !== 'group') {
        throw new HttpsError('invalid-argument', 'capacity only applies to a leaf group, not a country/city/main node');
      }
      const capacity = Number(capacityRaw);
      if (!Number.isInteger(capacity) || capacity < 1) {
        throw new HttpsError('invalid-argument', 'capacity must be a positive whole number');
      }
      patch.capacity = capacity;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new HttpsError('invalid-argument', 'Nothing to update');
  }

  await ref.update(patch);

  await recordAudit({
    action: 'updateGroup',
    actorUserId: request.auth!.uid,
    targetId: groupId,
    result: 'SUCCESS',
    metadata: {
      name: patch.name,
      capacity: capacityRaw === undefined ? undefined : capacityRaw === null || capacityRaw === '' ? 'cleared' : patch.capacity,
    },
  });

  return { ok: true };
});

/**
 * Soft-delete only — archived nodes are retained for historical
 * attendance/reporting. Archiving a non-leaf node (main/country/city)
 * does NOT cascade to its children — this is deliberately a single-node
 * operation; archiving an entire branch is an explicit multi-step admin
 * action, not something a single click should do silently.
 */
export const archiveGroup = onCall(async (request) => {
  await requireAdminPermission(request, 'groups');

  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required');

  await getGroupOrThrow(groupId); // throws not-found if missing

  await db.collection('groups').doc(groupId).update({ status: 'archived' });

  await recordAudit({
    action: 'archiveGroup',
    actorUserId: request.auth!.uid,
    targetId: groupId,
    result: 'SUCCESS',
  });

  return { ok: true };
});

/**
 * Hard delete — permanently removes the node, unlike archiveGroup's
 * soft-delete. Refuses if anything still points at this node so a
 * delete can never silently orphan children or strand active members:
 *   - any child group (country/city/group under this one) blocks it
 *   - for a leaf 'group', any active groupMembership blocks it
 * The admin has to clear those first (delete/move the children, or
 * remove the members) — that's a deliberate extra step, not friction to
 * design around, since undoing a hard delete isn't possible the way
 * un-archiving is.
 */
export const deleteGroup = onCall(async (request) => {
  await requireAdminPermission(request, 'groups');

  const groupId = String(request.data?.groupId ?? '');
  if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required');

  const group = await getGroupOrThrow(groupId);

  const childrenSnap = await db.collection('groups').where('parentGroupId', '==', groupId).limit(1).get();
  if (!childrenSnap.empty) {
    throw new HttpsError('failed-precondition', 'Delete or move everything under this first.');
  }

  if (group.type === 'group') {
    const activeMemberSnap = await db
      .collection('groupMemberships')
      .where('groupId', '==', groupId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (!activeMemberSnap.empty) {
      throw new HttpsError('failed-precondition', 'Remove all members from this group first.');
    }
    await db.collection('chatRooms').doc(groupId).delete().catch(() => {});
  }

  await db.collection('groups').doc(groupId).delete();

  await recordAudit({
    action: 'deleteGroup',
    actorUserId: request.auth!.uid,
    targetId: groupId,
    result: 'SUCCESS',
    metadata: { name: group.name, type: group.type },
  });

  return { ok: true as const };
});

interface HierarchyRow {
  country: string;
  city?: string;
  group?: string;
}

/**
 * Bulk-creates Country -> City -> Group nodes from a flat list of rows,
 * for orgs with hundreds of countries/cities/groups where clicking
 * "Create" one at a time on Countries/Cities/Groups isn't practical.
 * Each row is (country, city?, group?) — city/group are optional so one
 * file can mix rows that only add a country, rows that add a city under
 * one, and rows that add a full country/city/group triple. A Main Group
 * is auto-created if none exists yet (same one-time setup Countries.tsx
 * already offers, done here automatically instead of asking first).
 *
 * Find-or-create by name (case-insensitive) under the right parent —
 * idempotent, so re-uploading the same file (e.g. after fixing typos in
 * later rows) never creates duplicates for rows that already succeeded.
 * All existing active nodes are loaded into memory once up front and
 * kept in sync as new ones are created within this same call, so row 50
 * can resolve a country that row 3 in the SAME upload just created,
 * without a Firestore round trip per row.
 */
export const importGroupHierarchy = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  await requireAdminPermission(request, 'groups');

  const rows: HierarchyRow[] = Array.isArray(request.data?.rows) ? request.data.rows : [];
  if (rows.length === 0) throw new HttpsError('invalid-argument', 'rows must be a non-empty array');
  if (rows.length > 500) {
    throw new HttpsError('invalid-argument', 'Max 500 rows per import call — split into batches');
  }

  const snap = await db.collection('groups').where('status', '==', 'active').get();
  const nodes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as GroupDoc) }));

  function findChild(parentId: string | undefined, type: GroupType, name: string) {
    return nodes.find(
      (n) => n.type === type && n.parentGroupId === parentId && n.name.toLowerCase() === name.toLowerCase()
    );
  }

  async function createNode(name: string, type: GroupType, parentGroupId?: string) {
    const doc: GroupDoc = {
      name,
      type,
      status: 'active',
      createdAt: FieldValue.serverTimestamp() as unknown as GroupDoc['createdAt'],
      ...(parentGroupId ? { parentGroupId } : {}),
    };
    const ref = await db.collection('groups').add(doc);
    if (type === 'group') {
      const roomDoc: ChatRoomDoc = {
        groupId: ref.id,
        createdAt: FieldValue.serverTimestamp() as unknown as ChatRoomDoc['createdAt'],
      };
      await db.collection('chatRooms').doc(ref.id).set(roomDoc);
    }
    const node = { id: ref.id, ...doc };
    nodes.push(node);
    return node;
  }

  let mainGroup = nodes.find((n) => n.type === 'main');
  if (!mainGroup) {
    mainGroup = await createNode('Main Group', 'main');
  }

  const results: Array<{ country: string; city?: string; group?: string; error?: string }> = [];

  for (const row of rows) {
    try {
      const countryName = String(row.country ?? '').trim();
      const cityName = String(row.city ?? '').trim();
      const groupName = String(row.group ?? '').trim();
      if (!countryName) throw new Error('country is required');
      if (groupName && !cityName) throw new Error('city is required when group is given');

      let country = findChild(mainGroup.id, 'country', countryName);
      if (!country) country = await createNode(countryName, 'country', mainGroup.id);

      let city = cityName ? findChild(country.id, 'city', cityName) : undefined;
      if (cityName && !city) city = await createNode(cityName, 'city', country.id);

      if (groupName && city) {
        const group = findChild(city.id, 'group', groupName);
        if (!group) await createNode(groupName, 'group', city.id);
      }

      results.push({ country: countryName, city: cityName || undefined, group: groupName || undefined });
    } catch (err) {
      results.push({
        country: row.country,
        city: row.city,
        group: row.group,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordAudit({
    action: 'importGroupHierarchy',
    actorUserId: request.auth!.uid,
    result: 'SUCCESS',
    metadata: { rowCount: rows.length, failureCount: results.filter((r) => r.error).length },
  });

  return { results };
});

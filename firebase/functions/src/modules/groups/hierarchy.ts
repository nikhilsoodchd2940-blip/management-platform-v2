import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config/firebase';
import type { GroupDoc } from '../../types/models';

export type GroupType = GroupDoc['type'];

/**
 * The 4-level tree this app organizes groups into: Main Group -> Country
 * -> City -> Group (leaf). This map is the single source of truth for
 * "what type of parent does each type require" — every place that
 * creates or validates a group node reads from here rather than
 * re-encoding the rule, so the hierarchy can't drift between createGroup,
 * event validation, and anywhere else that needs to check it.
 */
const REQUIRED_PARENT_TYPE: Record<GroupType, GroupType | null> = {
  main: null,
  country: 'main',
  city: 'country',
  group: 'city',
};

export function requiredParentType(type: GroupType): GroupType | null {
  return REQUIRED_PARENT_TYPE[type];
}

/** Fetches a group doc and throws a clear error if it's missing — shared by every caller that needs one. */
export async function getGroupOrThrow(groupId: string): Promise<GroupDoc> {
  const snap = await db.collection('groups').doc(groupId).get();
  if (!snap.exists) throw new HttpsError('not-found', `Group ${groupId} not found`);
  return snap.data() as GroupDoc;
}

/**
 * Validates that `parentGroupId` exists, is active, and is the correct
 * type to parent a node of `childType` — e.g. a 'city' must have a
 * 'country' parent, not a 'main' or another 'city'. Used by createGroup
 * so the tree can never end up with a node under the wrong level.
 */
export async function validateParent(childType: GroupType, parentGroupId: string): Promise<void> {
  const required = requiredParentType(childType);
  if (!required) {
    throw new HttpsError('invalid-argument', `type "${childType}" must not have a parentGroupId`);
  }
  const parent = await getGroupOrThrow(parentGroupId);
  if (parent.type !== required) {
    throw new HttpsError(
      'failed-precondition',
      `parentGroupId must reference a "${required}" node for a "${childType}" (got "${parent.type}")`
    );
  }
  if (parent.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Parent group is archived');
  }
}

/**
 * Walks a leaf 'group' node up through city -> country -> main and
 * returns the Main Group's ID. This is what replaces the old direct
 * "does this Sub Group's parentGroupId equal the given mainGroupId"
 * check now that there are two extra levels in between — event creation
 * (modules/events/events.ts, modules/events/recurring.ts) uses this to
 * confirm a set of leaf groups actually belong to the Main Group an
 * event is being created for.
 */
export async function resolveMainGroupId(leafGroupId: string): Promise<string> {
  const leaf = await getGroupOrThrow(leafGroupId);
  if (leaf.type !== 'group') {
    throw new HttpsError('failed-precondition', `${leafGroupId} is a "${leaf.type}", not a leaf "group"`);
  }
  const city = await getGroupOrThrow(leaf.parentGroupId!);
  const country = await getGroupOrThrow(city.parentGroupId!);
  // country.parentGroupId is the Main Group's ID — no need to fetch it,
  // the caller already has (or is validating against) a mainGroupId.
  if (!country.parentGroupId) {
    throw new HttpsError('failed-precondition', `Group ${leafGroupId}'s ancestry is broken above "country"`);
  }
  return country.parentGroupId;
}

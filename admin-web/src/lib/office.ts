import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { assignMemberToGroups, setKurelRoles } from './functions';

export interface OfficeInput {
  leaderId?: string;
  pedagogyPresidentId?: string;
  surveillantId?: string;
  choirMasterId?: string;
  socialId?: string;
  administrationId?: string;
  choirDeputyIds?: string[];
  surveillantDeputyId?: string;
  socialDeputyId?: string;
  administrationDeputyId?: string;
  committeeIds?: string[];
}

/** Puts everyone named in the kurel first (when they are not yet in it), then saves the office. */
export async function appointOffice(groupId: string, o: OfficeInput): Promise<void> {
  const named = Array.from(new Set([o.leaderId, o.pedagogyPresidentId, o.surveillantId, o.choirMasterId, o.socialId, o.administrationId, o.surveillantDeputyId, o.socialDeputyId, o.administrationDeputyId, ...(o.choirDeputyIds ?? []), ...(o.committeeIds ?? [])].filter(Boolean) as string[]));
  if (named.length === 0) return;
  const snap = await getDocs(query(collection(db, 'groupMemberships'), where('groupId', '==', groupId), where('status', '==', 'active')));
  const inside = new Set(snap.docs.map((d) => d.data().userId as string));
  for (const uid of named.filter((u) => !inside.has(u))) await assignMemberToGroups({ userId: uid, groupIds: [groupId] });
  await setKurelRoles({
    groupId,
    leaderId: o.leaderId ?? '', pedagogyPresidentId: o.pedagogyPresidentId ?? '', surveillantId: o.surveillantId ?? '', choirMasterId: o.choirMasterId ?? '', socialId: o.socialId ?? '', administrationId: o.administrationId ?? '',
    surveillantDeputyId: o.surveillantDeputyId ?? '', socialDeputyId: o.socialDeputyId ?? '', administrationDeputyId: o.administrationDeputyId ?? '',
    choirDeputyIds: o.choirDeputyIds ?? [], committeeIds: o.committeeIds ?? [],
  });
}

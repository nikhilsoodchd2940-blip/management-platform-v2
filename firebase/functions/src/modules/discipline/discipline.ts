import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission } from '../admin/authorize';
import { getGroupOrThrow } from '../groups/hierarchy';
import { recordAudit } from '../../utils/logger';
import { notifyUser } from '../../utils/notify';
import type { DisciplinaryCaseDoc, DisciplinaryHistoryEntryDoc, DisciplinaryVoteDoc } from '../../types/models';

/**
 * Conseil de discipline. The prototype's circuit (Signalement →
 * Instruction → Audition → Vote → Décision, with tie-escalation to
 * "Direction nationale") is simplified here to: open → optional hearing
 * request → votes accumulate → an admin explicitly resolves once
 * satisfied a majority exists. There's no automatic tie-escalation or
 * enforced "majority required, no veto" rule engine — resolving is a
 * deliberate admin action that records whatever the actual vote tally
 * was, rather than software silently deciding when "enough" votes exist.
 */
export const openDisciplinaryCase = onCall(async (request) => {
  await requireAdminPermission(request, 'members');

  const memberId = String(request.data?.memberId ?? '');
  const memberName = String(request.data?.memberName ?? '').trim();
  const groupId = String(request.data?.groupId ?? '');
  const reason = String(request.data?.reason ?? '').trim();
  const description = String(request.data?.description ?? '').trim();

  if (!memberId || !memberName) throw new HttpsError('invalid-argument', 'memberId and memberName are required');
  if (!reason) throw new HttpsError('invalid-argument', 'reason is required');
  await getGroupOrThrow(groupId);

  const firstEntry: DisciplinaryHistoryEntryDoc = {
    action: 'opened',
    actorId: request.auth!.uid,
    actorName: String(request.data?.actorName ?? '').trim() || 'Admin',
    at: Timestamp.now(),
  };

  const doc: DisciplinaryCaseDoc = {
    memberId,
    memberName,
    groupId,
    reason,
    description,
    status: 'open',
    votes: [],
    history: [firstEntry],
    openedBy: request.auth!.uid,
    openedAt: FieldValue.serverTimestamp() as unknown as DisciplinaryCaseDoc['openedAt'],
    updatedAt: FieldValue.serverTimestamp() as unknown as DisciplinaryCaseDoc['updatedAt'],
  };
  const ref = await db.collection('disciplinaryCases').add(doc);

  await notifyUser(memberId, 'A disciplinary case was opened', `Reason: ${reason}. You may request a hearing.`, { relatedId: ref.id });
  await recordAudit({ action: 'openDisciplinaryCase', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS', metadata: { memberId, reason } });
  return { caseId: ref.id };
});

export const requestDisciplinaryHearing = onCall(async (request) => {
  await requireAdminPermission(request, 'members');
  const caseId = String(request.data?.caseId ?? '');
  const note: string | undefined = request.data?.note?.trim() || undefined;
  if (!caseId) throw new HttpsError('invalid-argument', 'caseId is required');

  const ref = db.collection('disciplinaryCases').doc(caseId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Case not found');

  const entry: DisciplinaryHistoryEntryDoc = {
    action: 'hearing_requested',
    actorId: request.auth!.uid,
    actorName: String(request.data?.actorName ?? '').trim() || 'Admin',
    ...(note ? { note } : {}),
    at: Timestamp.now(),
  };
  await ref.update({ status: 'hearing_requested', history: FieldValue.arrayUnion(entry), updatedAt: FieldValue.serverTimestamp() });
  await recordAudit({ action: 'requestDisciplinaryHearing', actorUserId: request.auth!.uid, targetId: caseId, result: 'SUCCESS' });
  return { ok: true };
});

export const castDisciplinaryVote = onCall(async (request) => {
  await requireAdminPermission(request, 'members');
  const caseId = String(request.data?.caseId ?? '');
  const decision = request.data?.decision as 'reinstate' | 'uphold';
  const voterName = String(request.data?.voterName ?? '').trim() || 'Admin';
  if (!caseId) throw new HttpsError('invalid-argument', 'caseId is required');
  if (decision !== 'reinstate' && decision !== 'uphold') throw new HttpsError('invalid-argument', 'decision must be "reinstate" or "uphold"');

  const ref = db.collection('disciplinaryCases').doc(caseId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Case not found');
  const existing = snap.data() as DisciplinaryCaseDoc;
  if (existing.status === 'resolved') throw new HttpsError('failed-precondition', 'This case is already resolved');
  if (existing.votes.some((v) => v.voterId === request.auth!.uid)) {
    throw new HttpsError('failed-precondition', 'You already voted on this case');
  }

  const vote: DisciplinaryVoteDoc = { voterId: request.auth!.uid, voterName, decision, at: Timestamp.now() };
  const entry: DisciplinaryHistoryEntryDoc = { action: 'vote_cast', actorId: request.auth!.uid, actorName: voterName, at: Timestamp.now() };
  await ref.update({
    status: 'vote_required',
    votes: FieldValue.arrayUnion(vote),
    history: FieldValue.arrayUnion(entry),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await recordAudit({ action: 'castDisciplinaryVote', actorUserId: request.auth!.uid, targetId: caseId, result: 'SUCCESS', metadata: { decision } });
  return { ok: true };
});

/** An admin explicitly closes the case with a resolution — see the module doc comment above for why this isn't auto-decided from the vote tally. */
export const resolveDisciplinaryCase = onCall(async (request) => {
  await requireAdminPermission(request, 'members');
  const caseId = String(request.data?.caseId ?? '');
  const resolution = request.data?.resolution as 'reinstated' | 'upheld';
  const note: string | undefined = request.data?.note?.trim() || undefined;
  const actorName = String(request.data?.actorName ?? '').trim() || 'Admin';
  if (!caseId) throw new HttpsError('invalid-argument', 'caseId is required');
  if (resolution !== 'reinstated' && resolution !== 'upheld') {
    throw new HttpsError('invalid-argument', 'resolution must be "reinstated" or "upheld"');
  }

  const ref = db.collection('disciplinaryCases').doc(caseId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Case not found');
  const existing = snap.data() as DisciplinaryCaseDoc;
  if (existing.status === 'resolved') throw new HttpsError('failed-precondition', 'Already resolved');

  const entry: DisciplinaryHistoryEntryDoc = { action: 'resolved', actorId: request.auth!.uid, actorName, ...(note ? { note } : {}), at: Timestamp.now() };
  await ref.update({
    status: 'resolved',
    resolution,
    history: FieldValue.arrayUnion(entry),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifyUser(
    existing.memberId,
    'Your disciplinary case was resolved',
    resolution === 'reinstated' ? 'You have been reinstated.' : `The decision was upheld.${note ? ` ${note}` : ''}`,
    { relatedId: caseId }
  );
  await recordAudit({ action: 'resolveDisciplinaryCase', actorUserId: request.auth!.uid, targetId: caseId, result: 'SUCCESS', metadata: { resolution } });
  return { ok: true };
});

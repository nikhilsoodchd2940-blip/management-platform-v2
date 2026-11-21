import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { requireAdminPermission } from '../admin/authorize';
import { getGroupOrThrow } from '../groups/hierarchy';
import { recordAudit } from '../../utils/logger';
import { notifyUser } from '../../utils/notify';
import type { ContributionDoc, ContributionMethod, FinancialProgramDoc } from '../../types/models';

const VALID_METHODS: readonly ContributionMethod[] = ['wave', 'orange_money', 'cash'];

export const createFinancialProgram = onCall(async (request) => {
  await requireAdminPermission(request, 'donations');

  const name = String(request.data?.name ?? '').trim();
  const goalAmountCents = Number(request.data?.goalAmountCents);
  const deadlineMs: number | undefined = request.data?.deadlineMs;
  const groupIds: unknown = request.data?.groupIds;
  const scopeAllGroups = groupIds === undefined || groupIds === null;

  if (!name) throw new HttpsError('invalid-argument', 'name is required');
  if (!Number.isInteger(goalAmountCents) || goalAmountCents < 1) {
    throw new HttpsError('invalid-argument', 'goalAmountCents must be a positive whole number');
  }
  if (!scopeAllGroups && (!Array.isArray(groupIds) || !groupIds.every((g) => typeof g === 'string'))) {
    throw new HttpsError('invalid-argument', 'groupIds must be an array of group IDs, or omitted for all groups');
  }

  const doc: FinancialProgramDoc = {
    name,
    goalAmountCents,
    ...(deadlineMs !== undefined ? { deadline: Timestamp.fromMillis(deadlineMs) } : {}),
    scopeAllGroups,
    ...(scopeAllGroups ? {} : { groupIds: groupIds as string[] }),
    status: 'open',
    createdBy: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as FinancialProgramDoc['createdAt'],
  };

  const ref = await db.collection('financialPrograms').add(doc);
  await recordAudit({ action: 'createFinancialProgram', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS', metadata: { name, goalAmountCents } });
  return { programId: ref.id };
});

export const closeFinancialProgram = onCall(async (request) => {
  await requireAdminPermission(request, 'donations');
  const programId = String(request.data?.programId ?? '');
  if (!programId) throw new HttpsError('invalid-argument', 'programId is required');
  await db.collection('financialPrograms').doc(programId).update({ status: 'closed' });
  await recordAudit({ action: 'closeFinancialProgram', actorUserId: request.auth!.uid, targetId: programId, result: 'SUCCESS' });
  return { ok: true };
});

/** Recorded by an admin on a member's behalf — mobile-money/cash payments are proof-based, not an automatic charge (unlike DonationDoc's Stripe flow). */
export const recordContribution = onCall(async (request) => {
  await requireAdminPermission(request, 'donations');

  const programId = String(request.data?.programId ?? '');
  const groupId = String(request.data?.groupId ?? '');
  const userId = String(request.data?.userId ?? '');
  const userName = String(request.data?.userName ?? '').trim();
  const method = request.data?.method as ContributionMethod;
  const amountCents = Number(request.data?.amountCents);
  const proofUrl: string | undefined = request.data?.proofUrl || undefined;

  if (!programId) throw new HttpsError('invalid-argument', 'programId is required');
  if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required');
  if (!userId || !userName) throw new HttpsError('invalid-argument', 'userId and userName are required');
  if (!VALID_METHODS.includes(method)) throw new HttpsError('invalid-argument', `method must be one of ${VALID_METHODS.join(', ')}`);
  if (!Number.isInteger(amountCents) || amountCents < 1) throw new HttpsError('invalid-argument', 'amountCents must be a positive whole number');
  if (method !== 'cash' && !proofUrl) throw new HttpsError('invalid-argument', 'A proof image is required for Wave/Orange Money');

  const programSnap = await db.collection('financialPrograms').doc(programId).get();
  if (!programSnap.exists) throw new HttpsError('not-found', 'Program not found');
  await getGroupOrThrow(groupId); // throws if the group doesn't exist

  const doc: ContributionDoc = {
    programId,
    groupId,
    userId,
    userName,
    method,
    amountCents,
    ...(proofUrl ? { proofUrl } : {}),
    status: 'pending_review',
    createdBy: request.auth!.uid,
    createdAt: FieldValue.serverTimestamp() as unknown as ContributionDoc['createdAt'],
  };
  const ref = await db.collection('contributions').add(doc);

  await notifyUser(userId, 'Contribution recorded', `Your ${amountCents / 100} contribution was recorded and is pending review.`, {
    type: 'resource_request', // reuses the same notification "kind" — no dedicated finance type needed for one line item
    relatedId: ref.id,
  });

  await recordAudit({ action: 'recordContribution', actorUserId: request.auth!.uid, targetId: ref.id, result: 'SUCCESS', metadata: { programId, groupId, amountCents, method } });
  return { contributionId: ref.id };
});

export const reviewContribution = onCall(async (request) => {
  await requireAdminPermission(request, 'donations');

  const contributionId = String(request.data?.contributionId ?? '');
  const decision = request.data?.decision as 'validate' | 'reject';
  const comment: string | undefined = request.data?.comment?.trim() || undefined;
  if (!contributionId) throw new HttpsError('invalid-argument', 'contributionId is required');
  if (decision !== 'validate' && decision !== 'reject') throw new HttpsError('invalid-argument', 'decision must be "validate" or "reject"');

  const ref = db.collection('contributions').doc(contributionId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Contribution not found');
  const existing = snap.data() as ContributionDoc;
  if (existing.status !== 'pending_review') throw new HttpsError('failed-precondition', `Already ${existing.status}`);

  await ref.update({
    status: decision === 'validate' ? 'validated' : 'rejected',
    reviewedBy: request.auth!.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    ...(comment ? { reviewComment: comment } : {}),
  });

  await notifyUser(
    existing.userId,
    decision === 'validate' ? 'Contribution validated' : 'Contribution rejected',
    `Your contribution of ${(existing.amountCents / 100).toFixed(2)} was ${decision === 'validate' ? 'validated' : `rejected${comment ? `: ${comment}` : '.'}`}`,
    { type: 'resource_request', relatedId: contributionId }
  );

  await recordAudit({ action: 'reviewContribution', actorUserId: request.auth!.uid, targetId: contributionId, result: 'SUCCESS', metadata: { decision } });
  return { ok: true };
});

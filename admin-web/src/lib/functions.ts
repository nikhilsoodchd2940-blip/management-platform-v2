import { httpsCallable } from './callCache';
import { functions } from './firebase';

/**
 * Thin typed wrappers so pages call `createGroup({...})` instead of
 * repeating `httpsCallable(functions, 'createGroup')` everywhere. Keeps
 * the callable name -> Cloud Function mapping in exactly one place.
 */

export const createGroup = httpsCallable<
  { name: string; type: 'main' | 'country' | 'city' | 'group'; parentGroupId?: string; capacity?: number; levelId?: string },
  { groupId: string }
>(functions, 'createGroup');

export const updateGroup = httpsCallable<
  { groupId: string; name?: string; capacity?: number | null },
  { ok: true }
>(functions, 'updateGroup');

export const archiveGroup = httpsCallable<{ groupId: string }, { ok: true }>(functions, 'archiveGroup');

export const reviewRegistration = httpsCallable<
  { userId: string; decision: 'approved' | 'rejected'; reason?: string },
  { ok: true }
>(functions, 'reviewRegistration');

export const setMemberStatus = httpsCallable<
  { userId: string; status: 'active' | 'disabled'; reason?: string },
  { ok: true }
>(functions, 'setMemberStatus');

export const deleteMember = httpsCallable<{ userId: string }, { ok: true }>(functions, 'deleteMember');

export const updateMember = httpsCallable<
  { userId: string; displayName?: string; memberId?: string; phone?: string; secondaryPhone?: string; email?: string; memberSince?: string },
  { ok: true }
>(functions, 'updateMember');

export const removeMemberFromGroup = httpsCallable<{ userId: string; groupId: string }, { ok: true }>(
  functions,
  'removeMemberFromGroup'
);

export const adminSetMemberPhoto = httpsCallable<{ userId: string; photoUrl: string }, { ok: true }>(
  functions,
  'adminSetMemberPhoto'
);

export const adminRemoveMemberPhoto = httpsCallable<{ userId: string }, { ok: true }>(
  functions,
  'adminRemoveMemberPhoto'
);

export const importGroupHierarchy = httpsCallable<
  { rows: Array<{ country: string; zone?: string; city?: string; group?: string }> },
  { results: Array<{ country: string; zone?: string; city?: string; group?: string; error?: string }> }
>(functions, 'importGroupHierarchy');

export const deleteGroup = httpsCallable<{ groupId: string; cascade?: boolean }, { ok: true }>(functions, 'deleteGroup');

export const addMember = httpsCallable<
  { phone: string; secondaryPhone?: string; memberId: string; displayName: string; email?: string; memberSince?: string; groupIds?: string[] },
  { userId: string }
>(functions, 'addMember');

export const importMembers = httpsCallable<
  { rows: Array<{ memberId: string; phone: string; displayName: string; email?: string; memberSince?: string; groupIds?: string[] }> },
  { results: Array<{ memberId: string; phone: string; userId?: string; error?: string }> }
>(functions, 'importMembers');

export const searchMembers = httpsCallable<
  { query: string; limit?: number },
  { results: Array<{ userId: string; displayName: string; phone: string; status: string; photoUrl?: string }> }
>(functions, 'searchMembers');

export const assignMemberToGroups = httpsCallable<{ userId: string; groupIds: string[]; strict?: boolean }, { ok: true }>(
  functions,
  'assignMemberToGroups'
);

export const assignHostToGroups = httpsCallable<
  { userId: string; groupIds: string[] },
  { ok: true; hostGroupIds: string[] }
>(functions, 'assignHostToGroups');

export const assignRole = httpsCallable<
  { targetUserId: string; role: 'admin' | 'host' | 'member'; orgId?: string; hostGroupIds?: string[] },
  { ok: true }
>(functions, 'assignRole');

// ---------- Events (Phase 2) ----------

interface EventInputPayload {
  title: string;
  mainGroupId: string;
  subGroupIds: string[];
  location: { lat: number; lng: number; address?: string };
  geofenceRadiusMeters: number;
  geofencePolygon?: { lat: number; lng: number }[];
  memberListDeadlineMs?: number;
  audioDeadlineMs?: number;
  startAtMs: number;
  endAtMs: number;
  kind?: 'event' | 'rehearsal' | 'meeting' | 'special_program';
  purpose?: string;
  requirements?: string;
  expectedAttendees?: number;
  timeSlots?: { start: string; end: string }[];
  conflictsApproved?: number;
  dailySchedule?: { date: string; start: string; end: string; slots?: { start: string; end: string }[] }[];
  /** Members taken out of the event to solve conflicts. */
  excludedUserIds?: string[];
}

export const createEvent = httpsCallable<EventInputPayload & { publish?: boolean }, { eventId: string; published: boolean; attendeeCount?: number }>(
  functions,
  'createEvent',
  { timeout: 300000 }
);

export const updateEvent = httpsCallable<EventInputPayload & { eventId: string }, { ok: true; removedSlots?: number; slotsOutside?: string[]; slotsOutsideCount?: number }>(
  functions,
  'updateEvent'
);

export const publishEvent = httpsCallable<{ eventId: string }, { ok: true; attendeeCount: number }>(
  functions,
  'publishEvent',
  { timeout: 300000 }
);

export const publishEventSeries = httpsCallable<{ seriesId: string }, { ok: true; publishedCount: number }>(
  functions,
  'publishEventSeries'
);

export const cancelEvent = httpsCallable<{ eventId: string }, { ok: true }>(functions, 'cancelEvent');
export const restoreEvent = httpsCallable<{ eventId: string }, { ok: true }>(functions, 'restoreEvent');

export const addEventAttendee = httpsCallable<{ eventId: string; userId: string }, { ok: true }>(
  functions,
  'addEventAttendee'
);

export const removeEventAttendee = httpsCallable<{ eventId: string; userId: string }, { ok: true }>(
  functions,
  'removeEventAttendee'
);

// ---------- Recurring events (Phase 4) ----------

export const createRecurringEvent = httpsCallable<
  EventInputPayload & {
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    daysOfWeek?: number[];
    occurrenceCount?: number;
    endByDateMs?: number;
    publish?: boolean;
  },
  { seriesId: string; eventIds: string[]; published: boolean }
>(functions, 'createRecurringEvent', { timeout: 540000 });

export const cancelEventSeries = httpsCallable<{ seriesId: string }, { ok: true; cancelledCount: number }>(
  functions,
  'cancelEventSeries'
);

export const deleteEvent = httpsCallable<{ eventId: string }, { ok: true }>(functions, 'deleteEvent');
export const deleteEventSeries = httpsCallable<{ seriesId: string }, { ok: true; deletedCount: number; keptCount: number }>(functions, 'deleteEventSeries');

// ---------- Requests (Phase 3) ----------

export const reviewEventRequest = httpsCallable<
  { eventRequestId: string; decision: 'approved' | 'rejected'; reason?: string },
  { ok: true }
>(functions, 'reviewEventRequest');

export const reviewAbsenceRequest = httpsCallable<
  { eventId: string; userId: string; decision: 'approved' | 'rejected' },
  { ok: true }
>(functions, 'reviewAbsenceRequest');

// ---------- Granular admin permissions (Phase 4) ----------

export const setAdminPermissions = httpsCallable<
  { targetUserId: string; isSuperAdmin: boolean; permissions: string[] },
  { ok: true }
>(functions, 'setAdminPermissions');

// ---------- Org settings (support contact shown on the mobile registration mismatch screen) ----------

export const updateOrgSettings = httpsCallable<
  { supportEmail?: string; supportPhone?: string; worldClocks?: { label: string; timeZone: string }[] },
  { ok: true }
>(functions, 'updateOrgSettings');

// ---------- Phone update requests (member's number changed, can't complete registration) ----------

export const reviewPhoneUpdateRequest = httpsCallable<
  { requestId: string; decision: 'approved' | 'rejected' },
  { ok: true }
>(functions, 'reviewPhoneUpdateRequest');

export const setMembershipRole = httpsCallable<
  { userId: string; groupId: string; role: 'member' | 'host' },
  { ok: true }
>(functions, 'setMembershipRole');

// groupId: null clears the member's Primary Group without setting a
// replacement. The Cloud Function itself validates groupId is one of
// the member's current active groups — the admin-panel UI just picks
// from that same set (see the member edit panel's Primary Group
// dropdown), so the failure mode this guards against shouldn't come up
// in normal use.
export const setPrimaryGroup = httpsCallable<{ userId: string; groupId: string | null }, { ok: true }>(
  functions,
  'setPrimaryGroup'
);

// ---------- Banners & popups (Admin-managed home-screen content) ----------

export const createBanner = httpsCallable<
  { imageUrl: string; linkUrl?: string; order?: number; active?: boolean },
  { bannerId: string }
>(functions, 'createBanner');

export const updateBanner = httpsCallable<
  { bannerId: string; imageUrl?: string; linkUrl?: string; order?: number; active?: boolean },
  { ok: true }
>(functions, 'updateBanner');

export const deleteBanner = httpsCallable<{ bannerId: string }, { ok: true }>(functions, 'deleteBanner');

export const createPopup = httpsCallable<
  { title: string; imageUrl?: string; description?: string; linkUrl?: string; order?: number; active?: boolean },
  { popupId: string }
>(functions, 'createPopup');

export const updatePopup = httpsCallable<
  {
    popupId: string;
    title?: string;
    imageUrl?: string;
    description?: string;
    linkUrl?: string;
    order?: number;
    active?: boolean;
  },
  { ok: true }
>(functions, 'updatePopup');

export const deletePopup = httpsCallable<{ popupId: string }, { ok: true }>(functions, 'deletePopup');

export interface IntegrationFieldStatus {
  configured: boolean;
  value?: string; // present only for non-secret fields (Twilio "from" number, Stripe publishable key)
  hint?: string; // present only for secret fields, e.g. "•••• 4242"
}

export type IntegrationStatus = Record<
  | 'twilioAccountSid'
  | 'twilioAuthToken'
  | 'twilioVerifyServiceSid'
  | 'twilioFromNumber'
  | 'stripeSecretKey'
  | 'stripeWebhookSecret'
  | 'stripePublishableKey'
  | 'googleMapsApiKey',
  IntegrationFieldStatus
>;

export const getIntegrationStatus = httpsCallable<Record<string, never>, IntegrationStatus>(
  functions,
  'getIntegrationStatus'
);

export const updateIntegrationSettings = httpsCallable<
  Partial<{
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioVerifyServiceSid: string;
    twilioFromNumber: string;
    stripeSecretKey: string;
    stripeWebhookSecret: string;
    stripePublishableKey: string;
    googleMapsApiKey: string;
  }>,
  { ok: true }
>(functions, 'updateIntegrationSettings');

// ---------- Group, Event & Approval Management module ----------

export const setZoneManagerCities = httpsCallable<{ targetUserId: string; cityIds: string[] }, { ok: true }>(
  functions,
  'setZoneManagerCities'
);

export type ResourceCategory =
  | 'music_equipment'
  | 'books'
  | 'instruments'
  | 'furniture'
  | 'transportation'
  | 'food'
  | 'other';

export const createResourceRequest = httpsCallable<
  {
    groupId: string;
    requestedBy: string;
    requestedByName: string;
    equipmentId: string;
    /** Optional extra notes, appended to the equipment name. */
    itemsDescription?: string;
    quantity?: number;
    purpose?: string;
    deliveryLocation?: string;
    neededByMs?: number;
  },
  { requestId: string }
>(functions, 'createResourceRequest');

export const reviewResourceRequest = httpsCallable<
  { requestId: string; decision: 'approve' | 'reject'; comment?: string; actorName?: string },
  { ok: true; stage: string; logisticsTaskId?: string }
>(functions, 'reviewResourceRequest');

export type LogisticsStatus = 'pending' | 'assigned' | 'preparing' | 'dispatched' | 'delivered' | 'completed';

export const updateLogisticsTask = httpsCallable<
  {
    taskId: string;
    status?: LogisticsStatus;
    assignedToUserId?: string;
    assignedToName?: string;
    comment?: string;
    actorName?: string;
  },
  { ok: true; status: LogisticsStatus }
>(functions, 'updateLogisticsTask');

// ---------- Finance (Programmes financiers) ----------

export type ContributionMethod = 'wave' | 'orange_money' | 'cash';

export const createFinancialProgram = httpsCallable<
  { name: string; description?: string; currency?: 'XOF' | 'USD' | 'EUR'; goalAmountCents: number; recurrence?: 'monthly' | 'quarterly' | 'yearly'; startMs?: number; deadlineMs?: number; phases?: { name: string; amountCents: number; startMs?: number; endMs?: number }[]; groupIds?: string[] },
  { programId: string }
>(functions, 'createFinancialProgram');
export const updateFinancialProgram = httpsCallable<{ programId: string; name?: string; description?: string; goalAmountCents?: number; recurrence?: 'none' | 'monthly' | 'quarterly' | 'yearly'; startMs?: number | null; deadlineMs?: number | null; phases?: { name: string; amountCents: number; startMs?: number; endMs?: number }[]; status?: 'open' | 'closed' }, { ok: true }>(functions, 'updateFinancialProgram');
export const setProgramPhases = httpsCallable<{ programId: string; phases: { name: string; amountCents: number }[] }, { ok: true }>(functions, 'setProgramPhases');

export const closeFinancialProgram = httpsCallable<{ programId: string }, { ok: true }>(functions, 'closeFinancialProgram');

export const recordContribution = httpsCallable<
  {
    programId: string;
    groupId: string;
    userId: string;
    userName: string;
    method: ContributionMethod;
    amountCents: number;
    proofUrl?: string;
    notes?: string;
  },
  { contributionId: string }
>(functions, 'recordContribution');

export const reviewContribution = httpsCallable<
  { contributionId: string; decision: 'validate' | 'reject'; comment?: string },
  { ok: true }
>(functions, 'reviewContribution');

// ---------- Conseil de discipline ----------

export const openDisciplinaryCase = httpsCallable<
  { memberId: string; memberName: string; groupId: string; reason: string; description: string; actorName?: string },
  { caseId: string }
>(functions, 'openDisciplinaryCase');

export const requestDisciplinaryHearing = httpsCallable<{ caseId: string; note?: string; actorName?: string }, { ok: true }>(
  functions,
  'requestDisciplinaryHearing'
);

export const castDisciplinaryVote = httpsCallable<
  { caseId: string; decision: 'reinstate' | 'uphold'; voterName?: string },
  { ok: true }
>(functions, 'castDisciplinaryVote');

export const resolveDisciplinaryCase = httpsCallable<
  { caseId: string; resolution: 'reinstated' | 'upheld'; note?: string; actorName?: string },
  { ok: true }
>(functions, 'resolveDisciplinaryCase');

// ---------- Comité pédagogique ----------

export const createQacaid = httpsCallable<
  { code?: string; title: string; melody?: string; durationSeconds?: number; levelId?: string },
  { qacaidId: string }
>(functions, 'createQacaid');

export const allocateQacaid = httpsCallable<{ qacaidId: string; groupId: string }, { ok: true }>(functions, 'allocateQacaid');

export const deleteQacaid = httpsCallable<{ qacaidId: string; deleteFiles?: boolean }, { ok: true }>(functions, 'deleteQacaid');
export const deleteQacaidEdition = httpsCallable<{ editionId: string }, { ok: true }>(functions, 'deleteQacaidEdition');
export const deleteAudioTrack = httpsCallable<{ trackId: string }, { ok: true }>(functions, 'deleteAudioTrack');

export const removeQacaidAllocation = httpsCallable<{ qacaidId: string; groupId: string }, { ok: true }>(
  functions,
  'removeQacaidAllocation'
);

export const submitProgressReport = httpsCallable<
  { groupId: string; period: string; masteryPct: number; melodyPct: number; timingPct: number; directivesPct: number },
  { reportId: string }
>(functions, 'submitProgressReport');

// ---------- Bibliothèque des Qasaid ----------

export const createQacaidEdition = httpsCallable<
  { qacaidId: string; levelId?: string; label: string; fileUrl: string; filePath: string; fileSizeBytes: number; durationSeconds?: number; downloadable?: boolean },
  { editionId: string }
>(functions, 'createQacaidEdition');

export const shareQacaidEdition = httpsCallable<
  { editionId: string; scopeType: 'group' | 'user'; scopeId: string; right: 'download' | 'read_only'; expiresAtMs?: number },
  { shareId: string }
>(functions, 'shareQacaidEdition');

export const revokeLibraryShare = httpsCallable<{ shareId: string }, { ok: true }>(functions, 'revokeLibraryShare');

// ---------- Audio library ----------

export const uploadAudioTrack = httpsCallable<
  {
    qacaidId: string;
    melodyLabel: string;
    category: 'rehearsal' | 'announcement' | 'performance';
    groupIds?: string[];
    levelId?: string;
    fileUrl: string;
    filePath: string;
    durationSeconds: number;
    linkedEventId?: string;
  },
  { trackId: string }
>(functions, 'uploadAudioTrack');

export const setAudioTrackLevel = httpsCallable<{ trackId: string; levelId: string }, { ok: true }>(functions, 'setAudioTrackLevel');

export const reviewAudioTrack = httpsCallable<{ trackId: string }, { ok: true }>(functions, 'reviewAudioTrack');

// ---------- Annonces et notifications ----------

export const sendAnnouncement = httpsCallable<
  { title: string; body: string; target: 'all' | 'group'; targetGroupId?: string },
  { announcementId: string; recipientCount: number }
>(functions, 'sendAnnouncement');

// ---------- Academic levels & equipment ----------

export const createLevel = httpsCallable<
  { name: string; rank: number; description?: string; accessLevelIds?: string[]; maxBooks?: number | null },
  { levelId: string }
>(functions, 'createLevel');

export const updateLevel = httpsCallable<
  { levelId: string; name?: string; rank?: number; description?: string; accessLevelIds?: string[]; maxBooks?: number | null },
  { ok: true }
>(functions, 'updateLevel');

export const deleteLevel = httpsCallable<{ levelId: string }, { ok: true }>(functions, 'deleteLevel');

export const setGroupLevel = httpsCallable<{ groupId: string; levelId: string }, { ok: true }>(functions, 'setGroupLevel');
export const setQacaidLevel = httpsCallable<{ qacaidId: string; levelId: string }, { ok: true }>(functions, 'setQacaidLevel');
export const setEditionLevel = httpsCallable<{ editionId: string; levelId: string }, { ok: true }>(functions, 'setEditionLevel');
export const rebuildLevelAccess = httpsCallable<Record<string, never>, { users: number }>(functions, 'rebuildLevelAccess');

export const createEquipment = httpsCallable<
  { name: string; category: ResourceCategory; description?: string; levelId: string; quantityAvailable?: number },
  { equipmentId: string }
>(functions, 'createEquipment');

export const updateEquipment = httpsCallable<
  {
    equipmentId: string;
    name?: string;
    category?: ResourceCategory;
    description?: string;
    levelId?: string;
    quantityAvailable?: number | null;
    status?: 'active' | 'retired';
  },
  { ok: true }
>(functions, 'updateEquipment');

export const deleteEquipment = httpsCallable<{ equipmentId: string }, { deleted: boolean; retired: boolean }>(functions, 'deleteEquipment');

// ---------- Offices, delegations, evaluations, meetings, welfare, admissions, renewal, programmes ----------
// Loosely typed on purpose: every one of these is validated server-side (see firebase/functions/src/modules).
type Payload = Record<string, unknown>;
const callable = <R = Record<string, unknown>>(name: string) => httpsCallable<Payload, R>(functions, name, { timeout: 300000 });

export const setKurelRoles = callable('setKurelRoles');
export const createDelegation = callable('createDelegation');
export const revokeDelegation = callable('revokeDelegation');
export const markAttendance = callable('markAttendance');
export const setEventSites = callable('setEventSites');
export const setEventShifts = callable('setEventShifts');
export const setEventExclusions = callable<{ ok: true; excluded: number }>('setEventExclusions');
export const analyzeEventConflicts = callable('analyzeEventConflicts');

export interface DraftConflict {
  id: string;
  type: 'group' | 'member' | 'cross_event' | 'performance' | 'site' | 'supervisor' | 'shift';
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  otherEventId?: string;
  otherEventTitle?: string;
  startMs?: number;
  endMs?: number;
  place?: string;
  affectedGroups?: string[];
  suggestion?: string;
  groupIds?: string[];
  members?: { id: string; name: string }[];
  shiftIds?: string[];
}
export interface SharedMember {
  userId: string;
  name: string;
  groups: { groupId: string; groupName: string; startMs: number; endMs: number; hasSlot: boolean; place: string }[];
}
export type LiveStatus = 'upcoming' | 'ready' | 'in_progress' | 'completed' | 'delayed' | 'cancelled';
export interface DelayImpact {
  slotId: string; groupId: string; groupName: string; sharedMembers: string[]; reason: string;
  suggestedStartMs: number; suggestedEndMs: number; shiftMinutes: number;
  first: boolean; squeezeable: boolean; originalStartMs: number; originalEndMs: number;
}
export type RunState = Record<string, { state: 'running' | 'paused' | 'ended'; atMs: number }>;
export const setEventRun = callable<{ ok: true; shifted: number; closed: number; cancelled: number }>('setEventRun');
export const addExtraSlot = callable<{ ok: true; slotId: string }>('addExtraSlot');
export type SupervisionLevel = 'admin' | 'main' | 'manager' | 'member';
export const LEVEL_NAME: Record<SupervisionLevel, string> = { admin: 'Administration', main: 'Main event supervisor', manager: 'Site manager', member: 'Site staff' };
export interface ThreadMessage { id: string; fromName: string; fromLevel: string; fromRole: string; system: boolean; text: string; atMs: number }
export interface SupervisorThread {
  threadId: string; kind: string; status: string; handler: 'manager' | 'main' | 'admin'; handlerLabel: string;
  ownerUid: string; ownerName: string; ownerLevel: string; place: string; about: string;
  mine: boolean; involved: boolean; canAct: boolean; canEscalate: boolean; createdMs: number; updatedMs: number; messages: ThreadMessage[];
}
export const sendSupervisorMessage = callable<{ ok: true; threadId: string; handler?: string }>('sendSupervisorMessage');
export const escalateSupervisorThread = callable<{ ok: true; handler: string }>('escalateSupervisorThread');
export const resolveSupervisorThread = callable<{ ok: true }>('resolveSupervisorThread');
export const getSupervisorThreads = callable<{ level: SupervisionLevel; threads: SupervisorThread[] }>('getSupervisorThreads');
export const scheduleImpacts = callable<{ ok: true; impacts: DelayImpact[] }>('scheduleImpacts');
export const setLiveStatus = callable<{ ok: true; impacts: DelayImpact[] }>('setLiveStatus');
export const extendPerformance = callable<{ ok: true; impacts: DelayImpact[] }>('extendPerformance');
export const adjustSchedule = callable<{ ok: true; changed: number }>('adjustSchedule');
export const addEventNote = callable('addEventNote');
export interface SupervisionSummary {
  name: string;
  events: { id: string; title: string; status: string; run?: string[]; startMs: number; endMs: number; location: string; groups: number; myShifts: { id: string; label: string; startMs: number; endMs: number; role: 'main' | 'member' }[] }[];
}
export interface SupervisionMember {
  userId: string;
  name: string;
  photoUrl: string;
  groups: { groupName: string; startMs: number; endMs: number; status: string; place: string }[];
  current: { groupName: string; startMs: number; endMs: number; place: string } | null;
  next: { groupName: string; startMs: number; endMs: number; place: string } | null;
}
export interface SupervisionEvent {
  event: {
    id: string; title: string; status: string; startMs: number; endMs: number; location: string;
    timeSlots: { start: string; end: string }[]; dailySchedule: { date: string; start: string; end: string }[];
    sites: { id: string; name: string; groupIds: string[]; supervisorName?: string }[];
    shifts: { id: string; label: string; startMs: number; endMs: number; siteIds: string[]; groupIds: string[]; supervisors: { userId: string; name: string; role: 'main' | 'member'; leaderId?: string; level: SupervisionLevel; photoUrl: string; can: string[] }[] }[];
    run: RunState;
    /** False when the supervisor only has some of the places. */
    scopeAll: boolean;
  };
  me: { userId: string; level: SupervisionLevel; levelLabel: string; rights: string[] };
  contacts: { userId: string; name: string; phone: string; email: string; photoUrl: string; role: string; level: SupervisionLevel; places: string[] }[];
  slots: { id: string; groupId: string; groupName: string; startMs: number; endMs: number; performanceRemark?: string; originalStartMs?: number; status: LiveStatus; delayMinutes?: number; delayReason?: string; atRisk?: boolean; atRiskReason?: string; actualStartMs?: number; actualEndMs?: number; audioRuns?: Record<string, { startedMs: number; endedMs?: number; pausedMs?: number; pausedAtMs?: number; remark?: string; rating?: number }>; audio?: { status: string; items: { title: string; artist?: string; type: string; seconds: number }[] } | null }[];
  log: { id: string; type: string; byName: string; detail: string; before?: string; after?: string; groupName?: string; atMs: number }[];
  members: SupervisionMember[];
}
export const getMySupervision = callable<SupervisionSummary>('getMySupervision');
export const getSupervisionEvent = callable<SupervisionEvent>('getSupervisionEvent');
export const sendOtp = callable<{ sent: boolean }>('sendOtp');
export const verifyOtp = callable<{ customToken: string; uid: string }>('verifyOtp');
export const checkDraftConflicts = callable<{ conflicts: DraftConflict[]; sharedMembers: SharedMember[]; sharedTotal?: number }>('checkDraftConflicts');
export const submitEvaluation = callable('submitEvaluation');
export const reviewEvaluation = callable('reviewEvaluation');
export const createMeeting = callable('createMeeting');
export const updateMeetingAgenda = callable('updateMeetingAgenda');
export const setMeetingStatus = callable('setMeetingStatus');
export const controlAgendaPoint = callable('controlAgendaPoint');
export const finishMeeting = callable<{ followUpMeetingIds: string[] }>('finishMeeting');
export const createFollowUpMeetings = callable<{ followUpMeetingIds: string[] }>('createFollowUpMeetings');
export const submitMeetingFeedback = callable('submitMeetingFeedback');
export const markMeetingAttendance = callable('markMeetingAttendance');
export const addMeetingDecision = callable('addMeetingDecision');
export const setMeetingActionStatus = callable('setMeetingActionStatus');
export const submitWelfareRequest = callable('submitWelfareRequest');
export const updateWelfareRequest = callable('updateWelfareRequest');
export const createAdmissionApplication = callable('createAdmissionApplication');
export const advanceAdmission = callable('advanceAdmission');
export const completeAdmission = callable('completeAdmission');
export const openRenewalCampaign = callable('openRenewalCampaign');
export const recordRenewalPayment = callable('recordRenewalPayment');
export const closeRenewalCampaign = callable('closeRenewalCampaign');
export const setProgramAllocations = callable('setProgramAllocations');
export const setMemberShares = callable('setMemberShares');
export const submitEventProgram = callable('submitEventProgram');
export const recordProgramPerformance = callable('recordProgramPerformance');
export const giveProgramFeedback = callable('giveProgramFeedback');
export const saveDisciplinaryMinutes = callable('saveDisciplinaryMinutes');
export const setGroupSpecial = callable('setGroupSpecial');
export const requestKurelTransfer = callable('requestKurelTransfer');
export const giveTransferOpinion = callable('giveTransferOpinion');
export const decideTransfer = callable('decideTransfer');

export const createZone = callable<{ zoneId: string }>('createZone');
export const updateZone = callable('updateZone');
export const deleteZone = callable('deleteZone');
export const setCityGeo = callable('setCityGeo');
export const applyDefaultTimeZones = callable<{ updated: number }>('applyDefaultTimeZones');
export const createManagerAccount = callable<{ userId: string }>('createManagerAccount');
export const setManagerAccess = callable('setManagerAccess');
export const setManagerEnabled = callable('setManagerEnabled');
export const removeManagerAccess = callable('removeManagerAccess');
export const setAdminProfile = callable('setAdminProfile');
export const getAccountEmails = callable<{ accounts: Record<string, { email: string; disabled: boolean }> }>('getAccountEmails');
export const saveCommittee = callable<{ id: string }>('saveCommittee');
export const setCommitteeMembers = callable<{ ok: boolean; count: number }>('setCommitteeMembers');
export const deleteCommittee = callable('deleteCommittee');
export const upsertEventSlot = callable<{ slotId: string; memberConflicts?: number }>('upsertEventSlot');
/** Saves the slots of many groups in one call (an event created with a group schedule). Each refused slot comes back with its reason. */
export const createEventSlots = httpsCallable<
  { eventId: string; slots: { groupId: string; startAtMs: number; durationMinutes: number }[]; allowOverlap?: boolean },
  { created: number; failed: { groupId: string; startAtMs: number; message: string }[]; failedCount: number; memberConflicts: number }
>(functions, 'createEventSlots', { timeout: 300000 });
export const setMemberPerformingGroup = callable('setMemberPerformingGroup');
export const deleteEventSlot = callable('deleteEventSlot');
/** Puts the groups of an event in a new performance order (each moved slot gets its new start, its length is kept). */
export const reorderEventSlots = callable<{ moved: number }>('reorderEventSlots');
export const submitPerformanceSelection = callable<{ totalSeconds: number; remainingSeconds: number }>('submitPerformanceSelection');
export const previewPerformanceSelection = callable<{ items: { type: string; id: string; title: string; durationSeconds: number }[]; totalSeconds: number; allocatedSeconds: number; remainingSeconds: number; fits: boolean }>('previewPerformanceSelection');
export const reviewPerformanceSelection = callable('reviewPerformanceSelection');
export const setResourceDuration = callable('setResourceDuration');
export const addPerformanceRemark = callable('addPerformanceRemark');
export const setPerformanceStatus = callable('setPerformanceStatus');
export const submitEventRequest = callable<{ eventRequestId: string }>('submitEventRequest');
export const saveGeofence = callable<{ geofenceId: string | null }>('saveGeofence');
export const setGeofenceActive = callable('setGeofenceActive');
export const deleteGeofence = callable('deleteGeofence');
export const saveLocalZone = callable<{ localZoneId: string }>('saveLocalZone');
export const setLocalZoneActive = callable('setLocalZoneActive');
export const deleteLocalZone = callable('deleteLocalZone');
export const setGroupLocalZone = callable('setGroupLocalZone');

export const getMapsConfig = httpsCallable<Record<string, never>, { googleMapsApiKey: string }>(functions, 'getMapsConfig');

// ---------- Attendance for supervisors ----------
export type AttendanceState = 'PRESENT' | 'LATE' | 'LATE_APPROVED' | 'PENDING' | 'ABSENT' | 'EXCUSED' | 'NONE';
export interface AttendanceMember { userId: string; name: string; photoUrl: string; substitute: boolean; state: AttendanceState; atMs?: number; minutesLate?: number }
export interface AttendanceGroup {
  groupId: string; groupName: string; place: string; startMs: number; endMs: number; status: string;
  counts: { total: number; present: number; late: number; lateApproved: number; pending: number; absent: number; notYet: number };
  members: AttendanceMember[];
}
export interface AttendanceConflict { key: string; kind: 'pending' | 'missing_on_stage' | 'double_booked'; userId: string; name: string; groupName: string; detail: string }
export interface EventAttendance {
  totals: { total: number; present: number; late: number; lateApproved: number; pending: number; absent: number; notYet: number };
  groups: AttendanceGroup[]; conflicts: AttendanceConflict[]; canDecide: boolean; nowMs: number;
}
export const getEventAttendance = callable<EventAttendance>('getEventAttendance');
export const setAudioRun = callable<{ ok: true }>('setAudioRun');
export const reviewLateArrival = callable<{ ok: true }>('reviewLateArrival');

// ---------- Member lists, deadlines, withdrawals ----------
export type ListStatus = 'requested' | 'submitted' | 'approved' | 'rejected' | 'withdrawal_pending' | 'withdrawn';
export interface ParticipationGroup {
  groupId: string; groupName: string; status: ListStatus; late: boolean; memberCount: number; preview?: { userId: string; name: string; photoUrl: string }[];
  submittedAtMs?: number; submittedByName: string; reviewedByName: string; rejectReason: string;
  removed: { userId: string; name: string; reason: string; byName: string; atMs?: number }[];
  withdrawal: { reason: string; byName: string; atMs?: number; decision?: 'approved' | 'rejected'; decidedByName?: string; note?: string } | null;
  audio: { slots: number; items: number; state: 'none' | 'draft' | 'submitted' | 'approved' };
  listOverdue: boolean; audioOverdue: boolean;
  history: { by: string; action: string; detail: string; atMs?: number }[];
}
export interface ParticipationRoster { userId: string; name: string; photoUrl: string; substitute: boolean; included: boolean }
export interface EventParticipation {
  eventId: string; title: string; startMs: number; nowMs: number;
  deadlines: { memberListMs: number | null; audioMs: number | null };
  mode: 'group' | 'review'; canReview: boolean; canDecide: boolean;
  totals: { groups: number; waiting: number; toReview: number; approved: number; rejected: number; withdrawals: number; withdrawn: number; listOverdue: number; audioOverdue: number };
  groups: ParticipationGroup[]; roster?: ParticipationRoster[];
}
export interface MyListItem {
  eventId: string; title: string; startMs: number; groupId: string; groupName: string; status: ListStatus;
  deadlineMs: number | null; audioDeadlineMs: number | null; memberCount: number; rejectReason: string;
  removed: { name: string; reason: string }[]; withdrawal: { reason: string; decision: 'approved' | 'rejected' | null; note: string } | null;
}
export const getEventParticipation = callable<EventParticipation>('getEventParticipation');
export const getMyParticipation = callable<{ items: MyListItem[] }>('getMyParticipation');
export const setEventDeadlines = callable<{ ok: true }>('setEventDeadlines');
export const submitParticipantList = callable<{ ok: true; late: boolean }>('submitParticipantList');
export interface InboxList { eventId: string; title: string; startMs: number; groupId: string; groupName: string; status: ListStatus; memberCount: number; late: boolean; submittedAtMs: number | null; submittedByName: string; withdrawalReason: string }
export const getParticipationInbox = callable<{ items: InboxList[]; canDecide: boolean }>('getParticipationInbox');
export const reviewParticipantList = callable<{ ok: true }>('reviewParticipantList');
export const requestWithdrawal = callable<{ ok: true }>('requestWithdrawal');
export const decideWithdrawal = callable<{ ok: true }>('decideWithdrawal');
export const setMembershipSeat = callable<{ ok: true }>('setMembershipSeat');
export const setMemberTag = callable<{ ok: true }>('setMemberTag');

// ---------- Quick actions ----------
export type QuickItem = 'books' | 'water' | 'coffee' | 'tissue' | 'other';
export type QuickStatus = 'new' | 'in_progress' | 'not_available' | 'delivered';
export interface QuickRow { id: string; item: QuickItem; note: string; siteName: string; requesterName: string; mine: boolean; status: QuickStatus; handledByName: string; createdMs: number; updatedMs: number; canAnswer: boolean }
export const createQuickRequest = callable<{ ok: true; id: string }>('createQuickRequest');
export const setQuickRequestStatus = callable<{ ok: true }>('setQuickRequestStatus');
export const listQuickRequests = callable<{ canHandle: boolean; rows: QuickRow[]; open: number; nowMs: number }>('listQuickRequests');

// ---------- Event books (what groups choose for event performances) ----------
export interface EventBookRow { id: string; title: string; artist: string; version?: string; durationSeconds: number; levelId: string }
export interface ImportBookRow { row: number; title: string; artist: string; version?: string; durationSeconds: number; levelName: string; status: 'new' | 'update' | 'same' | 'error'; message: string }
export interface ImportBooksResult { dryRun: boolean; summary: { added: number; updated: number; unchanged: number; errors: number }; rows: ImportBookRow[]; revalidated?: number }
export const listEventBooks = callable<{ books: EventBookRow[] }>('listEventBooks');
export const saveEventBook = callable<{ ok: true; revalidated: number }>('saveEventBook');
export interface BookSuggestion { id: string; title: string; artist: string; version: string; durationSeconds: number; levelId: string; levelName: string; groupName: string; requesterName: string; status: 'pending' | 'approved' | 'rejected'; reason: string; createdAtMs: number; decidedByName: string }
export const suggestEventBook = callable<{ ok: true; id: string }>('suggestEventBook');
export const listBookSuggestions = callable<{ suggestions: BookSuggestion[]; canReview: boolean }>('listBookSuggestions');
export const reviewBookSuggestion = callable<{ ok: true; bookId?: string }>('reviewBookSuggestion');
export const deleteEventBook = callable<{ ok: true; usedBy: number }>('deleteEventBook');
export const importEventBooks = callable<ImportBooksResult>('importEventBooks');

export interface DirectMessage { id: string; mine: boolean; fromName: string; text: string; atMs: number }
export const sendDirectMessage = callable<{ ok: true; id: string }>('sendDirectMessage');
export const getDirectMessages = callable<{ messages: DirectMessage[] }>('getDirectMessages');
export const getDirectInbox = callable<{ byUser: Record<string, number> }>('getDirectInbox');

// Collection plan: targets handed down the management levels.
export const createCollectionPlan = callable('createCollectionPlan');
export const removeDraftTarget = callable('removeDraftTarget');
export const publishCollectionPlan = callable('publishCollectionPlan');
export const respondToAllocation = callable('respondToAllocation');
export const splitAllocation = callable('splitAllocation');
export const respondAsMember = callable('respondAsMember');
export const resolveShortfall = callable('resolveShortfall');
export const reviewEscalation = callable('reviewEscalation');

export const backfillDefaultPhotos = callable<{ ok: true; updated: number }>('backfillDefaultPhotos');

// ---------- Tasks ----------
export const createTask = callable<{ taskId: string }>('createTask');
export const updateTask = callable('updateTask');
export const addTaskFeedback = callable('addTaskFeedback');
export const editTask = callable('editTask');
export const remindTask = callable('remindTask');
export const setTaskReminders = callable('setTaskReminders');
export const syncMeetingTasks = callable<{ created: number }>('syncMeetingTasks');

/** Fills missing texts of a language with Google Cloud Translation (Languages & texts screen). */
export const translateTexts = httpsCallable<
  { lang: 'fr' | 'es' | 'it'; items: { key: string; text: string }[] },
  { translations: Record<string, string> }
>(functions, 'translateTexts');

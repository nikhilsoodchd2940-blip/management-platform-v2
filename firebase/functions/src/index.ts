import { onCall } from 'firebase-functions/v2/https';
import { log } from './utils/logger';

/**
 * Phase 0: health-check only, to prove the project builds/deploys.
 * Phase 1: OTP auth, role assignment, group CRUD, member management,
 * personal QR issuance.
 * Phase 2: event lifecycle, QR check-in with geofence validation
 * (see docs/QR_DATAFLOW.md).
 * Phase 3: absence requests, event requests, system-detected conflicts,
 * donations. Chat has no Functions — messages are written directly by
 * clients under firestore.rules (see that file).
 * Phase 4: recurring events, scheduled SMS/in-app reminders, granular
 * admin permissions. Chat media reuses Phase 3's direct-client-write
 * chat messages (see firebase/storage.rules for the upload path) — no
 * new Function needed there either.
 * Phase 5 (this file, current): no new callables — a review/hardening
 * pass over everything above. modules/admin/authorize.ts now enforces
 * the granular permissions Phase 4 only checked in the UI; sendOtp and
 * checkIn are rate-limited (utils/rateLimit.ts); sendOtp, verifyOtp,
 * checkIn, assignRole, setAdminPermissions, and createDonationIntent all
 * set enforceAppCheck: true. See docs/PHASE5_COMPLETION.md and
 * docs/QA_SECURITY_REVIEW.md.
 */

export const healthCheck = onCall((request) => {
  log.info('healthCheck invoked', { uid: request.auth?.uid ?? null });
  if (!request.auth) {
    return { ok: true, authenticated: false, timestamp: Date.now() };
  }
  return { ok: true, authenticated: true, timestamp: Date.now() };
});

// ---------- Auth (blueprint §5 — "Login using the agreed OTP flow") ----------
export { sendOtp, verifyOtp } from './modules/auth/otp';
export { assignRole } from './modules/auth/assignRole';
export { setUserRoleClaims, isValidRole } from './modules/auth/roles';

// ---------- Closed registration (Phase 6 — Member ID + phone match, photo, admin approval) ----------
export { beginRegistration, completeRegistrationOtp, submitRegistration, reviewRegistration } from './modules/auth/registration';

// ---------- Org settings (support contact shown on the registration mismatch screen) ----------
export { updateOrgSettings } from './modules/settings/orgSettings';

// ---------- Phone update requests (member's number changed, can't complete registration) ----------
export { requestPhoneUpdate, reviewPhoneUpdateRequest } from './modules/members/phoneUpdateRequests';

// ---------- Home-screen banners & app-open popups (Admin-managed) ----------
export { createBanner, updateBanner, deleteBanner, createPopup, updatePopup, deletePopup } from './modules/content/content';

// ---------- Groups (blueprint §5 — Admin web group management) ----------
export { createGroup, updateGroup, archiveGroup, deleteGroup, importGroupHierarchy } from './modules/groups/groups';
export {
  addMember,
  importMembers,
  searchMembers,
  assignMemberToGroups,
  assignHostToGroups,
  setMembershipRole,
  setMemberStatus,
  deleteMember,
  updateMember,
  removeMemberFromGroup,
  adminSetMemberPhoto,
  adminRemoveMemberPhoto,
  setPrimaryGroup,
} from './modules/groups/members';

// ---------- Personal QR (blueprint §5 — "one unique personal QR") ----------
export { getPersonalQr, signQrPayload, verifyQrPayload } from './modules/qr/personalQr';

// ---------- Events (blueprint §6 — event lifecycle) ----------
export {
  createEvent,
  updateEvent,
  publishEvent,
  publishEventSeries,
  cancelEvent,
  addEventAttendee,
  removeEventAttendee,
} from './modules/events/events';

// ---------- Check-in (blueprint §6 — QR + geofence + attendance, docs/QR_DATAFLOW.md) ----------
export { checkIn } from './modules/qr/checkIn';

// ---------- Absence requests (blueprint §7) ----------
export { submitAbsenceRequest, reviewAbsenceRequest } from './modules/absence/absence';

// ---------- Event requests (blueprint §7 — member-proposed, Admin-reviewed) ----------
export { submitEventRequest, reviewEventRequest } from './modules/requests/eventRequests';

// ---------- Conflicts (blueprint §7 — system-detected, Firestore trigger) ----------
export { onEventAttendeeCreated } from './modules/conflicts/conflicts';

// ---------- Donations (blueprint §7 — Stripe, webhook-verified) ----------
export { createDonationIntent, stripeWebhook } from './modules/donations/donations';
export { getIntegrationStatus, updateIntegrationSettings } from './modules/integrations/integrations';
export { setZoneManagerCities } from './modules/admin/permissions';
export { createResourceRequest, reviewResourceRequest } from './modules/resourceRequests/resourceRequests';
export { updateLogisticsTask } from './modules/logistics/logistics';
export { createFinancialProgram, closeFinancialProgram, recordContribution, reviewContribution } from './modules/finance/finance';
export { openDisciplinaryCase, requestDisciplinaryHearing, castDisciplinaryVote, resolveDisciplinaryCase } from './modules/discipline/discipline';
export { createQacaid, allocateQacaid, removeQacaidAllocation, submitProgressReport } from './modules/pedagogy/pedagogy';
export { createQacaidEdition, shareQacaidEdition, revokeLibraryShare } from './modules/library/library';
export { uploadAudioTrack, reviewAudioTrack } from './modules/audio/audio';

// ---------- Recurring events (blueprint §8) ----------
export { createRecurringEvent, cancelEventSeries } from './modules/events/recurring';

// ---------- Reminders (blueprint §8 — scheduled SMS + in-app) ----------
export { sendEventReminders } from './modules/reminders/reminders';

// ---------- Granular admin permissions (blueprint §8) ----------
export { setAdminPermissions } from './modules/admin/permissions';

/**
 * Canonical Firestore collection shapes. This file is the single source of
 * truth for the data model — see docs/DATA_MODEL.md for the narrative
 * explanation of *why* it's shaped this way. Admin web and Flutter mobile
 * should mirror these shapes in their own type systems (TS interfaces /
 * Dart classes) rather than re-deriving them independently.
 */

export type Role = 'admin' | 'host' | 'member';

export type Timestamp = FirebaseFirestore.Timestamp;

// ---------- Identity ----------

/**
 * Registration is closed (blueprint update, Phase 6): a person can only
 * ever reach 'pending_approval' by matching a memberId+phone pair an
 * Admin already pre-loaded (via addMember/importMembers). The states:
 *   not_registered   -> Admin pre-loaded the record; nobody has opened
 *                        the app with these credentials yet.
 *   pending_approval  -> the person completed registration (memberId +
 *                        phone matched, OTP verified, photo uploaded)
 *                        and is waiting on an Admin decision.
 *   approved          -> Admin approved; full app access.
 *   rejected          -> Admin rejected; no app access. Can be
 *                        re-registered by an Admin resetting the status.
 * Only Cloud Functions ever write this field (see modules/groups/members.ts
 * and modules/auth/registration.ts) — never the client directly.
 */
export type RegistrationStatus = 'not_registered' | 'pending_approval' | 'approved' | 'rejected';

export interface UserDoc {
  authUid: string;
  phone: string;
  email?: string;
  displayName: string;
  displayNameLower?: string; // maintained alongside displayName for prefix search (Admin "search members")
  photoUrl?: string;
  /**
   * Unique per person, assigned by an Admin (addMember/importMembers) —
   * this is what a member types in at registration, matched against
   * `phone` to gate app access. Uniqueness is enforced via the
   * `memberIdIndex/{memberId}` collection (Firestore has no native
   * unique-field constraint), written transactionally alongside this
   * doc. Optional in the type only because users created before this
   * field existed may not have one yet.
   */
  memberId?: string;
  registrationStatus: RegistrationStatus;
  /**
   * Set only when registrationStatus is 'rejected' (see
   * modules/auth/registration.ts reviewRegistration) — shown to the
   * member on the mobile pending/rejected screen so a rejection (e.g.
   * blurry or mismatched photo) isn't a dead end with no explanation.
   * Cleared on re-approval.
   */
  rejectionReason?: string;
  status: 'active' | 'disabled';
  notificationsEnabled?: boolean; // default true when absent — gates SMS reminders, not the in-app inbox
  /**
   * One of the (possibly several) groupIds this member has an active
   * groupMemberships row for — the group shown on the mobile Home
   * header ("Member of {group}"), not simply "whichever group happens
   * to be first". Optional: older members, or anyone an admin hasn't
   * explicitly set one for yet, have none, and the mobile app falls
   * back to their first active group in that case.
   *
   * Admin/Function-only — see modules/groups/members.ts setPrimaryGroup
   * for the one place this is written, and firestore.rules' `users`
   * match for why a member can't set this on themselves (the same
   * reasoning as `role`/`status`: nothing here can verify, on a client
   * self-edit, that the value is actually one of their real groups).
   */
  primaryGroupId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Doc ID IS the memberId — that's what makes it a uniqueness constraint:
 * two rows trying to claim the same memberId collide on the same doc ID,
 * so a transactional create-if-absent is all that's needed to enforce
 * "one memberId, one user" without a query-then-write race.
 */
export interface MemberIdIndexDoc {
  userId: string;
  createdAt: Timestamp;
}

/**
 * A 4-level tree: Main Group -> Country -> City -> Group (leaf).
 * Membership, chat, and events all attach at the leaf 'group' level only
 * — the three levels above it (main/country/city) exist purely for
 * organizing the leaf groups, the same way "Sub Group" used to attach
 * directly under "Main Group" before this was introduced. Every level
 * (except 'main') has a parentGroupId pointing to its immediate parent;
 * validation of which type can parent which lives in
 * modules/groups/groups.ts / modules/groups/hierarchy.ts.
 */
export interface GroupDoc {
  name: string;
  type: 'main' | 'country' | 'city' | 'group';
  parentGroupId?: string; // present for every type except 'main'
  status: 'active' | 'archived';
  createdAt: Timestamp;
  /** Optional max active+host headcount, leaf ('group') type only — used
   *  by the admin panel's capacity tiles/boards. Absent means "no limit
   *  set", not zero; the admin dashboard treats those as excluded from
   *  any "at/over capacity" count rather than counting them as full. */
  capacity?: number;
}

export type MembershipRole = 'member' | 'host';

/** Doc ID is deterministic: `${groupId}_${userId}` — same idempotency pattern as EventAttendeeDoc. */
export interface GroupMembershipDoc {
  userId: string;
  groupId: string;
  role: MembershipRole; // standing WITHIN this specific group
  status: 'active' | 'removed';
  joinedAt: Timestamp;
}
// ---------- Events & attendance ----------

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type EventKind = 'event' | 'rehearsal' | 'meeting' | 'special_program';

export interface EventDoc {
  title: string;
  mainGroupId: string;
  subGroupIds: string[]; // can span multiple Sub Groups
  location: GeoPoint & { address?: string };
  geofenceRadiusMeters: number;
  startAt: Timestamp;
  endAt: Timestamp;
  status: 'draft' | 'published' | 'cancelled';
  createdBy: string;
  createdAt: Timestamp;
  seriesId?: string; // present when created via createRecurringEvent — links sibling occurrences
  /**
   * Group, Event & Approval Management module — all optional so every
   * event created before this shipped, and any event that doesn't need
   * them, stays perfectly valid with no backfill required. Absent
   * `kind` should be treated as 'event' by readers (createEvent always
   * writes an explicit value for anything created from now on).
   */
  kind?: EventKind;
  purpose?: string;
  requirements?: string;
  expectedAttendees?: number;
}

/** Doc ID is deterministic: `${eventId}_${userId}` */
export interface EventAttendeeDoc {
  eventId: string;
  userId: string;
  invitedAt: Timestamp;
  invitedBy: string;
}

export type ScanResult =
  | 'ALLOWED'
  | 'ALREADY_CHECKED_IN'
  | 'NOT_ALLOWED'
  | 'REJECTED'
  | 'INVALID_QR'
  | 'EVENT_CLOSED';

/**
 * Written ONLY by the checkIn Cloud Function. Never client-writable.
 * Doc ID is deterministic: `${eventId}_${userId}` — same idempotency
 * pattern as EventAttendeeDoc/GroupMembershipDoc, and what lets checkIn
 * detect "already checked in" with a single get() instead of a query.
 */
export interface AttendanceDoc {
  eventId: string;
  userId: string;
  groupContextId?: string;
  status: 'PRESENT';
  scannedByHostId: string;
  serverTimestamp: Timestamp;
  clientReportedLocation?: GeoPoint; // audit only — never the authorization signal
}

// ---------- Phase 3: Absence, Chat, Event Requests, Conflicts, Donations ----------

/** Doc ID is deterministic: `${eventId}_${userId}` — one pending/resolved request per person per event. */
export interface AbsenceRequestDoc {
  eventId: string;
  userId: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: Timestamp;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
}

/** One room per Sub Group — doc ID is the groupId itself, no separate ID scheme needed. */
export interface ChatRoomDoc {
  groupId: string;
  createdAt: Timestamp;
}

/**
 * Subcollection: chatRooms/{groupId}/messages/{messageId} (auto-ID —
 * ordering is by sentAt, not the ID). A message carries text and/or a
 * single media attachment (Phase 4) — never neither.
 */
export interface ChatMessageDoc {
  roomId: string; // == groupId, denormalized for query convenience
  senderId: string;
  text?: string;
  mediaUrl?: string; // Storage download URL
  mediaType?: 'image' | 'file';
  mediaPath?: string; // Storage path, kept for moderation/deletion tooling later
  sentAt: Timestamp;
}

export interface EventRequestDoc {
  requestedBy: string;
  groupId: string; // Sub Group the proposed event would belong to
  proposedTitle: string;
  proposedStartAt: Timestamp;
  proposedEndAt: Timestamp;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  createdAt: Timestamp;
}

/**
 * System-detected overlapping events for a member — never user-submitted.
 * Doc ID is deterministic: `${userId}_${eventIdLow}_${eventIdHigh}` (the
 * two event IDs sorted lexicographically before joining) so the same pair
 * can't be recorded twice regardless of which event triggered detection.
 */
export interface ConflictDoc {
  userId: string;
  eventIdA: string;
  eventIdB: string;
  detectedAt: Timestamp;
}

export type DonationStatus = 'pending' | 'succeeded' | 'failed';

/**
 * `status` is written ONLY by the Stripe webhook Function (signature-
 * verified) — never by the client-side "success" callback, which is UX
 * only. See docs/INTEGRATIONS.md.
 */
export interface DonationDoc {
  userId: string;
  amountCents: number;
  currency: string;
  groupId?: string;
  eventId?: string;
  status: DonationStatus;
  stripePaymentIntentId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------- Phase 4: Reminders, granular admin permissions ----------

/**
 * Pure dedupe marker — doc ID is deterministic (`${eventId}_${userId}`),
 * written by sendEventReminders right after a reminder actually goes out,
 * so a scheduler run that overlaps a previous one (or retries) can't
 * double-text the same person for the same event.
 */
export interface ReminderSentDoc {
  eventId: string;
  userId: string;
  sentAt: Timestamp;
}

/**
 * Every admin has full "admin" access via the Auth custom claim (see
 * docs/ARCHITECTURE.md §1) — this collection layers OPTIONAL, coarser
 * section-level restrictions on top for the admin web UI (e.g. an admin
 * who should only handle Requests, not Members or Donations). A missing
 * doc, or `isSuperAdmin: true`, means unrestricted — this is additive
 * scoping, not a replacement for the base isAdmin() check anywhere.
 */
export interface AdminRoleDoc {
  userId: string;
  isSuperAdmin: boolean;
  permissions: AdminPermission[]; // ignored when isSuperAdmin is true
  /**
   * "Zone Manager" (Group, Event & Approval Management module) — the
   * city-level groups (see GroupDoc, type:'city') this admin reviews
   * Resource Requests for, as the middle stage of Member/Host → Admin →
   * Zone Manager → Top Management. A Zone here IS a City node; there's
   * no separate "zone" hierarchy level (see docs note in
   * resourceRequests.ts for why). Empty/absent means not a Zone
   * Manager of anything — unrelated to isSuperAdmin/permissions.
   */
  zoneManagerCityIds?: string[];
  updatedBy: string;
  updatedAt: Timestamp;
}

export type AdminPermission =
  | 'groups'
  | 'members'
  | 'events'
  | 'requests'
  | 'donations'
  | 'reports'
  | 'content'
  | 'integrations'
  | 'logistics';

/**
 * Doc ID is always 'default' — one settings doc per org (matches
 * DEFAULT_ORG_ID being the only org this deployment serves, same
 * assumption the rest of the codebase already makes). Publicly
 * readable (see firestore.rules) specifically so the mobile
 * registration screen can show a "Contact Admin" option to someone who
 * ISN'T signed in yet — the Member ID + phone mismatch screen is the
 * whole reason this exists.
 */
export interface OrgSettingsDoc {
  supportEmail?: string;
  supportPhone?: string; // E.164, e.g. +15551234567 — same format as UserDoc.phone
  updatedAt: Timestamp;
}

/**
 * Self-service "my number changed" request — the closed-registration
 * flow (modules/auth/registration.ts) has no path for someone whose
 * phone no longer matches their Member ID, since that's exactly the
 * check it enforces. This lets them ask an Admin to fix it without
 * needing a session (they can't get one — that's the whole problem),
 * gated only by knowing their own Member ID. See
 * modules/members/phoneUpdateRequests.ts.
 */
export interface PhoneUpdateRequestDoc {
  memberId: string;
  requestedPhone: string; // E.164
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  createdAt: Timestamp;
}

/**
 * Home-screen banner carousel (mobile). `order` is a plain sort key —
 * lower shows first — set via drag/reorder in the admin panel, not tied
 * to createdAt so an admin can slot a new banner in anywhere. `active`
 * lets an admin turn one off without deleting it (e.g. an expired
 * promotion they might reuse later).
 */
export interface BannerDoc {
  imageUrl: string;
  linkUrl?: string;
  order: number;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Modal shown on app open (mobile) — a stronger interruption than a
 * banner, for things that genuinely need a member's attention. `order`
 * (lower first) matters more here than for banners since typically only
 * the single highest-priority active popup is actually shown.
 */
export interface PopupDoc {
  imageUrl?: string;
  title: string;
  description?: string;
  linkUrl?: string;
  order: number;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------- Phase 0 stubs (fleshed out in later phases) ----------

export interface AuditLogDoc {
  action: string;
  actorUserId: string | null;
  targetId?: string;
  result: ScanResult | 'SUCCESS' | 'DENIED';
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
}

// ---------- Group, Event & Approval Management module ----------
//
// Hierarchy for this module: Top Management (isSuperAdmin) → Zone
// Manager (an admin with this city in AdminRoleDoc.zoneManagerCityIds)
// → Group Host (existing GroupMembershipDoc role:'host') → Group
// Members (existing GroupMembershipDoc role:'member'). There is no new
// "Zone" collection — a Zone IS an existing City-type Group node, since
// a city is already exactly "the set of kurels in one area" that a Zone
// groups together; adding a parallel hierarchy would mean two
// incompatible ways to answer "what area is this kurel in".
//
// This whole module runs through the admin panel (all four actors —
// submitter, Admin, Zone Manager, Top Management — act as admin-web
// users). The mobile app has no submission UI yet; an admin records a
// request on a member's/host's behalf (see requestedBy/requestedByName
// on ResourceRequestDoc) until/unless a mobile submission screen is
// built as its own follow-up.

export type ResourceCategory =
  | 'music_equipment'
  | 'books'
  | 'instruments'
  | 'furniture'
  | 'transportation'
  | 'food'
  | 'other';

export type ResourceRequestStage = 'admin_review' | 'zone_manager_review' | 'top_management_review' | 'approved' | 'rejected';

/** One entry per submission/decision — the doc's own append-only history, not a separate collection, so "show the complete approval history" is always a single read. */
export interface ApprovalStepDoc {
  stage: ResourceRequestStage;
  action: 'submitted' | 'approved' | 'rejected';
  actorUserId: string;
  actorName: string;
  comment?: string;
  at: Timestamp;
}

export interface ResourceRequestDoc {
  requestedBy: string; // uid of the member/host this request is for
  requestedByName: string; // denormalized — the requester may not be an admin-web user who can be looked up later
  groupId: string; // leaf 'group' (kurel) this request is for
  category: ResourceCategory;
  itemsDescription: string;
  quantity?: number;
  purpose?: string;
  neededBy?: Timestamp;
  deliveryLocation?: string;
  stage: ResourceRequestStage;
  approvalHistory: ApprovalStepDoc[];
  logisticsTaskId?: string; // set once stage reaches 'approved' (see reviewResourceRequest)
  createdBy: string; // admin-web uid who recorded the submission
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type LogisticsStatus = 'pending' | 'assigned' | 'preparing' | 'dispatched' | 'delivered' | 'completed';

export interface LogisticsHistoryEntryDoc {
  status: LogisticsStatus;
  actorUserId: string;
  actorName: string;
  comment?: string;
  at: Timestamp;
}

/** Auto-created by reviewResourceRequest the moment a request reaches 'approved' — never created directly by a client. */
export interface LogisticsTaskDoc {
  resourceRequestId: string;
  groupId: string;
  itemsDescription: string;
  quantity?: number;
  deliveryLocation?: string;
  deliveryAt?: Timestamp;
  assignedToUserId?: string;
  assignedToName?: string;
  status: LogisticsStatus;
  history: LogisticsHistoryEntryDoc[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Matches the shape the mobile app's NotificationsScreen already reads
 * (`userId`/`title`/`body`/`createdAt`, ordered newest-first) — that
 * screen shipped in Phase 1 with nothing writing to it yet
 * ("Phase 4 introduces senders" per firestore.rules). This module is
 * the first sender. `type`/`relatedId` are additive — the existing
 * reader ignores fields it doesn't know about.
 */
export interface NotificationDoc {
  userId: string;
  title: string;
  body: string;
  type?: 'resource_request' | 'logistics';
  relatedId?: string;
  createdAt: Timestamp;
}

// ---------- Finance (Programmes financiers) ----------
// The prototype's 5-level cascade (National → Zone → Daara → Kurel →
// Member) assumes a hierarchy this app doesn't have (see the doc
// comment on ResourceRequestDoc for why Zone==City here, and note this
// module goes one further: there's no Daara level at all). A Program's
// scope is either every kurel or an explicit list — reporting rolls up
// through the real Country → City → Group tree instead of a cascade.
// This is separate from DonationDoc (Stripe card payments) — a
// Contribution is a mobile-money/cash payment an admin records with a
// proof photo, reviewed like a Resource Request, not an automatic charge.

export type ContributionMethod = 'wave' | 'orange_money' | 'cash';
export type ContributionStatus = 'pending_review' | 'validated' | 'rejected';

export interface FinancialProgramDoc {
  name: string;
  goalAmountCents: number;
  deadline?: Timestamp;
  scopeAllGroups: boolean;
  groupIds?: string[]; // present only when scopeAllGroups is false
  status: 'open' | 'closed';
  createdBy: string;
  createdAt: Timestamp;
}

export interface ContributionDoc {
  programId: string;
  groupId: string;
  userId: string;
  userName: string;
  method: ContributionMethod;
  amountCents: number;
  proofUrl?: string; // Storage URL, required for wave/orange_money, optional for cash
  status: ContributionStatus;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  reviewComment?: string;
  createdBy: string; // admin who recorded it — see module note on ResourceRequestDoc re: no mobile submission yet
  createdAt: Timestamp;
}

// ---------- Conseil de discipline ----------

export type DisciplinaryStatus = 'open' | 'hearing_requested' | 'vote_required' | 'resolved';
export type DisciplinaryResolution = 'reinstated' | 'upheld';

export interface DisciplinaryVoteDoc {
  voterId: string;
  voterName: string;
  decision: 'reinstate' | 'uphold';
  at: Timestamp;
}

export interface DisciplinaryHistoryEntryDoc {
  action: 'opened' | 'hearing_requested' | 'vote_cast' | 'resolved' | 'note';
  actorId: string;
  actorName: string;
  note?: string;
  at: Timestamp;
}

export interface DisciplinaryCaseDoc {
  memberId: string;
  memberName: string;
  groupId: string;
  reason: string;
  description: string;
  status: DisciplinaryStatus;
  votes: DisciplinaryVoteDoc[];
  resolution?: DisciplinaryResolution;
  history: DisciplinaryHistoryEntryDoc[];
  openedBy: string;
  openedAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------- Comité pédagogique (Pilotage pédagogique) ----------

export interface QacaidDoc {
  code: string; // e.g. "Q-018" — admin-assigned, not auto-generated, so it matches whatever numbering the Comité already uses on paper
  title: string;
  melody: string;
  durationSeconds?: number;
  level: 1 | 2 | 3 | 4;
  status: 'active' | 'retired';
  createdBy: string;
  createdAt: Timestamp;
}

/** Doc ID is deterministic: `${qacaidId}_${groupId}` — one allocation per Qaçaid per kurel. */
export interface QacaidAllocationDoc {
  qacaidId: string;
  groupId: string;
  allocatedBy: string;
  allocatedAt: Timestamp;
}

export interface ProgressReportDoc {
  groupId: string;
  period: string; // free-form label the Comité already uses, e.g. "2026-T3" — not modeled as a strict enum since the real cadence (weekly/monthly/quarterly) is the Comité's own call, not this schema's
  masteryPct: number;
  melodyPct: number;
  timingPct: number;
  directivesPct: number;
  submittedBy: string;
  submittedAt: Timestamp;
}

// ---------- Bibliothèque des Qaçaid ----------

export interface QacaidEditionDoc {
  qacaidId: string;
  label: string; // e.g. "Édition officielle · Texte arabe"
  fileUrl: string; // Storage download URL
  filePath: string; // Storage path, for deletion/moderation
  fileSizeBytes: number;
  downloadable: boolean; // false == read-only preview, matches the prototype's "Lecture seule" editions
  downloadsCount: number;
  uploadedBy: string;
  createdAt: Timestamp;
}

export interface LibraryShareDoc {
  editionId: string;
  scopeType: 'group' | 'user';
  scopeId: string;
  right: 'download' | 'read_only';
  expiresAt?: Timestamp;
  sharedBy: string;
  sharedAt: Timestamp;
}

// ---------- Médiathèque audio ----------

export type AudioCategory = 'rehearsal' | 'announcement' | 'performance';
export type AudioStatus = 'pending' | 'approved';

export interface AudioTrackDoc {
  title: string;
  melodyLabel?: string;
  category: AudioCategory;
  scopeAllGroups: boolean;
  groupIds?: string[]; // present only when scopeAllGroups is false — e.g. a kurel-specific announcement
  level?: 1 | 2 | 3 | 4;
  fileUrl: string;
  filePath: string;
  durationSeconds?: number;
  status: AudioStatus;
  linkedEventId?: string; // performance recordings tie back to the event, per the prototype's "Associer l'enregistrement à un événement"
  uploadedBy: string;
  createdAt: Timestamp;
}

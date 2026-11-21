# Firestore Data Model

Collections match TypeScript types in `firebase/functions/src/types/models.ts` — that file is the canonical source; this doc explains relationships and indexing intent. Written in Phase 0, kept current as each phase lands (Phase 2 added `events`/`eventAttendees`/`attendance` as live collections instead of stubs).

## Identity — never duplicate a person

```
users/{userId}                      -- ONE doc per human, ever
  authUid, phone, email, displayName, displayNameLower, photoUrl,
  status: active|disabled,
  createdAt, updatedAt
  -- displayNameLower is maintained alongside displayName purely so Admin
  -- "search members" (blueprint §5) can do a prefix range query; Firestore
  -- has no native case-insensitive or full-text search.

groups/{groupId}                    -- 4-level tree: Main Group -> Country -> City -> leaf Group
  name, type: 'main' | 'country' | 'city' | 'group', parentGroupId?, status, createdAt
  -- parentGroupId is present for every type except 'main'. Only a LEAF
  -- 'group' node can ever have members/events/chat attached — 'country'
  -- and 'city' exist purely to organize the tree (e.g. Main Group "xyz"
  -- -> Country "USA" -> City "Houston" -> Group "Houston A"). Which type
  -- can parent which is validated in
  -- firebase/functions/src/modules/groups/hierarchy.ts — that file is
  -- the canonical source, not this doc.

groupMemberships/{groupId}_{userId} -- join table: user <-> LEAF group, many-to-many
  userId, groupId, role: 'member' | 'host',   -- role WITHIN this leaf group
  status: active|removed, joinedAt
  -- Doc ID is deterministic (`${groupId}_${userId}`), same pattern as
  -- eventAttendees below: idempotent writes, and Firestore Security Rules
  -- can check membership with a direct get()/exists() instead of a query.
```

A user's global role (`Admin`) lives on the Auth custom claim, set only by a Function. `groupMemberships.role` governs Member/Host standing *within a specific Sub Group* — a person can be a Host in one Sub Group and a plain Member in another. This is what lets "assign Hosts to one or multiple Sub Groups" (blueprint §5) work without a second identity system.

## Events, attendee eligibility, attendance

```
events/{eventId}
  title, mainGroupId, subGroupIds: string[],   -- can span multiple Sub Groups
  location: { lat, lng, address },
  geofenceRadiusMeters,
  startAt, endAt, status: draft|published|cancelled,
  createdBy, createdAt

eventAttendees/{eventId}_{userId}    -- deterministic doc ID prevents duplicate invites
  eventId, userId, invitedAt, invitedBy

attendance/{eventId}_{userId}        -- created ONLY by the checkIn Cloud Function
  eventId, userId, groupContextId?,
  status: 'PRESENT',                  -- only successful check-ins are ever stored here
  scannedByHostId, serverTimestamp,
  clientReportedLocation?: {lat,lng}  -- stored for audit only, never trusted for the decision
  -- Doc ID is deterministic (`${eventId}_${userId}`), same pattern as
  -- eventAttendees — lets checkIn detect "already checked in" with a
  -- single get() inside a transaction instead of a query, and makes a
  -- double-scan of the same person idempotent rather than a duplicate row.
```

Deliberately **no row is written to `attendance` for NOT ALLOWED or REJECTED outcomes** (blueprint §6, rule 9) — those are transient function responses, optionally mirrored into `auditLogs` for security review, not into the attendance table. This keeps "attendance" meaning exactly one thing: a verified presence.

`eventAttendees` doc ID is `{eventId}_{userId}` specifically so a duplicate-invite write is idempotent and so the checkIn function can do a single `get()` by constructed ID instead of a query — this is also what makes "unlimited attendees, no 50-cap" cheap: eligibility is an O(1) doc lookup, not a scan of an array field.

## Absence, chat, event requests, conflicts, donations (Phase 3)

```
absenceRequests/{eventId}_{userId}   -- member-submitted, host- or admin-reviewed
  eventId, userId, reason, status: pending|approved|rejected,
  requestedAt, reviewedBy?, reviewedAt?
  -- Deterministic ID: one live request per person per event; resubmitting
  -- after a rejection overwrites rather than accumulating duplicates.

chatRooms/{groupId}                  -- one private room per Sub Group, doc ID == groupId
  groupId, createdAt
  -- Created automatically alongside its Sub Group by createGroup —
  -- there's no separate "create chat room" step for an Admin to forget.

chatRooms/{groupId}/messages/{messageId}   -- subcollection, auto-ID
  roomId (== groupId, denormalized), senderId, text, sentAt
  -- The ONE collection in this data model that clients write to directly
  -- (see firestore.rules) rather than through a Cloud Function — chat has
  -- no fraud/authorization stakes worth a round-trip. The rule itself
  -- enforces senderId == auth.uid, roomId == groupId, and a length cap.

eventRequests/{id}                   -- member-proposed, Admin-reviewed (auto-ID)
  requestedBy, groupId, proposedTitle, proposedStartAt, proposedEndAt,
  notes?, status: pending|approved|rejected, reviewedBy?, reviewedAt?, createdAt
  -- Approving does NOT auto-create a real event — Admin still uses
  -- createEvent/publishEvent from Phase 2 deliberately, so a member's
  -- input never becomes a published event without an Admin actively
  -- choosing to do so.

conflicts/{userId}_{eventIdLow}_{eventIdHigh}   -- system-detected only, never user-submitted
  userId, eventIdA, eventIdB, detectedAt
  -- Written by a Firestore trigger (onEventAttendeeCreated) that fires
  -- when a new eventAttendees doc appears, not by any callable — there is
  -- no "submit a conflict" action for a client to call.

donations/{stripePaymentIntentId}    -- doc ID == the Stripe PaymentIntent ID
  userId, amountCents, currency, groupId?, eventId?,
  status: pending|succeeded|failed, stripePaymentIntentId,
  createdAt, updatedAt
  -- status is written ONLY by the signature-verified Stripe webhook
  -- Function — never by the client, not even the donor's own "payment
  -- succeeded" callback, which is UX only (docs/INTEGRATIONS.md).
```

## Recurring events, reminders, chat media, granular permissions (Phase 4)

```
events/{eventId}                     -- unchanged shape, one new optional field:
  ...(all Phase 2 fields)...
  seriesId?: string                  -- present when created via createRecurringEvent;
                                      -- links sibling occurrences. Each occurrence is
                                      -- still an ordinary event doc — there is no
                                      -- separate "recurring event" document type.

chatRooms/{groupId}/messages/{messageId}   -- unchanged shape, extended:
  ...(text, senderId, roomId, sentAt)...
  mediaUrl?, mediaType?: 'image'|'file', mediaPath?
  -- A message carries text and/or ONE media attachment, never neither.
  -- The file itself lives in Storage at chatMedia/{groupId}/{uid}/{fileName}
  -- (firebase/storage.rules) — Firestore only stores the download URL.

reminders/{eventId}_{userId}         -- pure dedupe marker, no client ever reads/writes it
  eventId, userId, sentAt
  -- Written by the sendEventReminders scheduled Function BEFORE the SMS
  -- send is attempted, specifically so a failed/retried send can't
  -- double-text someone — a missed reminder is a smaller problem than a
  -- spammed one.

adminRoles/{userId}                  -- ADDITIVE, optional admin UI scoping
  userId, isSuperAdmin: boolean, permissions: string[], updatedBy, updatedAt
  -- Every Admin already has full access via the role claim
  -- (docs/ARCHITECTURE.md §1) — a missing doc, or isSuperAdmin: true,
  -- means unrestricted. This narrows the web UI for admins deliberately
  -- scoped to fewer sections; it is never the sole authorization check
  -- anywhere a real write happens.

users/{userId}                       -- one new optional field:
  ...(all Phase 0/1 fields)...
  notificationsEnabled?: boolean     -- default true when absent; gates SMS
                                      -- reminders only, not the in-app inbox
```

## Supporting collections (stubs, filled in per-phase)

```
sessions/{sessionId}                 -- meeting/session tied to a group or event
media/{id}                           -- Storage refs + metadata for non-chat attachments (meeting notes, etc.)
auditLogs/{id}                       -- sensitive-action trail (role changes, failed QR attempts, refunds) — LIVE since Phase 1, written by recordAudit()
```

`notifications`, `events`/`eventAttendees`/`attendance`, `absenceRequests`/`chatRooms`+messages/`eventRequests`/`conflicts`/`donations`, and `reminders`/`adminRoles` graduated from stub to live collections in Phases 1, 2, 3, and 4 respectively — see their sections above and the matching `docs/PHASEn_COMPLETION.md`.

## Indexes (initial — `firebase/firestore.indexes.json`)

- `groupMemberships`: composite on `(userId, status)` and `(groupId, status)` — both directions of the membership lookup are hot paths (a user's groups; a group's members).
- `eventAttendees`: composite on `(eventId, userId)` — already unique by doc ID, index exists for the reverse "all events a user is invited to" query via `(userId, eventId)`.
- `attendance`: composite on `(eventId, status)` and `(userId, eventId)`.
- `events`: composite on `(subGroupIds array-contains, startAt)` for calendar views per Sub Group, `(seriesId, status)` for cancelling future occurrences of a recurring series, and `(status, startAt)` for the reminders scheduler's "published events starting soon" scan.
- `notifications`, `donations`: composite on `(userId, createdAt desc)` for each person's own history view.
- `eventRequests`: composite on `(groupId, createdAt desc)` and `(status, createdAt desc)` for the per-group and global-pending admin views.

Exact index JSON is generated/refined once real queries are written in each phase — Phase 0 ships the ones the above access patterns already require.

# Phase 3 Completion Report — Absence, Chat, Requests, Conflicts, Donations

## Completed items

**Cloud Functions** (`firebase/functions/src/`)
- `modules/absence/absence.ts` — `submitAbsenceRequest` (member, must be on the event's attendee list, deterministic `${eventId}_${userId}` doc so resubmitting after rejection overwrites rather than piling up), `reviewAbsenceRequest` (Admin or the Host actually assigned to that event's Sub Group — checked server-side against the `hostGroupIds` claim, not client input).
- `modules/requests/eventRequests.ts` — `submitEventRequest` (member proposes an event for a group they belong to), `reviewEventRequest` (Admin-only). Approving deliberately does **not** auto-create a real event — Admin still uses Phase 2's `createEvent`/`publishEvent` on purpose, so a member's input never becomes a published event without an Admin actively choosing to do so.
- `modules/conflicts/conflicts.ts` + `modules/conflicts/overlap.ts` — `onEventAttendeeCreated`, a Firestore trigger (not a callable — conflicts are system-detected, never user-submitted) that fires whenever a new `eventAttendees` doc appears and checks that one new invitation against every other event the same person is already invited to for a time overlap. `rangesOverlap`/`conflictDocId` are pure and exported separately for testing.
- `modules/donations/donations.ts` — `createDonationIntent` (creates a Stripe PaymentIntent + a `pending` `donations` doc) and `stripeWebhook` (public HTTPS endpoint, signature-verified, the **only** thing that ever moves a donation to `succeeded`/`failed`; idempotent against Stripe's own retry behavior by checking the donation isn't already terminal before applying an update).
- `modules/groups/groups.ts` — `createGroup` now also creates the matching `chatRooms/{groupId}` doc for Sub Groups, so there's no separate "set up chat" step an Admin could forget.
- `types/models.ts` — added `AbsenceRequestDoc`, `ChatRoomDoc`, `ChatMessageDoc`, `EventRequestDoc`, `ConflictDoc`, `DonationDoc`.
- `index.ts` updated to export all Phase 3 callables and the trigger.

**Chat has no Cloud Function** — messages are written directly by clients (Firestore rules enforce `senderId == auth.uid`, `roomId == groupId`, and a 2000-character cap). This is a deliberate exception to the "sensitive writes go through Functions" pattern used everywhere else: chat has no fraud/authorization stakes worth a round-trip, so real-time direct writes win over centralizing it.

**Firestore rules** (`firebase/firestore.rules`)
- `absenceRequests`: read by Admin, the requester, or the Host of that event; write-locked (Functions only).
- `eventRequests`: read by Admin, the requester, or the Host of that group; write-locked.
- `conflicts`: read by Admin or the affected user only; write-locked (trigger-only).
- `chatRooms`/`chatRooms/{groupId}/messages`: read by Admin/Host-of-group/active-member; room docs are write-locked (Admin/Function only), but **messages are the one collection clients write to directly**, with the rule itself validating sender identity, room membership, and length.
- `donations`: read by Admin or the donor only; write-locked (Functions/webhook only) — status can never be set by the client, including the donor's own success callback.

**Firestore indexes** — added `eventRequests (groupId, createdAt desc)`, `eventRequests (status, createdAt desc)`, `donations (userId, createdAt desc)`.

**Admin web** (`admin-web/src/`)
- `app/dashboard/requests/page.tsx` — reviews pending event requests (approve/reject, with a note that approving doesn't auto-create the event) and pending absence requests, both live via `onSnapshot`.
- `app/dashboard/donations/page.tsx` — read-only donation ledger with a running total of succeeded donations; explicitly notes status is webhook-only.
- `lib/functions.ts` — wrappers for `reviewEventRequest`/`reviewAbsenceRequest`.
- Dashboard nav/home updated with Requests and Donations entries.

**Mobile** (`mobile/lib/`)
- `features/chat/chat_screen.dart` — real-time group chat, shared by both Member and Host entry points.
- `features/requests/propose_event_screen.dart` — Member's "propose an event" form.
- `features/groups/group_detail_screen.dart` — new tap target from `my_groups_screen.dart`, links to chat and propose-event.
- `features/absence/request_absence_dialog.dart` — reusable dialog, wired into `features/events/my_events_screen.dart` (which also now shows a conflict warning banner per event using the `conflicts` collection, and a per-event "Request absence" action for events not yet checked into).
- `features/donations/donation_screen.dart` — amount picker → `createDonationIntent` → Stripe Payment Sheet (`flutter_stripe`, added to `pubspec.yaml`); wired from a new "Donate" button on `profile_screen.dart`.
- `features/host/host_absence_requests_screen.dart` — Host reviews pending absence requests for their group's events; wired as an app-bar action on `host_group_members_screen.dart` alongside a new Chat action.
- `main.dart` — initializes `flutter_stripe` with a publishable key passed via `--dart-define` (never hard-coded; the key itself is safe to ship client-side, unlike the secret key).
- `mobile/README.md` — documents the new Stripe build-time flag and minimum platform versions `flutter_stripe` needs once `android`/`ios` exist.

**Tests** (offline, no emulator) — `test/overlap.test.ts` (range-overlap logic and conflict-doc-ID determinism, including the "touching endpoints don't count as overlapping" edge case).

## Tests passed
Same caveat as every prior phase: **not executed in this sandbox** (no network access to `npm install`). Six test files now exist. Run `npm test` yourself before relying on any of this — Phase 3's `conflicts.ts` trigger in particular has no offline-testable Firestore interaction, only its pure `overlap.ts` helpers are covered; the trigger itself needs an emulator run to verify.

## Known issues / sandbox limitations
- **Still unverified** — nothing in this repo has been compiled, run, or deployed here.
- **Conflict detection is one-directional per write**: it reconciles the *newly created* `eventAttendees` doc against existing ones, which correctly covers every real case (each pair gets checked exactly once, from whichever side got created second) — but if you ever bulk-import historical `eventAttendees` data outside of `publishEvent`/`addEventAttendee` (e.g. a manual Firestore import), the trigger won't retroactively check pairs that already both existed before the import. Not a concern for normal usage through the app.
- **Chat messages are unmoderated and permanent** (`allow update, delete: if false`) — deliberate for Phase 3 scope; moderation/deletion is a hardening item, not an oversight (noted in `firestore.rules`).
- **`flutter_stripe` needs native setup** (min SDK versions, `Info.plist`/`build.gradle` entries) once `android`/`ios` folders exist — documented in `mobile/README.md`, not yet addable in this sandbox for the same reason as Phase 2's camera/location permissions.
- **`stripeWebhook` requires a public HTTPS Cloud Function URL registered with Stripe** as a webhook endpoint (in the Stripe Dashboard, pointing at the deployed function's URL) — this is an external configuration step outside this repo, not something the code itself can set up.
- Host's absence-request review does an N+1 read (all events for a group, then absenceRequests per event) — acceptable at Phase 3 event volumes, flagged in the code comment as a choice, not an oversight; a collection-group query would need every request to redundantly carry `groupId`.

## Database changes
- `absenceRequests`, `eventRequests`, `conflicts`, `donations` graduated from Phase 0 schema-only stubs to live collections. `chatRooms` graduated too, and now has a `messages` subcollection.
- No live data exists in any environment yet, so nothing to migrate.

## Security changes
- `reviewAbsenceRequest` re-derives Host authorization server-side from the event's `subGroupIds` against the caller's `hostGroupIds` claim — same pattern as `checkIn`'s Host check in Phase 2, not a new mechanism.
- `donations.status` remains exclusively webhook-written; the create-intent callable never sets anything but `pending`.
- Chat is the first and only collection where clients write directly rather than through a Function — worth remembering as the one exception to the "Functions are the trust boundary" pattern established since Phase 0, and worth revisiting if chat ever needs moderation, rate-limiting, or abuse handling (Phase 4/5 territory).

## Exact next steps (Phase 4 prerequisites)
1. Run the same verification steps as prior phases (`npm install/build/lint/test`, `flutter create .` + `pub get` + permission/Stripe setup) — still unverified.
2. Register the deployed `stripeWebhook` URL as a webhook endpoint in the Stripe Dashboard (test mode first), subscribed to `payment_intent.succeeded` and `payment_intent.payment_failed`.
3. Smoke-test in the emulator: member submits an absence request → Host approves it; member proposes an event → Admin approves and separately creates/publishes it; publish two overlapping events for the same Sub Group and confirm a `conflicts` doc appears for a member on both; send a chat message as a member and confirm a non-member/non-host cannot read or write to that room; run a test donation through Stripe's test webhook simulator and confirm `donations.status` only changes via the webhook.
4. Phase 4 work (blueprint §8 or equivalent): reports, chat media (Storage rules currently default-deny — see `firebase/storage.rules`), recurring events, reminders (Twilio SMS via the `sendReminder` Function stubbed out in Phase 0's `docs/INTEGRATIONS.md`), granular admin permissions (`adminRoles` is still a schema-only stub), offline QR support.

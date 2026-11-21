# Phase 4 Completion Report — Reports, Chat Media, Recurring Events, Reminders, Permissions, Offline QR

## Completed items

**Cloud Functions** (`firebase/functions/src/`)
- `modules/events/recurring.ts` — `createRecurringEvent` (weekly/monthly, capped at 52 occurrences, batch-creates N draft events sharing a generated `seriesId`; each occurrence is an ordinary event doc, not a special "recurring event" type, so every other Phase 2/3 code path — publish, cancel, attendance, conflicts — works on it unmodified), `cancelEventSeries` (cancels only FUTURE non-cancelled occurrences, deliberately leaving past/ongoing ones alone). `addOccurrence` is pure and exported for testing.
- `modules/reminders/reminders.ts` — `sendEventReminders`, a scheduled Function (every 15 minutes) that finds published events starting within the next hour and, per attendee who hasn't checked in and hasn't already been reminded for that event, writes an in-app `notifications` doc and sends an SMS (gated by `notificationsEnabled`, default on). The dedupe marker (`reminders/{eventId}_{userId}`) is written *before* the SMS send is attempted, so a failed/retried send can't double-text — a missed reminder is a smaller problem than a spammed one.
- `modules/admin/permissions.ts` — `setAdminPermissions`: an ADDITIVE, optional restriction on top of the base `role: 'admin'` claim (every admin still has full system access via the claim), gated by a super-admin flag on the caller's own `adminRoles` doc. Bootstrapping the first super-admin is out-of-band, same reasoning as the first Admin in Phase 1 — no self-service path.
- `types/models.ts` — `EventDoc.seriesId?`, `ChatMessageDoc.mediaUrl?/mediaType?/mediaPath?` (text made optional — a message now carries text and/or media, never neither), `UserDoc.notificationsEnabled?`, new `ReminderSentDoc`, `AdminRoleDoc`, `AdminPermission`.
- `config/env.ts` — added `twilioFromNumber` (a Functions v2 string param, not a secret — it's a public phone number), `REMINDER_LEAD_MINUTES` (60), `REMINDER_SCHEDULE` ('every 15 minutes').
- `index.ts` updated to export all Phase 4 callables and the scheduled function.

**Chat media has no new Cloud Function** — the image itself uploads straight from the mobile client to Storage, and the message doc is still written directly to Firestore exactly as in Phase 3 (now just optionally carrying `mediaUrl` instead of `text`). The only new enforcement point is `firebase/storage.rules`.

**Firestore rules** (`firebase/firestore.rules`)
- `chatRooms/{groupId}/messages`: the create rule now accepts a message with either non-empty `text` OR a `mediaUrl` string (previously required `text`).
- `reminders`: fully locked down — no client ever reads or writes it; it's a pure internal dedupe record for the scheduled Function.
- `adminRoles`: readable by any Admin (not sensitive among admins themselves), write-locked to `setAdminPermissions` only.

**Storage rules** (`firebase/storage.rules`, new this phase — was default-deny through Phase 3)
- `chatMedia/{groupId}/{uid}/{fileName}`: readable by Admin/Host-of-group/active-member, writable only by the uploader themselves (`uid == request.auth.uid`) if they're also an active member or assigned Host of that group, capped at 10MB, restricted to `image/*` or PDF content types. Uses a cross-service `firestore.get()`/`firestore.exists()` lookup against the same deterministic `groupMemberships` doc ID `firestore.rules` uses, so the two authorization surfaces check the identical thing rather than two independently-maintained membership checks that could drift apart.

**Firestore indexes** — added `events (seriesId, status)` for series cancellation, `events (status, startAt)` for the reminders scheduler's window scan.

**Admin web** (`admin-web/src/`)
- `app/dashboard/events/page.tsx` — a "Make this a recurring series" toggle (frequency + occurrence count) on the create form, and a "Cancel series" button that appears on any event carrying a `seriesId`.
- `app/dashboard/reports/page.tsx` — new: org overview (active members/groups via `getCountFromServer`, total succeeded donations via `getAggregateFromServer`'s `sum()`) and a per-event attendance report (invited vs. present counts, list of who hasn't checked in yet). Uses Firestore's server-side aggregation queries rather than fetching every document, since a reporting page is exactly where that matters at real org sizes.
- `app/dashboard/permissions/page.tsx` — new: gated on the signed-in admin's own `isSuperAdmin` flag (read client-side, enforced server-side by the Function regardless); lets a super-admin set another admin's section permissions or super-admin status.
- `lib/functions.ts` — wrappers for `createRecurringEvent`, `cancelEventSeries`, `setAdminPermissions`.
- Dashboard nav/home updated with Reports and Permissions entries.

**Mobile** (`mobile/lib/`)
- `features/chat/chat_screen.dart` — rewritten to support sending a photo (`image_picker` → Storage upload → message doc with the resulting download URL) alongside plain text; incoming messages render either bubble type.
- `features/profile/profile_screen.dart` — added an SMS-reminders toggle (writes `notificationsEnabled`).
- `core/offline_checkin_queue.dart` — new: a `shared_preferences`-backed local queue of raw scanned QR payloads + location + event context, waiting to be synced. Deliberately stores only raw data, never a decision — the server still makes every real authorization call once synced (docs/QR_DATAFLOW.md); this queue cannot grant attendance on its own.
- `features/host/qr_scan_screen.dart` — rewritten: detects offline (via `connectivity_plus`) before or during a `checkIn` call and queues instead of failing; syncs automatically when connectivity returns and via a manual app-bar button with a pending-count badge; a new `queued` feedback state (purple/cloud-off icon) distinct from allowed/denied/error so the Host always knows which of the four happened.
- `mobile/README.md` — documents the new `NSPhotoLibraryUsageDescription` entry `image_picker` needs, and notes `connectivity_plus`/`shared_preferences` need no extra native setup.

**Tests** (offline, no emulator) — `test/recurring-and-permissions.test.ts` (weekly/monthly date math including a year-rollover case, and permission-string validation).

## Tests passed
Same caveat as every prior phase: **not executed in this sandbox** (no network access to `npm install`). Eight test files now exist. Run `npm test` yourself before relying on any of this — as with Phase 3's conflict trigger, `sendEventReminders` and the Storage rules' cross-service lookup have no offline-testable path here; both need an emulator run (Storage emulator + Firestore emulator together) to verify.

## Known issues / sandbox limitations
- **Still unverified** — nothing in this repo has been compiled, run, or deployed here, now across five phases.
- **`sendEventReminders` needs Cloud Scheduler enabled** on the Firebase project (it's what backs `onSchedule` under the hood) — this is a one-time per-project setup step outside the code itself, and the first deploy of a scheduled function typically prompts for a Cloud Scheduler job region.
- **Reports page has no date-range filtering yet** — the org overview counts are all-time totals, and the attendance report is one event at a time. Trend-over-time reporting (e.g., "attendance rate this month vs last") is a reasonable Phase 5 addition, not built here to avoid guessing at a report format nobody's asked for yet.
- **Granular admin permissions are UI-only** — `setAdminPermissions` and the `adminRoles` collection exist and are enforced for who can *call* `setAdminPermissions` itself, but no other Function in this codebase checks a caller's specific permission list yet (they all still just check `role === 'admin'`). This was a deliberate scope decision, stated plainly rather than glossed over: wiring per-permission checks into every admin Function (event management needs 'events', donation views need 'donations', etc.) is real work multiplied across every existing Function, and doing it well means deciding per-Function what "read" vs "write" scoping even means — better as a focused Phase 5 hardening pass than half-applied here. The `adminRoles` data model and the web UI are ready for that pass.
- **Offline queue has no size cap or age-based eviction** — a Host who scans dozens of people while offline for days would accumulate an unbounded local list. Not a realistic scenario at the event sizes this app targets, but worth knowing if that assumption changes.
- **Chat media upload has no client-side compression/resizing beyond `image_picker`'s built-in `imageQuality: 80`** — fine for typical phone photos, but a very large original could still take a while over a slow connection before hitting the 10MB Storage rule cap.
- `flutter_stripe`, camera/location, and photo-library permissions all still need the native setup steps accumulated across Phases 2–4, documented in `mobile/README.md` — not addable in this sandbox (no `android`/`ios` folders yet).

## Database changes
- `reminders`, `adminRoles` graduated from stub to live collections.
- `events` gained the optional `seriesId` field; `chatRooms/*/messages` gained optional `mediaUrl`/`mediaType`/`mediaPath` and `text` became optional; `users` gained optional `notificationsEnabled`.
- No live data exists in any environment yet, so nothing to migrate.

## Security changes
- Storage rules went from blanket default-deny (Phase 0–3) to a real, scoped rule for chat media — the first Storage path this app actually uses.
- The Storage rule's membership check cross-references Firestore via the *same* deterministic doc ID `firestore.rules` uses, specifically so the two independent authorization layers (Firestore and Storage) can't silently diverge into checking different things for the same group.
- `setAdminPermissions` requires the caller to already be a super-admin — same "no self-service escalation" pattern as `assignRole` in Phase 1.
- As flagged above: granular permissions are additive UI scoping only right now, not yet enforced inside the other admin Functions. This is the honest state of it, not an oversight to discover later.

## Exact next steps (Phase 5 prerequisites)
1. Run the same verification steps as every prior phase (`npm install/build/lint/test`, `flutter create .` + `pub get` + all accumulated native permission/SDK setup) — still unverified.
2. Confirm Cloud Scheduler is enabled on the target Firebase project before deploying `sendEventReminders`.
3. Smoke-test in the emulator (Firestore + Storage + Functions together): create a 4-occurrence weekly recurring event and confirm 4 draft events share a `seriesId`; cancel the series and confirm only future occurrences flip to cancelled; send a chat image as an active member and confirm a non-member can't read it from Storage directly; manually invoke `sendEventReminders` against a published event starting soon and confirm exactly one SMS + one `notifications` doc per eligible attendee, with no duplicate on a second manual invocation; as a super-admin, restrict another admin to `['events']` and confirm the Permissions page reflects it (note: this doesn't yet restrict what that admin's account can actually *do* via Functions — see Known Issues).
4. Decide whether to prioritize wiring granular permissions into the rest of the admin Functions before Phase 5, or treat it as part of Phase 5's security hardening pass — either is reasonable, but it should be a decision, not a surprise.
5. Phase 5 work (blueprint's final phase): QA pass across all four prior phases, security review (this is likely where granular permission enforcement gets finished, along with a real look at rate-limiting `sendOtp`/`checkIn`/chat message writes), performance pass (the N+1 reads flagged in Phases 2–3, pagination on list views that currently fetch everything), and launch readiness (CI actually running against real Firebase/Vercel deploys, not just local lint/build).

# Phase 2 Completion Report — Events + QR + Geofence + Attendance

## Completed items

**Cloud Functions** (`firebase/functions/src/`)
- `modules/events/events.ts` — `createEvent` (draft), `updateEvent` (draft-only), `publishEvent` (flips to published AND auto-populates `eventAttendees` from every active `groupMembership` of the event's Sub Groups at that moment — this is what commits the eligibility list `checkIn` checks), `cancelEvent`, plus `addEventAttendee`/`removeEventAttendee` for manual overrides after publishing. `validateEventInput` and `validateSubGroups` guard against malformed/cross-org input (Sub Group must actually belong to the given Main Group, end must be after start, radius must be positive, etc.).
- `modules/qr/checkIn.ts` — the `checkIn` callable, implementing `docs/QR_DATAFLOW.md` exactly: (1) caller must be an authenticated Host, (2) Host must be assigned to one of the event's Sub Groups (checked against the `hostGroupIds` claim, not client input), (3) QR signature verified server-side via `verifyQrPayload` from Phase 1, (4) event must be `published` and now() within `[startAt, endAt]` ± `CHECK_IN_GRACE_MINUTES`, (5) eligibility checked via a single `eventAttendees` doc lookup, (6) geofence checked server-side via haversine distance — client location is a hint only, (7) attendance written inside a transaction that re-checks for an existing row first, so a double-scan is idempotent (`ALREADY_CHECKED_IN`) rather than a duplicate. **No row is ever written to `attendance` for a denial** — denials return a response code and an audit log entry only, matching the data-flow doc's non-negotiable #3.
- `utils/geo.ts` — pure haversine distance calculation, used instead of a Google Maps Distance Matrix call specifically to avoid a billable/networked API call on every single scan (documented in `docs/INTEGRATIONS.md`).
- `config/env.ts` — added `CHECK_IN_GRACE_MINUTES` (15, symmetric before/after the event window).
- `types/models.ts` — `attendance` doc ID is now deterministic (`${eventId}_${userId}`), matching the `eventAttendees`/`groupMemberships` pattern; added `ALREADY_CHECKED_IN` to `ScanResult`.
- `index.ts` updated to export all Phase 2 callables.

**Firestore rules** (`firebase/firestore.rules`)
- Added `isHostOfEvent(eventId)` — checks the caller's `hostGroupIds` claim against the target event's `subGroupIds` via a single `get()`. This replaces the Phase 0/1 placeholder ("any Host can read any eventAttendees/attendance doc") with real scoping: a Host now only sees attendee/attendance data for events in groups they're actually assigned to.
- `attendance` remains `allow write: if false` for every client — only `checkIn` (Admin SDK) writes it. This was true from Phase 0 and hasn't changed; it's the second independent layer described in `docs/QR_DATAFLOW.md`.

**Firestore indexes** — no new indexes required this phase; the Phase 0/1 composites (`groupMemberships (groupId, status)`, `events (subGroupIds contains, startAt)`) already cover `publishEvent`'s membership lookup and the mobile event-list query.

**Admin web** (`admin-web/src/`)
- `lib/functions.ts` — typed wrappers for all six event callables.
- `app/dashboard/events/page.tsx` — event list (live `onSnapshot`) + create-draft form (title, Main Group, Sub Groups scoped to that Main Group, address label, lat/lng, radius, start/end) + Publish/Cancel actions.
- `app/dashboard/events/[eventId]/page.tsx` — live attendee list with real-time check-in status (reads `eventAttendees` + `attendance` via `onSnapshot`), a checked-in/total counter.
- Dashboard nav and home page updated with an Events entry.

**Mobile** (`mobile/lib/`)
- `features/host/host_event_list_screen.dart` — published events for one Sub Group the Host is assigned to.
- `features/host/qr_scan_screen.dart` — camera scan (`mobile_scanner`) → device location (`geolocator`) → `checkIn` callable → color-coded result banner (green ALLOWED, blue ALREADY_CHECKED_IN, red NOT_ALLOWED/REJECTED, orange local error). This screen makes no allow/deny decision itself — it only collects the QR payload and a location reading and displays whatever the Function decides.
- `features/host/host_group_members_screen.dart` — "Scan QR" now navigates to the event list instead of the Phase 1 placeholder dialog.
- `features/events/my_events_screen.dart` — new: Members can see events they're on the attendee list for and whether they've checked in. Added as a fifth tab in `features/member_home_shell.dart`.
- `mobile/README.md` — documented the camera/location permission entries Phase 2 requires (`AndroidManifest.xml`, `Info.plist`) once `flutter create .` has been run locally — honestly flagged as not yet addable here since those platform folders don't exist in this sandbox.

**Tests** (offline, no emulator) — `test/geo.test.ts` (haversine distance + radius checks against known city-to-city distances), `test/events.test.ts` (pure input validation).

## Tests passed
Same caveat as Phases 0–1: **not executed in this sandbox** (no network access to `npm install`). Five test files now exist (`roles`, `personalQr`, `phone`, `geo`, `events`) — run `npm test` yourself before relying on any of this.

## Known issues / sandbox limitations
- **Still unverified** — nothing in this repo has been compiled or run here. This phase touched the most security-sensitive code yet (`checkIn.ts`); treat it as a careful implementation of the documented design, not as tested software, until you've run it.
- **Camera/location permissions** are documented but not addable in this sandbox (no `android/`/`ios/` folders yet — see `mobile/README.md` for the exact manifest entries to add after `flutter create .`).
- **`publishEvent`'s membership snapshot is a point-in-time sweep**, not a live subscription — someone added to a Sub Group *after* publishing won't automatically appear in `eventAttendees` for an already-published event. Use `addEventAttendee` for that case. This is a deliberate simplicity choice for Phase 2, not an oversight — a live-updating attendee list would need a Firestore trigger (`onCreate` on `groupMemberships`) reconciling against every published future event, which is more moving parts than this phase needs.
- **`CHECK_IN_GRACE_MINUTES = 15` is a single global constant**, not configurable per event yet. Flagged in `config/env.ts` as a "generalize later if needed" choice, not a limitation to design around now.
- Admin web's event location entry is manual lat/lng (no Places Autocomplete/map picker) — same deliberate Phase 2 simplification called out in Phase 0's `docs/INTEGRATIONS.md`, now actually hit: swap it in once a Google Maps API key exists.

## Database changes
- `attendance` doc ID scheme changed from auto-ID to deterministic `${eventId}_${userId}` (see `docs/DATA_MODEL.md`). No live data exists in any environment yet, so nothing to migrate.
- `events` and `eventAttendees` graduated from Phase 0 schema-only stubs to actively-written collections.

## Security changes
- `eventAttendees`/`attendance` read access narrowed from "any Host" to "Host assigned to one of the event's Sub Groups" via the new `isHostOfEvent()` rule helper.
- `checkIn` re-derives every authorization fact server-side (Host assignment from the claim, not client input; QR validity from HMAC verification, not a client-asserted userId; eligibility from a server-side `eventAttendees` lookup; geofence from a server-computed haversine distance) — the client never gets to assert anything the function trusts outright except which event it selected and a location *hint*.
- `attendance` is still `if false` for all client writes, unchanged from Phase 0 — confirmed still correct after adding the `checkIn` Function, since it's the Admin SDK (bypasses rules) that writes it, not a rule exception.

## Exact next steps (Phase 3 prerequisites)
1. Run the same verification steps as Phases 0–1 (`npm install/build/lint/test` in `firebase/functions/` and `admin-web/`; `flutter create .` + `pub get` + add the camera/location permission entries above) — still unverified.
2. Set `QR_SIGNING_SECRET` if you haven't already (Phase 1 requirement, `checkIn` also depends on it).
3. Smoke-test end-to-end in the emulator: Admin creates + publishes an event for a Sub Group with at least one member → Host opens that group's event list → Host scans the member's personal QR from Phase 1 → confirm `ALLOWED` the first time, `ALREADY_CHECKED_IN` on a re-scan, and `NOT_ALLOWED`/`REJECTED` when testing someone not on the list or a location outside the geofence radius.
4. Phase 3 work (blueprint §7 or equivalent): absence requests (member-submitted, host-approved — note `absenceRequests` is still a schema-only stub), group chat, event requests, conflict detection, donations (Stripe webhook-verified, per `docs/INTEGRATIONS.md`).

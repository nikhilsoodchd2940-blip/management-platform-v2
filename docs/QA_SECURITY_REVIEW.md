# QA & Security Review — Phase 5

This is the review pass the blueprint's final phase calls for: a systematic look back across everything built in Phases 0–4, what got fixed here, and what's being knowingly left open with a stated reason. It is not a substitute for the manual verification every prior phase's completion report already asked for (`npm install/build/lint/test`, emulator smoke tests) — treat this as what to check *in addition to* running the code for the first time.

## Method

Went through, module by module: (1) does every write path that matters go through server-side validation, (2) does every read path leak more than it should, (3) is the client ever trusted for a decision it shouldn't be, (4) what happens under abuse/load, (5) what's genuinely untested.

## Findings fixed this phase

| Area | Finding | Fix |
| --- | --- | --- |
| Authorization | Phase 4 shipped `adminRoles`/granular permissions as UI-only — no Function actually checked a caller's permission list | `modules/admin/authorize.ts` (`requireAdminPermission`/`hasAdminPermission`) wired into every admin Function: `groups.ts`, `members.ts`, `events.ts`, `recurring.ts`, `reviewEventRequest`, `reviewAbsenceRequest`'s admin branch |
| Authorization | `assignRole` let any admin grant the `admin` role to anyone, including themselves-adjacent escalation via a cooperating second account | Granting `admin` now requires an explicit `isSuperAdmin: true` doc — the one deliberate exception to "missing adminRoles doc = unrestricted" (documented inline in `assignRole.ts`, since it reads as an inconsistency without the reasoning) |
| Abuse prevention | `sendOtp` had no rate limit beyond Twilio's own account-level throttling — a script could spam a phone number with codes via our callable | `utils/rateLimit.ts`, 5 requests/hour per phone number |
| Abuse prevention | `checkIn` had no rate limit — a compromised or buggy Host client could hammer the endpoint | Same utility, 120 scans/minute per Host (generous — a real Host scanning a line does maybe one every couple seconds) |
| Client authenticity | App Check was flagged in `docs/ARCHITECTURE.md` since Phase 0 ("enforced... once mobile/web apps exist, Phase 1") but never actually implemented | `enforceAppCheck: true` on `sendOtp`, `verifyOtp`, `checkIn`, `assignRole`, `setAdminPermissions`, `createDonationIntent` — the six where a forged/non-genuine client would do the most damage. Client-side activation added in both apps. |
| Crash visibility | "Crash reporting" was in the original Phase 0 requirements list and never built | Crashlytics wired into `mobile/main.dart` |
| Performance | Events and Donations admin pages used unbounded `onSnapshot` — would degrade linearly with org history | Both capped with `limit()` + "Load more"; Donations' running total switched to a server-side `sum()` aggregate so pagination can't make it wrong |
| CI coverage | Mobile had zero automated checks in CI | Added a `flutter analyze` + `flutter test` job |

## Findings reviewed and knowingly left open (with reasoning)

These aren't gaps discovered too late to fix — they're things looked at deliberately and judged not worth the risk or scope creep of changing in this pass. Each has a reason, not just a shrug.

1. **`users` collection read rule remains broad**: any Host can read any user's profile doc (name/phone/email), not just members of groups they host. Tightening this correctly would require either denormalizing group membership onto the user doc or an expensive per-group existence check in rules for every `hostGroupIds` entry (Firestore rules can't iterate an array checking `exists()` per element). The data exposed (name, phone) is what a Host already sees for their own group's members through the app's normal UI — this rule is broader than necessary but not exposing anything a Host couldn't reasonably already have. **Left open**; worth fixing with a denormalization pass if the org size or sensitivity profile changes.
2. **Chat has no rate limiting or moderation**. A group member could flood a chat room with messages (capped at 2000 chars each, but no send-frequency limit). **Left open** — chat is low-stakes compared to the financial/identity paths that got rate-limited this phase; add if it becomes a real problem, don't build spam infrastructure speculatively.
3. **`reviewAbsenceRequest`/`reviewEventRequest` have no rate limiting**. Same reasoning as chat — these are occasional admin/host actions, not a plausible abuse vector at any realistic scale.
4. **Firestore rules for `eventAttendees`/`attendance` do a `get()` on the parent `events` doc per read** (`isHostOfEvent`). At high read volumes (e.g., an admin dashboard listing many events' attendance simultaneously) this multiplies Firestore reads. Not addressed — it's the correct security check, and the cost is proportional to legitimate admin usage, not attacker-controlled.
5. **No automated widget/UI tests for admin web or mobile** — see `docs/TESTING.md` for the reasoning (business logic concentrates in Functions by design; UI tests are a reasonable next investment against a real deploy, not before one exists).
6. **Only one emulator integration test exists** (`checkIn`). Chat rules, Storage rules, the conflict-detection trigger, and reminder scheduling all still only have unit-level coverage of their pure logic pieces, not end-to-end emulator verification. Flagged explicitly in `docs/TESTING.md` rather than implied to be covered.
7. **No structured alerting on Cloud Function errors** beyond default Cloud Logging (every `log.error` call goes there). Setting up actual alerting policies (e.g., "page someone if `checkIn` error rate exceeds X%") is a Google Cloud Console configuration step, not code — listed in `docs/LAUNCH_CHECKLIST.md` as a manual pre-launch task rather than built here, since it depends on who's actually on call for a specific deployment.

## What was NOT re-litigated

Decisions already made and documented correctly in earlier phases were not revisited just because this is the "security phase" — for example, the single-organization `DEFAULT_ORG_ID` assumption (Phase 1), chat's direct-client-write exception to the Functions-as-trust-boundary pattern (Phase 3), and `publishEvent`'s point-in-time attendee snapshot (Phase 2) are all still the right calls for this app's stated scope. Security review means checking whether something is actually a problem, not maximizing caution everywhere.

## Bottom line

The trust boundary established in Phase 0 (Functions validate, Firestore Rules independently re-deny, client is never trusted for a decision) held up under this review — nothing found required restructuring it, only closing gaps within it (the permissions enforcement gap being the most significant). Everything above is unverified the same way every phase has been: no network access in this sandbox means none of this has been run against a real emulator or deploy. Treat this document as a map of what to check when you do, not proof that it's correct.

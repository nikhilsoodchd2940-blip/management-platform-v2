# Launch Checklist

Every manual, out-of-band, or console step flagged somewhere across `docs/PHASE0_COMPLETION.md` through `docs/PHASE5_COMPLETION.md`, gathered in one place so launching doesn't mean re-reading five documents. Roughly in the order you'd actually do them.

## 1. Verify the code actually builds — nothing in this repo has been run

- [ ] `cd firebase/functions && npm install && npm run build && npm run lint && npm test`
- [ ] `cd admin-web && npm install && npm run build && npm run lint`
- [ ] `cd mobile && flutter create .` (generates `android/`/`ios/` — not present in this repo), then `flutter pub get && flutter analyze && flutter test`

Fix whatever doesn't compile before going further. Every phase's completion report has said this — it's still true.

## 2. Firebase project setup (per environment: dev, staging, prod)

- [ ] Create the three Firebase projects, fill in `firebase/.firebaserc` from `.firebaserc.example`
- [ ] Enable Cloud Firestore, Cloud Storage, Cloud Functions, Firebase Auth (phone sign-in not required since OTP goes through Twilio, not Firebase's own phone auth)
- [ ] **Enable Cloud Scheduler** (Phase 4 — required for `sendEventReminders`; first scheduled-function deploy usually prompts for a region if this isn't already on)
- [ ] Deploy Firestore rules/indexes and Storage rules: `firebase deploy --project <env> --only firestore:rules,firestore:indexes,storage`

## 3. Secrets and config (per environment)

- [ ] `firebase functions:secrets:set TWILIO_ACCOUNT_SID`
- [ ] `firebase functions:secrets:set TWILIO_AUTH_TOKEN`
- [ ] `firebase functions:secrets:set TWILIO_VERIFY_SERVICE_SID`
- [ ] `firebase functions:secrets:set STRIPE_SECRET_KEY`
- [ ] `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` (see step 6 — you'll get this value from Stripe after registering the webhook, so this may happen after a first deploy, then redeploy)
- [ ] `firebase functions:secrets:set QR_SIGNING_SECRET` — generate with `openssl rand -hex 32`, and treat rotation as a breaking change (every issued personal QR becomes invalid — see `docs/QR_DATAFLOW.md`/Phase 1 notes)
- [ ] Set `TWILIO_FROM_NUMBER` (not a secret — a public phone number) in `firebase/functions/.env.<project-id>` or via the CLI's first-deploy prompt
- [ ] admin-web: fill in `admin-web/.env.local` (or your hosting provider's env var settings) from `.env.local.example`
- [ ] mobile: run `flutterfire configure` to generate `lib/core/firebase_options.dart` per environment flavor

## 4. Client authenticity — App Check (Phase 5)

Several callables enforce App Check (`sendOtp`, `verifyOtp`, `checkIn`, `assignRole`, `setAdminPermissions`, `createDonationIntent`) — until this is configured on staging/prod, **those specific calls will be rejected**, not silently unprotected.

**Enforcement is now automatic per project, not a manual Console toggle** (`firebase/functions/src/config/env.ts` → `APP_CHECK_ENFORCED`, derived from `GCLOUD_PROJECT`):

- `<app>-dev` → enforcement is **OFF**. Testers can install a dev build and sign in on any device with zero App Check setup — no debug tokens, no per-device Console registration, no cap on number of testers.
- `<app>-staging` / `<app>-prod` → enforcement is **ON**, matching real launch conditions.

This means dev testing needs none of the App Check steps below — skip straight to step 5 if you're only working against `<app>-dev`. The remaining steps here are for staging/prod:

- [ ] Firebase Console (staging + prod projects) → App Check → register the mobile app with Play Integrity (Android) and App Attest (iOS)
- [ ] Firebase Console (staging + prod projects) → App Check → register the admin web app with reCAPTCHA v3, get the site key
- [ ] Set `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` in admin-web's env
- [ ] Confirm each of the six enforced callables succeeds against staging from a real client before assuming they work — an App Check misconfiguration fails closed, so this is worth testing deliberately rather than discovering at launch
- [ ] **Sanity check before going live:** confirm the prod project ID does NOT end in `-dev` (it shouldn't, per the naming in `docs/ENVIRONMENT.md`) — that's the only thing that would accidentally leave prod unenforced

## 5. Bootstrap the first Admin and super-admin

No self-service path exists for either, by design (see `docs/PHASE1_COMPLETION.md`, `docs/PHASE4_COMPLETION.md`, and the inline comment in `assignRole.ts`).

- [ ] Create the first Admin's Firebase Auth user (email/password) via Console or a trusted local script using the Admin SDK
- [ ] From that same trusted machine, call `setUserRoleClaims(uid, { role: 'admin', orgId: 'default-org' })` (import from `modules/auth/roles.ts`) — a one-off script, not a deployed callable
- [ ] **Also** write `adminRoles/{uid}` with `isSuperAdmin: true` directly via the Admin SDK from that same script — as of Phase 5, granting the `admin` role through `assignRole` requires an existing super-admin, so the very first admin needs this doc to ever promote a second admin

## 6. Stripe

- [ ] In the Stripe Dashboard (test mode first), register a webhook endpoint pointing at the deployed `stripeWebhook` function's URL, subscribed to `payment_intent.succeeded` and `payment_intent.payment_failed`
- [ ] Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET` (step 3)
- [ ] Run a test donation through Stripe's test card numbers and confirm `donations.status` changes only via the webhook, never instantly on the client's own success callback (this is the thing Phase 3 specifically built to prevent trusting the client)
- [ ] Repeat in live mode when ready to accept real donations

## 7. Mobile platform permissions (once `android/`/`ios/` exist — step 1)

- [ ] Android `AndroidManifest.xml`: `CAMERA`, `ACCESS_FINE_LOCATION` (Phase 2)
- [ ] iOS `Info.plist`: `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription` (Phase 2), `NSPhotoLibraryUsageDescription` (Phase 4, chat images)
- [ ] `flutter_stripe`: Android `minSdkVersion 21`, iOS deployment target 13.0+ (Phase 3)
- [ ] Pass the Stripe publishable key at build time: `flutter run --dart-define=STRIPE_PUBLISHABLE_KEY=pk_...` (or bake into your CI build command)
- [ ] Google Maps API key wired into platform config, restricted to this app's package name/bundle ID (Phase 0/2)

## 8. CI/CD secrets (if using `.github/workflows/deploy.yml`)

Repo Settings → Secrets and variables → Actions:
- [ ] `FIREBASE_TOKEN` (from `firebase login:ci` on a trusted machine)
- [ ] `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
- [ ] `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (or swap the deploy workflow's admin-web job for Firebase Hosting if that's the chosen host instead)

## 9. Monitoring (manual Console setup — not code)

- [ ] Cloud Logging is already receiving every `log.error`/`log.warn` call (no setup needed) — but set up an actual **alerting policy** in Google Cloud Monitoring for at least `checkIn` and `stripeWebhook` error rates, since nobody's watching logs continuously
- [ ] Enable Crashlytics for the mobile app in the Firebase Console (the SDK is already wired in `main.dart` — Phase 5 — but reports won't appear until enabled there)
- [ ] Consider Firebase Performance Monitoring for the mobile app if launch-day performance visibility matters (not built in — evaluate if needed)

## 10. Final smoke test (per environment, in order)

1. Admin signs in, creates a Main Group, then a Sub Group
2. Admin adds a member, assigns them to the Sub Group and as its Host
3. Member signs in via OTP (real Twilio SMS this time, not the emulator) and sees their Sub Group and personal QR
4. Admin creates and publishes an event for that Sub Group
5. Host opens the event, scans the member's QR, confirms `ALLOWED` and the Admin's Reports page shows 1/1 checked in
6. Re-scan the same QR, confirm `ALREADY_CHECKED_IN`
7. Member sends a chat message and a photo in the group; confirm both appear
8. Member requests absence for a different upcoming event; Host approves it from the mobile app
9. Member proposes a new event; Admin approves the request (does not auto-create — Admin creates it separately, confirming that's still true)
10. Admin creates a 2-occurrence recurring event, confirms both drafts share a series, cancels the series, confirms only the future occurrence cancels
11. Member makes a real (or Stripe test-mode) donation; confirm status flips to `succeeded` only after the webhook fires
12. Turn off the Host's device network mid-scan, confirm the check-in queues locally with the "queued" indicator, turn network back on, confirm it syncs automatically

If all twelve pass in staging, you have a genuinely working system — not just individually-reviewed code, which is all any of the five phase completion reports could honestly claim on their own.

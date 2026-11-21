import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

// All values come from NEXT_PUBLIC_* env vars — see docs/ENVIRONMENT.md.
// Never hard-code a project's config here; that's how a dev key ends up
// pointed at prod data by accident.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp);
export const storage = getStorage(firebaseApp);

// App Check (Phase 5) — several callables now set enforceAppCheck: true
// (assignRole, setAdminPermissions; the mobile-only ones like checkIn
// don't apply here). This only activates client-side if a reCAPTCHA v3
// site key is configured — it's a no-op (not a crash) when the env var
// is absent, so local dev without a key still works against functions
// that DON'T enforce App Check; but any enforced callable will be
// rejected until this is genuinely configured. See docs/LAUNCH_CHECKLIST.md.
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

// Guard against re-initialization when multiple function files import this
// (Cloud Functions can cold-start the whole module graph more than once
// within a single container in some execution paths).
if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();
export const storageBucket = getStorage().bucket();

// Firestore settings: ignoreUndefinedProperties avoids a whole class of
// "undefined field crashes the write" bugs when optional model fields
// (see types/models.ts) are omitted rather than explicitly null.
db.settings({ ignoreUndefinedProperties: true });

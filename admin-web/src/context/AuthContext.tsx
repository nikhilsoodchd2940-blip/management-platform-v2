'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import type { RequiredAccess } from '@/lib/navigation';

/**
 * Admin web uses Firebase Auth email/password — Members/Hosts use Twilio
 * OTP on mobile (docs/INTEGRATIONS.md), but the blueprint doesn't mandate
 * a specific method for "Admin login" and an internal ops panel is the
 * standard case for email/password rather than SMS OTP. Role is read from
 * the ID token's custom claims (set only by the assignRole Cloud
 * Function) — never trusted from anywhere else.
 *
 * On top of the role, an admin may have an `adminRoles/{uid}` doc that
 * narrows which sections they can use (see the Permissions page). The
 * Cloud Functions enforce it; this context mirrors it so the menu only
 * offers what will actually work, and updates live if a super-admin
 * changes it while the admin is signed in.
 */

export interface AdminAccess {
  /** False until the adminRoles doc has been read (or failed to). */
  loaded: boolean;
  isSuperAdmin: boolean;
  /** null = no adminRoles doc = unrestricted admin. */
  permissions: string[] | null;
}

interface AuthState {
  user: User | null;
  role: 'admin' | 'host' | 'member' | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  access: AdminAccess;
  /** Whether this admin may use a section. Unrestricted admins and super-admins can use everything except 'superAdmin' areas (super-admins only). */
  can: (required: RequiredAccess) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const NO_ACCESS_YET: AdminAccess = { loaded: false, isSuperAdmin: false, permissions: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AuthState['role']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<AdminAccess>(NO_ACCESS_YET);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const token = await u.getIdTokenResult();
          setRole((token.claims.role as AuthState['role']) ?? null);
        } catch {
          // Offline / expired session: treat as signed out rather than hang on the loading screen forever.
          setRole(null);
        }
      } else {
        setRole(null);
        setAccess(NO_ACCESS_YET);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Live copy of this admin's own permission doc.
  useEffect(() => {
    if (!user || role !== 'admin') {
      setAccess(NO_ACCESS_YET);
      return;
    }
    return onSnapshot(
      doc(db, 'adminRoles', user.uid),
      (snap) => {
        const data = snap.data() as { isSuperAdmin?: boolean; permissions?: string[] } | undefined;
        setAccess({
          loaded: true,
          isSuperAdmin: data?.isSuperAdmin === true,
          permissions: snap.exists() ? (data?.permissions ?? []) : null,
        });
      },
      // If the doc can't be read, fail open for display only — the
      // server still enforces every permission on every action.
      () => setAccess({ loaded: true, isSuperAdmin: false, permissions: null })
    );
  }, [user, role]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      // Keep Firebase's error *code* (e.g. auth/invalid-credential) so the
      // login page can show a translated, human message instead of
      // "Firebase: Error (auth/…)".
      setError((err as { code?: string })?.code ?? 'sign-in-failed');
      throw err;
    }
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const can = useCallback(
    (required: RequiredAccess) => {
      if (!required) return true;
      if (role !== 'admin') return false;
      if (required === 'superAdmin') return access.isSuperAdmin;
      if (access.isSuperAdmin || access.permissions === null) return true;
      return access.permissions.includes(required);
    },
    [role, access]
  );

  const value = useMemo(
    () => ({ user, role, loading, error, signIn, signOut, access, can }),
    [user, role, loading, error, signIn, signOut, access, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

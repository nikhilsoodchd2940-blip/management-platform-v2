'use client';

import { useEffect, useState } from 'react';
import { doc } from 'firebase/firestore';
import { db } from './firebase';
import { onSnapshot } from './firestore';
import { useAuth } from '@/context/AuthContext';

/** The five roles, from widest to narrowest. */
export const ROLE_TITLE: Record<string, string> = {
  super_admin: 'Super Admin',
  zone_admin: 'Zone Manager',
  city_manager: 'City Manager',
  city_zone_manager: 'City Zone Manager',
  group_manager: 'Group Admin',
};

export { geoInScope, type Scope, type Geo } from './scopeFilter';
import { geoInScope, type Geo, type Scope } from './scopeFilter';

export function useMyScope(): { loaded: boolean; scope: Scope | null; allows: (geo: Geo) => boolean } {
  const { user } = useAuth();
  const [state, setState] = useState<{ loaded: boolean; scope: Scope | null }>({ loaded: false, scope: null });
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'adminScopes', user.uid),
      (snap) => setState({ loaded: true, scope: snap.exists() ? (snap.data() as Scope) : null }),
      () => setState({ loaded: true, scope: null })
    );
  }, [user]);
  return { ...state, allows: (geo) => geoInScope(state.scope, geo) };
}

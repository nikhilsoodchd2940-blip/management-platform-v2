'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tx } from '@/lib/i18n/tr';

/** Access & permissions and Role & Access Management are now one screen. */
export default function PermissionsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/role-access'); }, [router]);
  return <p>{tx("Opening Roles & access…")}</p>;
}

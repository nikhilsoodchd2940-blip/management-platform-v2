'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Management committees now live inside the Organization page. */
export default function CommitteesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/organigramme?tab=committees'); }, [router]);
  return null;
}

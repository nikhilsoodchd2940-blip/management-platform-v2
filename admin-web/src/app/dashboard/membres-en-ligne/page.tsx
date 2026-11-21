'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** This screen now lives inside Member management. */
export default function Moved() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/members?online=1'); }, [router]);
  return null;
}

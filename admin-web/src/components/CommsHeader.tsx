'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { collection, query } from 'firebase/firestore';
import { Bell, Image as ImageIcon, LayoutGrid, Megaphone, MessageSquare } from 'lucide-react';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { tx } from '@/lib/i18n/tr';
import { CxBanner, CxStats, CxTabs } from '@/components/Cx';

interface Counts { announcements: number; popups: number; banners: number; activePopups: number; activeBanners: number; sent30: number }

/** Shared header for Announcements, Pop-ups and Banners: banner, live stats, route tabs. */
export default function CommsHeader() {
  const router = useRouter();
  const path = usePathname() ?? '';
  const [c, setC] = useState<Counts>({ announcements: 0, popups: 0, banners: 0, activePopups: 0, activeBanners: 0, sent30: 0 });

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'announcements')), (s) => {
      const since = Date.now() - 30 * 864e5;
      const sent30 = s.docs.filter((d) => {
        const v = d.data().createdAt as { toMillis?: () => number } | undefined;
        return (v?.toMillis?.() ?? 0) >= since;
      }).length;
      setC((p) => ({ ...p, announcements: s.size, sent30 }));
    });
    const u2 = onSnapshot(query(collection(db, 'popups')), (s) =>
      setC((p) => ({ ...p, popups: s.size, activePopups: s.docs.filter((d) => d.data().active).length })));
    const u3 = onSnapshot(query(collection(db, 'banners')), (s) =>
      setC((p) => ({ ...p, banners: s.size, activeBanners: s.docs.filter((d) => d.data().active).length })));
    return () => { u1(); u2(); u3(); };
  }, []);

  const tab = path.includes('/popups') ? 'popups' : path.includes('/banners') ? 'banners' : 'announcements';
  const go = (v: string) => router.push(`/dashboard/${v}`);

  return (
    <>
      <CxBanner icon={<Megaphone size={26} />} kicker={tx('Communication')} title={tx('Announcements & Banners')}
        sub={tx('Reach every member with announcements, pop-ups and home banners.')} />
      <CxStats items={[
        { label: tx('Announcements sent'), value: c.announcements, sub: `${c.sent30} ${tx('in the last 30 days')}`, icon: <MessageSquare size={18} />, tone: 'green' },
        { label: tx('Active pop-ups'), value: c.activePopups, sub: `${c.popups} ${tx('total')}`, icon: <Bell size={18} />, tone: 'amber' },
        { label: tx('Active banners'), value: c.activeBanners, sub: `${c.banners} ${tx('total')}`, icon: <ImageIcon size={18} />, tone: 'violet' },
        { label: tx('Channels'), value: 3, sub: tx('Announcements, pop-ups, banners'), icon: <LayoutGrid size={18} />, tone: 'blue' },
      ]} />
      <CxTabs value={tab} onChange={go} items={[
        { value: 'announcements', label: tx('Announcements'), icon: <MessageSquare size={14} />, count: c.announcements },
        { value: 'popups', label: tx('Pop-ups'), icon: <Bell size={14} />, count: c.popups },
        { value: 'banners', label: tx('Banners'), icon: <ImageIcon size={14} />, count: c.banners },
      ]} />
    </>
  );
}

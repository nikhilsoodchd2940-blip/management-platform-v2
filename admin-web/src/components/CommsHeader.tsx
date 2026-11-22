'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { collection, query } from 'firebase/firestore';
import { BarChart3, Bell, CalendarDays, Image as ImageIcon, Layers, Megaphone, MessageSquare, Plus, Users } from 'lucide-react';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { tx } from '@/lib/i18n/tr';
import { CxBanner, CxStats, CxTabs } from '@/components/Cx';

interface Counts { announcements: number; popups: number; banners: number; activePopups: number; activeBanners: number; sent30: number; sent7: number; reach: number }

/** Shared header for Announcements, Pop-ups and Banners: banner, live stats, route tabs. */
export default function CommsHeader() {
  const router = useRouter();
  const path = usePathname() ?? '';
  const [c, setC] = useState<Counts>({ announcements: 0, popups: 0, banners: 0, activePopups: 0, activeBanners: 0, sent30: 0, sent7: 0, reach: 0 });

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'announcements')), (s) => {
      const since = Date.now() - 30 * 864e5;
      const sent30 = s.docs.filter((d) => {
        const v = d.data().createdAt as { toMillis?: () => number } | undefined;
        return (v?.toMillis?.() ?? 0) >= since;
      }).length;
      const w = Date.now() - 7 * 864e5;
      const sent7 = s.docs.filter((d) => ((d.data().createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0) >= w).length;
      const reach = s.docs.reduce((n, d) => n + ((d.data().recipientCount as number) ?? 0), 0);
      setC((p) => ({ ...p, announcements: s.size, sent30, sent7, reach }));
    });
    const u2 = onSnapshot(query(collection(db, 'popups')), (s) =>
      setC((p) => ({ ...p, popups: s.size, activePopups: s.docs.filter((d) => d.data().active).length })));
    const u3 = onSnapshot(query(collection(db, 'banners')), (s) =>
      setC((p) => ({ ...p, banners: s.size, activeBanners: s.docs.filter((d) => d.data().active).length })));
    return () => { u1(); u2(); u3(); };
  }, []);

  const [hash, setHash] = useState('');
  useEffect(() => { const h = () => setHash(window.location.hash.replace('#', '')); h(); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, [path]);
  const tab = path.includes('/popups') ? 'popups' : path.includes('/banners') ? 'banners' : path.includes('/communications') ? (hash === 'templates' ? 'templates' : hash === 'history' ? 'history' : 'overview') : 'announcements';
  const go = (v: string) => {
    if (v === 'overview') router.push('/dashboard/communications');
    else if (v === 'templates' || v === 'history') { router.push(`/dashboard/communications#${v}`); setHash(v); }
    else router.push(`/dashboard/${v}`);
  };

  return (
    <>
      <CxBanner icon={<Megaphone size={26} />} kicker={tx('Communication')} title={tx('Communications, Announcements & Banners')}
        sub={tx('Create, manage and publish announcements, pop-ups and banners across the platform.')}>
        <button type="button" className="cx-btn gold" onClick={() => router.push('/dashboard/announcements')}><Plus size={16} />{tx('Create New')}</button>
      </CxBanner>
      <CxStats items={[
        { label: tx('Active Announcements'), value: c.announcements, badge: `+${c.sent7} ${tx('this week')}`, sub: `${c.sent30} ${tx('in the last 30 days')}`, icon: <MessageSquare size={18} />, tone: 'green' },
        { label: tx('Active Pop-Ups'), value: c.activePopups, sub: `${c.popups} ${tx('total')}`, icon: <Bell size={18} />, tone: 'amber' },
        { label: tx('Active Banners'), value: c.activeBanners, sub: `${c.banners} ${tx('total')}`, icon: <ImageIcon size={18} />, tone: 'violet' },
        { label: tx('Scheduled'), value: 0, sub: tx('Scheduled sending not enabled'), icon: <CalendarDays size={18} />, tone: 'blue' },
        { label: tx('Total Recipients'), value: c.reach.toLocaleString(), sub: tx('All announcements'), icon: <Users size={18} />, tone: 'teal' },
      ]} />
      <CxTabs value={tab} onChange={go} items={[
        { value: 'overview', label: tx('Overview'), icon: <Megaphone size={14} /> },
        { value: 'announcements', label: tx('Announcements'), icon: <MessageSquare size={14} />, count: c.announcements },
        { value: 'popups', label: tx('Pop-ups'), icon: <Bell size={14} />, count: c.popups },
        { value: 'banners', label: tx('Banners'), icon: <ImageIcon size={14} />, count: c.banners },
        { value: 'templates', label: tx('Templates'), icon: <Layers size={14} /> },
        { value: 'history', label: tx('History & Reports'), icon: <BarChart3 size={14} /> },
      ]} />
    </>
  );
}

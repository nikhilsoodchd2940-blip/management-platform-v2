'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import AdminNotificationsBell from '@/components/AdminNotificationsBell';
import MemberHome from '@/components/MemberHome';
import SupervisorWorkspace from '@/components/SupervisorWorkspace';
import MeetingsView from '@/app/dashboard/meetings/MeetingsView';
import TasksView from '@/app/dashboard/tasks/TasksView';
import { useAuth } from '@/context/AuthContext';
import { tx } from '@/lib/i18n/tr';

/**
 * What any signed-in member sees on the web: only their own data. A home page, the meetings they are invited to
 * (with the controls when they coordinate one) and, for event supervisors, the supervision workspace.
 * Admins never see this; they get the full panel.
 */
export default function MemberWorkspace({ supervisor }: { supervisor: boolean }) {
  const { user, signOut } = useAuth();
  const path = usePathname() ?? '';
  const tab = path.startsWith('/dashboard/meetings') ? 'meetings' : path.startsWith('/dashboard/tasks') ? 'tasks' : path.startsWith('/dashboard/supervision') && supervisor ? 'supervision' : 'home';
  const tabs = [
    { key: 'home', href: '/dashboard', label: tx("My space") },
    { key: 'meetings', href: '/dashboard/meetings', label: tx("Meetings") },
    { key: 'tasks', href: '/dashboard/tasks', label: tx("My tasks") },
    ...(supervisor ? [{ key: 'supervision', href: '/dashboard/supervision', label: tx("Event supervision") }] : []),
  ];
  return (
    <div className="mw">
      <header className="mw-top">
        <div className="mw-brand"><img src="/hizbut-logo.png" alt="" /><div><strong>{tx("Direction Conservatoire")}</strong><span>{tx("Member space")}</span></div></div>
        <nav className="mw-tabs" aria-label={tx("Sections")}>
          {tabs.map((t) => <Link key={t.key} href={t.href} className={tab === t.key ? 'on' : ''}>{t.label}</Link>)}
        </nav>
        <div className="mw-right">
          <AdminNotificationsBell />
          <span className="mw-email" title={user?.email ?? ''}>{user?.email}</span>
          <button type="button" className="mw-out" onClick={() => signOut()}><LogOut size={15} /> {tx("Log out")}</button>
        </div>
      </header>
      <main className="mw-main">
        {tab === 'home' && <MemberHome />}
        {tab === 'meetings' && <MeetingsView memberMode />}
        {tab === 'tasks' && <TasksView memberMode />}
        {tab === 'supervision' && <SupervisorWorkspace />}
      </main>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { pauseRefreshWhenHidden } from '@/lib/quietTimers';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, LogOut, Menu, ShieldOff, X } from 'lucide-react';
import AdminNotificationsBell from '@/components/AdminNotificationsBell';
import ToastHost from '@/components/ToastHost';
import ScopeGate from '@/components/ScopeGate';
import MemberWorkspace from '@/components/MemberWorkspace';
import { getMySupervision } from '@/lib/functions';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { GroupHierarchyProvider } from '@/lib/useGroupHierarchy';
import { ROLE_TITLE, useMyScope } from '@/lib/useMyScope';
import { ALL_NAV, NAV_GROUPS, findNavItem, isActivePath, requiredAccessFor, type NavItem } from '@/lib/navigation';
import { tx } from '@/lib/i18n/tr';
import LanguageSwitch from '@/components/LanguageSwitch';

/**
 * Route guard + application shell (menu, header, content area).
 *
 * Redirects to /login if not signed in. This is a UX convenience only —
 * the actual authorization boundary is server-side (Firestore Rules +
 * Cloud Function checks), so a non-admin can never do anything here even
 * if this check were bypassed. The menu (and the page a URL points to)
 * also follow the admin's own section permissions from the Permissions
 * page, so a restricted admin is not offered screens whose every action
 * the server would refuse.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, loading, signOut, access, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string>('');
  const { scope } = useMyScope();
  useEffect(() => { pauseRefreshWhenHidden(); }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
  }, [user, loading, router]);

  // Close the mobile menu after navigating, and on Escape.
  useEffect(() => setMenuOpen(false), [pathname]);
  // The group that holds the page you are on opens by itself.
  useEffect(() => {
    const g = NAV_GROUPS.find((x) => x.hrefs.some((h) => isActivePath(pathname, h)));
    if (g) setOpenGroup(g.key);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Presence heartbeat: lets the "Members online" screen and the online counters see this admin session.
  useEffect(() => {
    if (!user || role !== 'admin') return;
    const beat = () =>
      setDoc(doc(db, 'presence', user.uid), {
        userId: user.uid,
        displayName: user.displayName || user.email || '',
        role: 'admin',
        device: 'Web admin panel',
        scope: 'Whole organization',
        lastActiveAt: serverTimestamp(),
      }).catch(() => undefined);
    beat();
    const handle = window.setInterval(beat, 60000);
    return () => window.clearInterval(handle);
  }, [user, role]);

  // A member who supervises an event may sign in here and sees only the supervisor workspace.
  const [supervisor, setSupervisor] = useState<'unknown' | 'yes' | 'no'>('unknown');
  useEffect(() => {
    if (loading || !user || role === 'admin') return;
    let cancelled = false;
    getMySupervision({}).then((r) => !cancelled && setSupervisor(r.data.events.length > 0 ? 'yes' : 'no')).catch(() => !cancelled && setSupervisor('no'));
    return () => { cancelled = true; };
  }, [loading, user, role]);

  if (loading || !user) {
    return (
      <div className="fullscreen-message">
        <p>{t.common.checkingAccess}</p>
      </div>
    );
  }

  // Signed in but not an admin: say so (the old behaviour bounced to
  // /login with no explanation, which looked like a broken sign-in).
  if (role !== 'admin' && supervisor === 'unknown') {
    return (
      <div className="fullscreen-message">
        <p>{t.common.checkingAccess}</p>
      </div>
    );
  }
  // A member who is not an admin gets the member space: their own data and their meetings (plus supervision when they supervise an event).
  if (role !== 'admin') {
    if (supervisor === 'unknown') return (<div className="fullscreen-message"><p>{t.common.checkingAccess}</p></div>);
    return (<><MemberWorkspace supervisor={supervisor === 'yes'} /><ToastHost /></>);
  }

  if (!access.loaded) {
    return (
      <div className="fullscreen-message">
        <p>{t.common.checkingAccess}</p>
      </div>
    );
  }

  const current = findNavItem(pathname);
  const currentPageName = current ? t.sidebar[current.labelKey] : t.common.adminPanel;

  const visible = (items: NavItem[]) => items.filter((i) => can(i.requires));
  const allItems = visible(ALL_NAV);
  const home = allItems.find((i) => i.href === '/dashboard');
  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.hrefs));
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.hrefs.map((h) => allItems.find((i) => i.href === h)).filter((i): i is NavItem => !!i) })).filter((g) => g.items.length > 0);
  const rest = allItems.filter((i) => i.href !== '/dashboard' && !grouped.has(i.href));
  if (rest.length) groups.push({ key: 'more', label: tx("More"), icon: 'administration', hrefs: [], items: rest });
  const allowed = can(requiredAccessFor(pathname));

  const roleTitle = tx(scope ? ROLE_TITLE[scope.role] ?? 'Manager' : access.isSuperAdmin ? ROLE_TITLE.super_admin : 'Administrator');
  const avatarInitial = (user.email ?? '?').charAt(0).toUpperCase();

  const renderLink = (item: NavItem) => {
    const active = isActivePath(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={active ? 'active' : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <span
          className="cs-ico"
          aria-hidden="true"
          style={{ ['--nav-icon' as string]: `url(/nav-icons/${item.icon}.svg)` }}
        />
        {t.sidebar[item.labelKey]}
      </Link>
    );
  };

  return (
    <GroupHierarchyProvider>
      <a href="#main-content" className="skip-link">
        {t.shell.skipToContent}
      </a>
      <div className="cs-app">
        <aside className={`cs-sidebar${menuOpen ? ' open' : ''}`} id="sidebar">
          <button type="button" className="cs-sidebar-close" aria-label={t.shell.closeMenu} onClick={() => setMenuOpen(false)}>
            <X size={18} />
          </button>

          <div className="cs-brand">
            <img src="/hizbut-logo.png" alt={tx("Hizbut Tarqiyyah")} />
            <div className="cs-brand-text">
              <strong>{tx("Direction Conservatoire")}</strong>
              <span>{tx("Hizbut Tarqiyyah")}</span>
            </div>
          </div>

          <div className="cs-nav-title">{t.sidebar.sectionAdministration}</div>
          <nav className="cs-nav" aria-label={t.shell.mainNav}>
            {home && renderLink(home)}
            {groups.map((g) => {
              // A category with a single page is just that page's link, not a folder.
              if (g.items.length === 1) return renderLink(g.items[0]);
              const open = openGroup === g.key;
              const hasActive = g.items.some((i) => isActivePath(pathname, i.href));
              return (
                <div key={g.key} className={`cs-grp${open ? ' open' : ''}${hasActive ? ' has-active' : ''}`}>
                  <button type="button" className="cs-grp-h" aria-expanded={open} onClick={() => setOpenGroup(open ? '' : g.key)}>
                    <span className="cs-ico" aria-hidden="true" style={{ ['--nav-icon' as string]: `url(/nav-icons/${g.icon}.svg)` }} />
                    <span className="cs-grp-t">{tx(g.label)}</span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  {open && <div className="cs-grp-b">{g.items.map(renderLink)}</div>}
                </div>
              );
            })}
          </nav>

          <div className="cs-sidebar-bottom">
            <LanguageSwitch />
            <div className="cs-live-pill">
              <span className="cs-pulse" aria-hidden="true" />
              {t.shell.statusLive}
            </div>
            <button type="button" className="cs-signout" onClick={() => signOut()}>
              <LogOut size={14} />
              {t.common.signOut}
            </button>
          </div>
        </aside>

        {menuOpen && <div className="cs-overlay" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

        <div className="cs-main" id="main-content">
          {(
            <>
              <header className="cs-topbar">
                <div className="cs-top-left">
                  <button
                    type="button"
                    className="cs-menu-btn"
                    aria-label={t.shell.openMenu}
                    aria-expanded={menuOpen}
                    aria-controls="sidebar"
                    onClick={() => setMenuOpen(true)}
                  >
                    <Menu size={20} />
                  </button>
                  <img className="cs-top-logo" src="/hizbut-logo.png" alt="" />
                  <div>
                    <div className="cs-brand-title">{tx("Direction Conservatoire")}</div>
                    <div className="cs-page-name">{currentPageName}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <AdminNotificationsBell />
                  <div className="cs-profile">
                    <div className="cs-avatar" title={user.email ?? undefined}>
                      {avatarInitial}
                    </div>
                    <div className="cs-who">
                      <strong>{user.email}</strong>
                      <span className="cs-role">{roleTitle}</span>
                    </div>
                  </div>
                  <button type="button" className="cs-logout" onClick={() => signOut()} title={t.common.signOut}>
                    <LogOut size={16} />
                    <span>{t.common.signOut}</span>
                  </button>
                </div>
              </header>
              <main className="cs-content" tabIndex={-1}>
                {allowed ? (
                  <ScopeGate>{children}</ScopeGate>
                ) : (
                  <div className="card" style={{ maxWidth: 520 }}>
                    <ShieldOff size={28} style={{ color: 'var(--danger)' }} />
                    <h1 style={{ fontSize: '1.2rem' }}>{t.shell.noAccessTitle}</h1>
                    <p style={{ color: 'var(--ink-soft)' }}>{t.shell.noAccessText}</p>
                    <Link href="/dashboard" className="btn btn-primary">
                      {t.shell.backToDashboard}
                    </Link>
                  </div>
                )}
              </main>
            </>
          )}
        </div>
      </div>
      <ToastHost />
    </GroupHierarchyProvider>
  );
}

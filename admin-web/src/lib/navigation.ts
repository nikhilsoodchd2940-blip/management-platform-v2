import type { Dictionary } from './i18n/translations';

/**
 * Same keys the backend enforces in requireAdminPermission
 * (firebase/functions/src/modules/admin/authorize.ts) — so a section is
 * only offered in the menu when the Cloud Functions behind it would
 * actually accept the admin's calls. 'superAdmin' = only an admin
 * flagged isSuperAdmin on their adminRoles doc.
 */
export type AdminPermission =
  | 'groups'
  | 'members'
  | 'events'
  | 'requests'
  | 'donations'
  | 'reports'
  | 'content'
  | 'integrations'
  | 'logistics';

export type RequiredAccess = AdminPermission | 'superAdmin' | undefined;

export interface NavItem {
  href: string;
  labelKey: keyof Dictionary['sidebar'];
  /** File name (without .svg) in public/nav-icons. */
  icon: string;
  requires?: RequiredAccess;
}

/** The side menu — same entries, order and labels as the approved design, plus the two level-management screens. */
export const MAIN_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: 'home' },
  { href: '/dashboard/organigramme', labelKey: 'organigramme', icon: 'organisation', requires: 'groups' },
  { href: '/dashboard/approvals', labelKey: 'administration', icon: 'administration', requires: 'members' },
  { href: '/dashboard/meetings', labelKey: 'meetings', icon: 'calendar', requires: 'events' },
  { href: '/dashboard/tasks', labelKey: 'tasks', icon: 'tasks', requires: 'events' },
  { href: '/dashboard/members', labelKey: 'members', icon: 'members', requires: 'members' },
  { href: '/dashboard/messagerie', labelKey: 'messagerie', icon: 'messages' },
  { href: '/dashboard/groups', labelKey: 'groups', icon: 'kurels', requires: 'groups' },
  { href: '/dashboard/levels', labelKey: 'levels', icon: 'pedagogy', requires: 'content' },
  { href: '/dashboard/programme-pedagogique', labelKey: 'programmePedagogique', icon: 'pedagogy', requires: 'content' },
  { href: '/dashboard/library', labelKey: 'library', icon: 'library', requires: 'content' },
  { href: '/dashboard/audio', labelKey: 'audio', icon: 'audio', requires: 'content' },
  { href: '/dashboard/events', labelKey: 'events', icon: 'calendar', requires: 'events' },
  { href: '/dashboard/event-books', labelKey: 'eventBooks', icon: 'library', requires: 'events' },
  { href: '/dashboard/performance-history', labelKey: 'performanceHistory', icon: 'evaluation', requires: 'events' },
  { href: '/dashboard/rehearsals', labelKey: 'rehearsals', icon: 'calendar', requires: 'events' },
  { href: '/dashboard/reports', labelKey: 'attendance', icon: 'attendance', requires: 'reports' },
  { href: '/dashboard/evaluations', labelKey: 'evaluations', icon: 'evaluation' },
  { href: '/dashboard/requests', labelKey: 'social', icon: 'social', requires: 'requests' },
  { href: '/dashboard/donations', labelKey: 'finance', icon: 'finance', requires: 'donations' },
  { href: '/dashboard/logistics', labelKey: 'logistics', icon: 'logistics', requires: 'logistics' },
  { href: '/dashboard/equipment', labelKey: 'equipment', icon: 'logistics', requires: 'logistics' },
  { href: '/dashboard/disciplinary', labelKey: 'disciplinary', icon: 'discipline', requires: 'members' },
  { href: '/dashboard/geofence', labelKey: 'geofence', icon: 'logistics', requires: 'groups' },
  { href: '/dashboard/role-access', labelKey: 'roleAccess', icon: 'access', requires: 'superAdmin' },
];

/** Further tools, shown in a second menu group. */
export const TOOLS_NAV: NavItem[] = [
  { href: '/dashboard/locations', labelKey: 'locations', icon: 'organisation', requires: 'groups' },
  { href: '/dashboard/zones', labelKey: 'zones', icon: 'organisation', requires: 'groups' },
  { href: '/dashboard/local-zones', labelKey: 'localZones', icon: 'organisation', requires: 'groups' },
  { href: '/dashboard/resource-requests', labelKey: 'resourceRequests', icon: 'logistics', requires: 'requests' },
  { href: '/dashboard/banners', labelKey: 'banners', icon: 'library', requires: 'content' },
  { href: '/dashboard/popups', labelKey: 'popups', icon: 'messages', requires: 'content' },
  { href: '/dashboard/announcements', labelKey: 'announcements', icon: 'messages', requires: 'content' },
  { href: '/dashboard/integrations', labelKey: 'integrations', icon: 'access', requires: 'integrations' },
  { href: '/dashboard/settings', labelKey: 'settings', icon: 'administration', requires: 'groups' },
  { href: '/dashboard/languages', labelKey: 'languages', icon: 'messages', requires: 'superAdmin' },
  { href: '/dashboard/help', labelKey: 'help', icon: 'evaluation' },
];

/** The side menu, grouped by what the pages are about. Each page keeps its own entry above; this only decides where it is listed. */
export const NAV_GROUPS: { key: string; label: string; icon: string; hrefs: string[] }[] = [
  { key: 'members', label: 'Members', icon: 'members', hrefs: ['/dashboard/members'] },
  { key: 'admin', label: 'Administration', icon: 'administration', hrefs: ['/dashboard/approvals', '/dashboard/disciplinary', '/dashboard/requests'] },
  { key: 'work', label: 'Meetings & tasks', icon: 'calendar', hrefs: ['/dashboard/meetings', '/dashboard/tasks'] },
  { key: 'org', label: 'Organization', icon: 'organisation', hrefs: ['/dashboard/organigramme', '/dashboard/groups'] },
  { key: 'places', label: 'Locations & areas', icon: 'logistics', hrefs: ['/dashboard/locations', '/dashboard/zones', '/dashboard/local-zones', '/dashboard/geofence'] },
  { key: 'events', label: 'Events & performance', icon: 'attendance', hrefs: ['/dashboard/events', '/dashboard/event-books', '/dashboard/rehearsals', '/dashboard/performance-history', '/dashboard/reports', '/dashboard/evaluations'] },
  { key: 'learning', label: 'Learning', icon: 'pedagogy', hrefs: ['/dashboard/levels', '/dashboard/programme-pedagogique', '/dashboard/library', '/dashboard/audio'] },
  { key: 'resources', label: 'Resources & finance', icon: 'finance', hrefs: ['/dashboard/donations', '/dashboard/logistics', '/dashboard/equipment', '/dashboard/resource-requests'] },
  { key: 'comms', label: 'Communication', icon: 'messages', hrefs: ['/dashboard/messagerie', '/dashboard/announcements', '/dashboard/popups', '/dashboard/banners'] },
  { key: 'system', label: 'System', icon: 'access', hrefs: ['/dashboard/role-access', '/dashboard/integrations', '/dashboard/settings', '/dashboard/languages', '/dashboard/help'] },
];

export const ALL_NAV: NavItem[] = [...MAIN_NAV, ...TOOLS_NAV];

export function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV.find((i) => isActivePath(pathname, i.href));
}

/** The access a given URL needs (undefined = open to every admin). */
export function requiredAccessFor(pathname: string): RequiredAccess {
  return findNavItem(pathname)?.requires;
}

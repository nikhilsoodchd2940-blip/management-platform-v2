/** Every role a person can hold, in one place: what it is, how it is given, and what it needs to be filled in. */
export type Kind = 'access' | 'team' | 'kurel';
export type Need = 'countries' | 'zones' | 'cities' | 'kurels';

export interface RoleDef {
  key: string;
  kind: Kind;
  label: string;
  what: string;
  tone: 'g' | 'b' | 'y' | 'p' | 't' | 'r';
  badge: string;
  /** For admin access roles: which places must be chosen. `all` = every one of them is needed, `any` = at least one of them. */
  needs?: Need[];
  mode?: 'all' | 'any';
  preset?: string[];
}

export const SECTIONS: { key: string; label: string; what: string }[] = [
  { key: 'groups', label: 'Kurels and structure', what: 'Create and edit countries, cities and kurels' },
  { key: 'members', label: 'Members', what: 'Profiles, statuses and assignments' },
  { key: 'events', label: 'Events and rehearsals', what: 'Plan sessions, attendance, audio and books' },
  { key: 'requests', label: 'Requests and welfare', what: 'Member requests and social news' },
  { key: 'donations', label: 'Finance', what: 'Programs, collections and payments' },
  { key: 'reports', label: 'Reports', what: 'Attendance and activity reports' },
  { key: 'content', label: 'Content and curriculum', what: 'Library, audio and teaching material' },
  { key: 'logistics', label: 'Logistics', what: 'Equipment and resources' },
  { key: 'integrations', label: 'Integrations', what: 'Connected services' },
];
export const ALL_SECTIONS = SECTIONS.map((s) => s.key);

export const ACCESS_ROLES: RoleDef[] = [
  { key: 'super_admin', kind: 'access', label: 'Super Admin', what: 'Everything, everywhere. Every section is included automatically.', tone: 'p', badge: 'SA' },
  { key: 'zone_admin', kind: 'access', label: 'Country or zone manager', what: 'Manages the countries and zones assigned to them, with their cities and kurels.', tone: 'b', badge: 'CZ', needs: ['countries', 'zones'], mode: 'any', preset: ['groups', 'members', 'events', 'requests', 'donations', 'reports', 'content', 'logistics'] },
  { key: 'city_manager', kind: 'access', label: 'City manager', what: 'Manages the cities assigned to them, with their kurels.', tone: 'y', badge: 'CM', needs: ['cities'], mode: 'any', preset: ['groups', 'members', 'events', 'requests', 'reports', 'content'] },
  { key: 'city_zone_manager', kind: 'access', label: 'Local city zone manager', what: 'Manages kurels that are in a chosen city AND a chosen zone.', tone: 't', badge: 'LZ', needs: ['cities', 'zones'], mode: 'all', preset: ['groups', 'members', 'events', 'requests', 'reports', 'content'] },
  { key: 'group_manager', kind: 'access', label: 'Kurel admin', what: 'Manages only the kurels assigned to them.', tone: 'g', badge: 'KA', needs: ['kurels'], mode: 'any', preset: ['members', 'events', 'requests', 'content'] },
];

export const TEAM_TITLES: RoleDef[] = [
  { key: 'president', kind: 'team', label: 'President', what: 'Leads a management team. One per team.', tone: 'p', badge: 'P' },
  { key: 'vice_president', kind: 'team', label: 'Vice-president', what: 'Assists the president of a management team.', tone: 'b', badge: 'VP' },
  { key: 'secretary', kind: 'team', label: 'Secretary', what: 'Keeps the records of a management team.', tone: 't', badge: 'S' },
  { key: 'treasurer', kind: 'team', label: 'Treasurer', what: 'Follows the money of a management team.', tone: 'y', badge: 'T' },
  { key: 'member', kind: 'team', label: 'Team member', what: 'Sits on a management team. Gets the team’s access.', tone: 'g', badge: 'M' },
];

/** Field names are the ones the kurel team document uses. */
export const KUREL_ROLES: RoleDef[] = [
  { key: 'leaderId', kind: 'kurel', label: 'Superviseur (kurel leader)', what: 'Responsible of the kurel. The only one who validates operations.', tone: 'p', badge: 'SV' },
  { key: 'surveillantId', kind: 'kurel', label: 'General supervisor', what: 'Surveillant Général: keeps order and follows attendance.', tone: 'b', badge: 'GS' },
  { key: 'surveillantDeputyId', kind: 'kurel', label: 'Second general supervisor', what: 'Optional second member next to the general supervisor.', tone: 'b', badge: 'G2' },
  { key: 'pedagogyPresidentId', kind: 'kurel', label: 'Pedagogy president', what: 'Heads the pedagogical committee of the kurel.', tone: 'g', badge: 'PP' },
  { key: 'socialId', kind: 'kurel', label: 'Social', what: 'Follows the social life of the members.', tone: 'r', badge: 'SO' },
  { key: 'socialDeputyId', kind: 'kurel', label: 'Second social', what: 'Optional second member next to the social role.', tone: 'r', badge: 'S2' },
  { key: 'administrationId', kind: 'kurel', label: 'Administration', what: 'Handles the administration of the kurel.', tone: 'y', badge: 'AD' },
  { key: 'administrationDeputyId', kind: 'kurel', label: 'Second administration', what: 'Optional second member next to administration.', tone: 'y', badge: 'A2' },
  { key: 'choirMasterId', kind: 'kurel', label: 'Choir master', what: 'Maître de chœurs: leads the choir.', tone: 't', badge: 'CH' },
];

export const ALL_ROLES: RoleDef[] = [...ACCESS_ROLES, ...TEAM_TITLES, ...KUREL_ROLES];
export const ROLE_BY_KEY: Record<string, RoleDef> = Object.fromEntries(ALL_ROLES.filter((r) => r.kind !== 'team').map((r) => [r.key, r]));
export const TEAM_BY_TITLE: Record<string, RoleDef> = Object.fromEntries(TEAM_TITLES.map((r) => [r.key, r]));
/** The key used in the catalogue: team titles get a prefix so they never clash with access roles. */
export const catalogKey = (r: RoleDef) => (r.kind === 'team' ? `team:${r.key}` : r.key);
export const KUREL_FIELDS = KUREL_ROLES.map((r) => r.key);

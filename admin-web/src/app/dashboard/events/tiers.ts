export type Tier = 'head' | 'manager' | 'staff';
export const TIER_NAME: Record<Tier, string> = { head: 'Main event supervisor', manager: 'Site manager', staff: 'Site staff' };

interface ShiftLike { siteId?: string; siteIds?: string[]; supervisors: { userId: string; role: 'main' | 'member' }[] }

/**
 * The level of every supervisor of an event, worked out like the server does: a main supervisor who covers
 * every place (or the only place) is the head of the event, one who covers some places only is a site manager,
 * and a team member is site staff.
 */
export function tiersOf(shifts: ShiftLike[], allSiteIds: string[]): Map<string, Tier> {
  const out = new Map<string, Tier>();
  const sitesOf = (sh: ShiftLike) => (sh.siteIds?.length ? sh.siteIds : sh.siteId ? [sh.siteId] : []);
  const ids = new Set(shifts.flatMap((sh) => sh.supervisors.map((p) => p.userId)));
  ids.forEach((uid) => {
    const mine = shifts.filter((sh) => sh.supervisors.some((p) => p.userId === uid && p.role === 'main'));
    if (mine.length === 0) { out.set(uid, 'staff'); return; }
    if (allSiteIds.length <= 1 || mine.some((sh) => sitesOf(sh).length === 0)) { out.set(uid, 'head'); return; }
    const covered = new Set(mine.flatMap(sitesOf));
    out.set(uid, allSiteIds.every((s) => covered.has(s)) ? 'head' : 'manager');
  });
  return out;
}

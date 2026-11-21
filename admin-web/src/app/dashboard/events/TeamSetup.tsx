'use client';

import { useState } from 'react';
import MemberPicker, { Avatar, type PickedMember } from '@/components/MemberPicker';
import type { ShiftDraft, ShiftPerson, SiteDraft } from './eventPlanTypes';
import { tx } from '@/lib/i18n/tr';

export type Tier = 'head' | 'manager' | 'staff';
export const TIER_LABEL: Record<Tier, string> = { head: 'Main event supervisor', manager: 'Site manager', staff: 'Site staff' };
/** What each level may do by default (a person can be given other rights in the advanced part of a shift). */
export const TIER_RIGHTS: Record<Tier, string[]> = {
  head: ['status', 'delay', 'notes', 'adjust', 'cancel'],
  manager: ['status', 'delay', 'notes', 'adjust'],
  staff: ['status', 'delay', 'notes'],
};

/**
 * The level of a person in the draft, worked out the same way as on the server: staff work under a manager;
 * a main supervisor who covers every place (or the only place) is the head of the event; one who covers some
 * places only is a site manager.
 */
export function tierOf(shifts: ShiftDraft[], sites: SiteDraft[], userId: string): Tier {
  const mine = shifts.filter((s) => s.people.some((p) => p.userId === userId && p.role === 'main'));
  if (mine.length === 0) return 'staff';
  if (sites.length <= 1) return 'head';
  if (mine.some((s) => s.siteIds.length === 0)) return 'head';
  const covered = new Set(mine.flatMap((s) => s.siteIds));
  return sites.every((s) => covered.has(s.id)) ? 'head' : 'manager';
}

const asPerson = (m: PickedMember | undefined, id: string, role: ShiftPerson['role'], leaderId?: string): ShiftPerson => ({ userId: id, name: m?.name ?? id, photoUrl: m?.photoUrl, role, ...(leaderId ? { leaderId } : {}) });

/**
 * Who is in charge of the event, in three clear steps: the main event supervisor (one person for the whole
 * event), a site manager for each place, and the site staff of each place. It fills every shift for you;
 * a single shift can still be changed on its own below.
 */
export default function TeamSetup({ shifts, setShifts, sites, performing = [] }: { shifts: ShiftDraft[]; setShifts: (s: ShiftDraft[]) => void; sites: SiteDraft[]; performing?: string[] }) {
  const many = sites.length > 1;
  const perPlace = many && shifts.length > 0 && shifts.every((s) => s.siteIds.length > 0);
  const allPeople = shifts.flatMap((s) => s.people);
  const uniq = <T extends { userId: string }>(list: T[]) => Array.from(new Map(list.map((p) => [p.userId, p])).values());
  const tier = (id: string) => tierOf(shifts, sites, id);

  const heads = uniq(allPeople.filter((p) => p.role === 'main' && tier(p.userId) === 'head'));
  const managersOf = (siteId: string) => uniq(shifts.filter((s) => s.siteIds.includes(siteId)).flatMap((s) => s.people.filter((p) => p.role === 'main' && tier(p.userId) === 'manager')));
  const staffOf = (siteId: string | null) => uniq(shifts.filter((s) => siteId === null || s.siteIds.includes(siteId)).flatMap((s) => s.people.filter((p) => p.role === 'member')));
  const usedElsewhere = (except: string[]) => allPeople.map((p) => p.userId).filter((id) => !except.includes(id));

  function setHead(ids: string[], picked: PickedMember[]) {
    const old = new Set(heads.map((p) => p.userId));
    setShifts(shifts.map((sh) => ({
      ...sh,
      people: [
        ...sh.people.filter((p) => !(old.has(p.userId) && p.role === 'main') && !ids.includes(p.userId)),
        ...ids.map((id) => asPerson(picked.find((x) => x.id === id) ?? (heads.find((h) => h.userId === id) ? { id, name: heads.find((h) => h.userId === id)!.name, phone: '', memberId: '', photoUrl: heads.find((h) => h.userId === id)!.photoUrl } : undefined), id, 'main')),
      ],
    })));
  }

  function setManagers(siteId: string, ids: string[], picked: PickedMember[]) {
    const old = new Map(managersOf(siteId).map((p) => [p.userId, p]));
    setShifts(shifts.map((sh) => {
      if (!sh.siteIds.includes(siteId)) return sh;
      const keep = sh.people.filter((p) => !(p.role === 'main' && old.has(p.userId)) && !ids.includes(p.userId));
      const added = ids.map((id) => old.get(id) ?? asPerson(picked.find((x) => x.id === id), id, 'main'));
      const leader = ids.length === 1 ? ids[0] : undefined;
      return { ...sh, people: [...keep.map((p) => (p.role === 'member' && !p.leaderId && leader ? { ...p, leaderId: leader } : p)), ...added.map((p) => ({ ...p, role: 'main' as const }))] };
    }));
  }

  function setStaff(siteId: string | null, ids: string[], picked: PickedMember[]) {
    const old = new Map(staffOf(siteId).map((p) => [p.userId, p]));
    setShifts(shifts.map((sh) => {
      if (siteId !== null && !sh.siteIds.includes(siteId)) return sh;
      const keep = sh.people.filter((p) => !(p.role === 'member' && old.has(p.userId)) && !ids.includes(p.userId));
      const mgrs = sh.people.filter((p) => p.role === 'main' && tier(p.userId) === 'manager');
      const leader = mgrs.length === 1 ? mgrs[0].userId : undefined;
      const added = ids.map((id) => ({ ...(old.get(id) ?? asPerson(picked.find((x) => x.id === id), id, 'member')), role: 'member' as const, ...(leader ? { leaderId: leader } : {}) }));
      return { ...sh, people: [...keep, ...added] };
    }));
  }

  interface Slot { id: string; step: number; title: string; hint: string; people: ShiftPerson[]; multiple: boolean; set: (ids: string[], picked: PickedMember[]) => void }
  const slots: Slot[] = [
    { id: 'head', step: 1, title: tx("Main event supervisor"), hint: tx("For the whole event, every day. Sees everything, receives the problems the site managers cannot solve, and can do everything. To give different days to different people, use “Supervisors by part of the event” above."), people: heads, multiple: true, set: setHead },
    ...(many && perPlace ? sites.map((st): Slot => ({ id: `m${st.id}`, step: 2, title: `Site manager: ${st.name || 'Place'}`, hint: tx("Looks after the whole place: answers the staff, changes the schedule if needed and sends serious problems to the main event supervisor. Cannot cancel a performance."), people: managersOf(st.id), multiple: true, set: (ids, p) => setManagers(st.id, ids, p) })) : []),
    ...(many && perPlace
      ? sites.map((st): Slot => ({ id: `s${st.id}`, step: many ? 3 : 2, title: `Site staff: ${st.name || 'Place'}`, hint: tx("Responsible for the group performances: they check the audio, start and finish each group, report delays and add notes. They report to the site manager and cannot change the schedule."), people: staffOf(st.id), multiple: true, set: (ids, p) => setStaff(st.id, ids, p) }))
      : [{ id: 's', step: 2, title: tx("Site staff"), hint: tx("Responsible for the group performances: they check the audio, start and finish each group, report delays and add notes. They report to their manager and cannot change the schedule."), people: staffOf(null), multiple: true, set: (ids: string[], p: PickedMember[]) => setStaff(null, ids, p) } as Slot]),
  ];
  const [active, setActive] = useState('head');
  const cur = slots.find((x) => x.id === active) ?? slots[0];
  const idx = slots.findIndex((x) => x.id === cur.id);
  const nextSlot = slots[idx + 1];
  const go = (id: string) => setActive(id);

  if (shifts.length === 0) return null;
  const groupsOf: [number, string][] = [[1, 'Main event supervisor'], [2, many ? 'Site managers' : 'Site staff'], ...(many ? [[3, 'Site staff'] as [number, string]] : [])];
  return (
    <section className="ts">
      <header>
        <h4>{tx("Who is in charge?")}</h4>
        <p>{tx("Staff report to their site manager, the site manager reports to the main event supervisor. Choose the people for each role; every shift is filled for you, and one shift can still be changed on its own below.")}</p>
        <ol className="ts-chain" aria-label={tx("Reporting chain")}><li>{tx("Site staff")}</li><li>{tx("Site manager")}</li><li>{tx("Main event supervisor")}</li><li>{tx("Administration")}</li></ol>
      </header>

      <div className="ts-board">
        <nav className="ts-rail" aria-label={tx("Roles to fill")}>
          {groupsOf.map(([n, label]) => {
            const list = slots.filter((x) => x.step === n);
            if (list.length === 0) return null;
            return (
              <div key={n} className="ts-grp">
                <h5><span>{n}</span>{label}</h5>
                {list.map((x) => (
                  <button key={x.id} type="button" className={`ts-slot${x.id === cur.id ? ' on' : ''}${x.people.length ? ' ok' : ''}`} onClick={() => go(x.id)} aria-current={x.id === cur.id}>
                    <i aria-hidden="true">{x.people.length ? '✓' : ''}</i>
                    <span>
                      <b>{x.id === 'head' || x.id === 's' ? label : x.title.split(': ')[1]}</b>
                      <small>{x.people.length ? x.people.slice(0, 2).map((p) => p.name).join(', ') + (x.people.length > 2 ? ` +${x.people.length - 2}` : '') : tx("Not chosen yet")}</small>
                    </span>
                    {x.people.length > 0 && <span className="ts-av">{x.people.slice(0, 3).map((p) => <Avatar key={p.userId} name={p.name} photoUrl={p.photoUrl} size={24} />)}</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {many && !perPlace && <p className="ts-warn">{tx("To choose a manager for each place, the shifts must be separate for each place. Tick “A separate shift for each place” above and create the shifts again.")}</p>}
          {!many && <p className="ts-note">{tx("This event has one place, so the main event supervisor is also its manager.")}</p>}
        </nav>

        <div className="ts-panel">
          <div className="ts-ph">
            <div><b>{cur.title}</b><small>{cur.hint}</small></div>
            <div className="ts-pa">
              {nextSlot ? <button type="button" className="btn btn-primary" onClick={() => go(nextSlot.id)}>{cur.people.length ? tx("Done, next") : tx("Skip")}: {nextSlot.title.replace('Site manager: ', 'Manager of ').replace('Site staff: ', 'Staff of ')} →</button>
                : <span className="ts-fin">{cur.people.length ? tx("Last role done. Check the shifts below.") : tx("This is the last role.")}</span>}
            </div>
          </div>
          <MemberPicker
            key={cur.id}
            multiple={cur.multiple}
            value={cur.people.map((p) => p.userId)}
            selected={cur.people.map((p) => ({ id: p.userId, name: p.name, phone: '', memberId: '', photoUrl: p.photoUrl }))}
            disabledIds={[...usedElsewhere(cur.people.map((p) => p.userId)), ...performing]}
            disabledReason={{ ...Object.fromEntries(performing.map((id) => [id, 'Performing in this event'])), ...Object.fromEntries(usedElsewhere(cur.people.map((p) => p.userId)).map((id) => [id, 'Already has another role'])) }}
            onChange={(ids, picked) => { cur.set(ids, picked); if (!cur.multiple && ids.length && nextSlot) go(nextSlot.id); }}
          />
        </div>
      </div>
    </section>
  );
}

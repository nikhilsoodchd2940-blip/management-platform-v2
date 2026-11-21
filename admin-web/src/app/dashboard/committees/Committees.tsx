'use client';

import '../../px/index.css';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useZones } from '@/lib/useZones';
import { useMyScope } from '@/lib/useMyScope';
import { useUserProfiles } from '@/lib/useUserNames';
import { deleteCommittee, saveCommittee, setCommitteeMembers } from '@/lib/functions';
import { Avatar } from '@/components/MemberPicker';
import { MemberProfileDialog } from '@/components/MemberProfile';
import MemberPicker from '@/components/MemberPicker';
import Dropdown from '@/components/Dropdown';
import { notify } from '@/lib/notify';
import { Shell } from '../donations/AllocDialogs';
import { CountryFlag } from '@/components/CountryFlag';
import { tx, txf } from '@/lib/i18n/tr';

type Level = 'organisation' | 'country' | 'zone' | 'city' | 'localzone';
type Title = 'president' | 'vice_president' | 'secretary' | 'treasurer' | 'member';
interface Committee { id: string; level: Level; name: string; countryId?: string; zoneId?: string; cityId?: string; countryIds?: string[]; zoneIds?: string[]; cityIds?: string[]; localZoneIds?: string[]; members: { userId: string; title: Title }[]; memberIds: string[]; permissions: string[] }

const TITLES: [Title, string][] = [['president', 'President'], ['vice_president', 'Vice-president'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer'], ['member', 'Member']];
const TITLE = Object.fromEntries(TITLES) as Record<Title, string>;
const areasOf = (c: Committee): string[] => (c.level === 'country' ? c.countryIds ?? (c.countryId ? [c.countryId] : []) : c.level === 'zone' ? c.zoneIds ?? (c.zoneId ? [c.zoneId] : []) : c.level === 'city' ? c.cityIds ?? (c.cityId ? [c.cityId] : []) : c.level === 'localzone' ? c.localZoneIds ?? [] : []);
const NOUN: Record<Level, string> = { organisation: 'organisation', country: 'countries', zone: 'zones', city: 'cities', localzone: 'local city zones' };
interface Area { id: string; name: string; sub: string; country: string; zoneId?: string; cityId?: string }
const SECTIONS: [string, string][] = [['groups', 'Kurels and structure'], ['members', 'Members'], ['events', 'Events and rehearsals'], ['requests', 'Requests and welfare'], ['donations', 'Finance'], ['reports', 'Attendance reports'], ['content', 'Content and curriculum'], ['logistics', 'Logistics']];
const ONE: Record<Level, string> = { organisation: 'organisation', country: 'country', zone: 'zone', city: 'city', localzone: 'local city zone' };
const LV_ICON: Record<Level, string> = { organisation: '🏢', country: '🚩', zone: '📍', city: '🏙️', localzone: '🗺️' };
const LEVELS: { key: Level; n: number; title: string; what: string; tone: string }[] = [
  { key: 'organisation', n: 1, title: 'Organisation Management Committee', what: 'The whole organisation. Sees and manages everything.', tone: 'g' },
  { key: 'country', n: 2, title: 'Country Management Team', what: 'One or several countries, with their zones, cities and kurels.', tone: 'b' },
  { key: 'zone', n: 3, title: 'Zone Management Committee', what: 'One or several zones, with their cities and kurels.', tone: 'y' },
  { key: 'city', n: 4, title: 'City Management Team', what: 'One or several cities, with their kurels.', tone: 'p' },
  { key: 'localzone', n: 5, title: 'Local City Zone Team', what: 'One or several local zones inside a city, with their kurels.', tone: 't' },
];


interface Item { id: string; name: string; sub: string }
type Kind = 'zones' | 'cities' | 'localZones' | 'kurels';
const KIND_LABEL: Record<Kind, [string, string]> = { zones: ['zone', 'zones'], cities: ['city', 'cities'], localZones: ['local city zone', 'local city zones'], kurels: ['kurel', 'kurels'] };
const KINDS_OF: Record<Level, Kind[]> = { organisation: [], country: ['zones', 'cities', 'localZones', 'kurels'], zone: ['cities', 'localZones', 'kurels'], city: ['localZones', 'kurels'], localzone: ['kurels'] };

/** The real geography under any country, zone, city or local city zone: how many of each, and which ones. */
function useGeo() {
  const { countries, cities, activeLeafGroups, byId } = useGroupHierarchy();
  const zones = useZones();
  const lzRaw = useCollection<{ name: string; cityId: string; zoneId?: string; countryId?: string; active?: boolean }>('localZones', []);
  return useMemo(() => {
    const zoneList = zones ?? [];
    const lz = (lzRaw ?? []).filter((z) => byId[z.cityId]?.status === 'active');
    const zoneName = (id?: string) => zoneList.find((z) => z.id === id)?.name ?? '';
    const lzName = (id?: string) => lz.find((z) => z.id === id)?.name ?? '';
    const kByCity = new Map<string, typeof activeLeafGroups>();
    activeLeafGroups.forEach((g) => kByCity.set(g.parentGroupId ?? '', [...(kByCity.get(g.parentGroupId ?? '') ?? []), g]));
    const kCount = (cityId: string) => kByCity.get(cityId)?.length ?? 0;
    const asZone = (z: (typeof zoneList)[number]): Item => ({ id: z.id, name: z.name, sub: `${byId[z.countryId]?.name ?? ''} · ${cities.filter((c) => c.zoneId === z.id).length} cities` });
    const asCity = (c: (typeof cities)[number]): Item => ({ id: c.id, name: c.name, sub: [byId[c.parentGroupId ?? '']?.name, zoneName(c.zoneId), `${kCount(c.id)} kurels`].filter(Boolean).join(' · ') });
    const asLz = (z: (typeof lz)[number] & { id: string }): Item => ({ id: z.id, name: z.name, sub: [byId[z.cityId]?.name, `${activeLeafGroups.filter((g) => g.localZoneId === z.id).length} kurels`].filter(Boolean).join(' · ') });
    const asKurel = (g: (typeof activeLeafGroups)[number]): Item => ({ id: g.id, name: g.name, sub: [byId[g.parentGroupId ?? '']?.name, lzName(g.localZoneId)].filter(Boolean).join(' · ') });
    const lzOf = lz as (typeof lz[number] & { id: string })[];
    /** Everything under the given areas of one level, without duplicates. */
    function under(level: Level, ids: string[]): Record<Kind, Item[]> {
      const set = new Set(ids);
      const cs = level === 'country' ? cities.filter((c) => set.has(c.parentGroupId ?? '')) : level === 'zone' ? cities.filter((c) => set.has(c.zoneId ?? '')) : level === 'city' ? cities.filter((c) => set.has(c.id)) : [];
      const cityIds = new Set(cs.map((c) => c.id));
      const zs = level === 'country' ? zoneList.filter((z) => set.has(z.countryId)) : [];
      const ls = level === 'localzone' ? lzOf.filter((z) => set.has(z.id)) : lzOf.filter((z) => cityIds.has(z.cityId));
      const ks = level === 'localzone' ? activeLeafGroups.filter((g) => set.has(g.localZoneId ?? '')) : activeLeafGroups.filter((g) => cityIds.has(g.parentGroupId ?? ''));
      return { zones: zs.map(asZone), cities: cs.map(asCity), localZones: ls.map(asLz), kurels: ks.map(asKurel) };
    }
    return { under, countries, cities, zones: zoneList, localZones: lzOf };
  }, [zones, lzRaw, cities, activeLeafGroups, byId, countries]);
}
type Geo = ReturnType<typeof useGeo>;

/** The raw numbers for a set of areas, each one a button that opens the full list. */
function Stats({ geo, level, ids, title, compact }: { geo: Geo; level: Level; ids: string[]; title: string; compact?: boolean }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [q, setQ] = useState('');
  const data = useMemo(() => geo.under(level, ids), [geo, level, ids]);
  const kinds = KINDS_OF[level];
  if (kinds.length === 0) return null;
  const list = open ? data[open].filter((x) => !q.trim() || `${x.name} ${x.sub}`.toLowerCase().includes(q.trim().toLowerCase())) : [];
  return (
    <>
      <div className={`gs-row${compact ? ' sm' : ''}`}>
        {kinds.map((k) => (
          <button type="button" key={k} className={`gs ${k}`} disabled={ids.length === 0} onClick={(e) => { e.stopPropagation(); setQ(''); setOpen(k); }}>
            <b>{data[k].length}</b><span>{KIND_LABEL[k][data[k].length === 1 ? 0 : 1]}</span>
          </button>
        ))}
      </div>
      {open && (
        <Shell title={`${title} · ${data[open].length} ${KIND_LABEL[open][data[open].length === 1 ? 0 : 1]}`} sub={ids.length > 1 ? `Across ${ids.length} ${NOUN[level]}` : `Inside this ${ONE[level]}`} onClose={() => setOpen(null)} footer={<button type="button" className="fm-ghost" onClick={() => setOpen(null)}>{tx("Close")}</button>}>
          <input className="gs-q" type="search" placeholder={tx("Search the list")} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="gs-list">{list.map((x) => <li key={x.id}><b>{x.name}</b><small>{x.sub}</small></li>)}{list.length === 0 && <li className="cm-nobody">{tx("Nothing to show.")}</li>}</ul>
        </Shell>
      )}
    </>
  );
}

/** The management structure. Only the Organisation Committee creates committees and chooses who sits in them. */
export default function Committees() {
  const { countries, cities, byId } = useGroupHierarchy();
  const zones = useZones();
  const geo = useGeo();
  const { scope } = useMyScope();
  const canManage = !scope || scope.role === 'super_admin';
  const rows = useCollection<Committee>('managementCommittees', []);
  const [level, setLevel] = useState<Level>('organisation');
  const [q, setQ] = useState('');
  const [fCountry, setFCountry] = useState('');
  const [fCity, setFCity] = useState('');
  const [fZone, setFZone] = useState('');
  const [edit, setEdit] = useState<null | { committee?: Committee; level: Level; preset?: string[]; step?: number }>(null);
  const [assign, setAssign] = useState<null | { level: Level; area: Area }>(null);
  async function addArea(team: Committee, areaId: string) {
    try {
      await saveCommittee({ id: team.id, name: team.name, permissions: team.permissions, areaIds: [...areasOf(team), areaId] });
      notify('Added to the team', 'success');
      setAssign(null);
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
  }

  const all = useMemo(() => rows ?? [], [rows]);
  const people = useUserProfiles(useMemo(() => all.flatMap((c) => c.memberIds ?? []), [all]));
  const find = (lv: Level) => all.find((c) => c.level === lv);
  const teamsOf = (lv: Level) => all.filter((c) => c.level === lv).sort((x, y) => x.name.localeCompare(y.name));
  const areasFor = (lv: Level): Area[] => {
    if (lv === 'country') return countries.map((c) => ({ id: c.id, name: c.name, sub: `${cities.filter((x) => x.parentGroupId === c.id).length} cities`, country: c.id }));
    if (lv === 'zone') return (zones ?? []).map((z) => ({ id: z.id, name: z.name, sub: byId[z.countryId]?.name ?? '', country: z.countryId, zoneId: z.id }));
    if (lv === 'city') return cities.map((c) => ({ id: c.id, name: c.name, sub: byId[c.parentGroupId ?? '']?.name ?? '', country: c.parentGroupId ?? '', zoneId: c.zoneId, cityId: c.id }));
    if (lv === 'localzone') return geo.localZones.map((z) => ({ id: z.id, name: z.name, sub: byId[z.cityId]?.name ?? '', country: byId[z.cityId]?.parentGroupId ?? '', zoneId: byId[z.cityId]?.zoneId, cityId: z.cityId }));
    return [];
  };
  const covered = (lv: Level) => new Set(teamsOf(lv).flatMap(areasOf));


  const [prof, setProf] = useState<string | null>(null);
  const [mlist, setMlist] = useState<Committee | null>(null);
  const mpeople = useUserProfiles(mlist ? mlist.memberIds : []);

  function Faces({ c }: { c: Committee }) {
    const pres = c.members.find((m) => m.title === 'president');
    return (
      <div className="cm-who">
        <button type="button" className="cm-stack cm-btn" title={tx("See the members")} onClick={() => setMlist(c)}>{c.memberIds.slice(0, 5).map((u) => <Avatar key={u} name={people[u]?.name || '…'} photoUrl={people[u]?.photoUrl} size={28} />)}</button>
        <span><button type="button" className="cm-link cm-count" onClick={() => setMlist(c)}>{c.memberIds.length} {tx("member")}{c.memberIds.length === 1 ? '' : 's'} ›</button><small>{pres ? <>{tx("President:")} <button type="button" className="cm-link" onClick={() => setProf(pres.userId)}>{people[pres.userId]?.name ?? '…'}</button></> : tx("No president yet")}</small></span>
      </div>
    );
  }

  const tier = LEVELS.find((l) => l.key === level)!;
  return (
    <div className="px px-index cm">
      <div className="content">
        <div className="section-head">
          <div>
            <h1>{tx("Management committees")}</h1>
            <p>{tx("Five levels, each with its own area. A team sees and manages only its own country, zone, city or kurels, and nothing outside it. The server checks this on every action.")}</p>
          </div>
        </div>

        {prof && <MemberProfileDialog userId={prof} onClose={() => setProf(null)} />}
        {mlist && (
          <Shell title={`${mlist.name} · members`} sub={`${mlist.memberIds.length} member${mlist.memberIds.length === 1 ? '' : 's'} · tap a name to see the profile`} onClose={() => setMlist(null)} footer={<button type="button" className="fm-go" onClick={() => setMlist(null)}>{tx("Close")}</button>}>
            <ul className="cm-mlist">
              {[...mlist.members].sort((a, b) => (a.title === 'president' ? -1 : 0) - (b.title === 'president' ? -1 : 0)).map((m) => (
                <li key={m.userId}><button type="button" onClick={() => setProf(m.userId)}><Avatar name={mpeople[m.userId]?.name || '…'} photoUrl={mpeople[m.userId]?.photoUrl} size={40} /><span><b>{mpeople[m.userId]?.name || '…'}</b><small>{TITLE[m.title] ?? m.title}</small></span><u>{tx("Profile ›")}</u></button></li>
              ))}
            </ul>
          </Shell>
        )}
        <div className="cm2-tiers">
          {LEVELS.map((l) => (
            <button type="button" key={l.key} className={`cm2-t ${l.tone}${level === l.key ? ' on' : ''}`} onClick={() => { setLevel(l.key); setQ(''); setFCountry(''); setFCity(''); setFZone(''); }}>
              <span className="cm2-ic" aria-hidden>{LV_ICON[l.key]}</span>
              <span className="cm2-tt">
                <b><i>{l.n}</i>{tx(l.title)}</b>
                <small>{tx(l.what)}</small>
                <em>{l.key === 'organisation' ? (find('organisation') ? `${find('organisation')?.memberIds.length ?? 0} ${tx("members")}` : tx("Not created")) : txf(teamsOf(l.key).length === 1 ? "{n} team · {c} / {t} covered" : "{n} teams · {c} / {t} covered", { n: teamsOf(l.key).length, c: covered(l.key).size, t: areasFor(l.key).length })}</em>
              </span>
              <span className="cm2-go" aria-hidden>→</span>
            </button>
          ))}
        </div>

        <section className={`cm-panel ${tier.tone}`}>
          <header className="cm2-ph"><span className="cm2-pi" aria-hidden>👥</span><div><h2>{tx(tier.title)}</h2><p>{tx(tier.what)}</p></div>{canManage && level !== 'organisation' && <button type="button" className="cm2-create" onClick={() => setEdit({ level })}><i>＋</i>{tx("Create a team")}</button>}</header>

          {level === 'organisation' && (() => {
            const c = find('organisation');
            return (
              <div className="cm-one">
                {c ? <Faces c={c} /> : <p className="cm-empty">{tx("The Organisation Committee does not exist yet. Create it and add its members: they get access to everything.")}</p>}
                {canManage && <button type="button" className="fm-go" onClick={() => setEdit({ committee: c, level: 'organisation' })}>{c ? tx("Manage the committee") : tx("Create the committee")}</button>}
              </div>
            );
          })()}

          {(level === 'country' || level === 'zone' || level === 'city' || level === 'localzone') && (() => {
            const touches = (t: Committee) => {
              const as = areasOf(t).map((id) => areasFor(level).find((x) => x.id === id)).filter(Boolean) as Area[];
              const cityObj = fCity ? byId[fCity] : undefined;
              const zoneObj = fZone ? (zones ?? []).find((z) => z.id === fZone) : undefined;
              if (fCountry && !as.some((a) => a.country === fCountry)) return false;
              if (fCity && !as.some((a) => (level === 'country' ? a.id === cityObj?.parentGroupId : level === 'zone' ? a.id === cityObj?.zoneId : a.cityId === fCity))) return false;
              if (fZone && !as.some((a) => (level === 'country' ? a.id === zoneObj?.countryId : a.zoneId === fZone))) return false;
              return true;
            };
            const teams = teamsOf(level).filter(touches).filter((t) => !q.trim() || `${t.name} ${areasOf(t).map((id) => areasFor(level).find((x) => x.id === id)?.name ?? '').join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
            const every = areasFor(level);
            const cov = covered(level);
            const free = every.filter((x) => !cov.has(x.id));
            return (
              <>
                <div className="cm2-bar">
                  <label className="og-search cm2-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><input type="search" placeholder={tx("Team or area name")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
                  <Dropdown label={tx("Country")} value={fCountry} onChange={(v) => { setFCountry(v); setFCity(''); setFZone(''); }} allLabel={tx("All countries")} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
                  <Dropdown label={tx("City")} value={fCity} onChange={setFCity} allLabel={tx("All cities")} options={cities.filter((c) => !fCountry || c.parentGroupId === fCountry).map((c) => ({ value: c.id, label: c.name }))} />
                  <Dropdown label={tx("Zone")} value={fZone} onChange={setFZone} allLabel={tx("All zones")} options={(zones ?? []).filter((z) => !fCountry || z.countryId === fCountry).map((z) => ({ value: z.id, label: z.name }))} />
                  <button type="button" className="cm2-reset" onClick={() => { setQ(''); setFCountry(''); setFCity(''); setFZone(''); }}>↺ {tx("Reset")}</button>
                </div>
                <div className="cm2-body">
                <div className="cm-grid tm-grid">
                  {teams.map((c) => {
                    const ids = areasOf(c);
                    const nameOf = (id: string) => every.find((x) => x.id === id)?.name ?? id;
                    return (
                      <article key={c.id} className="cm-card has cm2-card" role="button" tabIndex={0} title={tx("Click to manage this team")} onClick={() => canManage && setEdit({ committee: c, level })} onKeyDown={(e) => { if (e.key === 'Enter' && canManage) setEdit({ committee: c, level }); }}>
                        <header><span className="cm2-gi" aria-hidden>👥</span><b>{c.name}</b><span className="kt-st ok">{tx("Active")}</span></header>
                        <strong className="cm2-n">{ids.length} {ids.length === 1 ? tx(ONE[level]) : tx(NOUN[level])}</strong>
                        <div onClick={(e) => e.stopPropagation()}><Faces c={c} /></div>
                        <div className="tm-areas">{ids.slice(0, 8).map((id) => <i key={id} className="cm2-chip" onClick={(e) => { e.stopPropagation(); if (canManage) setEdit({ committee: c, level, step: 2 }); }}>{level === 'country' && <CountryFlag name={nameOf(id)} size={16} />}{nameOf(id)}</i>)}{ids.length > 8 && <i className="more">+{ids.length - 8} {tx("more")}</i>}{ids.length === 0 && <em>{tx("No area yet. Open the team to give it some.")}</em>}</div>
                        {ids.length > 0 && <Stats geo={geo} level={level} ids={ids} title={c.name} compact />}
                        <ul className="cm2-secs">{c.permissions.map((p) => <li key={p} onClick={(e) => { e.stopPropagation(); if (canManage) setEdit({ committee: c, level, step: 3 }); }}><span>{SECTIONS.find(([k]) => k === p)?.[1] ?? p}</span><i>›</i></li>)}</ul>
                        {canManage && <button type="button" className="cm2-manage" onClick={(e) => { e.stopPropagation(); setEdit({ committee: c, level }); }}>👥 {tx("Manage the team")}</button>}
                      </article>
                    );
                  })}
                  {teams.length === 0 && <p className="cm-empty">{teamsOf(level).length === 0 ? `No team yet. Create a team first, then give it the ${NOUN[level]} it manages.` : tx("No team matches.")}</p>}
                </div>
                <section className="tm-free cm2-free">
                  <h3>{free.length === 0 ? `Every ${ONE[level]} has a team` : `Without a team (${free.length})`}</h3>
                  {free.length > 0 && <div className="tm-chips">{free.slice(0, 80).map((x) => <button type="button" key={x.id} disabled={!canManage} onClick={() => setAssign({ level, area: x })}>{x.name}{x.sub && <small> · {x.sub}</small>}</button>)}{free.length > 80 && <em>+{free.length - 80} {tx("more. Search inside a team to add them.")}</em>}</div>}
                  {free.length > 0 && canManage && <p className="fm-note">{tx("Click one to start a new team with it, or open a team and add it there.")}</p>}
                </section>
                </div>
              </>
            );
          })()}
        </section>
      </div>
      {assign && (
        <Shell title={`${tx("Assign")} ${assign.area.name}`} sub={assign.area.sub} onClose={() => setAssign(null)} footer={<button type="button" className="fm-ghost" onClick={() => setAssign(null)}>{tx("Cancel")}</button>}>
          <div className="cm2-assign">
            {teamsOf(assign.level).map((t) => <button type="button" key={t.id} onClick={() => addArea(t, assign.area.id)}><b>{tx("Add to")} {t.name}</b><small>{areasOf(t).length} {tx(NOUN[assign.level])}</small></button>)}
            <button type="button" className="new" onClick={() => { const a = assign; setAssign(null); setEdit({ level: a.level, preset: [a.area.id] }); }}><b>＋ {tx("Create a new team with it")}</b><small>{tx("Name it, then choose its members.")}</small></button>
          </div>
        </Shell>
      )}
      {edit && <Editor {...edit} people={people} all={all} areas={areasFor(edit.level)} geo={geo} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Editor({ committee, level, preset, step: step0, people, all, areas, geo, onClose }: { committee?: Committee; level: Level; preset?: string[]; step?: number; people: Record<string, { name: string; photoUrl: string }>; all: Committee[]; areas: Area[]; geo: Geo; onClose: () => void }) {
  const order = level === 'organisation' ? [4] : [1, 2, 3, 4];
  const [step, setStep] = useState<number>(level === 'organisation' ? 4 : committee ? (step0 ?? 1) : preset?.length ? 1 : 1);
  const [name, setName] = useState(committee?.name ?? '');
  const [picked, setPicked] = useState<string[]>(committee ? areasOf(committee) : preset ?? []);
  const takenBy = useMemo(() => { const m: Record<string, string> = {}; all.filter((c) => c.level === level && c.id !== committee?.id).forEach((c) => areasOf(c).forEach((id) => { m[id] = c.name; })); return m; }, [all, level, committee]);
  const [members, setMembers] = useState<{ userId: string; title: Title }[]>(committee?.members ?? []);
  const [perms, setPerms] = useState<string[]>(committee?.permissions ?? (level === 'organisation' ? [] : SECTIONS.map(([k]) => k)));
  const [adding, setAdding] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [known, setKnown] = useState<Record<string, { name: string; photoUrl?: string }>>({});
  const profiles = useUserProfiles(members.map((m) => m.userId));
  const who = (id: string) => known[id] ?? profiles[id] ?? people[id];

  async function save() {
    setErr('');
    setBusy(true);
    try {
      let id = committee?.id;
      if (level !== 'organisation' && !name.trim()) throw new Error('Give the team a name.');
      if (!id) {
        const r = await saveCommittee({ level, name: name.trim(), permissions: perms, areaIds: picked });
        id = r.data.id;
      } else if (level !== 'organisation') {
        await saveCommittee({ id, name: name.trim(), permissions: perms, areaIds: picked });
      }
      await setCommitteeMembers({ id, members });
      notify('Committee saved. Members see the change the next time they sign in or refresh.', 'success');
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx("Could not save"));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!committee || !confirm(tx("Delete this committee? Its members lose the access it gave them."))) return;
    setBusy(true);
    try {
      await deleteCommittee({ id: committee.id });
      notify('Committee deleted', 'success');
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx("Could not delete"));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fm" role="dialog" aria-modal="true" aria-label={tx("Committee")}>
        <header><div><h2>{committee ? committee.name : level === 'organisation' ? tx("Organisation Management Committee") : tx("Create a team")}</h2><p>{level === 'organisation' ? tx("Members of this committee have access to all the data.") : `Members see and manage only the ${NOUN[level]} chosen below, with everything inside them.`}</p></div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        {level !== 'organisation' && (
          <ol className="cm2-steps">
            {order.map((n) => <li key={n}><button type="button" className={`${step === n ? 'on' : ''}${n < step ? ' done' : ''}`} onClick={() => { if (n > 1 && !name.trim()) { setErr(tx("Give the team a name.")); setStep(1); return; } setErr(''); setStep(n); }}><i>{n < step ? '✓' : n}</i>{[tx("Team"), tx("Areas"), tx("Sections"), tx("Members")][n - 1]}</button></li>)}
          </ol>
        )}
        <div className="fm-body">
          {level !== 'organisation' && step === 1 && (
            <section className="fm-sec">
              <h3>{tx("1 · The team")}</h3>
              <label className="fm-f">{tx("Team name")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={level === 'country' ? tx("For example: West Africa team") : level === 'zone' ? tx("For example: North zones team") : level === 'city' ? tx("For example: Dakar and Thiès team") : tx("For example: Dakar centre team")} /></label>
            </section>
          )}
          {level !== 'organisation' && step === 2 && (
            <section className="fm-sec">
              <h3>2 · {NOUN[level].replace(/^./, (c) => c.toUpperCase())} {tx("it manages")} <small>({picked.length})</small></h3>
              <AreaPicker areas={areas} picked={picked} onChange={setPicked} takenBy={takenBy} noun={NOUN[level]} level={level} geo={geo} withCountry={level !== 'country'} />
            </section>
          )}
          {level !== 'organisation' && step === 3 && (
            <section className="fm-sec">
              <h3>{tx("3 · Sections they can use")}</h3>
              <div className="cm-pills">{SECTIONS.map(([k, l]) => <button type="button" key={k} className={perms.includes(k) ? 'on' : ''} onClick={() => setPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>{l}</button>)}</div>
            </section>
          )}
          {step === 4 && <section className="fm-sec">
            <div className="cm-mh"><h3>{level === 'organisation' ? '' : '4 · '}{tx("Members")} <small>({members.length})</small></h3><button type="button" className="kt-btn" onClick={() => setAdding((v) => !v)}>{adding ? tx("Close the list") : tx("+ Add a person")}</button></div>
            {adding && <MemberPicker key={pickerKey} value={[]} onChange={(ids, picked) => { const id = ids[0]; if (!id || members.some((m) => m.userId === id)) return; const p = picked[0]; if (p) setKnown((k) => ({ ...k, [id]: { name: p.name, photoUrl: p.photoUrl } })); setMembers((m) => [...m, { userId: id, title: m.length === 0 ? 'president' : 'member' }]); setPickerKey((n) => n + 1); setAdding(false); }} />}
            <ul className="cm-members">
              {members.map((m) => (
                <li key={m.userId}>
                  <Avatar name={who(m.userId)?.name || '…'} photoUrl={who(m.userId)?.photoUrl} size={40} />
                  <span className="cm-mn"><b>{who(m.userId)?.name || '…'}</b><small>{TITLE[m.title] ?? m.title}</small></span>
                  <Dropdown label={tx("Title")} value={m.title} onChange={(v) => setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, title: v as Title } : x)))} options={TITLES.map(([k, l]) => ({ value: k, label: l }))} />
                  <button type="button" className="cm-x" aria-label={tx("Remove")} title={tx("Remove from the team")} onClick={() => setMembers((list) => list.filter((x) => x.userId !== m.userId))}>×</button>
                </li>
              ))}
              {members.length === 0 && <li className="cm-nobody">{tx("Nobody yet. Add the people who will manage this")} {level === 'organisation' ? tx("organisation") : tx("team")}.</li>}
            </ul>
            <p className="fm-note">{members.filter((m) => m.title === 'president').length === 0 && members.length > 0 ? tx("Tip: choose a president. ") : ''}{tx("At most 40 people.")} {TITLE.president} {tx("is one person.")}</p>
          </section>}
        </div>
        <footer>{err && <span className="fm-err">{err}</span>}
          {committee && level !== 'organisation' && <button type="button" className="fm-ghost" style={{ color: '#a02820', borderColor: '#e3a39d' }} onClick={remove} disabled={busy}>{tx("Delete")}</button>}
          {level !== 'organisation' && step > 1 && <button type="button" className="fm-ghost" onClick={() => setStep(step - 1)}>← {tx("Back")}</button>}
          <button type="button" className="fm-ghost" onClick={onClose}>{tx("Cancel")}</button>
          {level !== 'organisation' && step < 4 && <button type="button" className="fm-go" onClick={() => { if (step === 1 && !name.trim()) { setErr(tx("Give the team a name.")); return; } setErr(''); setStep(step + 1); }}>{tx("Next")} →</button>}
          {(level === 'organisation' || step === 4 || committee) && <button type="button" className="fm-go" disabled={busy || (level !== 'organisation' && (perms.length === 0 || !name.trim()))} onClick={save}>{busy ? tx("Saving…") : committee ? tx("Save") : tx("Create the team")}</button>}
        </footer>
      </div>
    </div>,
    document.body
  );
}

/** Pick the areas (countries, zones or cities) a team manages. Areas that belong to another team are shown but locked. */
function AreaPicker({ areas, picked, onChange, takenBy, noun, level, geo, withCountry }: { areas: Area[]; picked: string[]; onChange: (v: string[]) => void; takenBy: Record<string, string>; noun: string; level: Level; geo: Geo; withCountry: boolean }) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('');
  const set = new Set(picked);
  const countryNames = useGroupHierarchy().byId;
  const rows = areas.filter((a) => (!only || a.country === only) && (!q.trim() || `${a.name} ${a.sub}`.toLowerCase().includes(q.trim().toLowerCase())));
  const free = rows.filter((a) => !takenBy[a.id]);
  const toggle = (id: string) => onChange(set.has(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="tm-pick">
      <div className="tm-sum">
        <div><b>{picked.length}</b><span>{picked.length === 1 ? ONE[level] : noun} {tx("selected")}</span></div>
        {picked.length > 0 ? <Stats geo={geo} level={level} ids={picked} title={tx("Your selection")} /> : <p>{tx("Tick the")} {noun} {tx("below to see how many zones, cities, local city zones and kurels this team will manage.")}</p>}
      </div>
      <div className="tm-pick-bar">
        <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("Name")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {withCountry && <Dropdown label={tx("Country")} value={only} onChange={setOnly} allLabel="All countries" options={[...new Set(areas.map((a) => a.country))].filter(Boolean).map((id) => ({ value: id, label: countryNames[id]?.name ?? id }))} />}
      </div>
      <div className="tm-pick-act"><button type="button" onClick={() => onChange([...new Set([...picked, ...free.map((a) => a.id)])])}>{tx("Select all shown (")}{free.length})</button><button type="button" onClick={() => onChange([])} disabled={picked.length === 0}>{tx("Clear")}</button></div>
      <ul className="tm-pick-list">
        {rows.map((a) => {
          const by = takenBy[a.id];
          return (
            <li key={a.id} className={`${set.has(a.id) ? 'on' : ''}${by ? ' off' : ''}`}>
              <button type="button" className="tm-row" disabled={!!by} onClick={() => toggle(a.id)}><span className="tm-box">{set.has(a.id) ? '✓' : ''}</span><span><b>{a.name}</b><small>{by ? `Already in “${by}”` : a.sub}</small></span></button>
              <Stats geo={geo} level={level} ids={[a.id]} title={a.name} compact />
            </li>
          );
        })}
        {rows.length === 0 && <li className="cm-nobody">{tx("No")} {noun} {tx("match.")}</li>}
      </ul>
    </div>
  );
}

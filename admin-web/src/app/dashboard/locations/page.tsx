'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { createGroup, archiveGroup, deleteGroup, createZone, updateZone, deleteZone, setCityGeo, applyDefaultTimeZones, saveLocalZone } from '@/lib/functions';
import BoundaryDialog from '@/components/BoundaryDialog';
import type { FenceShape } from '@/app/dashboard/geofence/GeofenceMap';
import { TIME_ZONES } from '@/lib/timeZones';
import FormDialog from '@/components/FormDialog';
import Dropdown from '@/components/Dropdown';
import LocationSheet from './LocationSheet';
import { useRouter } from 'next/navigation';
import WorldMap from '@/components/WorldMap';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { ACCESS_ROLE_LABEL } from '@/components/AccessDialog';
import { useUserProfiles } from '@/lib/useUserNames';
import { CONTINENTS, geoOf, type Continent } from '@/lib/worldGeo';
import { zoneStyle, hashIx } from '@/lib/zoneColor';
import { CountryFlag, CountryName } from '@/components/CountryFlag';
import { flagUrl } from '@/lib/flags';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

interface ScopeDoc { role: string; countryIds?: string[]; zoneIds?: string[]; cityIds?: string[]; groupIds?: string[] }
interface Zone { name: string; countryId: string; status: 'active' | 'archived' }

const norm = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Countries, zones and cities in one place: every country with its zones and its cities underneath. */
export default function LocationsPage() {
  const { byId, mainGroups, countries, cities, groups, loading } = useGroupHierarchy();
  const localZones = useCollection<{ cityId: string }>('localZones', []);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const zones = useCollection<Zone>('zones', [orderBy('name')]);
  const [dialog, setDialog] = useState<null | 'country' | 'city' | 'zone'>(null);
  const [forCountry, setForCountry] = useState('');
  const [lzCity, setLzCity] = useState('');
  const fences = useCollection<FenceShape & { localZoneId?: string }>('geofences', []);
  /** Chains the creation flow: country, then its first city, then the local zones of that city. */
  const later = (fn: () => void) => { setTimeout(fn, 80); };
  const [search, setSearch] = useState('');
  const mainId = mainGroups[0]?.id;
  const [continent, setContinent] = useState<'' | Continent>('');
  /** What is shown on the map: a country or a city. */
  const [sel, setSel] = useState<{ kind: 'country' | 'city'; id: string } | null>(null);
  const [sheet, setSheet] = useState(false);
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const scopes = useCollection<ScopeDoc>('adminScopes', []);
  const showOnMap = (kind: 'country' | 'city', id: string) => { setSel({ kind, id }); mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      notify(ok, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  }

  /** Deletes a place. If kurels or cities are still under it, the admin is asked before they are deleted together with it. */
  async function removePlace(id: string, name: string) {
    try {
      await deleteGroup({ groupId: id });
      notify('Deleted', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const m = /HAS_CHILDREN\|(.*)$/.exec(msg);
      if (!m) { notify(msg || 'Could not delete', 'error'); return; }
      if (!confirm(`${m[1]}\n\nDelete "${name}" together with everything under it? This cannot be undone. It only works when no kurel below has members.`)) return;
      try {
        await deleteGroup({ groupId: id, cascade: true });
        notify('Deleted with everything under it', 'success');
      } catch (e2) {
        notify(e2 instanceof Error ? e2.message : 'Could not delete', 'error');
      }
    }
  }

  const q = norm(search);
  const kurelsOf = (cityId: string) => groups.filter((g) => g.type === 'group' && g.status === 'active' && g.parentGroupId === cityId).length;
  const lzOf = (cityId: string) => (localZones ?? []).filter((z) => z.cityId === cityId).length;
  const cityMatch = (x: (typeof cities)[number]) => (sel?.kind !== 'city' || x.id === sel.id) && (!q || norm(x.name).includes(q)) && (filter !== 'nozone' || !x.zoneId) && (filter !== 'notz' || !x.timeZone);
  const selCity = sel?.kind === 'city' ? byId[sel.id] : undefined;
  const selCountryId = sel?.kind === 'country' ? sel.id : selCity?.parentGroupId ?? '';
  const selCountry = selCountryId ? byId[selCountryId] : undefined;
  const shown = countries
    .filter((c) => (!q && !filter) || norm(c.name).includes(q) && !filter || cities.some((x) => x.parentGroupId === c.id && cityMatch(x)))
    .filter((c) => !continent || geoOf(c.name)?.continent === continent)
    .filter((c) => !selCountryId || c.id === selCountryId);
  const kurelsInCountry = (cid: string) => cities.filter((x) => x.parentGroupId === cid).reduce((n, x) => n + kurelsOf(x.id), 0);
  const markers = countries.flatMap((c) => { const g = geoOf(c.name); return g && (!continent || g.continent === continent) ? [{ id: c.id, name: c.name, lat: g.lat, lng: g.lng, weight: Math.max(1, kurelsInCountry(c.id)) }] : []; });
  const continentsPresent = CONTINENTS.map((k) => ({ ...k, n: countries.filter((c) => geoOf(c.name)?.continent === k.key).length })).filter((k) => k.n > 0);
  /** Who is responsible for the chosen place: country managers and zone managers, and the managers of the city. */
  type Resp = { userId: string; role: string; where: string; level: 'country' | 'city' };
  const responsibleAll = useMemo(() => {
    if (!sel || !selCountry) return [] as Resp[];
    const out: Resp[] = [];
    const myZones = (zones ?? []).filter((z) => z.countryId === selCountry.id).map((z) => z.id);
    (scopes ?? []).forEach((sc) => {
      const userId = (sc as unknown as { id: string }).id;
      if (sc.role === 'super_admin') return;
      const countryWide = !!sc.countryIds?.includes(selCountry.id);
      const zoneWide = !!sc.zoneIds?.some((z) => myZones.includes(z));
      if (countryWide || zoneWide) { out.push({ userId, role: sc.role, where: selCountry.name, level: 'country' }); return; }
      if (sel.kind === 'city') {
        if (sc.cityIds?.includes(sel.id)) out.push({ userId, role: sc.role, where: selCity?.name ?? '', level: 'city' });
      } else if (sc.cityIds?.some((id) => byId[id]?.parentGroupId === selCountry.id)) {
        out.push({ userId, role: sc.role, where: (sc.cityIds ?? []).filter((id) => byId[id]?.parentGroupId === selCountry.id).map((id) => byId[id]?.name).join(', '), level: 'city' });
      }
    });
    // A country shows its country managers first; a city shows its own managers first.
    const first = sel.kind === 'city' ? 'city' : 'country';
    return out.sort((x, y) => (x.level === first ? 0 : 1) - (y.level === first ? 0 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, scopes, zones, selCountry, selCity, byId]);
  /** What the side panel lists: for a country only its country managers (the city managers are counted and shown on the sheet). */
  const responsible = sel?.kind === 'country' ? responsibleAll.filter((r) => r.level === 'country') : responsibleAll;
  const cityManagerCount = sel?.kind === 'country' ? responsibleAll.filter((r) => r.level === 'city').length : 0;
  const profiles = useUserProfiles(responsibleAll.map((r) => r.userId));
  const totalKurels = groups.filter((g) => g.type === 'group' && g.status === 'active').length;
  const activeZones = (zones ?? []).filter((z) => z.status === 'active' && countries.some((c) => c.id === z.countryId));
  const clock = (tz?: string) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Africa/Dakar', hour: '2-digit', minute: '2-digit' }).format(new Date()); } catch { return '--:--'; } };
  const initials = (n: string) => n.trim().slice(0, 2).toUpperCase();

  return (
    <div className="loc">
      <div className="lm" ref={mapRef}>
        <div className="lm-head">
          <div>
            <span className="loc-eyebrow">{tx("Organization map")}</span>
            <h1>{tx("Locations")}</h1>
          </div>
          <div className="loc-actions">
            <button className="loc-btn ghost" onClick={() => { setForCountry(''); setDialog('country'); }}>{tx("+ Country")}</button>
            <button className="loc-btn ghost" onClick={() => { setForCountry(''); setDialog('city'); }}>{tx("+ City")}</button>
            <button className="loc-btn solid" onClick={() => { setForCountry(''); setDialog('zone'); }}>{tx("+ Zone")}</button>
          </div>
        </div>
        <div className="lm-body">
          <div className="lm-map">
            {selCountry ? (
              <div className="lm-zoom">
                <iframe title={selCity?.name ?? selCountry.name} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://www.google.com/maps?q=${encodeURIComponent(selCity ? `${selCity.name}, ${selCountry.name}` : selCountry.name)}${selCity ? '&z=11' : ''}&output=embed`} />
                <button type="button" className="lm-world" onClick={() => setSel(null)}>← {tx("World map")}</button>
                <span className="lm-zname">{selCity ? `${selCity.name} · ${selCountry.name}` : selCountry.name}</span>
              </div>
            ) : (
              <>
                <WorldMap markers={markers} activeId="" onPick={(id) => setSel({ kind: 'country', id })} />
                <small className="lm-legend"><i />{tx("Presence — one marker per country")}</small>
              </>
            )}
          </div>
          <aside className="lm-side">
            {sel && selCountry ? (
              <>
                <div className="lm-place">
                  <span>{sel.kind === 'city' ? tx("City") : tx("Country")}</span>
                  <b>{sel.kind === 'city' ? selCity?.name : <CountryName name={selCountry.name} size={22} />}</b>
                  <small>{sel.kind === 'city' ? `${selCountry.name} · ${kurelsOf(sel.id)} ${tx("kurel(s)")}` : `${cities.filter((x) => x.parentGroupId === selCountry.id).length} ${tx("cities")} · ${kurelsInCountry(selCountry.id)} ${tx("kurel(s)")}`}</small>
                  {!geoOf(selCountry.name) && <small className="lm-warn">{tx("This country is not on the map yet.")}</small>}
                </div>
                <div className="lm-resp">
                  <span className="lm-cap">{tx("Responsible")}</span>
                  {responsible.length === 0 && <p>{sel.kind === 'country' ? tx("No country manager assigned yet.") : tx("No manager assigned yet.")} <Link href="/dashboard/role-access">{tx("Assign one")}</Link></p>}
                  {responsible.map((r, i) => (
                    <div className="lm-person" key={`${r.userId}${i}`}>
                      <Avatar name={profiles[r.userId]?.name || '…'} photoUrl={profiles[r.userId]?.photoUrl} size={38} />
                      <span><PersonLink userId={r.userId}><b>{profiles[r.userId]?.name || tx("Loading…")}</b></PersonLink><small>{r.level === 'country' && r.role === 'zone_admin' ? tx("Country manager") : tx(ACCESS_ROLE_LABEL[r.role] ?? r.role)} · {r.where}</small>{profiles[r.userId]?.phone && <a href={`tel:${profiles[r.userId].phone}`}>{profiles[r.userId].phone}</a>}</span>
                    </div>
                  ))}
                </div>
                {cityManagerCount > 0 && <p className="lm-note">{cityManagerCount} {tx("city manager(s) — pick a city to see them")}</p>}
                {sel.kind === 'country' && (
                  <div className="lm-cities">
                    <span className="lm-cap">{tx("Cities")}</span>
                    <div>{cities.filter((x) => x.parentGroupId === selCountry.id).sort((a, b) => kurelsOf(b.id) - kurelsOf(a.id)).map((x) => <button type="button" key={x.id} onClick={() => setSel({ kind: 'city', id: x.id })}><b>{x.name}</b><small>{kurelsOf(x.id)} {tx("kurel(s)")}</small></button>)}</div>
                  </div>
                )}
                {sel.kind === 'city' && <button type="button" className="lm-back" onClick={() => setSel({ kind: 'country', id: selCountry.id })}>← {selCountry.name}</button>}
                <div className="lm-acts"><button type="button" className="lm-open" onClick={() => setSheet(true)}>{tx("Open the sheet")}</button><button type="button" className="lm-clear" onClick={() => setSel(null)}>{tx("Show all countries")}</button></div>
              </>
            ) : (
              <div className="lm-place"><span>{tx("Countries")}</span><b>{countries.length}</b><small>{continentsPresent.length} {tx("continents")} · {cities.length} {tx("cities")} · {totalKurels} {tx("kurel(s)")}</small><small>{tx("Select a country on the map, or press “Show on map” on any country or city, to see where it is and who is responsible.")}</small></div>
            )}
          </aside>
        </div>
        <div className="lm-tools">
          <div className="lm-pills">
          <button type="button" className={!continent ? 'on' : ''} onClick={() => setContinent('')}>{tx("All")} <em>{countries.length}</em></button>
          {continentsPresent.map((k) => <button type="button" key={k.key} className={continent === k.key ? 'on' : ''} onClick={() => { setContinent(continent === k.key ? '' : k.key); setSel(null); }}>{tx(k.label)} <em>{k.n}</em></button>)}
        </div>
          <Dropdown label={tx("Choose a country")} value={selCountry?.id ?? ''} onChange={(v) => setSel(v ? { kind: 'country', id: v } : null)} allLabel={`${tx("All countries")} · ${countries.length}`} options={countries.filter((c) => !continent || geoOf(c.name)?.continent === continent).map((c) => ({ value: c.id, label: c.name }))} className="lm-dd" />
          <Dropdown label={tx("Choose a city")} value={selCity?.id ?? ''} onChange={(v) => setSel(v ? { kind: 'city', id: v } : selCountry ? { kind: 'country', id: selCountry.id } : null)} allLabel={selCountry ? `${tx("All cities")} · ${cities.filter((x) => x.parentGroupId === selCountry.id).length}` : `${tx("All cities")} · ${cities.length}`} options={cities.filter((x) => !selCountry || x.parentGroupId === selCountry.id).map((x) => ({ value: x.id, label: selCountry ? x.name : `${x.name} · ${byId[x.parentGroupId ?? '']?.name ?? ''}` }))} className="lm-dd" />
        </div>
      </div>


      <div className="loc-kpis">
        <div><i>🌍</i><span>{tx("Countries")}</span><strong>{countries.length}</strong></div>
        <div className="gold"><i>◈</i><span>{tx("Zones")}</span><strong>{activeZones.length}</strong></div>
        <div><i>🏙</i><span>{tx("Cities")}</span><strong>{cities.length}</strong></div>
        <div className="gold"><i>📍</i><span>{tx("Local zones")}</span><strong>{(localZones ?? []).filter((z) => cities.some((c) => c.id === z.cityId)).length}</strong></div>
        <div><i>👥</i><span>{tx("Kurels")}</span><strong>{totalKurels}</strong></div>
      </div>

      <div className="loc-bar">
        <input type="search" placeholder={tx("Search a country or a city")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Dropdown label={tx("Show")} value={filter} onChange={setFilter} allLabel={tx("All cities")} options={[{ value: 'nozone', label: tx("Cities without a zone") }, { value: 'notz', label: tx("Cities without a time zone") }]} className="loc-dd" />
        <button className="loc-btn ghost" title={tx("A city with no time zone uses Senegal (Dakar)")} onClick={() => run(async () => { const r = await applyDefaultTimeZones({}); notify(`${r.data.updated} city(ies) set to Senegal`, 'info'); }, 'Done')}>{tx("Set Senegal time on cities with none")}</button>
        <Link href="/dashboard/countries" className="loc-btn ghost">{tx("Import from a file")}</Link>
      </div>

      {loading || zones === null ? <p>{tx("Loading…")}</p> : shown.length === 0 ? <section className="loc-card"><p className="fx2-empty">{countries.length === 0 ? tx("No country yet. Add the first country.") : tx("Nothing matches.")}</p></section> : <div className="loc-list">{[...shown].sort((a, b) => (cities.some((x) => x.parentGroupId === a.id) ? 0 : 1) - (cities.some((x) => x.parentGroupId === b.id) ? 0 : 1)).map((c) => {
        const cZones = zones.filter((z) => z.countryId === c.id);
        const cCities = cities.filter((x) => x.parentGroupId === c.id && cityMatch(x));
        const allCities = cities.filter((x) => x.parentGroupId === c.id);
        const folded = open[c.id] === false;
        return (
          <section className={`loc-card${allCities.length === 0 ? ' empty' : ''}`} key={c.id}>
            <div className="loc-card-head">
              {flagUrl(c.name) ? <CountryFlag name={c.name} size={50} /> : <div className="loc-badge">{initials(c.name)}</div>}
              <div className="loc-card-title">
                <h2>{c.name}</h2>
                <div className="loc-blocks">
                  <div><b>{allCities.length}</b><span>{allCities.length === 1 ? tx("city") : tx("cities")}</span></div>
                  <div><b>{cZones.filter((z) => z.status === 'active').length}</b><span>{tx("zone(s)")}</span></div>
                  <div className="gold"><b>{allCities.reduce((n, x) => n + kurelsOf(x.id), 0)}</b><span>{tx("kurel(s)")}</span></div>
                </div>
              </div>
              <div className="loc-card-actions">
                <button className="loc-btn small" onClick={() => showOnMap('country', c.id)}>{tx("📍 Show on map")}</button>
                <button className="loc-btn small" onClick={() => { setForCountry(c.id); setDialog('city'); }}>{tx("+ City")}</button>
                <button className="loc-btn small" onClick={() => { setForCountry(c.id); setDialog('zone'); }}>{tx("+ Zone")}</button>
                <button className="loc-btn small" onClick={() => confirm(`Archive ${c.name}?`) && run(() => archiveGroup({ groupId: c.id }), 'Archived')}>{tx("Archive")}</button>
                <button className="loc-btn small danger" onClick={() => confirm(`Delete ${c.name}?`) && removePlace(c.id, c.name)}>{tx("Delete")}</button>
                <button className="loc-btn small" onClick={() => setOpen({ ...open, [c.id]: folded })} aria-label={folded ? tx("Expand") : tx("Collapse")}>{folded ? '▾' : '▴'}</button>
              </div>
            </div>

            {!folded && (
              <>
                {cZones.length > 0 && (
                  <div className="loc-zones">
                    <span className="loc-label">{tx("Zones")}</span>
                    {cZones.map((z) => (
                      <span key={z.id} className={`loc-zone${z.status === 'active' ? '' : ' off'}`}>
                        {z.name} · {allCities.filter((x) => x.zoneId === z.id).length} {tx("cit")}{allCities.filter((x) => x.zoneId === z.id).length === 1 ? 'y' : tx("ies")}{z.status === 'archived' ? tx(" · archived") : ''}
                        <button type="button" onClick={() => run(() => updateZone({ zoneId: z.id, status: z.status === 'active' ? 'archived' : 'active' }), 'Zone updated')}>{z.status === 'active' ? tx("archive") : tx("restore")}</button>
                        <button type="button" className="x" onClick={() => confirm(`Delete the zone "${z.name}"? Its cities stay, without a zone.`) && run(() => deleteZone({ zoneId: z.id }), 'Zone deleted')}>{tx("delete")}</button>
                      </span>
                    ))}
                  </div>
                )}

                {cCities.length === 0 ? (allCities.length === 0 ? null : <p className="fx2-empty">{tx("No city matches.")}</p>) : (
                  <div className="loc-cities lc-flex">
                    {cCities.map((x) => (
                      <div className="lc-cell" key={x.id}><article className="zp-card lc-card" style={zoneStyle(hashIx(x.id))}>
                        <header>
                          <div className="loc-badge">{initials(x.name)}</div>
                          <div className="zp-name"><h3>{x.name}</h3><small>{c.name}</small></div>
                          <span className="zp-pill ok" title={tx("Local time now")}>{clock(x.timeZone)}</span>
                        </header>
                        <div className="loc-blocks">
                          <div><b>{kurelsOf(x.id)}</b><span>{tx("kurel(s)")}</span></div>
                          <div className="gold"><b>{lzOf(x.id)}</b><span>{tx("local zone(s)")}</span></div>
                        </div>
                        <div className="zp-dds lc-dds">
                          <Dropdown label={tx("Zone")} value={x.zoneId ?? ''} onChange={(v) => run(() => setCityGeo({ cityId: x.id, zoneId: v }), 'City updated')} allLabel={tx("No zone")} options={cZones.filter((z) => z.status === 'active').map((z) => ({ value: z.id, label: z.name }))} />
                          <Dropdown label={tx("Time zone")} value={x.timeZone ?? ''} onChange={(v) => run(() => setCityGeo({ cityId: x.id, timeZone: v }), 'Time zone saved')} allLabel={tx("Default: Senegal (Dakar)")} options={[...(x.timeZone && !TIME_ZONES.some((t) => t.value === x.timeZone) ? [{ value: x.timeZone, label: x.timeZone }] : []), ...TIME_ZONES.map((t) => ({ value: t.value, label: t.label }))]} />
                        </div>
                        <footer>
                          <button className="loc-btn small" onClick={() => showOnMap('city', x.id)}>{tx("📍 Show on map")}</button>
                          <button className="loc-btn small" onClick={() => setLzCity(x.id)}>{tx("+ Local zone")}</button>
                          <Link href="/dashboard/local-zones" className="loc-btn small">{tx("All local zones")}</Link>
                          <button className="loc-btn small" onClick={() => confirm(`Archive ${x.name}?`) && run(() => archiveGroup({ groupId: x.id }), 'Archived')}>{tx("Archive")}</button>
                          <button className="loc-btn small danger wide" onClick={() => confirm(`Delete ${x.name}?`) && removePlace(x.id, x.name)}>{tx("Delete")}</button>
                        </footer>
                      </article></div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}</div>}


      {sheet && sel && selCountry && <LocationSheet kind={sel.kind} name={sel.kind === 'city' ? selCity?.name ?? '' : selCountry.name} country={selCountry.name} kurels={sel.kind === 'city' ? kurelsOf(sel.id) : kurelsInCountry(selCountry.id)} people={responsibleAll} profiles={profiles} onClose={() => setSheet(false)} onManage={() => router.push('/dashboard/role-access')} />}

      {dialog === 'country' && (
        <FormDialog
          title={tx("Add a country")}
          submitLabel={tx("Add country")}
          onClose={() => setDialog(null)}
          fields={[{ name: 'name', label: tx("Country name"), required: true }]}
          onSubmit={async (v) => {
            if (!mainId) throw new Error('Set up the organization first (Import from a file page).');
            if (countries.some((c) => norm(c.name) === norm(v.name))) throw new Error(`The country "${v.name.trim()}" already exists.`);
            const made = await createGroup({ name: v.name.trim(), type: 'country', parentGroupId: mainId });
            notify('Country added. Next: add its first city.', 'success');
            later(() => { setForCountry((made.data as { groupId: string }).groupId); setDialog('city'); });
          }}
        />
      )}
      {dialog === 'city' && (
        <FormDialog
          title={tx("Add a city")}
          submitLabel={tx("Add city")}
          onClose={() => setDialog(null)}
          fields={[
            { name: 'countryId', label: tx("Country"), type: 'select', required: true, initial: forCountry, options: countries.map((c) => ({ value: c.id, label: c.name })) },
            { name: 'name', label: tx("City name"), required: true },
            { name: 'timeZone', label: tx("Time zone (UTC value)"), type: 'select', required: true, initial: 'Africa/Dakar', options: TIME_ZONES.map((t) => ({ value: t.value, label: t.label })), hint: tx("Events of this city are shown in this time zone.") },
            { name: 'zoneId', label: tx("Zone (optional)"), type: 'select', options: [{ value: '', label: tx("No zone") }, ...(zones ?? []).filter((z) => z.status === 'active').map((z) => ({ value: z.id, label: `${byId[z.countryId]?.name ?? ''} — ${z.name}` }))] },
            { name: 'newZone', label: tx("Or create a new zone for this city (optional)"), placeholder: tx("For example: North zone"), hint: tx("Creates the zone in the chosen country and puts the city in it.") },
          ]}
          onSubmit={async (v) => {
            if (cities.some((x) => x.parentGroupId === v.countryId && norm(x.name) === norm(v.name))) throw new Error(`The city "${v.name.trim()}" already exists in ${byId[v.countryId]?.name ?? 'this country'}.`);
            const z = (zones ?? []).find((x) => x.id === v.zoneId);
            if (v.zoneId && z && z.countryId !== v.countryId) throw new Error('This zone belongs to another country. Choose a zone of the same country.');
            const created = await createGroup({ name: v.name.trim(), type: 'city', parentGroupId: v.countryId });
            let zoneId = v.zoneId;
            if (v.newZone?.trim()) {
              const exist = (zones ?? []).find((x) => x.countryId === v.countryId && norm(x.name) === norm(v.newZone));
              zoneId = exist ? exist.id : (await createZone({ countryId: v.countryId, name: v.newZone.trim() })).data.zoneId;
            }
            const cityId = (created.data as { groupId: string }).groupId;
            await setCityGeo({ cityId, timeZone: v.timeZone, ...(zoneId ? { zoneId } : {}) });
            notify('City added. Next: draw its first local zone.', 'success');
            later(() => setLzCity(cityId));
          }}
        />
      )}
      {dialog === 'zone' && (
        <FormDialog
          title={tx("Add a zone")}
          submitLabel={tx("Add zone")}
          onClose={() => setDialog(null)}
          fields={[
            { name: 'countryId', label: tx("Country"), type: 'select', required: true, initial: forCountry, options: countries.map((c) => ({ value: c.id, label: c.name })) },
            { name: 'name', label: tx("Zone name"), required: true },
          ]}
          onSubmit={async (v) => {
            if ((zones ?? []).some((z) => z.countryId === v.countryId && norm(z.name) === norm(v.name))) throw new Error(`The zone "${v.name.trim()}" already exists in ${byId[v.countryId]?.name ?? 'this country'}.`);
            await createZone({ countryId: v.countryId, name: v.name.trim() });
            notify('Zone added', 'success');
          }}
        />
      )}
      {lzCity && byId[lzCity] && (
        <BoundaryDialog
          title={`New local zone in ${byId[lzCity].name}`}
          cityName={`${byId[lzCity].name}, ${byId[byId[lzCity].parentGroupId ?? '']?.name ?? ''}`}
          initial={{ name: '', cityId: lzCity, shape: 'polygon', radiusMeters: 500, polygon: [] }}
          others={(fences ?? []).filter((f) => f.localZoneId)}
          onClose={() => setLzCity('')}
          onSave={async (d) => {
            if (!d.name.trim()) throw new Error('Give the zone a name');
            await saveLocalZone({ cityId: lzCity, name: d.name, shape: d.shape, ...(d.shape === 'circle' ? { center: d.center, radiusMeters: d.radiusMeters } : { polygon: d.polygon }) });
            notify('Local zone saved', 'success');
          }}
        />
      )}
    </div>
  );
}

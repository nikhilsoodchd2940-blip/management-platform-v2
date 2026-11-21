'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { createZone, updateZone, deleteZone, setCityGeo, applyDefaultTimeZones } from '@/lib/functions';
import { TIME_ZONES } from '@/lib/timeZones';
import Link from 'next/link';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { ACCESS_ROLE_LABEL } from '@/components/AccessDialog';
import { useUserProfiles } from '@/lib/useUserNames';
import FormDialog from '@/components/FormDialog';
import Dropdown from '@/components/Dropdown';
import LocMap from '@/components/LocMap';
import { CountryName } from '@/components/CountryFlag';
import { zonePal, zoneStyle } from '@/lib/zoneColor';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

interface ScopeDoc { role: string; countryIds?: string[]; zoneIds?: string[]; cityIds?: string[] }
interface Zone { name: string; countryId: string; status: 'active' | 'archived' }

const initials = (n: string) => n.trim().slice(0, 2).toUpperCase();

/** Country → Zones → Cities → Groups. A zone is a named set of cities inside one country. */
export default function ZonesPage() {
  const { byId, countries, cities, groups, loading } = useGroupHierarchy();
  const zones = useCollection<Zone>('zones', [orderBy('name')]);
  const scopes = useCollection<ScopeDoc>('adminScopes', []);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [countryId, setCountryId] = useState('');
  const [status, setStatus] = useState('');
  const [cityShow, setCityShow] = useState('');
  const [sel, setSel] = useState('');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [limit, setLimit] = useState(24);
  const mapRef = useRef<HTMLDivElement>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      notify(ok, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  }

  const all = zones ?? [];
  const kurelsOf = (cityId: string) => groups.filter((g) => g.type === 'group' && g.status === 'active' && g.parentGroupId === cityId).length;
  const citiesOf = (zoneId: string) => cities.filter((c) => c.zoneId === zoneId);
  const term = search.trim().toLowerCase();
  const shown = useMemo(() => all.filter((z) =>
    (!countryId || z.countryId === countryId) && (!status || z.status === status) &&
    (!term || z.name.toLowerCase().includes(term) || (byId[z.countryId]?.name ?? '').toLowerCase().includes(term) || cities.some((c) => c.zoneId === z.id && c.name.toLowerCase().includes(term)))),
  [all, countryId, status, term, cities, byId]);
  const countryOpts = countries.filter((c) => all.some((z) => z.countryId === c.id));
  const placed = cities.filter((c) => c.zoneId).length;
  const filtering = !!(search || countryId || status);

  const cityRows = cities.filter((c) => (!countryId || c.parentGroupId === countryId) &&
    (cityShow === 'nozone' ? !c.zoneId : cityShow === 'notz' ? !c.timeZone : true) &&
    (!term || c.name.toLowerCase().includes(term) || (byId[c.parentGroupId ?? '']?.name ?? '').toLowerCase().includes(term)));

  const colorIx = (id: string) => Math.max(0, all.findIndex((z) => z.id === id));
  const selZone = all.find((z) => z.id === sel);
  const pick = (id: string) => { const z = all.find((x) => x.id === id); if (z) setCountryId(z.countryId); setSel((cur) => (cur === id ? '' : id)); mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };

  const managers = useMemo(() => {
    if (!selZone) return [] as { userId: string; label: string }[];
    return (scopes ?? []).filter((sc) => sc.role !== 'super_admin' && sc.zoneIds?.includes(selZone.id)).map((sc) => ({ userId: (sc as unknown as { id: string }).id, label: sc.role === 'zone_admin' ? tx("Zone manager") : tx(ACCESS_ROLE_LABEL[sc.role] ?? sc.role) }));
  }, [selZone, scopes]);
  const profiles = useUserProfiles(managers.map((m) => m.userId));
  return (
    <div className="zp">
      <LocMap
        mapRef={mapRef}
        eyebrow={tx("Country → Zones → Cities → Groups")}
        title={tx("Zones")}
        actions={<button className="loc-btn solid" onClick={() => setCreating(true)}>{tx("+ New zone")}</button>}
        countries={countryOpts}
        weight={(id) => all.filter((z) => z.countryId === id).length}
        countryId={countryId}
        onCountry={(id) => { setCountryId(id); if (!id) setSel(''); }}
        itemLabel={tx("Choose a zone")}
        itemAll={`${tx("All zones")} · ${shown.length}`}
        itemOptions={shown.map((z) => ({ value: z.id, label: `${z.name} · ${byId[z.countryId]?.name ?? ''}` }))}
        itemId={sel}
        onItem={(id) => { setSel(id); const z = all.find((x) => x.id === id); if (z) setCountryId(z.countryId); }}
        mapQuery={selZone ? `${citiesOf(selZone.id)[0] ? `${citiesOf(selZone.id)[0].name}, ` : ''}${byId[selZone.countryId]?.name ?? ''}` : undefined}
        mapZoom={selZone && citiesOf(selZone.id).length === 0 ? 6 : 10}
        mapTitle={selZone ? `${selZone.name} · ${byId[selZone.countryId]?.name ?? ''}` : undefined}
        list={countryId ? all.filter((z) => z.countryId === countryId).map((z) => ({ id: z.id, name: z.name, sub: `${citiesOf(z.id).length} ${citiesOf(z.id).length === 1 ? tx("city") : tx("cities")}` })) : undefined}
        overview={<div className="lm-place"><span>{tx("Zones")}</span><b>{shown.length}</b><small>{countryId ? <CountryName name={byId[countryId]?.name} size={15} /> : `${countryOpts.length} ${tx("countries")}`} · {all.reduce((n, z) => n + citiesOf(z.id).length, 0)} {tx("cities")}</small><small>{tx("Select a zone to see where it is on the map.")}</small></div>}
        side={selZone ? <>
          <div className="lm-place">
            <span>{tx("Zone")}</span>
            <b>{selZone.name}</b>
            <small><CountryName name={byId[selZone.countryId]?.name} size={15} /> · {selZone.status === 'active' ? tx("Active") : tx("Archived")}</small>
          </div>
          <div className="zp-facts">
            <div><b>{citiesOf(selZone.id).length}</b><span>{citiesOf(selZone.id).length === 1 ? tx("city") : tx("cities")}</span></div>
            <div><b>{citiesOf(selZone.id).reduce((n, c) => n + kurelsOf(c.id), 0)}</b><span>{tx("kurel(s)")}</span></div>
          </div>
          <div className="lm-resp">
            <span className="lm-cap">{tx("Zone manager")}</span>
            {managers.length === 0 && <p>{tx("No zone manager assigned yet.")} <Link href="/dashboard/role-access">{tx("Assign one")}</Link></p>}
            {managers.map((r, i) => (
              <div className="lm-person" key={`${r.userId}${i}`}>
                <Avatar name={profiles[r.userId]?.name || '…'} photoUrl={profiles[r.userId]?.photoUrl} size={38} />
                <span><PersonLink userId={r.userId}><b>{profiles[r.userId]?.name || tx("Loading…")}</b></PersonLink><small>{r.label}</small>{profiles[r.userId]?.phone && <a href={`tel:${profiles[r.userId].phone}`}>{profiles[r.userId].phone}</a>}</span>
              </div>
            ))}
          </div>
          <div className="lm-cities">
            <span className="lm-cap">{tx("Cities")}</span>
            {citiesOf(selZone.id).length === 0 ? <p className="lm-note">{tx("No city yet")}</p> : <div>{citiesOf(selZone.id).map((c) => <span className="zp-cityline" key={c.id}><b>{c.name}</b><small>{kurelsOf(c.id)} {tx("kurel(s)")}</small></span>)}</div>}
          </div>
        </> : undefined}
      />

      <div className="loc-kpis zp-kpis">
        <div><i>◈</i><span>{tx("Zones")}</span><strong>{all.length}</strong></div>
        <div className="gold"><i>✓</i><span>{tx("Active")}</span><strong>{all.filter((z) => z.status === 'active').length}</strong></div>
        <div><i>🏙</i><span>{tx("Cities in a zone")}</span><strong>{placed}<small>/{cities.length}</small></strong></div>
        <div className="gold"><i>!</i><span>{tx("Cities without a zone")}</span><strong>{cities.length - placed}</strong></div>
      </div>

      <div className="loc-bar">
        <input type="search" placeholder={tx("Search by zone, city or country")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Dropdown label={tx("Country")} value={countryId} onChange={setCountryId} allLabel={`${tx("All countries")} · ${countryOpts.length}`} options={countryOpts.map((c) => ({ value: c.id, label: c.name }))} className="loc-dd" />
        <Dropdown label={tx("Status")} value={status} onChange={setStatus} allLabel={tx("Any status")} options={[{ value: 'active', label: tx("Active") }, { value: 'archived', label: tx("Archived") }]} className="loc-dd" />
        {filtering && <button type="button" className="loc-btn ghost" onClick={() => { setSearch(''); setCountryId(''); setStatus(''); }}>{tx("Clear filters")}</button>}
      </div>


      <div className="zp-title" id="zm-all"><h2>{tx("Zones")} <em>{filtering ? `${shown.length} / ${all.length}` : all.length}</em></h2></div>
      {zones === null || loading ? <p>{tx("Loading…")}</p> : shown.length === 0 ? <section className="zp-card"><p className="fx2-empty">{all.length === 0 ? tx("No zone yet. Create the first one.") : tx("Nothing matches.")}</p></section> : (
        <div className="zp-grid">
          {shown.slice(0, limit).map((z) => {
            const cs = citiesOf(z.id);
            const active = z.status === 'active';
            return (
              <article className={`zp-card${active ? '' : ' off'}${sel === z.id ? ' sel' : ''}`} key={z.id} style={zoneStyle(colorIx(z.id))} onClick={() => pick(z.id)}>
                <header>
                  <div className="loc-badge">{initials(z.name)}</div>
                  <div className="zp-name">
                    <h3>{z.name}</h3>
                    <small><CountryName name={byId[z.countryId]?.name} size={14} /></small>
                  </div>
                  <span className={`zp-pill${active ? ' ok' : ''}`}>{active ? tx("Active") : tx("Archived")}</span>
                </header>
                <div className="loc-blocks">
                  <div><b>{cs.length}</b><span>{cs.length === 1 ? tx("city") : tx("cities")}</span></div>
                  <div className="gold"><b>{cs.reduce((n, c) => n + kurelsOf(c.id), 0)}</b><span>{tx("kurel(s)")}</span></div>
                </div>
                <div className="zp-chips">
                  {cs.length === 0 ? <em>{tx("No city yet")}</em> : cs.map((c) => <span key={c.id}>{c.name}</span>)}
                </div>
                <footer className="three" onClick={(e) => e.stopPropagation()}>
                  <button className="loc-btn small" onClick={() => pick(z.id)}>{sel === z.id ? tx("Hide") : tx("📍 Show on map")}</button>
                  <button className="loc-btn small" onClick={() => run(() => updateZone({ zoneId: z.id, status: active ? 'archived' : 'active' }), 'Zone updated')}>{active ? tx("Archive") : tx("Restore")}</button>
                  <button className="loc-btn small danger" onClick={() => { if (confirm(cs.length ? `"${z.name}" has ${cs.length} city(ies). They stay, but lose this zone. Delete the zone?` : `Delete "${z.name}"?`)) run(() => deleteZone({ zoneId: z.id }), 'Zone deleted'); }}>{tx("Delete")}</button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {shown.length > limit && <button type="button" className="loc-btn zp-more" onClick={() => setLimit((n) => n + 24)}>{tx("Show more")} · {shown.length - limit}</button>}

      <div className="zp-title zp-title2">
        <div>
          <h2>{tx("Cities: zone and time zone")} <em>{cityRows.length}</em></h2>
          <p>{tx("A city with no time zone uses Senegal (Dakar) automatically. Change it here if it is wrong.")}</p>
        </div>
        <div className="zp-tools">
          <Dropdown label={tx("Show")} value={cityShow} onChange={setCityShow} allLabel={tx("All cities")} options={[{ value: 'nozone', label: tx("Cities without a zone") }, { value: 'notz', label: tx("Cities without a time zone") }]} className="loc-dd" />
          <button className="loc-btn" onClick={() => run(async () => { const r = await applyDefaultTimeZones({}); notify(`${r.data.updated} city(ies) set to Senegal`, 'info'); }, 'Done')}>{tx("Save the default on every city that has none")}</button>
        </div>
      </div>
      {cityRows.length === 0 ? <section className="zp-card"><p className="fx2-empty">{cities.length === 0 ? tx("No city yet. Create cities first.") : tx("Nothing matches.")}</p></section> : (
        <div className="zp-cities">
          {cityRows.map((c) => (
            <article className="zp-city" key={c.id} style={c.zoneId ? zoneStyle(colorIx(c.zoneId)) : undefined}>
              <header>
                <strong>{c.name}</strong>
                <span>{byId[c.parentGroupId ?? '']?.name ?? '—'}</span>
              </header>
              <div className="zp-dds">
                <Dropdown label={tx("Zone")} value={c.zoneId ?? ''} onChange={(v) => run(() => setCityGeo({ cityId: c.id, zoneId: v }), 'City updated')} allLabel={tx("No zone")} options={all.filter((z) => z.countryId === c.parentGroupId && z.status === 'active').map((z) => ({ value: z.id, label: z.name }))} />
                <Dropdown label={tx("Time zone")} value={c.timeZone ?? ''} onChange={(v) => run(() => setCityGeo({ cityId: c.id, timeZone: v }), 'Time zone saved')} allLabel={tx("Default: Senegal (Dakar)")} options={TIME_ZONES.map((t) => ({ value: t.value, label: t.label }))} />
              </div>
            </article>
          ))}
        </div>
      )}

      {creating && (
        <FormDialog
          title={tx("New zone")}
          submitLabel={tx("Create zone")}
          onClose={() => setCreating(false)}
          fields={[
            { name: 'countryId', label: tx("Country"), type: 'select', required: true, options: countries.map((c) => ({ value: c.id, label: c.name })) },
            { name: 'name', label: tx("Zone name"), required: true },
          ]}
          onSubmit={async (v) => {
            await createZone({ countryId: v.countryId, name: v.name });
            notify('Zone created', 'success');
          }}
        />
      )}
    </div>
  );
}

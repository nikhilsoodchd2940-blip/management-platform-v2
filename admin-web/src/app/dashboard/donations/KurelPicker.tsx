'use client';

import { useMemo, useState } from 'react';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useLevels } from '@/lib/useLevels';
import Dropdown from '@/components/Dropdown';
import { tx } from '@/lib/i18n/tr';

/** Filters over a list of kurels (country, city, local zone, level, search) with a tick list. Used when choosing who a program is for and who gets an allocation. */
export default function KurelPicker({ allowed, selected, onChange, height = 220 }: { allowed?: string[]; selected: string[]; onChange: (ids: string[]) => void; height?: number }) {
  const { activeLeafGroups, countries, cities, locationOf } = useGroupHierarchy();
  const { levels } = useLevels();
  const zones = useCollection<{ name: string; cityId: string }>('localZones', []);
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [level, setLevel] = useState('');
  const pool = useMemo(() => (allowed ? activeLeafGroups.filter((g) => allowed.includes(g.id)) : activeLeafGroups), [activeLeafGroups, allowed]);
  const shown = useMemo(() => pool.filter((g) => {
    const loc = locationOf(g.id);
    if (country && loc.country?.id !== country) return false;
    if (city && loc.city?.id !== city) return false;
    if (zone && g.localZoneId !== zone) return false;
    if (level && g.levelId !== level) return false;
    const t = q.trim().toLowerCase();
    return !t || `${g.name} ${loc.city?.name ?? ''}`.toLowerCase().includes(t);
  }).sort((a, b) => a.name.localeCompare(b.name)), [pool, country, city, zone, level, q, locationOf]);
  const cityList = cities.filter((c) => !country || locationOf(c.id).country?.id === country || c.parentGroupId === country);
  const zoneList = (zones ?? []).filter((z) => !city || z.cityId === city);
  const set = new Set(selected);
  const toggle = (id: string) => onChange(set.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="kp">
      <div className="kp-filters">
        <label className="og-search"><svg viewBox="0 0 20 20" aria-hidden><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{tx("Search")}</span><input type="search" placeholder={tx("A kurel")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Dropdown label={tx("Country")} value={country} onChange={(v) => { setCountry(v); setCity(''); setZone(''); }} allLabel="All" options={countries.map((c) => ({ value: c.id, label: c.name }))} />
        <Dropdown label={tx("City")} value={city} onChange={(v) => { setCity(v); setZone(''); }} allLabel="All" options={cityList.map((c) => ({ value: c.id, label: c.name }))} />
        <Dropdown label={tx("Local zone")} value={zone} onChange={setZone} allLabel="All" options={zoneList.map((z) => ({ value: z.id, label: z.name }))} />
        <Dropdown label={tx("Level")} value={level} onChange={setLevel} allLabel="All" options={levels.map((l) => ({ value: l.id, label: l.name }))} />
      </div>
      <div className="kp-bar">
        <span><b>{selected.length}</b> {tx("selected ·")} {shown.length} {tx("shown of")} {pool.length}</span>
        <span>
          <button type="button" onClick={() => onChange([...new Set([...selected, ...shown.map((g) => g.id)])])}>{tx("Select all shown")}</button>
          <button type="button" onClick={() => onChange(selected.filter((id) => !shown.some((g) => g.id === id)))}>{tx("Unselect shown")}</button>
          <button type="button" onClick={() => onChange([])}>{tx("Clear")}</button>
        </span>
      </div>
      <div className="kp-list" style={{ maxHeight: height }}>
        {shown.map((g) => { const loc = locationOf(g.id); return (
          <label key={g.id} className={set.has(g.id) ? 'on' : ''}><input type="checkbox" checked={set.has(g.id)} onChange={() => toggle(g.id)} /><span><b>{g.name}</b><small>{[loc.city?.name, loc.country?.name].filter(Boolean).join(' · ')}</small></span></label>
        ); })}
        {shown.length === 0 && <p className="kp-none">{tx("No kurel matches these filters.")}</p>}
      </div>
    </div>
  );
}

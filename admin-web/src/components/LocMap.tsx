'use client';

import { useMemo, useState, type ReactNode, type Ref } from 'react';
import WorldMap from '@/components/WorldMap';
import Dropdown from '@/components/Dropdown';
import { CONTINENTS, geoOf, type Continent } from '@/lib/worldGeo';
import { CountryName } from '@/components/CountryFlag';
import { tx } from '@/lib/i18n/tr';

export interface LocMapProps {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  countries: { id: string; name: string }[];
  /** How many places (zones, fences…) a country holds; countries with 0 get no marker. */
  weight: (countryId: string) => number;
  countryId: string;
  onCountry: (id: string) => void;
  itemLabel: string;
  itemAll: string;
  itemOptions: { value: string; label: string }[];
  itemId: string;
  onItem: (id: string) => void;
  /** Google Maps search text (or "lat,lng") for the chosen place; falls back to the chosen country. */
  mapQuery?: string;
  mapZoom?: number;
  mapTitle?: string;
  /** What the country holds, listed in the side panel while no single place is chosen. */
  list?: { id: string; name: string; sub?: string }[];
  overview: ReactNode;
  side?: ReactNode;
  legend?: string;
  mapRef?: Ref<HTMLDivElement>;
}

/** The Locations map block, shared by Zones, Local zones and Geofence: dotted world map, zoom on a country, side panel, continent pills and filters. */
export default function LocMap(p: LocMapProps) {
  const [continent, setContinent] = useState<'' | Continent>('');
  const country = p.countries.find((c) => c.id === p.countryId);
  const markers = useMemo(() => p.countries.flatMap((c) => { const g = geoOf(c.name); const w = p.weight(c.id); return g && w > 0 && (!continent || g.continent === continent) ? [{ id: c.id, name: c.name, lat: g.lat, lng: g.lng, weight: w }] : []; }), [p.countries, p.weight, continent]); // eslint-disable-line react-hooks/exhaustive-deps
  const present = CONTINENTS.map((k) => ({ ...k, n: p.countries.filter((c) => geoOf(c.name)?.continent === k.key && p.weight(c.id) > 0).length })).filter((k) => k.n > 0);
  const total = p.countries.filter((c) => p.weight(c.id) > 0).length;
  const q = p.mapQuery || country?.name || '';
  const isCoord = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q);
  return (
    <div className="lm" ref={p.mapRef}>
      <div className="lm-head">
        <div><span className="loc-eyebrow">{p.eyebrow}</span><h1>{p.title}</h1></div>
        {p.actions && <div className="loc-actions">{p.actions}</div>}
      </div>
      <div className="lm-body">
        <div className="lm-map">
          {country ? (
            <div className="lm-zoom">
              <iframe title={p.mapTitle ?? country.name} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://www.google.com/maps?q=${encodeURIComponent(q)}&z=${p.mapQuery ? (p.mapZoom ?? (isCoord ? 16 : 11)) : 5}&output=embed`} />
              <button type="button" className="lm-world" onClick={() => { p.onItem(''); p.onCountry(''); }}>← {tx("World map")}</button>
              <span className="lm-zname">{p.mapTitle ?? country.name}</span>
            </div>
          ) : (
            <>
              <WorldMap markers={markers} activeId="" onPick={(id) => p.onCountry(id)} />
              <small className="lm-legend"><i />{p.legend ?? tx("Presence — one marker per country")}</small>
            </>
          )}
        </div>
        <aside className="lm-side">{country && p.side ? p.side : country && p.list ? (
          <>
            <div className="lm-place"><span>{p.itemLabel}</span><b><CountryName name={country.name} size={22} /></b><small>{p.list.length} · {tx("Select one to see where it is on the map.")}</small></div>
            <div className="lm-cities">
              <div>{p.list.map((x) => <button type="button" key={x.id} onClick={() => p.onItem(x.id)}><b>{x.name}</b>{x.sub && <small>{x.sub}</small>}</button>)}{p.list.length === 0 && <p className="lm-note">—</p>}</div>
            </div>
          </>
        ) : p.overview}</aside>
      </div>
      <div className="lm-tools">
        <div className="lm-pills">
          <button type="button" className={!continent ? 'on' : ''} onClick={() => setContinent('')}>{tx("All")} <em>{total}</em></button>
          {present.map((k) => <button type="button" key={k.key} className={continent === k.key ? 'on' : ''} onClick={() => { setContinent(continent === k.key ? '' : k.key); p.onCountry(''); }}>{tx(k.label)} <em>{k.n}</em></button>)}
        </div>
        <Dropdown label={tx("Choose a country")} value={p.countryId} onChange={(v) => { p.onItem(''); p.onCountry(v); }} allLabel={`${tx("All countries")} · ${total}`} options={p.countries.filter((c) => p.weight(c.id) > 0 && (!continent || geoOf(c.name)?.continent === continent)).map((c) => ({ value: c.id, label: c.name }))} className="lm-dd" />
        <Dropdown label={p.itemLabel} value={p.itemId} onChange={p.onItem} allLabel={p.itemAll} options={p.itemOptions} className="lm-dd" />
      </div>
    </div>
  );
}

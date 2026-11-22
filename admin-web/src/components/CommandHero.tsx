'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { searchMembers } from '@/lib/functions';
import { useCityWeather } from '@/lib/useCityWeather';
import { weatherLook } from '@/components/WeatherCard';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { DEFAULT_CLOCKS } from '@/lib/timeZones';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface ClockZone { label: string; timeZone: string }
interface SearchHit { label: string; detail: string; href: string }

function ClockWeather({ zone }: { zone?: ClockZone }) {
  const w = useCityWeather(zone?.label ?? '', zone?.timeZone ?? '');
  if (!zone) return null;
  if (!w) return <div className="clock-wx muted">{tx("Weather loading…")}</div>;
  const [icon, text] = weatherLook(w.code);
  return (
    <div className="clock-wx" title={`${text}, wind ${Math.round(w.wind)} km/h`}>
      <span className="ico">{icon}</span>
      <b>{Math.round(w.temp)}°C</b>
      <em>{text}</em>
      <small>💨 {Math.round(w.wind)} km/h{w.humidity !== undefined ? ` · 💧 ${w.humidity}%` : ''}</small>
    </div>
  );
}

/** The green header used on the dashboard and on the finance page: title, global search and the four world clocks with their weather. */
export default function CommandHero({ title, subtitle, variant }: { title: string; subtitle: string; variant?: 'finance' }) {
  const router = useRouter();
  const { countries, cities, activeLeafGroups } = useGroupHierarchy();
  const [now, setNow] = useState(() => Date.now());
  const [stamp, setStamp] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, []);
  // World clocks configured by the organization.
  const [clocks, setClocks] = useState<ClockZone[]>(DEFAULT_CLOCKS);
  useEffect(() => {
    return onSnapshot(collection(db, 'orgSettings'), (snap) => {
      const d = snap.docs.find((x) => x.id === 'default')?.data();
      const saved = ((d?.worldClocks as ClockZone[]) ?? []).slice(0, 4);
      // A slot left empty in Settings falls back to the standard four cities.
      setClocks([0, 1, 2, 3].map((i) => (saved[i]?.label && saved[i]?.timeZone ? saved[i] : DEFAULT_CLOCKS[i])));
    });
  }, []);
  // Global search: kurels are matched locally, members on the server.
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  async function runSearch() {
    const q = term.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const lower = q.toLowerCase();
    const found: SearchHit[] = [];
    [...countries, ...cities, ...activeLeafGroups]
      .filter((g) => g.name.toLowerCase().includes(lower))
      .slice(0, 5)
      .forEach((g) => found.push({ label: g.name, detail: g.type === 'group' ? 'Kurel' : g.type === 'city' ? 'City' : 'Country', href: '/dashboard/groups' }));
    try {
      const res = await searchMembers({ query: q });
      res.data.results.slice(0, 5).forEach((m) => found.push({ label: m.displayName || m.phone, detail: 'Member', href: '/dashboard/members' }));
    } catch {
      /* member search unavailable — kurel matches still shown */
    }
    setHits(found);
  }

  const clockText = (zone: ClockZone) => {
    try {
      const d = new Date(now);
      return {
        time: d.toLocaleTimeString(dateLocale(), { timeZone: zone.timeZone, hour12: false }),
        date: d.toLocaleDateString(dateLocale(), { timeZone: zone.timeZone, weekday: 'short', day: 'numeric', month: 'short' }),
      };
    } catch {
      return { time: '—', date: '' };
    }
  };


  return (
    <>
        <div className="command-hero">
          <div className="command-head">
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            {variant === 'finance' ? (
              <span className="demo-pill fn-live"><i aria-hidden />{tx("Live data")} · {tx("Updated")} {Math.max(0, Math.floor((now - stamp) / 60000)) === 0 ? tx("just now") : `${Math.floor((now - stamp) / 60000)} min ${tx("ago")}`}<button type="button" aria-label={tx("Refresh")} onClick={() => { setStamp(Date.now()); router.refresh(); }}>↻</button></span>
            ) : <span className="demo-pill">{tx("Live data · Firebase")}</span>}
          </div>
          <div className="global-search">
            <div className="search-shell">
              <span>⌕</span>
              <input
                type="search"
                placeholder={variant === 'finance' ? tx("Search a member, group, city, country or program…") : tx("Search a member, kurel, city or country…")}
                aria-label={tx("Global search")}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
              <button type="button" onClick={runSearch}>
                {tx("Search")}
              </button>
            </div>
            <div className={`search-results${hits ? ' show' : ''}`}>
              {hits && hits.length === 0 && (
                <div className="search-result">
                  <strong>{tx("No results")}</strong>
                  <small>{tx("Try a name, a kurel or a city.")}</small>
                </div>
              )}
              {hits?.map((h, i) => (
                <button key={i} type="button" className="search-result" onClick={() => router.push(h.href)}>
                  <strong>{h.label}</strong>
                  <small>{h.detail}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="world-clocks" hidden={variant === 'finance'}>
            {[0, 1, 2, 3].map((i) => {
              const zone = clocks[i];
              const t = zone ? clockText(zone) : null;
              return (
                <div className="world-clock" key={i}>
                  <span>{zone ? zone.label : '—'}</span>
                  <strong>{t ? t.time : '—'}</strong>
                  <small>{t ? t.date : ''}</small>
                  <ClockWeather zone={zone} />
                </div>
              );
            })}
          </div>
        </div>

    </>
  );
}

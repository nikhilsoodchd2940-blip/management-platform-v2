'use client';

import { useEffect, useState } from 'react';

export interface CityWeather { temp: number; code: number; wind: number; humidity?: number }

const geoCache = new Map<string, Promise<{ lat: number; lng: number } | null>>();

function locate(label: string, timeZone: string) {
  const key = `${label}|${timeZone}`;
  let p = geoCache.get(key);
  if (!p) {
    p = fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(label)}&count=10&language=en&format=json`)
      .then((r) => r.json())
      .then((j: { results?: { latitude: number; longitude: number; timezone?: string }[] }) => {
        const list = j.results ?? [];
        const hit = list.find((x) => x.timezone === timeZone) ?? list[0];
        return hit ? { lat: hit.latitude, lng: hit.longitude } : null;
      })
      .catch(() => null);
    geoCache.set(key, p);
  }
  return p;
}

/** Current weather of a city (Open-Meteo, no key). Refreshes every 15 minutes. */
export function useCityWeather(label: string, timeZone: string): CityWeather | null {
  const [w, setW] = useState<CityWeather | null>(null);
  useEffect(() => {
    if (!label) return;
    let dead = false;
    const load = async () => {
      const at = await locate(label, timeZone);
      if (!at || dead) return;
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lng}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`);
        const j = await r.json();
        const c = j?.current;
        if (!dead && c) setW({ temp: c.temperature_2m, code: c.weather_code, wind: c.wind_speed_10m, humidity: c.relative_humidity_2m });
      } catch { /* the clock simply shows no weather */ }
    };
    void load();
    const h = window.setInterval(load, 15 * 60 * 1000);
    return () => { dead = true; window.clearInterval(h); };
  }, [label, timeZone]);
  return w;
}

'use client';

import { useEffect, useState } from 'react';
import { tx, dateLocale } from '@/lib/i18n/tr';

interface Day { max: number; min: number; rain: number; wind: number; code: number; now?: number; source: 'forecast' | 'history' }

const CODES: Record<number, [string, string]> = {
  0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Heavy showers'], 82: ['⛈️', 'Violent showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Thunderstorm, hail'],
};
export const weatherLook = (c: number) => CODES[c] ?? CODES[Math.floor(c / 10) * 10] ?? ['🌡️', 'Weather'];
const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const FETCHED = new Map<string, Promise<unknown>>();
const getJson = (url: string) => { let p = FETCHED.get(url); if (!p) { p = fetch(url).then((r) => r.json()); FETCHED.set(url, p); p.catch(() => FETCHED.delete(url)); } return p as Promise<{ daily?: Record<string, number[]>; current?: { temperature_2m?: number } }>; };

/** Weather of one day at one place (Open-Meteo, no key needed). */
export function useDayWeather(lat?: number | string, lng?: number | string, dateMs?: number) {
  const la = Number(lat), lo = Number(lng);
  const ok = Number.isFinite(la) && Number.isFinite(lo) && lat !== '' && lng !== '' && lat !== undefined && lng !== undefined && !!dateMs && !Number.isNaN(dateMs);
  const [day, setDay] = useState<Day | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'none' | 'error'>('idle');
  const date = ok ? ymd(dateMs!) : '';

  useEffect(() => {
    if (!ok) { setDay(null); setState('idle'); return; }
    let dead = false;
    setState('loading');
    const today = ymd(Date.now());
    const past = date < today;
    const base = past ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const url = `${base}?latitude=${la}&longitude=${lo}&start_date=${date}&end_date=${date}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max${date === today ? '&current=temperature_2m' : ''}&timezone=auto`;
    getJson(url)
      .then((j) => {
        if (dead) return;
        const d = j?.daily;
        if (!d?.time?.length || d.temperature_2m_max?.[0] == null) { setState('none'); setDay(null); return; }
        const rain = d.precipitation_probability_max?.[0] ?? (d.precipitation_sum?.[0] > 0.5 ? 80 : 10);
        setDay({ max: d.temperature_2m_max[0], min: d.temperature_2m_min[0], rain, wind: d.wind_speed_10m_max?.[0] ?? 0, code: d.weather_code?.[0] ?? 0, now: j.current?.temperature_2m, source: past ? 'history' : 'forecast' });
        setState('idle');
      })
      .catch(() => { if (!dead) setState('error'); });
    return () => { dead = true; };
  }, [ok, la, lo, date]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ok, day, state, date };
}

/** Weather of the event day at the venue. Fills itself from the place and the date. */
export default function WeatherCard({ lat, lng, dateMs, compact }: { lat?: number | string; lng?: number | string; dateMs?: number; compact?: boolean }) {
  const { ok, day, state, date } = useDayWeather(lat, lng, dateMs);
  if (!ok) return <div className={`wx wx-empty${compact ? ' compact' : ''}`}>{tx("⛅ Weather appears here once the place and date are set.")}</div>;
  if (state === 'loading') return <div className={`wx wx-empty${compact ? ' compact' : ''}`}>{tx("⛅ Loading the weather…")}</div>;
  if (state === 'error') return <div className={`wx wx-empty${compact ? ' compact' : ''}`}>{tx("Weather is not available right now.")}</div>;
  if (state === 'none' || !day) return <div className={`wx wx-empty${compact ? ' compact' : ''}`}>{tx("No forecast yet for this date (forecasts cover the next 16 days).")}</div>;
  const [icon, text] = weatherLook(day.code);
  const tip = day.rain >= 60 ? 'Rain is likely: plan a covered space.' : day.max >= 35 ? 'Very hot: plan water and shade.' : day.wind >= 40 ? 'Strong wind expected.' : 'Good conditions for the event.';
  return (
    <div className={`wx${compact ? ' compact' : ''}`}>
      <div className="wx-main"><span className="wx-ico">{icon}</span><div><strong>{text}</strong><small>{new Date(date + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })} · {day.source === 'history' ? tx("recorded") : tx("forecast")}</small></div></div>
      <div className="wx-grid">
        <div><span>{tx("High")}</span><b>{Math.round(day.max)}°C</b></div>
        <div><span>{tx("Low")}</span><b>{Math.round(day.min)}°C</b></div>
        <div><span>{tx("Rain")}</span><b>{Math.round(day.rain)}%</b></div>
        <div><span>{tx("Wind")}</span><b>{Math.round(day.wind)} km/h</b></div>
      </div>
      {!compact && <p className="wx-tip">{tip}</p>}
    </div>
  );
}

const sky = (code: number) => (code >= 95 ? 'storm' : code >= 51 && code <= 82 ? 'rain' : code === 45 || code === 48 ? 'fog' : code >= 71 && code <= 77 ? 'snow' : code >= 2 ? 'cloud' : 'clear');

/** One place as a weather widget: the name, the big temperature, the sky, and the high and low of the day. */
export function WeatherWidget({ name, lat, lng, dateMs }: { name: string; lat?: number | string; lng?: number | string; dateMs?: number }) {
  const { ok, day, state, date } = useDayWeather(lat, lng, dateMs);
  const [icon, text] = day ? weatherLook(day.code) : ['', ''];
  return (
    <div className={`wxw ${day ? sky(day.code) : 'wait'}`}>
      <div className="wxw-top">
        <b>{name}</b>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3 11 21 3l-8 18-2-8z" /></svg>
      </div>
      {!ok ? <p className="wxw-msg">{tx("Set the place on the map to see its weather.")}</p>
        : state === 'loading' ? <p className="wxw-msg">{tx("Loading the weather…")}</p>
        : state === 'error' ? <p className="wxw-msg">{tx("Weather is not available right now.")}</p>
        : state === 'none' || !day ? <p className="wxw-msg">{tx("No forecast yet for this date. Forecasts cover the next 16 days.")}</p>
        : (
          <>
            <div className="wxw-temp">{Math.round(day.now ?? day.max)}°</div>
            <div className="wxw-cond"><span>{icon}</span><b>{text}</b></div>
            <div className="wxw-hl">H:{Math.round(day.max)}° L:{Math.round(day.min)}°</div>
            <div className="wxw-more"><span>{tx("Rain")} {Math.round(day.rain)}%</span><span>{tx("Wind")} {Math.round(day.wind)} km/h</span></div>
            <small className="wxw-date">{new Date(date + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })} · {day.source === 'history' ? tx("recorded") : day.now !== undefined ? tx("now") : tx("forecast")}</small>
          </>
        )}
    </div>
  );
}

/** The weather of every place of an event, one widget each. */
export function WeatherPlaces({ places, dateMs }: { places: { id?: string; name: string; lat?: number | string; lng?: number | string }[]; dateMs?: number }) {
  if (places.length === 0) return null;
  return (
    <div className="wxw-grid">
      {places.map((p, i) => <WeatherWidget key={p.id ?? i} name={p.name} lat={p.lat} lng={p.lng} dateMs={dateMs} />)}
    </div>
  );
}

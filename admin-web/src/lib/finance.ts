import { useEffect, useState } from 'react';

export type Currency = 'XOF' | 'USD' | 'EUR';
export const CURRENCIES: Currency[] = ['XOF', 'USD', 'EUR'];

/** Exchange rates, expressed as "how many CFA francs for one unit". The euro is fixed to the CFA franc; the dollar rate moves. */
export interface Rates { xofPerUsd: number; xofPerEur: number; live: boolean; asOf: string }
export const FALLBACK_RATES: Rates = { xofPerUsd: 600, xofPerEur: 655.957, live: false, asOf: '' };

let cache: Promise<Rates> | null = null;
function loadRates(): Promise<Rates> {
  if (!cache) {
    cache = fetch('https://open.er-api.com/v6/latest/USD')
      .then((r) => r.json())
      .then((j: { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }) => {
        const xof = j.rates?.XOF; const eur = j.rates?.EUR;
        if (j.result !== 'success' || !xof || !eur) throw new Error('no rates');
        return { xofPerUsd: xof, xofPerEur: xof / eur, live: true, asOf: j.time_last_update_utc ?? '' };
      })
      .catch(() => FALLBACK_RATES);
  }
  return cache;
}

/** The current exchange rates (loaded once; the fixed euro rate and an approximate dollar rate are used if the rate service cannot be reached). */
export function useRates(): Rates {
  const [r, setR] = useState<Rates>(FALLBACK_RATES);
  useEffect(() => { let off = false; loadRates().then((x) => { if (!off) setR(x); }); return () => { off = true; }; }, []);
  return r;
}

export function convert(amount: number, from: Currency, to: Currency, r: Rates): number {
  if (from === to) return amount;
  const perXof = { XOF: 1, EUR: r.xofPerEur, USD: r.xofPerUsd };
  const v = (amount * perXof[from]) / perXof[to];
  return to === 'XOF' ? Math.round(v) : Math.round(v * 100) / 100;
}

export const money = (cents: number, currency: Currency | undefined = 'XOF') => {
  const v = cents / 100;
  if (currency === 'XOF' || !currency) return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v)} XOF`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
};

// ---- dates: day month-in-letters year, in French ----
export const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
export const DAYS_FR = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
export const frDate = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`; };
export const frIso = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS_FR[m - 1]} ${y}`; };
export const isoOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n).getTime()); };
export const startOf = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
export const endOf = (iso: string) => new Date(`${iso}T23:59:59`).getTime();

export interface Phase { name: string; amountCents: number; startMs?: number; endMs?: number }

/** Where a program stands phase by phase: each phase is filled in order from what has been collected. A phase opens when the one before it is complete or its end date has passed. */
export function phaseProgress(goalCents: number, phases: Phase[] | undefined, paidCents: number, now = Date.now()) {
  const list: Phase[] = phases && phases.length ? phases : [{ name: 'Whole goal', amountCents: goalCents }];
  let left = paidCents;
  const rows = list.map((p, i) => {
    const got = Math.max(0, Math.min(left, p.amountCents));
    left -= got;
    return { i: i + 1, name: p.name, target: p.amountCents, got, done: got >= p.amountCents, startMs: p.startMs, endMs: p.endMs, open: true };
  });
  rows.forEach((r, i) => { if (i > 0) { const prev = rows[i - 1]; r.open = prev.done || (!!prev.endMs && prev.endMs < now); } });
  const current = rows.find((r) => !r.done && r.open) ?? rows.find((r) => !r.done) ?? rows[rows.length - 1];
  const planned = list.reduce((n, p) => n + p.amountCents, 0);
  return { rows, current, planned, unplanned: Math.max(0, goalCents - planned), hasPhases: !!(phases && phases.length) };
}

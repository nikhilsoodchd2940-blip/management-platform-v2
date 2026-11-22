'use client';

import type { ReactNode } from 'react';
import { tx } from '@/lib/i18n/tr';

/** Shared look of the redesigned screens: green banner with a skyline, coloured stat tiles, icon tab bar, cards with a green header. */

export type CxTone = 'green' | 'amber' | 'violet' | 'blue' | 'red' | 'teal' | 'dark';

export function CxSkyline() {
  return (
    <svg className="cx-sky" viewBox="0 0 420 120" preserveAspectRatio="xMaxYMax meet" aria-hidden>
      <g fill="rgba(120,200,90,.55)">
        <rect x="60" y="30" width="7" height="90" rx="3" /><path d="M63.5 8l5 22h-10z" /><circle cx="63.5" cy="6" r="3" />
        <rect x="353" y="26" width="7" height="94" rx="3" /><path d="M356.5 4l5 22h-10z" /><circle cx="356.5" cy="2" r="3" />
        <path d="M120 120V82q0-26 28-26t28 26v38z" /><path d="M244 120V74q0-34 46-34t46 34v46z" /><rect x="286" y="14" width="3" height="28" /><path d="M287.5 4q8 6 0 14q-8-8 0-14z" />
        <path d="M184 120V92q0-18 18-18t18 18v28z" /><rect x="40" y="108" width="340" height="12" />
      </g>
    </svg>
  );
}

export function CxBanner({ icon, logo, kicker, title, sub, children }: { icon?: ReactNode; logo?: boolean; kicker?: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <section className="cx-banner">
      <CxSkyline />
      <div className="cx-bt">
        {logo && <><span className="cx-logo"><img src="/hizbut-logo.png" alt="" /></span><span className="cx-vline" aria-hidden /></>}
        {icon && <i className="cx-bi" aria-hidden>{icon}</i>}
        <div>{kicker && <small>{kicker}</small>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      </div>
      {children && <div className="cx-ba">{children}</div>}
    </section>
  );
}

export interface CxTabItem { value: string; label: string; icon?: ReactNode; count?: number | string }
export function CxTabs({ items, value, onChange, className = '' }: { items: CxTabItem[]; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <nav className={`cx-tabs ${className}`} role="tablist">
      {items.map((t) => (
        <button type="button" role="tab" key={t.value} aria-selected={value === t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.icon && <i aria-hidden>{t.icon}</i>}<span>{t.label}</span>{t.count !== undefined && <em>{t.count}</em>}
        </button>
      ))}
    </nav>
  );
}

export interface CxStatItem { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: CxTone; badge?: ReactNode; onClick?: () => void }
export function CxStats({ items, cols }: { items: CxStatItem[]; cols?: number }) {
  return (
    <div className="cx-stats" style={cols ? { gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` } : undefined}>
      {items.map((s) => {
        const Tag = s.onClick ? 'button' : 'div';
        return (
          <Tag key={s.label} {...(s.onClick ? { type: 'button' as const, onClick: s.onClick } : {})} className={`cx-stat ${s.tone ?? 'green'}`}>
            <i aria-hidden>{s.icon}</i>
            <span><small>{s.label}</small><b>{s.value}</b>{s.sub && <em>{s.sub}</em>}</span>
            {s.badge && <u>{s.badge}</u>}
          </Tag>
        );
      })}
    </div>
  );
}

export function CxCard({ icon, title, sub, right, dark, tone, className = '', children, id, footer }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; dark?: boolean; tone?: CxTone; className?: string; children: ReactNode; id?: string; footer?: ReactNode }) {
  return (
    <section id={id} className={`cx-card${dark ? ' dark' : ''}${tone ? ` ${tone}` : ''} ${className}`}>
      <header>{icon && <i aria-hidden>{icon}</i>}<div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{right && <div className="cx-hr">{right}</div>}</header>
      <div className="cx-cb">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  );
}

export function CxPill({ tone = 'green', children, dot }: { tone?: 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'grey'; children: ReactNode; dot?: boolean }) {
  return <span className={`cx-pill ${tone}`}>{dot && <i aria-hidden />}{children}</span>;
}

export function CxBar({ pct, tone = 'green', thick }: { pct: number; tone?: 'green' | 'amber' | 'red' | 'blue' | 'gold' | 'grey'; thick?: boolean }) {
  return <u className={`cx-bar${thick ? ' thick' : ''}`}><s className={tone} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></u>;
}

/** Donut from slices; the centre holds a big value and a label. */
export function CxDonut({ slices, big, label, size = 150 }: { slices: { value: number; color: string }[]; big: ReactNode; label?: ReactNode; size?: number }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const r = 42; const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="cx-donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e6ece8" strokeWidth="13" />
        {slices.filter((s) => s.value > 0).map((s, i) => {
          const len = (s.value / total) * c;
          const el = <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="13" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 50 50)" />;
          off += len;
          return el;
        })}
      </svg>
      <span><b>{big}</b>{label && <small>{label}</small>}</span>
    </div>
  );
}

/** Filled line chart over labelled points. */
export function CxLine({ labels, values, min = 0, max, unit = '' }: { labels: string[]; values: number[]; min?: number; max?: number; unit?: string }) {
  const W = 360, H = 150, P = { l: 30, r: 12, t: 12, b: 24 };
  const hi = max ?? Math.max(1, ...values), lo = min;
  const x = (i: number) => P.l + (values.length <= 1 ? 0 : (i / (values.length - 1)) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  return (
    <svg className="cx-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("Trend")}>
      {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#e3ebe6" /><text x={P.l - 5} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#5d6e66">{Math.round(t)}{unit}</text></g>)}
      {values.length > 1 && <polygon points={`${x(0)},${y(lo)} ${pts} ${x(values.length - 1)},${y(lo)}`} fill="rgba(31,157,99,.18)" />}
      <polyline points={pts} fill="none" stroke="#0e6b45" strokeWidth="2.2" />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.4" fill="#f1c24b" stroke="#0e6b45" strokeWidth="1.5" />)}
      {labels.map((l, i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#5d6e66">{l}</text>)}
    </svg>
  );
}

export function CxBars({ labels, values, highlight }: { labels: string[]; values: number[]; highlight?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="cx-vbars">
      {values.map((v, i) => (
        <div key={labels[i]}><b>{v}</b><u><s className={i === (highlight ?? values.length - 1) ? 'gold' : ''} style={{ height: `${(v / max) * 100}%` }} /></u><span>{labels[i]}</span></div>
      ))}
    </div>
  );
}

/** Round initials badge, coloured by name. */
const AV = ['#e8832f', '#c2417a', '#1f78d1', '#7c4cc4', '#1e9d66', '#1aa3b8', '#b8521f'];
export function CxInitials({ name, size = 36 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const ini = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase();
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <span className="cx-ini" style={{ width: size, height: size, background: AV[h % AV.length], fontSize: size * 0.38 }}>{ini}</span>;
}

export function CxSteps({ steps, active }: { steps: { icon: ReactNode; label: string }[]; active?: number }) {
  return (
    <ol className="cx-steps">
      {steps.map((s, i) => <li key={s.label} className={active === i ? 'on' : ''}><b>{i + 1}</b><i aria-hidden>{s.icon}</i><span>{s.label}</span></li>)}
    </ol>
  );
}

/** Light page header (icon, title, subtitle, actions on the right) used where the client design has a white header. */
export function CxHead({ icon, kicker, title, sub, children }: { icon?: ReactNode; kicker?: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="cx-lhead">
      <div className="cx-lh-t">
        {icon && <i aria-hidden>{icon}</i>}
        <div>{kicker && <small>{kicker}</small>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      </div>
      {children && <div className="cx-lh-a">{children}</div>}
    </header>
  );
}

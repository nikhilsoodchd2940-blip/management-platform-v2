'use client';

import type { ReactNode } from 'react';
import { tx } from '@/lib/i18n/tr';

export interface WizStep { n: number; label: string; sub: string; done?: boolean }
export type WizIcon = 'doc' | 'clock' | 'pin' | 'users' | 'shield' | 'check' | 'list' | 'calendar';

const P: Record<WizIcon, ReactNode> = {
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 6a3 3 0 0 1 0 6M18 14.8c1.8.7 3 2.3 3 5.2" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  calendar: <><rect x="3" y="5" width="14" height="14" rx="2.5" /><path d="M7 3v4M13 3v4M3 10h14M7 13.5h2M11 13.5h2" /><circle cx="17.5" cy="17.5" r="4" /><path d="M17.5 15.5v2l1.3.8" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
};
export function WizSvg({ name, size = 22 }: { name: WizIcon; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{P[name]}</svg>;
}

function recapIcon(label: string): WizIcon {
  const l = label.toLowerCase();
  if (/when|due|date/.test(l)) return 'calendar';
  if (/where|place/.test(l)) return 'pin';
  if (/agenda|length|priority/.test(l)) return 'clock';
  if (/task/.test(l)) return 'doc';
  return 'users';
}

/**
 * One look for every step-by-step creator (events, meetings): a green banner, a rail with the steps and a short recap,
 * a panel with an icon title, a body that scrolls on its own, and a footer that always stays at the bottom.
 */
export default function WizardShell({
  title, subtitle, steps, current, onStep, panelTitle, panelSub, panelIcon, onClose, children, footer, recap, setup, overlay = false, locked = false,
}: {
  title: string; subtitle: string; steps: WizStep[]; current: number; onStep: (n: number) => void;
  panelTitle: string; panelSub: string; panelIcon: WizIcon; onClose?: () => void;
  children: ReactNode; footer: ReactNode; recap?: { label: string; value: string }[];
  /** Small caption of the progress card, e.g. "Meeting Setup". */
  setup?: string;
  /** Fills the whole screen (meetings) instead of sitting in the page (events). */
  overlay?: boolean; locked?: boolean;
}) {
  return (
    <div className={`wzs${overlay ? ' wzs-overlay' : ''}`}>
      <header className="wzs-banner">
        <span className="wzs-logo"><WizSvg name="list" size={26} /></span>
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        {onClose && <button type="button" className="wzs-close" onClick={onClose}>{tx("✕ Close")}</button>}
      </header>
      <div className="wzs-body">
        <nav className="wzs-rail" aria-label={tx("Steps")}>
          <div className="wzs-prog" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={Math.min(current, steps.length)}>
            <span className="wzs-prog-ic"><WizSvg name="calendar" size={34} /></span>
            <div className="wzs-prog-b">
              <div className="wzs-prog-t"><b>{tx("Step")} {Math.min(current, steps.length)} {tx("of")} {steps.length}</b><span>{Math.round((Math.max(0, Math.min(current, steps.length) - 1) / steps.length) * 100)}%</span></div>
              <small>{setup ?? title}</small>
              <div className="wzs-prog-bar"><i style={{ width: `${(Math.max(0, Math.min(current, steps.length) - 1) / steps.length) * 100}%` }} /></div>
            </div>
          </div>
          <ol className="wzs-steps">
            {steps.map((s) => (
              <li key={s.n}>
                <button type="button" disabled={locked || s.n > current} aria-current={s.n === current ? 'step' : undefined} className={`wzs-st${s.n === current ? ' cur' : ''}${s.done ? ' done' : ''}`} onClick={() => onStep(s.n)}>
                  <span className="wzs-n">{s.done && s.n !== current ? '✓' : s.n}</span>
                  <span className="wzs-t"><b>{s.label}</b><small>{s.sub}</small></span>
                  {s.n === current && <i aria-hidden>›</i>}
                </button>
              </li>
            ))}
          </ol>
          {recap && recap.length > 0 && (
            <dl className="wzs-recap">
              <dt className="wzs-recap-h"><WizSvg name="doc" size={22} /> {tx("Summary")}</dt>
              {recap.map((r) => { const empty = !r.value || r.value === '—'; return <div key={r.label} className={empty ? 'empty' : ''}><span className="wzs-ri"><WizSvg name={recapIcon(r.label)} size={22} /></span><span><dt>{r.label}</dt><dd>{empty ? tx("Not set yet") : r.value}</dd></span></div>; })}
            </dl>
          )}
        </nav>
        <section className="wzs-panel">
          <div className="wzs-ph"><span className="wzs-ic"><WizSvg name={panelIcon} size={24} /></span><div><h3>{panelTitle}</h3><p>{panelSub}</p></div></div>
          <div className="wzs-scroll">{children}</div>
          <footer className="wzs-foot">{footer}</footer>
        </section>
      </div>
    </div>
  );
}

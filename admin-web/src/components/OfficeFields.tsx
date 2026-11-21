'use client';

import MemberPicker from './MemberPicker';
import type { OfficeInput } from '@/lib/office';
import { tx } from '@/lib/i18n/tr';

const ROLES: { key: 'leaderId' | 'choirMasterId' | 'pedagogyPresidentId' | 'surveillantId' | 'socialId' | 'administrationId'; n: number; label: string; hint: string; color: string }[] = [
  { key: 'leaderId', n: 1, label: 'Superviseur', hint: 'Responsible of the kurel, validates operations', color: '#0b6a43' },
  { key: 'choirMasterId', n: 2, label: 'Maître de Chœurs', hint: 'Leads the choir', color: '#6a3bb8' },
  { key: 'pedagogyPresidentId', n: 3, label: 'Comité Pédagogique (president)', hint: 'Heads the pedagogical committee, evaluates members', color: '#1f5fb0' },
  { key: 'surveillantId', n: 4, label: 'Surveillant Général', hint: 'Discipline and attendance', color: '#9a7208' },
  { key: 'socialId', n: 5, label: 'Finance/Social', hint: 'Collections and support of members', color: '#b2315a' },
  { key: 'administrationId', n: 6, label: 'Administration', hint: 'Administration of the kurel', color: '#0b7f86' },
];

/** Who handles the kurel: one member per function, found by country, zone, city or kurel. Anyone chosen who is not yet in the kurel is added to it. */
export default function OfficeFields({ value, onChange, area }: { value: OfficeInput; onChange: (v: OfficeInput) => void; area?: { country?: string; city?: string; localZone?: string } }) {
  return (
    <details style={{ margin: '0.9rem 0', border: '1px solid #e3e9e4', borderRadius: 14, padding: '0.7rem 0.9rem', background: '#fafcfa' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{tx("Kurel management team")} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>{tx("(optional, you can also do it later)")}</span></summary>
      <div style={{ display: 'grid', gap: '0.8rem', marginTop: '0.8rem' }}>
        {ROLES.map((r) => {
          const others = ROLES.filter((o) => o.key !== r.key && value[o.key]);
          const disabledIds = others.map((o) => value[o.key] as string);
          const disabledReason = Object.fromEntries(others.map((o) => [value[o.key] as string, `Already ${o.label}`]));
          return (
          <div key={r.key} style={{ borderLeft: `5px solid ${r.color}`, paddingLeft: '0.7rem' }}>
            <div style={{ fontWeight: 700, color: r.color }}>{r.n}. {r.label} <small style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>· {r.hint}</small></div>
            <MemberPicker key={`${area?.country}|${area?.city}|${area?.localZone}`} initialArea={area} disabledIds={disabledIds} disabledReason={disabledReason} value={value[r.key] ? [value[r.key] as string] : []} onChange={(ids) => onChange({ ...value, [r.key]: ids[0] ?? '' })} />
          </div>
          );
        })}
      </div>
    </details>
  );
}

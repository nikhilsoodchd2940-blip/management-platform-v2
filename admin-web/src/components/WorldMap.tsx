'use client';

import { useMemo, useState } from 'react';
import { MAP_H, MAP_W, dotPath, project } from '@/lib/worldGeo';

export interface MapMarker { id: string; name: string; lat: number; lng: number; weight: number }

/** A dotted world map with a gold marker for every country. The chosen country is ringed and named. */
export default function WorldMap({ markers, activeId, onPick }: { markers: MapMarker[]; activeId: string; onPick: (id: string) => void }) {
  const dots = useMemo(() => dotPath(), []);
  const [hover, setHover] = useState('');
  const shown = hover || activeId;
  return (
    <svg className="wm" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="World map" preserveAspectRatio="xMidYMid meet">
      <path d={dots} className="wm-dots" />
      {markers.map((m) => {
        const [x, y] = project(m.lat, m.lng);
        const r = Math.min(4.2, 1.5 + Math.sqrt(m.weight) * 0.09);
        const on = m.id === activeId;
        return (
          <g key={m.id} className={`wm-pin${on ? ' on' : ''}`} onClick={() => onPick(m.id)} onMouseEnter={() => setHover(m.id)} onMouseLeave={() => setHover('')} tabIndex={0} role="button" aria-label={m.name} onKeyDown={(e) => { if (e.key === 'Enter') onPick(m.id); }}>
            <circle cx={x} cy={y} r={r + 3} className="wm-hit" />
            {on && <circle cx={x} cy={y} r={r + 2.4} className="wm-ring" />}
            <circle cx={x} cy={y} r={r} className="wm-dot" />
          </g>
        );
      })}
      {markers.filter((m) => m.id === shown).map((m) => {
        const [x, y] = project(m.lat, m.lng);
        const w = m.name.length * 2.6 + 8;
        const lx = Math.min(MAP_W - w - 2, Math.max(2, x - w / 2));
        return <g key={`l${m.id}`} className="wm-label" pointerEvents="none"><rect x={lx} y={y - 14} width={w} height="9" rx="4.5" /><text x={lx + w / 2} y={y - 7.4} textAnchor="middle">{m.name}</text></g>;
      })}
    </svg>
  );
}

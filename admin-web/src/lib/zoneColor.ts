import type { CSSProperties } from 'react';

/** [border, soft tint] — used by the panels and the map. */
export const ZONE_PAL: [string, string][] = [['#2f9e55', '#e5f6ea'], ['#2a8fd0', '#e4f2fc'], ['#1a9aa8', '#def4f6'], ['#4fb04a', '#e8f6e2'], ['#2a7fd0', '#e6f0fc'], ['#1e9a8a', '#def4f0'], ['#26a06a', '#e0f5ea'], ['#3a9e48', '#e5f5e6']];
/** [gradient start, gradient end, dark badge] — the solid colourful cards. */
export const CARD_PAL: [string, string, string][] = [['#5bc16a', '#2f9e55', '#1d7a3a'], ['#3fb6e8', '#2a8fd0', '#1a64a8'], ['#2ec4c4', '#1a9aa8', '#0f7480'], ['#7fcf6a', '#4fb04a', '#2f8a3c'], ['#4aa8f0', '#2a7fd0', '#1a5fb4'], ['#35b6a8', '#1e9a8a', '#116d68'], ['#4fc38a', '#26a06a', '#12704a'], ['#5fbf5f', '#3a9e48', '#1d7a3a']];
export const zonePal = (i: number) => ZONE_PAL[((i % ZONE_PAL.length) + ZONE_PAL.length) % ZONE_PAL.length];
export const zoneStyle = (i: number): CSSProperties => {
  const n = ((i % ZONE_PAL.length) + ZONE_PAL.length) % ZONE_PAL.length;
  const [c, b] = ZONE_PAL[n];
  const [g1, g2, gd] = CARD_PAL[n];
  return { ['--zc' as string]: c, ['--zb' as string]: b, ['--g1' as string]: g1, ['--g2' as string]: g2, ['--gd' as string]: gd } as CSSProperties;
};
/** A steady colour index for an id (same card, same colour, whatever the filters). */
export const hashIx = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % ZONE_PAL.length; };

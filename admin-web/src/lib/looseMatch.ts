/** True when `needle` appears anywhere in `hay`. A phone-like needle ("781 14", "+22178") also matches by digits, ignoring spaces and signs. */
export function looseMatch(needle: string, hay: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  const h = hay.toLowerCase();
  if (h.includes(n)) return true;
  const d = n.replace(/\D/g, '');
  return /^[+\d\s().-]+$/.test(n) && d.length >= 3 && h.replace(/\D/g, '').includes(d);
}

'use client';

import { flagUrl } from '@/lib/flags';

/** A small round flag for a country name. Renders nothing when the flag is not known. */
export function CountryFlag({ name, size = 18 }: { name?: string; size?: number }) {
  const u = name ? flagUrl(name, 40) : undefined;
  if (!u) return null;
  return <span className="cf" aria-hidden style={{ width: size, height: size, backgroundImage: `url(${u})` }} />;
}

/** A country name with its flag in front of it. */
export function CountryName({ name, size = 18 }: { name?: string; size?: number }) {
  return <span className="cfn"><CountryFlag name={name} size={size} />{name ?? '—'}</span>;
}

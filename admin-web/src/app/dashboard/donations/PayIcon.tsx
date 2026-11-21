import { tx } from '@/lib/i18n/tr';
/** Marks for the three ways of paying. Wave and Orange Money use the official logos in /public; Cash is drawn. */
export default function PayIcon({ kind, size = 44 }: { kind: 'wave' | 'orange_money' | 'cash'; size?: number }) {
  if (kind === 'wave') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/pay-wave.png" width={size} height={size} alt={tx("Wave")} style={{ borderRadius: size * 0.24, display: 'block', objectFit: 'cover' }} />;
  }
  if (kind === 'orange_money') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/pay-orange.png" width={size} height={size} alt={tx("Orange Money")} style={{ borderRadius: size * 0.24, display: 'block', objectFit: 'cover', border: '1px solid #e3e8e5', boxSizing: 'border-box' }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={tx("Cash")}>
      <rect width="48" height="48" rx="12" fill="#1F9D63" />
      <rect x="8" y="14" width="32" height="20" rx="3" fill="#E8F7EE" />
      <circle cx="24" cy="24" r="5.500" fill="#1F9D63" />
      <circle cx="13" cy="24" r="1.800" fill="#1F9D63" />
      <circle cx="35" cy="24" r="1.800" fill="#1F9D63" />
      <path d="M22.500 24h3M24 22.300v3.400" stroke="#E8F7EE" strokeWidth="1.500" strokeLinecap="round" />
    </svg>
  );
}

import { tx } from '@/lib/i18n/tr';
/** Marks for the three ways of paying. All three marks are drawn inline, so no image files are needed. */
export default function PayIcon({ kind, size = 44 }: { kind: 'wave' | 'orange_money' | 'cash'; size?: number }) {
  if (kind === 'wave') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={tx("Wave")}>
        <rect width="48" height="48" rx="12" fill="#1DA1F2" />
        <path d="M9 22c3-4 6-4 9 0s6 4 9 0 6-4 9 0" fill="none" stroke="#fff" strokeWidth="3.200" strokeLinecap="round" />
        <path d="M9 31c3-4 6-4 9 0s6 4 9 0 6-4 9 0" fill="none" stroke="#fff" strokeWidth="3.200" strokeLinecap="round" opacity=".75" />
      </svg>
    );
  }
  if (kind === 'orange_money') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={tx("Orange Money")}>
        <rect width="48" height="48" rx="12" fill="#FF7900" />
        <rect x="9" y="9" width="30" height="30" rx="6" fill="#fff" opacity=".18" />
        <text x="24" y="30" textAnchor="middle" fontSize="17" fontWeight="800" fontFamily="Arial, sans-serif" fill="#fff">OM</text>
      </svg>
    );
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

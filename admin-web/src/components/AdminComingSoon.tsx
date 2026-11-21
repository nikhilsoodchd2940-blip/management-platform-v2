'use client';

import { Hourglass } from 'lucide-react';
import { useLocale } from '@/lib/i18n/LocaleContext';

/**
 * Used for admin sidebar destinations with no real feature behind them
 * yet — same reasoning as the mobile app's ComingSoonScreen (see
 * mobile/lib/features/content/coming_soon_screen.dart): shows this
 * instead of a broken page or fabricated data, so it's obvious this is
 * a real gap rather than something quietly not working.
 */
export default function AdminComingSoon({ title, description }: { title: string; description?: string }) {
  const { t } = useLocale();
  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '1.5rem' }}>{title}</h1>
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '3rem 2rem',
          gap: '0.75rem',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--accent-soft, #e0e7ff)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Hourglass size={26} color="var(--accent, #4338ca)" />
        </div>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>{t.common.comingSoon}</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.88rem', maxWidth: 420, margin: 0 }}>
          {description ?? t.common.comingSoonDefault(title)}
        </p>
      </div>
    </div>
  );
}

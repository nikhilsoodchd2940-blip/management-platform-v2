'use client';

import { useSyncExternalStore } from 'react';
import { LANGS, getLang, setLanguage, subscribe, type Lang } from '@/lib/i18n/store';

/** EN · FR · ES · IT — one tap changes the whole panel. The choice is remembered on this device. */
export default function LanguageSwitch({ className = '' }: { className?: string }) {
  const lang = useSyncExternalStore(subscribe, getLang, () => 'en' as Lang);
  return (
    <div className={`lsw ${className}`} role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.code} type="button" className={l.code === lang ? 'on' : ''} aria-pressed={l.code === lang} title={l.label} onClick={() => void setLanguage(l.code)}>
          {l.short}
        </button>
      ))}
    </div>
  );
}

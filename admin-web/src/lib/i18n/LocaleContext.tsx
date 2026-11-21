'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { dictionary, getLang, getVersion, initLanguage, intlLocale, isReady, setOverrides, subscribe, type Lang, type StringMap } from './store';
import type { Dictionary } from './translations';

interface TextValue {
  t: Dictionary;
  lang: Lang;
  /** BCP-47 tag for Intl / toLocale*String. */
  intlLocale: string;
  /** Formats a Date, Firestore-like `{seconds}` or epoch ms. */
  formatDate: (value: Date | number | { seconds: number } | null | undefined, withTime?: boolean) => string;
}

function make(): TextValue {
  const locale = intlLocale();
  return {
    t: dictionary(),
    lang: getLang(),
    intlLocale: locale,
    formatDate: (v, withTime = false) => {
      if (v === null || v === undefined) return '—';
      const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : v.seconds * 1000);
      if (Number.isNaN(d.getTime())) return '—';
      return withTime ? d.toLocaleString(locale) : d.toLocaleDateString(locale);
    },
  };
}

let cached: { v: number; value: TextValue } | null = null;
function snapshot(): TextValue {
  const v = getVersion();
  if (!cached || cached.v !== v) cached = { v, value: make() };
  return cached.value;
}

/** Loads the saved language once and keeps the admin-edited texts of the current language live. */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void initLanguage();
  }, []);
  return <>{children}</>;
}

/**
 * Re-draws the screen below it whenever the language or an edited text changes,
 * so every text — including the ones written straight into a screen — follows.
 * Sits inside AuthProvider so signing in is not interrupted.
 */
export function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const version = useSyncExternalStore(subscribe, getVersion, () => 0);
  const lang = useSyncExternalStore(subscribe, getLang, () => 'en' as Lang);
  const ready = useSyncExternalStore(subscribe, isReady, () => false);
  const scroll = useRef({ win: 0, main: 0 });

  // Remembers where the page was scrolled, so redrawing for a new text keeps the place.
  useEffect(() => {
    const main = () => document.getElementById('main-content');
    const save = () => {
      scroll.current = { win: window.scrollY, main: main()?.scrollTop ?? 0 };
    };
    window.addEventListener('scroll', save, true);
    return () => window.removeEventListener('scroll', save, true);
  }, []);
  useLayoutEffect(() => {
    const { win, main } = scroll.current;
    window.scrollTo(0, win);
    const el = document.getElementById('main-content');
    if (el) el.scrollTop = main;
  }, [version]);

  useEffect(() => {
    if (!ready) return;
    const unsub = onSnapshot(
      doc(db, 'translations', lang),
      (snap) => {
        const raw = (snap.data()?.strings ?? {}) as StringMap;
        setOverrides(lang, raw);
      },
      () => {
        /* offline or rules not deployed yet: the built-in texts stay */
      }
    );
    return unsub;
  }, [lang, ready]);

  if (!ready) return null;
  return <Fragment key={version}>{children}</Fragment>;
}

/** UI text + date formatting. Kept as a hook so screens read text the same way everywhere. */
export function useLocale(): TextValue {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

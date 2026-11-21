'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { tx } from '@/lib/i18n/tr';
import { DATA_ERROR_EVENT, TOAST_EVENT, type ToastDetail } from '@/lib/notify';
import { useLocale } from '@/lib/i18n/LocaleContext';

const AUTO_DISMISS_MS = { success: 4000, info: 5000, error: 9000 } as const;

/**
 * Renders everything dispatched through lib/notify.ts, plus a single
 * (de-duplicated) message when any live Firestore query fails — so a
 * permission or network problem is visible instead of leaving a page
 * silently empty.
 */
export default function ToastHost() {
  const { t } = useLocale();
  const [toasts, setToasts] = useState<ToastDetail[]>([]);
  const lastDataError = useRef<{ code: string; at: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    function push(toast: ToastDetail) {
      setToasts((prev) => [...prev.slice(-3), toast]);
      window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== toast.id)), AUTO_DISMISS_MS[toast.kind]);
    }

    function onToast(e: Event) {
      push((e as CustomEvent<ToastDetail>).detail);
    }

    function onDataError(e: Event) {
      const code = (e as CustomEvent<string>).detail;
      const now = Date.now();
      // A failing page can fire several listener errors at once — show one message per few seconds.
      if (lastDataError.current && now - lastDataError.current.at < 6000) return;
      lastDataError.current = { code, at: now };
      const msg =
        code === 'permission-denied'
          ? tRef.current.shell.permissionDenied
          : code === 'unavailable'
            ? tRef.current.shell.unavailable
            : tRef.current.shell.loadFailed;
      push({ id: now + Math.random(), kind: 'error', message: msg });
    }

    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(DATA_ERROR_EVENT, onDataError);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(DATA_ERROR_EVENT, onDataError);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          {toast.kind === 'success' ? <CheckCircle2 size={18} /> : toast.kind === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />}
          <span className="toast-message">{tx(toast.message)}</span>
          <button
            type="button"
            className="toast-close"
            aria-label={t.shell.dismiss}
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== toast.id))}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

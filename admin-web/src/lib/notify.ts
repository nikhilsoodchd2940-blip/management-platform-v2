/**
 * Tiny app-wide notification bus. Pages call `notify('…', 'success')`
 * instead of `window.alert()`, which blocks the whole tab, can't be
 * styled, and is suppressed entirely by some browsers when a tab is in
 * the background. <ToastHost /> (mounted once in the dashboard layout)
 * renders whatever is dispatched here.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastDetail {
  id: number;
  kind: ToastKind;
  message: string;
}

export const TOAST_EVENT = 'admin:toast';
export const DATA_ERROR_EVENT = 'admin:data-error';

let seq = 0;

export function notify(message: string, kind: ToastKind = 'info') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { id: ++seq, kind, message } }));
}

/** Called by the wrapped onSnapshot (lib/firestore.ts) when a live query fails. */
export function reportDataError(err: unknown) {
  if (typeof window === 'undefined') return;
  const code = (err as { code?: string } | null)?.code ?? 'unknown';
  window.dispatchEvent(new CustomEvent<string>(DATA_ERROR_EVENT, { detail: code }));
}

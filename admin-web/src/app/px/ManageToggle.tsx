'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tx } from '@/lib/i18n/tr';

/**
 * The create/edit tools of a screen. They open as their own full page on top of the
 * screen (no scrolling down to find them) and close with the Close button or Escape.
 * The screen below keeps its place.
 */
export default function ManageToggle({ title, children, openSignal = 0, closeSignal = 0, hideButton = false }: { title: string; children: ReactNode; openSignal?: number; closeSignal?: number; hideButton?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  useEffect(() => {
    if (closeSignal > 0) setOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {false && !hideButton && (
        <button type="button" className="manage-open" onClick={() => setOpen(true)}>
          {title}
        </button>
      )}
      {open && mounted &&
        createPortal(
          <div className="manage-page" role="dialog" aria-modal="true" aria-label={title}>
            <div className="manage-page-bar">
              <strong>{title}</strong>
              <button type="button" className="manage-close" onClick={() => setOpen(false)}>
                {tx("Close")}
              </button>
            </div>
            <div className="manage-page-body">{children}</div>
          </div>,
          document.body
        )}
    </>
  );
}

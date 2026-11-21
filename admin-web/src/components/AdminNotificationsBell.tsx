'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, limit, orderBy, query, where } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { Bell } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { tx } from '@/lib/i18n/tr';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  type?: 'resource_request' | 'logistics' | 'performance_selection' | 'event_schedule' | 'meeting';
  relatedId?: string;
  createdAt?: { seconds: number };
}

const READ_KEY = 'adminNotificationsRead';

/**
 * Bell + dropdown for the current admin's own notifications (approval
 * needed, request approved/rejected, moved to next level, logistics
 * assigned/dispatched/delivered). Reads the SAME `notifications`
 * collection the mobile app's NotificationsScreen reads — an admin is
 * an ordinary Firebase Auth user, so their uid is a valid `userId`
 * there (see functions/src/utils/notify.ts). "Unread" is tracked per
 * browser (localStorage timestamp) rather than a `read` field on the
 * doc, since the mobile reader has no such field.
 */
export default function AdminNotificationsBell() {
  const { user } = useAuth();
  const { t, formatDate } = useLocale();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setReadIds(JSON.parse(window.localStorage.getItem(READ_KEY) ?? '[]') as string[]);
    } catch {
      /* storage unavailable — everything just shows as unread */
    }
  }, []);

  function saveRead(ids: string[]) {
    const next = Array.from(new Set(ids)).slice(-200);
    setReadIds(next);
    try {
      window.localStorage.setItem(READ_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'notifications'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationRow, 'id'>) }))),
      () => setItems([])
    );
  }, [user]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const isNew = (n: NotificationRow) => !readIds.includes(n.id);
  const unread = items.filter(isNew).length;

  function toggle() {
    setOpen((o) => !o);
  }

  /** Opens what the notification is about, and marks it as read. */
  async function openItem(n: NotificationRow) {
    saveRead([...readIds, n.id]);
    setOpen(false);
    let href = '/dashboard/resource-requests';
    if (/^Book (suggested|approved|refused):/.test(n.title)) href = '/dashboard/events';
    else if (n.type === 'meeting') href = n.relatedId ? `/dashboard/meetings?open=${n.relatedId}` : '/dashboard/meetings';
    else if (n.type === 'logistics') href = '/dashboard/logistics';
    else if (n.type === 'performance_selection' || n.type === 'event_schedule') {
      href = '/dashboard/events';
      if (n.relatedId) {
        try {
          const slot = await getDoc(doc(db, 'eventSlots', n.relatedId));
          const eventId = slot.exists() ? (slot.data().eventId as string | undefined) : undefined;
          if (eventId) href = `/dashboard/events/${eventId}`;
        } catch {
          /* fall back to the events page */
        }
      }
    }
    router.push(href);
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggle}
        aria-label={t.notifications.ariaLabel}
        className="secondary"
        style={{ position: 'relative', padding: '0.5rem 0.6rem', display: 'inline-flex', alignItems: 'center' }}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              background: 'var(--danger)',
              color: '#fff',
              borderRadius: 999,
              fontSize: '0.62rem',
              fontWeight: 800,
              minWidth: 16,
              height: 16,
              display: 'grid',
              placeItems: 'center',
              padding: '0 4px',
            }}
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 340,
            maxHeight: 420,
            overflowY: 'auto',
            padding: '0.5rem',
            zIndex: 30,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {items.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', padding: '0.75rem', margin: 0 }}>{t.notifications.empty}</p>
          ) : (
            <>
              {unread > 0 && (
                <button type="button" className="secondary" style={{ width: '100%', marginBottom: 6, padding: '0.35rem' }} onClick={() => saveRead([...readIds, ...items.map((i) => i.id)])}>
                  {tx("Mark all as read")}
                </button>
              )}
              {items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => openItem(n)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', color: 'inherit', padding: '0.6rem 0.7rem', borderRadius: 10, background: isNew(n) ? '#fff8e7' : 'transparent' }}
                >
                  <strong style={{ fontSize: '0.82rem', display: 'block' }}>{n.title}</strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>{n.body}</span>
                  {n.createdAt && (
                    <small style={{ display: 'block', fontSize: '0.66rem', color: 'var(--ink-soft)', marginTop: 2 }}>
                      {formatDate(n.createdAt, true)}
                    </small>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

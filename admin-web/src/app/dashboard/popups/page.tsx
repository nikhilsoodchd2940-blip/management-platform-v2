'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { createPopup as createPopupFn, updatePopup as updatePopupFn, deletePopup as deletePopupFn } from '@/lib/functions';
import CommsHeader from '@/components/CommsHeader';
import { useLocale } from '@/lib/i18n/LocaleContext';

interface Popup {
  id: string;
  title: string;
  imageUrl?: string;
  description?: string;
  linkUrl?: string;
  order: number;
  active: boolean;
}

export default function PopupsPage() {
  const { t } = useLocale();
  const p18 = t.popups;
  const [popups, setPopups] = useState<Popup[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'popups'), orderBy('order')), (snap) => {
      setPopups(
        snap.docs.map((d) => ({
          id: d.id,
          title: (d.data().title as string) || '',
          imageUrl: (d.data().imageUrl as string) || undefined,
          description: (d.data().description as string) || undefined,
          linkUrl: (d.data().linkUrl as string) || undefined,
          order: (d.data().order as number) ?? 0,
          active: d.data().active !== false,
        }))
      );
      setLoading(false);
    });
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim()) {
      setFormError(p18.titleRequired);
      return;
    }
    setUploading(true);
    try {
      let imageUrl: string | undefined;
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        const path = `popupImages/${Date.now()}_${file.name}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, file, { contentType: file.type || 'image/jpeg' });
        imageUrl = await getDownloadURL(ref);
      }
      const nextOrder = popups.length > 0 ? Math.max(...popups.map((p) => p.order)) + 1 : 0;
      await createPopupFn({
        title: title.trim(),
        imageUrl,
        description: description || undefined,
        linkUrl: linkUrl || undefined,
        order: nextOrder,
        active: true,
      });
      setTitle('');
      setDescription('');
      setLinkUrl('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setFormError(err instanceof Error ? err.message : p18.addFailed);
    } finally {
      setUploading(false);
    }
  }

  async function handleToggleActive(popup: Popup) {
    setRowError(null);
    setRowBusyId(popup.id);
    try {
      await updatePopupFn({ popupId: popup.id, active: !popup.active });
    } catch (err) {
      setRowError(err instanceof Error ? err.message : p18.updateFailed);
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleMove(popup: Popup, direction: 'up' | 'down') {
    const idx = popups.findIndex((p) => p.id === popup.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= popups.length) return;
    const other = popups[swapIdx];
    setRowError(null);
    setRowBusyId(popup.id);
    try {
      await Promise.all([
        updatePopupFn({ popupId: popup.id, order: other.order }),
        updatePopupFn({ popupId: other.id, order: popup.order }),
      ]);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : p18.reorderFailed);
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleDelete(popup: Popup) {
    if (!confirm(p18.confirmDelete(popup.title))) return;
    setRowError(null);
    setRowBusyId(popup.id);
    try {
      await deletePopupFn({ popupId: popup.id });
    } catch (err) {
      setRowError(err instanceof Error ? err.message : p18.deleteFailed);
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <div>
      <CommsHeader />

      <div className="split">
        <div className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{p18.allPopups}</h2>
          {rowError && <p className="error-text">{rowError}</p>}
          {loading ? (
            <p style={{ color: 'var(--ink-soft)' }}>{t.common.loading}</p>
          ) : popups.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>{p18.none}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {popups.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '0.75rem',
                    opacity: p.active ? 1 : 0.55,
                  }}
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external Storage URL, not a local/optimizable asset
                    <img src={p.imageUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 64, height: 64, borderRadius: 6, background: 'var(--line)', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: '0.9rem' }}>{p.title}</strong>
                    {p.description && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '0.15rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.description}
                      </p>
                    )}
                    <span className="badge" style={{ background: 'var(--line)', color: 'var(--ink-soft)', fontSize: '0.72rem' }}>
                      {p.active ? p18.active : p18.inactive}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <button className="btn btn-secondary" disabled={i === 0 || rowBusyId === p.id} onClick={() => handleMove(p, 'up')}>
                      ▲
                    </button>
                    <button className="btn btn-secondary" disabled={i === popups.length - 1 || rowBusyId === p.id} onClick={() => handleMove(p, 'down')}>
                      ▼
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <button className="btn btn-secondary" disabled={rowBusyId === p.id} onClick={() => handleToggleActive(p)}>
                      {p.active ? p18.deactivate : p18.activate}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: 'var(--danger, #c0392b)' }}
                      disabled={rowBusyId === p.id}
                      onClick={() => handleDelete(p)}
                    >
                      {p18.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleAdd} className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{p18.addTitle}</h2>
          <div className="field">
            <label htmlFor="p-title">{p18.titleLabel}</label>
            <input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="p-description">{p18.descriptionLabel}</label>
            <textarea
              id="p-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid var(--line)', borderRadius: 'var(--radius)', fontSize: '0.95rem' }}
            />
          </div>
          <div className="field">
            <label htmlFor="p-image">{p18.imageLabel}</label>
            <input id="p-image" ref={fileInputRef} type="file" accept="image/*" />
          </div>
          <div className="field">
            <label htmlFor="p-link">{p18.linkLabel}</label>
            <input id="p-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
          </div>
          {formError && <p className="error-text">{formError}</p>}
          <button type="submit" className="btn btn-primary" disabled={uploading} style={{ width: '100%' }}>
            {uploading ? p18.saving : p18.submit}
          </button>
        </form>
      </div>
    </div>
  );
}

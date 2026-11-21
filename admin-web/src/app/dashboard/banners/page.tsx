'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { createBanner as createBannerFn, updateBanner as updateBannerFn, deleteBanner as deleteBannerFn } from '@/lib/functions';
import CommsHeader from '@/components/CommsHeader';
import { useLocale } from '@/lib/i18n/LocaleContext';

interface Banner {
  id: string;
  imageUrl: string;
  linkUrl?: string;
  order: number;
  active: boolean;
}

export default function BannersPage() {
  const { t } = useLocale();
  const b18 = t.banners;
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);

  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'banners'), orderBy('order')), (snap) => {
      setBanners(
        snap.docs.map((d) => ({
          id: d.id,
          imageUrl: d.data().imageUrl as string,
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
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setFormError(b18.chooseImage);
      return;
    }
    setUploading(true);
    try {
      const path = `bannerImages/${Date.now()}_${file.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file, { contentType: file.type || 'image/jpeg' });
      const imageUrl = await getDownloadURL(ref);
      const nextOrder = banners.length > 0 ? Math.max(...banners.map((b) => b.order)) + 1 : 0;
      await createBannerFn({ imageUrl, linkUrl: linkUrl || undefined, order: nextOrder, active: true });
      setLinkUrl('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setFormError(err instanceof Error ? err.message : b18.addFailed);
    } finally {
      setUploading(false);
    }
  }

  async function handleToggleActive(banner: Banner) {
    setRowError(null);
    setRowBusyId(banner.id);
    try {
      await updateBannerFn({ bannerId: banner.id, active: !banner.active });
    } catch (err) {
      setRowError(err instanceof Error ? err.message : b18.updateFailed);
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleMove(banner: Banner, direction: 'up' | 'down') {
    const idx = banners.findIndex((b) => b.id === banner.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= banners.length) return;
    const other = banners[swapIdx];
    setRowError(null);
    setRowBusyId(banner.id);
    try {
      await Promise.all([
        updateBannerFn({ bannerId: banner.id, order: other.order }),
        updateBannerFn({ bannerId: other.id, order: banner.order }),
      ]);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : b18.reorderFailed);
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleEditLink(banner: Banner) {
    const next = window.prompt(b18.linkPrompt, banner.linkUrl ?? '');
    if (next === null) return;
    setRowError(null);
    setRowBusyId(banner.id);
    try {
      await updateBannerFn({ bannerId: banner.id, linkUrl: next.trim() || undefined });
    } catch (err) {
      setRowError(err instanceof Error ? err.message : b18.updateLinkFailed);
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleDelete(banner: Banner) {
    if (!confirm(b18.confirmDelete)) return;
    setRowError(null);
    setRowBusyId(banner.id);
    try {
      await deleteBannerFn({ bannerId: banner.id });
    } catch (err) {
      setRowError(err instanceof Error ? err.message : b18.deleteFailed);
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <div>
      <CommsHeader />

      <div className="split">
        <div className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{b18.allBanners}</h2>
          {rowError && <p className="error-text">{rowError}</p>}
          {loading ? (
            <p style={{ color: 'var(--ink-soft)' }}>{t.common.loading}</p>
          ) : banners.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>{b18.none}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {banners.map((b, i) => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '0.75rem',
                    opacity: b.active ? 1 : 0.55,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external Storage URL, not a local/optimizable asset */}
                  <img src={b.imageUrl} alt="" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                      <span
                        className="badge"
                        title={b18.orderTitle}
                        style={{ background: i === 0 ? 'var(--accent-soft, #e0e7ff)' : 'var(--line)', color: i === 0 ? 'var(--accent, #4338ca)' : 'var(--ink-soft)' }}
                      >
                        #{i + 1}{i === 0 ? ` · ${b18.shownFirst}` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.linkUrl || <span style={{ color: 'var(--ink-soft)' }}>{b18.noLink}</span>}
                    </div>
                    <span className="badge" style={{ background: 'var(--line)', color: 'var(--ink-soft)', fontSize: '0.72rem' }}>
                      {b.active ? b18.on : b18.off}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <button className="btn btn-secondary" disabled={i === 0 || rowBusyId === b.id} onClick={() => handleMove(b, 'up')}>
                      ▲
                    </button>
                    <button className="btn btn-secondary" disabled={i === banners.length - 1 || rowBusyId === b.id} onClick={() => handleMove(b, 'down')}>
                      ▼
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <button className="btn btn-secondary" disabled={rowBusyId === b.id} onClick={() => handleEditLink(b)}>
                      {b18.editLink}
                    </button>
                    <button className="btn btn-secondary" disabled={rowBusyId === b.id} onClick={() => handleToggleActive(b)}>
                      {b.active ? b18.deactivate : b18.activate}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: 'var(--danger, #c0392b)' }}
                      disabled={rowBusyId === b.id}
                      onClick={() => handleDelete(b)}
                    >
                      {b18.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleAdd} className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{b18.addTitle}</h2>
          <div className="field">
            <label htmlFor="b-image">{b18.imageLabel}</label>
            <input id="b-image" ref={fileInputRef} type="file" accept="image/*" />
          </div>
          <div className="field">
            <label htmlFor="b-link">{b18.linkLabel}</label>
            <input id="b-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
          </div>
          {formError && <p className="error-text">{formError}</p>}
          <button type="submit" className="btn btn-primary" disabled={uploading} style={{ width: '100%' }}>
            {uploading ? b18.uploading : b18.submit}
          </button>
        </form>
      </div>
    </div>
  );
}

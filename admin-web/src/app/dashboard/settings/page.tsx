'use client';

import { DEFAULT_CLOCKS } from '@/lib/timeZones';
import { useEffect, useState, type FormEvent } from 'react';
import { doc } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { updateOrgSettings as updateOrgSettingsFn } from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { tx } from '@/lib/i18n/tr';

export default function SettingsPage() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [supportEmail, setSupportEmail] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [clocks, setClocks] = useState<{ label: string; timeZone: string }[]>([{ label: '', timeZone: '' }, { label: '', timeZone: '' }, { label: '', timeZone: '' }, { label: '', timeZone: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'orgSettings', 'default'), (snap) => {
      const data = snap.data();
      setSupportEmail((data?.supportEmail as string) ?? '');
      setSupportPhone((data?.supportPhone as string) ?? '');
      const saved = ((data?.worldClocks as { label: string; timeZone: string }[]) ?? []).slice(0, 4);
      setClocks([0, 1, 2, 3].map((i) => (saved[i]?.label && saved[i]?.timeZone ? saved[i] : DEFAULT_CLOCKS[i])));
      setLoading(false);
    });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateOrgSettingsFn({ supportEmail, supportPhone, worldClocks: clocks });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.settings.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '1.25rem' }}>{t.settings.title}</h1>

      <form onSubmit={handleSave} className="card" style={{ maxWidth: 480 }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{t.settings.supportContact}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '-0.5rem' }}>
          {t.settings.supportHelp}
        </p>

        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>{t.common.loading}</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="s-email">{t.settings.supportEmail}</label>
              <input
                id="s-email"
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder={tx("Email address")}
              />
            </div>
            <div className="field">
              <label htmlFor="s-phone">{t.settings.supportPhone}</label>
              <input
                id="s-phone"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                placeholder="+15551234567"
              />
            </div>

            {error && <p className="error-text">{error}</p>}
            {saved && !error && <p style={{ color: 'var(--ok, #1e7e34)', fontSize: '0.85rem' }}>{t.common.saved}</p>}

        <h2 style={{ fontSize: '1.05rem', margin: '1.25rem 0 0.4rem' }}>{tx("World clocks")}</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', marginTop: 0 }}>
          {tx("Shown on the dashboard. Give each clock a label and a time zone name (for example Europe/Paris). Leave a row empty to hide it.")}
        </p>
        {clocks.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input aria-label={`Clock ${i + 1} label`} placeholder={tx("Label")} value={c.label} onChange={(e) => setClocks((prev) => prev.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
            <input aria-label={`Clock ${i + 1} time zone`} placeholder={tx("Time zone")} value={c.timeZone} onChange={(e) => setClocks((prev) => prev.map((x, k) => (k === i ? { ...x, timeZone: e.target.value } : x)))} />
          </div>
        ))}

            <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%' }}>
              {saving ? t.common.saving : t.common.save}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

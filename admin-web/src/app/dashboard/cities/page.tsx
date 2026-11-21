'use client';

import { CountryName } from '@/components/CountryFlag';
import { useState, type FormEvent } from 'react';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { createGroup as createGroupFn, archiveGroup as archiveGroupFn, deleteGroup as deleteGroupFn } from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';

export default function CitiesPage() {
  const { loading, byId, countries, cities } = useGroupHierarchy();
  const { t } = useLocale();
  const c18 = t.cities;

  const [name, setName] = useState('');
  const [countryId, setCountryId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!countryId) {
      setError(c18.chooseCountry);
      return;
    }
    setSubmitting(true);
    try {
      await createGroupFn({ name, type: 'city', parentGroupId: countryId });
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : c18.createFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive(groupId: string, label: string) {
    if (!confirm(c18.confirmArchive(label))) return;
    await archiveGroupFn({ groupId });
  }

  async function handleDelete(groupId: string, label: string) {
    if (!confirm(c18.confirmDelete(label))) return;
    setRowError(null);
    try {
      await deleteGroupFn({ groupId });
    } catch (err) {
      setRowError(err instanceof Error ? err.message : c18.deleteFailed);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '1.25rem' }}>{c18.title}</h1>

      <div className="split">
        <div className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{c18.allCities}</h2>
          {rowError && <p className="error-text">{rowError}</p>}
          {loading ? (
            <p style={{ color: 'var(--ink-soft)' }}>{t.common.loading}</p>
          ) : cities.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>{c18.none}</p>
          ) : (
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>{c18.colName}</th>
                  <th>{c18.colCountry}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cities.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.parentGroupId ? <CountryName name={byId[c.parentGroupId]?.name} size={18} /> : '—'}</td>
                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-secondary" onClick={() => handleArchive(c.id, c.name)}>
                        {c18.archive}
                      </button>
                      <button className="btn btn-secondary" style={{ color: 'var(--danger, #c0392b)' }} onClick={() => handleDelete(c.id, c.name)}>
                        {t.common.delete}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        <form onSubmit={handleCreate} className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{c18.addTitle}</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '-0.5rem' }}>
            {c18.bulkBefore}{' '}
            <a href="/dashboard/countries" style={{ color: 'var(--accent)' }}>
              {c18.bulkLink}
            </a>{' '}
            {c18.bulkAfter}
          </p>

          <div className="field">
            <label htmlFor="ci-country">{c18.countryLabel}</label>
            <select id="ci-country" required value={countryId} onChange={(e) => setCountryId(e.target.value)} disabled={loading}>
              <option value="">{loading ? t.common.loading : c18.selectCountry}</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!loading && countries.length === 0 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '0.35rem' }}>
                {c18.noCountries}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="ci-name">{c18.nameLabel}</label>
            <input id="ci-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={c18.namePlaceholder} />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? c18.submitting : c18.submit}
          </button>
        </form>
      </div>
    </div>
  );
}

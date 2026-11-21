'use client';

import { CountryName } from '@/components/CountryFlag';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import {
  createGroup as createGroupFn,
  updateGroup as updateGroupFn,
  archiveGroup as archiveGroupFn,
  deleteGroup as deleteGroupFn,
  importGroupHierarchy as importGroupHierarchyFn,
} from '@/lib/functions';
import { parseCsvWithHeader, recordsFromRows } from '@/lib/csv';
import * as XLSX from 'xlsx';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { tx } from '@/lib/i18n/tr';

interface HierarchyRow {
  country: string;
  zone?: string;
  city?: string;
  group?: string;
  rowError?: string;
}

export default function CountriesPage() {
  const { loading, mainGroups, countries } = useGroupHierarchy();
  const { t } = useLocale();
  const c18 = t.countries;

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Bulk upload (Country/City/Group hierarchy)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<HierarchyRow[]>([]);
  const [bulkParseError, setBulkParseError] = useState<string | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResults, setBulkResults] = useState<
    { country: string; city?: string; group?: string; error?: string }[] | null
  >(null);

  // A Country's parent must be a Main Group (see firebase/functions/src/modules/groups/hierarchy.ts).
  // Most orgs only ever have one, so we use it automatically instead of
  // asking the admin to pick a concept they don't otherwise need to
  // think about — creating a Country is enough on its own.
  const mainGroupId = mainGroups[0]?.id;

  const [mainGroupName, setMainGroupName] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [mainGroupSaving, setMainGroupSaving] = useState(false);
  const [mainGroupError, setMainGroupError] = useState<string | null>(null);
  const [mainGroupSaved, setMainGroupSaved] = useState(false);

  // Keep the editable name in sync with the live doc, but only while the
  // admin isn't actively mid-edit — this is the same "don't clobber
  // what they're typing" pattern any live-synced form needs.
  useEffect(() => {
    if (mainGroups[0] && !mainGroupSaving) {
      setMainGroupName(mainGroups[0].name);
    }
  }, [mainGroups, mainGroupSaving]);

  async function handleSaveMainGroupName(e: FormEvent) {
    e.preventDefault();
    if (!mainGroupId) return;
    setMainGroupError(null);
    setMainGroupSaved(false);
    setMainGroupSaving(true);
    try {
      await updateGroupFn({ groupId: mainGroupId, name: mainGroupName });
      setMainGroupSaved(true);
    } catch (err) {
      setMainGroupError(err instanceof Error ? err.message : c18.saveFailed);
    } finally {
      setMainGroupSaving(false);
    }
  }

  async function handleCreateMainGroup() {
    setSubmitting(true);
    setError(null);
    try {
      await createGroupFn({ name: newOrgName.trim(), type: 'main' });
      setNewOrgName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : c18.createFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!mainGroupId) return;
    setSubmitting(true);
    try {
      await createGroupFn({ name, type: 'country', parentGroupId: mainGroupId });
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

  function downloadHierarchyTemplate() {
    const headers = ['country', 'zone', 'city', 'group'];
    // Header row only — no example data.
    const rows = [headers];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hierarchy');
    XLSX.writeFile(wb, 'hierarchy-template.xlsx');
  }

  function handleBulkFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkResults(null);
    setBulkParseError(null);
    setBulkFileName(file.name);

    const isExcel = /\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let parsed: Record<string, string>[];
        if (isExcel) {
          const data = new Uint8Array(reader.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
          parsed = recordsFromRows(rows);
        } else {
          parsed = parseCsvWithHeader(String(reader.result ?? ''));
        }
        if (parsed.length === 0) {
          setBulkParseError(c18.emptyFile);
          setBulkRows([]);
          return;
        }
        const rows: HierarchyRow[] = parsed.map((r) => {
          const country = r['country'] ?? '';
          const zone = r['zone'] ?? r['city zone'] ?? '';
          const city = r['city'] ?? '';
          const group = r['group'] ?? r['groupname'] ?? r['group name'] ?? '';
          let rowError: string | undefined;
          if (!country) rowError = c18.missingCountry;
          else if ((group || zone) && !city) rowError = c18.cityRequired;
          return { country, zone: zone || undefined, city: city || undefined, group: group || undefined, rowError };
        });
        setBulkRows(rows);
      } catch (err) {
        setBulkParseError(err instanceof Error ? err.message : c18.readFailed);
        setBulkRows([]);
      }
    };
    reader.onerror = () => setBulkParseError(c18.readFailed);
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  function resetBulkUpload() {
    setBulkFileName(null);
    setBulkRows([]);
    setBulkParseError(null);
    setBulkResults(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleBulkUpload() {
    const validRows = bulkRows.filter((r) => !r.rowError);
    if (validRows.length === 0) return;
    setBulkUploading(true);
    setBulkResults(null);
    try {
      const chunks: HierarchyRow[][] = [];
      for (let i = 0; i < validRows.length; i += 500) chunks.push(validRows.slice(i, i + 500));

      const allResults: { country: string; city?: string; group?: string; error?: string }[] = [];
      for (const chunk of chunks) {
        const res = await importGroupHierarchyFn({
          rows: chunk.map((r) => ({ country: r.country, zone: r.zone, city: r.city, group: r.group })),
        });
        allResults.push(...res.data.results);
      }
      setBulkResults(allResults);
    } catch (err) {
      setBulkResults([{ country: '', error: err instanceof Error ? err.message : c18.importFailed }]);
    } finally {
      setBulkUploading(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '1.25rem' }}>{c18.title}</h1>

      {mainGroupId && (
        <form onSubmit={handleSaveMainGroupName} className="card" style={{ marginBottom: '1.25rem', maxWidth: 480 }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{c18.orgTitle}</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '-0.5rem' }}>
            {c18.orgHelp}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={mainGroupName}
              onChange={(e) => {
                setMainGroupName(e.target.value);
                setMainGroupSaved(false);
              }}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary" disabled={mainGroupSaving || !mainGroupName.trim()}>
              {mainGroupSaving ? t.common.saving : t.common.save}
            </button>
          </div>
          {mainGroupError && <p className="error-text">{mainGroupError}</p>}
          {mainGroupSaved && !mainGroupError && <p style={{ color: 'var(--ok, #1e7e34)', fontSize: '0.85rem' }}>{t.common.saved}</p>}
        </form>
      )}

      <div className="split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{c18.allCountries}</h2>
            {rowError && <p className="error-text">{rowError}</p>}
            {loading ? (
              <p style={{ color: 'var(--ink-soft)' }}>{t.common.loading}</p>
            ) : countries.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)' }}>{c18.none}</p>
            ) : (
              <div className="table-scroll"><table>
                <thead>
                  <tr>
                    <th>{c18.colName}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {countries.map((c) => (
                    <tr key={c.id}>
                      <td><CountryName name={c.name} size={20} /></td>
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

          {/* Bulk upload — Countries, Cities, and Groups all at once */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>{c18.bulkTitle}</h2>
              <button type="button" className="btn btn-secondary" onClick={downloadHierarchyTemplate}>
                {c18.downloadTemplate}
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
              {c18.bulkHelpBefore}{' '}
              <code>{tx("country")}</code> {c18.bulkHelpCountry} <code>{tx("city")}</code> {c18.bulkHelpCity} <code>{tx("group")}</code>{' '}
              {c18.bulkHelpGroup}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleBulkFile}
              style={{ marginBottom: '0.75rem' }}
            />

            {bulkParseError && <p className="error-text">{bulkParseError}</p>}

            {bulkFileName && bulkRows.length > 0 && (
              <div>
                <p style={{ fontSize: '0.85rem' }}>
                  <strong>{bulkFileName}</strong> — {c18.rowsRead(bulkRows.length, bulkRows.filter((r) => r.rowError).length)}
                </p>

                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                  <div className="table-scroll"><table>
                    <thead>
                      <tr>
                        <th>{c18.colCountry}</th>
                        <th>{tx("Zone")}</th>
                        <th>{c18.colCity}</th>
                        <th>{c18.colKurel}</th>
                        <th>{c18.colProblem}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.country || '—'}</td>
                          <td>{r.zone || '—'}</td>
                          <td>{r.city || '—'}</td>
                          <td>{r.group || '—'}</td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--danger, #c0392b)' }}>{r.rowError ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={bulkUploading || bulkRows.every((r) => r.rowError)}
                    onClick={handleBulkUpload}
                  >
                    {bulkUploading ? c18.importing : c18.importRows(bulkRows.filter((r) => !r.rowError).length)}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={resetBulkUpload} disabled={bulkUploading}>
                    {c18.clear}
                  </button>
                </div>
              </div>
            )}

            {bulkResults && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
                <p style={{ fontSize: '0.85rem' }}>
                  <strong>{bulkResults.filter((r) => !r.error).length}</strong> {c18.succeeded},{' '}
                  <strong>{bulkResults.filter((r) => r.error).length}</strong> {c18.failed}.
                </p>
                {bulkResults.filter((r) => r.error).length > 0 && (
                  <ul style={{ fontSize: '0.78rem', color: 'var(--danger, #c0392b)', paddingLeft: '1.2rem' }}>
                    {bulkResults
                      .filter((r) => r.error)
                      .map((r, i) => (
                        <li key={i}>
                          {[r.country, r.city, r.group].filter(Boolean).join(' / ') || c18.rowWord} : {r.error}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleCreate} className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{c18.addTitle}</h2>

          {!loading && !mainGroupId ? (
            <div>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                {c18.setupFirst}
              </p>
              <div className="field">
                <label htmlFor="org-name">{c18.orgNameLabel}</label>
                <input id="org-name" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder={c18.orgNamePlaceholder} />
              </div>
              <button type="button" className="btn btn-primary" disabled={submitting || !newOrgName.trim()} onClick={handleCreateMainGroup} style={{ width: '100%' }}>
                {submitting ? c18.setupBusy : c18.setupButton}
              </button>
            </div>
          ) : (
            <div>
              <div className="field">
                <label htmlFor="c-name">{c18.nameLabel}</label>
                <input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={c18.namePlaceholder} />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? c18.submitting : c18.submit}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

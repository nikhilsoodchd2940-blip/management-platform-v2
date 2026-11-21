'use client';

import '../../px/outils-de-gestion.css';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { createEquipment, updateEquipment, deleteEquipment, type ResourceCategory } from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { useLevels } from '@/lib/useLevels';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

interface EquipmentRow {
  id: string;
  name: string;
  category: ResourceCategory;
  description?: string;
  levelId?: string;
  quantityAvailable?: number;
  status: 'active' | 'retired';
}

const CATEGORY_KEYS: ResourceCategory[] = ['music_equipment', 'books', 'instruments', 'furniture', 'transportation', 'food', 'other'];

export default function EquipmentPage() {
  const { t } = useLocale();
  const e18 = t.equipment;
  const { levels, byId, loading: levelsLoading } = useLevels();
  const [items, setItems] = useState<EquipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [editing, setEditing] = useState<EquipmentRow | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ResourceCategory>('music_equipment');
  const [levelId, setLevelId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'equipment'), orderBy('name')),
      (snap) => {
        setItems(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              name: (x.name as string) ?? '',
              category: x.category as ResourceCategory,
              description: (x.description as string) || undefined,
              levelId: (x.levelId as string) || undefined,
              quantityAvailable: typeof x.quantityAvailable === 'number' ? (x.quantityAvailable as number) : undefined,
              status: (x.status as 'active' | 'retired') ?? 'active',
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  const visible = useMemo(
    () =>
      items.filter(
        (i) => (!levelFilter || i.levelId === levelFilter || (levelFilter === 'none' && !i.levelId)) && (!categoryFilter || i.category === categoryFilter)
      ),
    [items, levelFilter, categoryFilter]
  );

  function startEdit(item: EquipmentRow) {
    setEditing(item);
    setName(item.name);
    setCategory(item.category);
    setLevelId(item.levelId ?? '');
    setQuantity(item.quantityAvailable === undefined ? '' : String(item.quantityAvailable));
    setDescription(item.description ?? '');
  }

  function resetForm() {
    setEditing(null);
    setName('');
    setCategory('music_equipment');
    setLevelId('');
    setQuantity('');
    setDescription('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateEquipment({
          equipmentId: editing.id,
          name: name.trim(),
          category,
          levelId,
          description: description.trim(),
          quantityAvailable: quantity.trim() === '' ? null : Number(quantity),
        });
      } else {
        await createEquipment({
          name: name.trim(),
          category,
          levelId,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(quantity.trim() !== '' ? { quantityAvailable: Number(quantity) } : {}),
        });
      }
      notify(e18.saved, 'success');
      resetForm();
    } catch (err) {
      notify(err instanceof Error ? err.message : e18.saveFailed, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleLevelChange(item: EquipmentRow, newLevelId: string) {
    try {
      await updateEquipment({ equipmentId: item.id, levelId: newLevelId });
    } catch (err) {
      notify(err instanceof Error ? err.message : e18.updateFailed, 'error');
    }
  }

  async function handleToggleStatus(item: EquipmentRow) {
    try {
      await updateEquipment({ equipmentId: item.id, status: item.status === 'active' ? 'retired' : 'active' });
    } catch (err) {
      notify(err instanceof Error ? err.message : e18.updateFailed, 'error');
    }
  }

  async function handleDelete(item: EquipmentRow) {
    if (!confirm(e18.confirmDelete(item.name))) return;
    try {
      const res = await deleteEquipment({ equipmentId: item.id });
      notify(res.data.retired ? e18.retiredNotice : e18.deleted, 'success');
      if (editing?.id === item.id) resetForm();
    } catch (err) {
      notify(err instanceof Error ? err.message : e18.deleteFailed, 'error');
    }
  }

  return (
    <div className="px px-outils-de-gestion">
      <div className="content">
      <div className="section-head">
        <div>
          <h1>{e18.title}</h1>
          <p>{e18.subtitle}</p>
        </div>
      </div>

      <div className="kpis">
        <article className="card kpi"><span>{tx("Catalog items")}</span><strong>{items.length}</strong><small>{items.filter((i) => i.status === 'active').length} {tx("active")}</small></article>
        <article className="card kpi"><span>{tx("Without a level")}</span><strong>{items.filter((i) => !i.levelId).length}</strong><small>{tx("No kurel can request them")}</small></article>
        <article className="card kpi"><span>{tx("Retired")}</span><strong>{items.filter((i) => i.status === 'retired').length}</strong><small>{tx("Hidden from requests")}</small></article>
      </div>

      <div className="split split-wide">
        <section className="card" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{e18.items}</h2>
              <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: '0.8rem' }}>{e18.shown(visible.length)}</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} aria-label={e18.colLevel}>
                <option value="">{e18.allLevels}</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="none">{e18.noLevel}</option>
              </select>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label={e18.colCategory}>
                <option value="">{e18.allCategories}</option>
                {CATEGORY_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {e18.categories[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <p>{t.common.loading}</p>
          ) : items.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>{e18.none}</p>
          ) : visible.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>{e18.noMatch}</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{e18.colName}</th>
                    <th>{e18.colCategory}</th>
                    <th>{e18.colLevel}</th>
                    <th>{e18.colQuantity}</th>
                    <th>{e18.colStatus}</th>
                    <th>{e18.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.name}</strong>
                        {i.description && <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{i.description}</div>}
                      </td>
                      <td>{e18.categories[i.category] ?? i.category}</td>
                      <td>
                        <select
                          value={i.levelId ?? ''}
                          onChange={(e) => e.target.value && handleLevelChange(i, e.target.value)}
                          aria-label={e18.changeLevel}
                          style={i.levelId && byId[i.levelId] ? undefined : { borderColor: 'var(--danger)' }}
                        >
                          {!i.levelId && <option value="">{e18.noLevel}</option>}
                          {levels.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{i.quantityAvailable ?? e18.unlimited}</td>
                      <td>
                        <span className={`status${i.status === 'active' ? '' : ' red'}`}>{i.status === 'active' ? e18.active : e18.retired}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem' }} onClick={() => startEdit(i)}>
                          {e18.edit}
                        </button>{' '}
                        <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem' }} onClick={() => handleToggleStatus(i)}>
                          {i.status === 'active' ? e18.retire : e18.reactivate}
                        </button>{' '}
                        <button type="button" className="btn btn-danger" style={{ padding: '0.25rem 0.6rem' }} onClick={() => handleDelete(i)}>
                          {e18.delete}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>{editing ? e18.editTitle : e18.addTitle}</h2>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="eq-name">{e18.nameLabel}</label>
              <input id="eq-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="eq-category">{e18.categoryLabel}</label>
              <select id="eq-category" value={category} onChange={(e) => setCategory(e.target.value as ResourceCategory)}>
                {CATEGORY_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {e18.categories[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="eq-level">{e18.levelLabel}</label>
              <select id="eq-level" value={levelId} onChange={(e) => setLevelId(e.target.value)} required>
                <option value="">{e18.selectLevel}</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {!levelsLoading && levels.length === 0 && (
                <p className="error-text" style={{ marginTop: '0.4rem' }}>
                  {e18.noLevelsYet}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="eq-qty">{e18.quantityLabel}</label>
              <input id="eq-qty" type="number" min={0} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="eq-desc">{e18.descriptionLabel}</label>
              <input id="eq-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={saving || levels.length === 0}>
                {saving ? e18.saving : editing ? e18.save : e18.add}
              </button>
              {editing && (
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  {e18.cancelEdit}
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
      </div>
    </div>
  );
}

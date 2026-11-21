'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import MemberPicker from './MemberPicker';
import DateTimePicker from './DateTimePicker';
import { tx } from '@/lib/i18n/tr';

export interface DialogField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime-local' | 'time' | 'textarea' | 'select' | 'tel' | 'checkboxes' | 'member' | 'members';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  initial?: string;
  hint?: string;
  min?: number;
  max?: number;
  /** For member fields: the area the picker starts in. */
  area?: { country?: string; zone?: string; city?: string; localZone?: string; kurel?: string };
  /** For member fields: limit the kurel filter to these kurels. */
  kurelIds?: string[];
  /** Member fields sharing the same key cannot pick the same person (one member, one role). */
  exclusive?: string;
}

/**
 * Small modal form used by the feature screens (schedule a meeting, score an
 * evaluation, allocate an envelope…). It only collects values; validation that
 * matters is done by the Cloud Function the caller submits to, and its error
 * message is shown right inside the dialog.
 */
export default function FormDialog({
  title,
  intro,
  header,
  fields,
  submitLabel = 'Save',
  onSubmit,
  onClose,
  onValuesChange,
  children,
}: {
  title: string;
  intro?: string;
  /** Shown under the intro, above the fields (for example the weather of the event day). */
  header?: ReactNode;
  fields: DialogField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  onClose: () => void;
  /** Called whenever any field changes — lets a screen load options that depend on another field (e.g. a kurel's members). */
  onValuesChange?: (values: Record<string, string>) => void;
  children?: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onValuesChange?.(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  // The page behind a dialog must not scroll while it is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing = fields.find((f) => f.required && (f.type === 'member' || f.type === 'members') && !values[f.name]);
    if (missing) {
      setError(`Please choose: ${missing.label}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("Could not save"));
    } finally {
      setBusy(false);
    }
  }

  /** People already chosen in another field of the same exclusive group, with the role they hold. */
  const takenFor = (f: DialogField) => {
    const ids: string[] = [];
    const why: Record<string, string> = {};
    if (f.exclusive) {
      for (const o of fields) {
        if (o.name === f.name || o.exclusive !== f.exclusive) continue;
        for (const id of (values[o.name] ?? '').split(',').filter(Boolean)) {
          ids.push(id);
          why[id] = `Already ${o.label.replace(/^\d+\.\s*/, '')}`;
        }
      }
    }
    return { ids, why };
  };

  return createPortal(
    <div className="fx-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="fx-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <h2>{title}</h2>
        {intro && <p className="fx-intro">{intro}</p>}
        {header}
        <div className="fx-fields">
          {fields.map((f) => (
            <FieldWrap key={f.name} plain={f.type === 'member' || f.type === 'members'} className={`fx-field${f.type === 'textarea' || f.type === 'checkboxes' || f.type === 'member' || f.type === 'members' ? ' full' : ''}`}>
              <span>{f.label}{f.required ? ' *' : ''}</span>
              {f.type === 'member' || f.type === 'members' ? (
                <MemberPicker
                  multiple={f.type === 'members'}
                  initialArea={f.area}
                  kurelIds={f.kurelIds}
                  disabledIds={takenFor(f).ids}
                  disabledReason={takenFor(f).why}
                  value={values[f.name] ? values[f.name].split(',').filter(Boolean) : []}
                  onChange={(ids) => setValues({ ...values, [f.name]: ids.join(',') })}
                />
              ) : f.type === 'checkboxes' ? (
                <div style={{ maxHeight: 170, overflow: 'auto', border: '1px solid #e5e9e6', borderRadius: 10, padding: 8, display: 'grid', gap: 4, fontWeight: 400 }}>
                  {(f.options ?? []).length === 0 && <small>{tx("Nothing to choose from.")}</small>}
                  {(f.options ?? []).map((o) => {
                    const chosen = values[f.name] ? values[f.name].split(',') : [];
                    return (
                      <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
                        <input type="checkbox" checked={chosen.includes(o.value)} onChange={(e) => setValues({ ...values, [f.name]: (e.target.checked ? [...chosen, o.value] : chosen.filter((x) => x !== o.value)).join(',') })} />
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              ) : f.type === 'textarea' ? (
                <textarea value={values[f.name] ?? ""} required={f.required} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              ) : f.type === 'select' ? (
                <select value={values[f.name] ?? ""} required={f.required} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  <option value="">{f.placeholder ?? tx("Choose…")}</option>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'datetime-local' || f.type === 'date' || f.type === 'time' ? (
                  <DateTimePicker mode={f.type === 'datetime-local' ? 'datetime' : f.type} required={f.required} value={values[f.name] ?? ''} placeholder={f.placeholder} onChange={(v) => setValues({ ...values, [f.name]: v })} />
              ) : (
                  <input type={f.type ?? 'text'} value={values[f.name] ?? ""} required={f.required} placeholder={f.placeholder} min={f.min} max={f.max} step={f.type === 'number' ? 'any' : undefined} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              )}
              {f.hint && <small>{f.hint}</small>}
            </FieldWrap>
          ))}
        </div>
        {children}
        {error && <div className="fx-error" role="alert">{error}</div>}
        <div className="fx-actions">
          <button type="button" className="fx-btn" onClick={onClose}>{tx("Cancel")}</button>
          <button type="submit" className="fx-btn fx-primary" disabled={busy}>{busy ? tx("Saving…") : submitLabel}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}


/** Label for ordinary fields; a plain block for the member finder (it holds its own labels and lists). */
function FieldWrap({ plain, className, children }: { plain: boolean; className: string; children: ReactNode }) {
  return plain ? <div className={className}>{children}</div> : <label className={className}>{children}</label>;
}

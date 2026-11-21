'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createFinancialProgram, updateFinancialProgram } from '@/lib/functions';
import { CURRENCIES, addDays, convert, endOf, frIso, isoOf, money, startOf, useRates, type Currency, type Phase } from '@/lib/finance';
import { notify } from '@/lib/notify';
import DatePicker from '@/components/DatePicker';
import KurelPicker from './KurelPicker';
import { tx } from '@/lib/i18n/tr';

type Rec = 'none' | 'monthly' | 'quarterly' | 'yearly';
const REC_LABEL: Record<Rec, string> = { none: 'One time', monthly: 'Every month', quarterly: 'Every quarter', yearly: 'Every year' };
const REC_MONTHS: Record<Rec, number> = { none: 0, monthly: 1, quarterly: 3, yearly: 12 };
/** End of the period that starts on `iso` (the day before the next period). */
function periodEndIso(iso: string, rec: Rec) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + REC_MONTHS[rec], 1));
  t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
interface PhaseRow { name: string; amount: string; start: string; end: string }
export interface EditableProgram { id: string; name: string; description: string; currency: Currency; goalCents: number; startMs: number; endMs: number; phases: Phase[]; locked: boolean; recurrence?: Rec }

/** Create a program (everything on one screen) or edit an existing one. */
export default function ProgramForm({ onClose, edit }: { onClose: () => void; edit?: EditableProgram }) {
  const rates = useRates();
  const [name, setName] = useState(edit?.name ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [currency, setCurrency] = useState<Currency>(edit?.currency ?? 'XOF');
  const [goal, setGoal] = useState(edit ? String(edit.goalCents / 100) : '');
  const [start, setStart] = useState(edit?.startMs ? isoOf(edit.startMs) : '');
  const [end, setEnd] = useState(edit?.endMs ? isoOf(edit.endMs) : '');
  const [rec, setRec] = useState<Rec>(edit?.recurrence ?? 'none');
  const [usePhases, setUsePhases] = useState(!!edit?.phases.length);
  const [phases, setPhases] = useState<PhaseRow[]>(edit?.phases.length ? edit.phases.map((p) => ({ name: p.name, amount: String(p.amountCents / 100), start: p.startMs ? isoOf(p.startMs) : '', end: p.endMs ? isoOf(p.endMs) : '' })) : [{ name: 'Phase 1', amount: '', start: '', end: '' }]);
  const [all, setAll] = useState(true);
  const [kurels, setKurels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const effEnd = rec !== 'none' && start ? periodEndIso(start, rec) : end;
  const goalNum = Number(goal) || 0;
  const planned = useMemo(() => phases.reduce((n, p) => n + (Number(p.amount) || 0), 0), [phases]);
  const fmt = (n: number) => money(Math.round(n * 100), currency);
  const patch = (i: number, v: Partial<PhaseRow>) => setPhases((ps) => ps.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const switchTo = (to: Currency) => { if (to === currency || edit) return; if (goalNum > 0) setGoal(String(convert(goalNum, currency, to, rates))); setPhases((ps) => ps.map((p) => (Number(p.amount) > 0 ? { ...p, amount: String(convert(Number(p.amount), currency, to, rates)) } : p))); setCurrency(to); };
  const minFor = (i: number) => { const prev = i > 0 ? phases[i - 1].end : ''; const after = prev ? addDays(prev, 1) : ''; return [start, after].filter(Boolean).sort().pop() || undefined; };

  async function save() {
    setErr('');
    try {
      if (!name.trim()) throw new Error('Give the program a name.');
      if (!(goalNum > 0)) throw new Error('Enter the amount to collect.');
      if (rec !== 'none' && !start) throw new Error('Choose the date the first period starts.');
      if (start && end && rec === 'none' && end < start) throw new Error('The end date cannot be before the start date.');
      const used = usePhases ? phases.filter((p) => Number(p.amount) > 0) : [];
      if (usePhases && used.length === 0) throw new Error('Enter the amount of phase 1, or switch phases off.');
      if (usePhases && planned > goalNum) throw new Error(`The phases add up to ${fmt(planned)}, which is more than the total ${fmt(goalNum)}.`);
      let prevEnd = '';
      used.forEach((p, i) => {
        if (p.start && p.end && p.end < p.start) throw new Error(`Phase ${i + 1}: the end date is before the start date.`);
        if (p.start && start && p.start < start) throw new Error(`Phase ${i + 1} cannot start before the program starts.`);
        if (p.end && effEnd && p.end > effEnd) throw new Error(`Phase ${i + 1} cannot end after the program ends (${frIso(effEnd)}).`);
        if (p.start && prevEnd && p.start <= prevEnd) throw new Error(`Phase ${i + 1} must start after phase ${i} ends (${frIso(prevEnd)}).`);
        if (p.end) prevEnd = p.end;
      });
      if (!edit && !all && kurels.length === 0) throw new Error('Choose at least one kurel, or choose all kurels.');
      const ph = used.map((p, i) => ({ name: p.name.trim() || `Phase ${i + 1}`, amountCents: Math.round(Number(p.amount) * 100), ...(p.start ? { startMs: startOf(p.start) } : {}), ...(p.end ? { endMs: endOf(p.end) } : {}) }));
      setBusy(true);
      if (edit) {
        await updateFinancialProgram({ programId: edit.id, name: name.trim(), description: description.trim(), goalAmountCents: Math.round(goalNum * 100), recurrence: rec, startMs: start ? startOf(start) : null, deadlineMs: effEnd ? endOf(effEnd) : null, phases: ph });
        notify('Program updated', 'success');
      } else {
        await createFinancialProgram({ name: name.trim(), description: description.trim() || undefined, currency, goalAmountCents: Math.round(goalNum * 100), ...(rec !== 'none' ? { recurrence: rec } : {}), ...(start ? { startMs: startOf(start) } : {}), ...(effEnd ? { deadlineMs: endOf(effEnd) } : {}), ...(usePhases ? { phases: ph } : {}), ...(all ? {} : { groupIds: kurels }) });
        notify('Program created', 'success');
      }
      onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fm" role="dialog" aria-modal="true" aria-label={edit ? tx("Edit the program") : tx("Create a program")}>
        <header><div><h2>{edit ? `Edit · ${edit.name}` : tx("Create a program")}</h2><p>{edit ? tx("Change the details, the dates and the phases.") : tx("Fill the sections from top to bottom.")}</p></div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="fm-body">
          <section className="fm-sec">
            <h3>{tx("1 · What is it for")}</h3>
            <label className="fm-f">{tx("Name")}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="fm-f">{tx("Description")}<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          </section>
          <section className="fm-sec">
            <h3>{tx("2 · Amount and dates")}</h3>
            <div className="fm-goal">
              <label className="fm-f">{tx("Total to collect")}<input type="number" min={0} step="any" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={tx("Add amount")} /></label>
              <div className="fm-cur" role="group" aria-label={tx("Currency")}>{CURRENCIES.map((c) => <button type="button" key={c} className={c === currency ? 'on' : ''} disabled={!!edit && c !== currency} onClick={() => setCurrency(c)}>{c}</button>)}</div>
            </div>
            {edit ? (
              <p className="fm-note">{tx("The currency (")}{currency}{tx(") cannot change after the program is created.")}</p>
            ) : (
              <div className="fm-conv">
                <span>{tx("Convert")}</span>
                {CURRENCIES.filter((c) => c !== currency).map((c) => <button type="button" key={c} onClick={() => switchTo(c)}>{tx("to")} {c}{goalNum > 0 ? ` · ${new Intl.NumberFormat('en-US', { maximumFractionDigits: c === 'XOF' ? 0 : 2 }).format(convert(goalNum, currency, c, rates))}` : ''}</button>)}
                <em>{rates.live ? tx("Live rates") : tx("Approximate rates")}{tx(": 1 USD =")} {rates.xofPerUsd.toFixed(1)} {tx("XOF · 1 EUR =")} {rates.xofPerEur.toFixed(1)} XOF</em>
              </div>
            )}
            <div className="fm-sw-h">{tx("Repeats")}</div>
            <div className="fm-cur wide" role="group" aria-label={tx("Repeats")}>{(Object.keys(REC_LABEL) as Rec[]).map((r) => <button type="button" key={r} className={r === rec ? 'on' : ''} onClick={() => { setRec(r); if (r !== 'none' && !start) setStart(isoOf(Date.now())); }}>{REC_LABEL[r]}</button>)}</div>
            {rec !== 'none' && <p className="fm-note">{tx("Each period is its own program with the same total. When one ends, the next is created automatically and Top Management is told. The previous targets are copied as drafts to adjust and share.")}</p>}
            <div className="fm-2">
              <DatePicker label={rec !== 'none' ? tx("First period starts") : tx("Start date")} value={start} onChange={(v) => { setStart(v); if (end && v && end < v) setEnd(''); }} max={rec === 'none' ? end || undefined : undefined} />
              {rec === 'none' ? <DatePicker label={tx("End date")} value={end} onChange={setEnd} min={start || undefined} /> : <div className="fm-f"><span>{tx("Each period ends")}</span><b style={{ display: 'block', padding: '10px 0' }}>{start ? frIso(effEnd) : tx("Pick a start date")}</b></div>}
            </div>
          </section>
          <section className="fm-sec">
            <h3>{tx("3 · Phases")}</h3>
            <label className="fm-sw"><input type="checkbox" checked={usePhases} onChange={(e) => setUsePhases(e.target.checked)} /><span><b>{tx("Collect in phases")}</b><small>{usePhases ? tx("Each phase has its own amount and dates. Phase 2 opens once phase 1 is complete or its end date has passed.") : `No phase: the whole ${goalNum > 0 ? fmt(goalNum) : 'amount'} is collected at once.`}</small></span></label>
            {usePhases && (
              <div className="fm-phs">
                {phases.map((p, i) => (
                  <div className="fm-phase" key={i}>
                    <div className="fm-phase-top">
                      <b>{i + 1}</b>
                      <input value={p.name} onChange={(e) => patch(i, { name: e.target.value })} aria-label={`Name of phase ${i + 1}`} />
                      <input type="number" min={0} step="any" placeholder={tx("Add amount")} value={p.amount} onChange={(e) => patch(i, { amount: e.target.value })} aria-label={`Amount of phase ${i + 1}`} />
                      <button type="button" aria-label={tx("Remove the phase")} disabled={phases.length <= 1} onClick={() => setPhases((ps) => ps.filter((_, j) => j !== i))}>×</button>
                    </div>
                    <div className="fm-2">
                      <DatePicker label={tx("Starts")} value={p.start} onChange={(v) => patch(i, { start: v, end: p.end && v && p.end < v ? '' : p.end })} min={minFor(i)} max={p.end || end || undefined} />
                      <DatePicker label={tx("Ends")} value={p.end} onChange={(v) => patch(i, { end: v })} min={p.start || minFor(i)} max={end || undefined} />
                    </div>
                  </div>
                ))}
                <div className="fm-ph-bar"><button type="button" onClick={() => setPhases((ps) => [...ps, { name: `Phase ${ps.length + 1}`, amount: '', start: '', end: '' }])}>{tx("+ Add a phase")}</button><span className={planned > goalNum && goalNum > 0 ? 'bad' : ''}>{tx("Planned")} {fmt(planned)} {tx("of")} {fmt(goalNum)}</span></div>
              </div>
            )}
          </section>
          {!edit && (
            <section className="fm-sec">
              <h3>{tx("4 · Who gets it")}</h3>
              <div className="fm-cur wide" role="group" aria-label={tx("Who gets it")}><button type="button" className={all ? 'on' : ''} onClick={() => setAll(true)}>{tx("All kurels")}</button><button type="button" className={!all ? 'on' : ''} onClick={() => setAll(false)}>{tx("Choose kurels")}</button></div>
              {all ? <p className="fm-note">{tx("Every kurel takes part. Later you can allocate the envelope by country, city, local zone or kurel.")}</p> : <KurelPicker selected={kurels} onChange={setKurels} height={200} />}
            </section>
          )}
        </div>
        <footer>{err && <span className="fm-err">{err}</span>}<button type="button" className="fm-ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="fm-go" disabled={busy} onClick={save}>{busy ? tx("Saving…") : edit ? tx("Save the changes") : tx("Create the program")}</button></footer>
      </div>
    </div>,
    document.body
  );
}

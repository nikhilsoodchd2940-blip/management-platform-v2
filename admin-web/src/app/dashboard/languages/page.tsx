'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteField, doc, FieldPath, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Dropdown from '@/components/Dropdown';
import { LANGS, builtIn, dictionaryEntries, type Lang, type StringMap } from '@/lib/i18n/store';
import catalog from '@/lib/i18n/catalog.json';
import { Banner, Kpis } from '@/components/kit';
import { tx } from '@/lib/i18n/tr';
import { translateTexts } from '@/lib/functions';

/** Entries that are the same in every language (numbers only…): never listed as missing. */
const NEUTRAL = new Set(['@levels.booksUsage', '@members.assigned']);

type Row = { key: string; group: string; en: string; template: boolean };
type Status = '' | 'missing' | 'edited' | 'auto' | 'built-in';

/** Kept outside the component so the screen keeps its place when the app redraws after a saved text. */
const ui = { lang: 'fr' as Lang, q: '', group: '', status: '' as Status, shown: 40, order: '' };

const GROUP_NAMES: Record<string, string> = {
  common: 'Common words', sidebar: 'Side menu', shell: 'Page frame', login: 'Sign-in', dashboard: 'Dashboard', members: 'Members', events: 'Events', eventDetail: 'Event page', groups: 'Kurels', levels: 'Levels',
  shared: 'Shared parts', tasks: 'Tasks', meetings: 'Meetings', help: 'Help', settings: 'Settings', donations: 'Finance', logistics: 'Logistics', messagerie: 'Messaging', approvals: 'Approvals',
  'programme-pedagogique': 'Pedagogical committee', programmePedagogique: 'Pedagogical committee', 'role-access': 'Roles & access', organigramme: 'Organization chart', 'membres-en-ligne': 'Members online', mobile: 'Mobile app',
};
const groupName = (g: string) => tx(GROUP_NAMES[g] ?? g.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

export default function LanguagesPage() {
  const [lang, setLangState] = useState<Lang>(ui.lang);
  const [q, setQState] = useState(ui.q);
  const [group, setGroupState] = useState(ui.group);
  const [status, setStatusState] = useState<Status>(ui.status);
  const [shown, setShownState] = useState(ui.shown);
  const [over, setOver] = useState<Partial<Record<Lang, StringMap>>>({});
  const [base, setBase] = useState<StringMap>({});
  const [enb, setEnb] = useState<StringMap>({});
  const [autoMap, setAutoMap] = useState<Partial<Record<Lang, Record<string, boolean>>>>({});
  const [order, setOrderState] = useState(ui.order);
  const setOrder = (v: string) => { ui.order = v; setOrderState(v); };
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const setLang = (v: Lang) => { ui.lang = v; ui.shown = 40; setShownState(40); setLangState(v); };
  const setQ = (v: string) => { ui.q = v; ui.shown = 40; setShownState(40); setQState(v); };
  const setGroup = (v: string) => { ui.group = v; ui.shown = 40; setShownState(40); setGroupState(v); };
  const setStatus = (v: Status) => { ui.status = v; ui.shown = 40; setShownState(40); setStatusState(v); };
  const showMore = () => { ui.shown += 40; setShownState(ui.shown); };

  // The admin-edited texts of every language, live.
  useEffect(() => {
    const unsubs = LANGS.map((l) =>
      onSnapshot(doc(db, 'translations', l.code), (snap) => { setOver((o) => ({ ...o, [l.code]: (snap.data()?.strings ?? {}) as StringMap })); setAutoMap((o) => ({ ...o, [l.code]: (snap.data()?.auto ?? {}) as Record<string, boolean> })); }, () => setNote(tx("The texts could not be read. Check the connection and that the rules were deployed.")))
    );
    return () => unsubs.forEach((u) => u());
  }, []);
  useEffect(() => { let on = true; void builtIn(lang).then((b) => on && setBase(b)); return () => { on = false; }; }, [lang]);
  useEffect(() => { let on = true; void builtIn('en').then((b) => on && setEnb(b)); return () => { on = false; }; }, []);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = dictionaryEntries().map((e) => ({ key: e.key, group: e.section, en: e.en, template: e.kind === 'template' }));
    for (const [text, g] of catalog as [string, string][]) out.push({ key: text, group: g, en: text, template: false });
    return out;
  }, []);

  const mine = over[lang] ?? {};
  const autos = autoMap[lang] ?? {};
  const valueOf = (r: Row) => mine[r.key] ?? base[r.key];
  const statusOf = (r: Row): Status => (mine[r.key] !== undefined ? (autos[r.key] ? 'auto' : 'edited') : lang === 'en' || NEUTRAL.has(r.key) || base[r.key] !== undefined ? 'built-in' : 'missing');

  const stats = useMemo(() => {
    let missing = 0, edited = 0;
    for (const r of rows) { const s = statusOf(r); if (s === 'missing') missing++; else if (s === 'edited' || s === 'auto') edited++; }
    return { total: rows.length, missing, edited, done: rows.length - missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mine, base, lang, autos]);

  const groups = useMemo(() => {
    const c = new Map<string, number>();
    rows.forEach((r) => c.set(r.group, (c.get(r.group) ?? 0) + 1));
    return [...c.entries()].sort((a, b) => groupName(a[0]).localeCompare(groupName(b[0]))).map(([g, n]) => ({ value: g, label: `${groupName(g)} (${n})` }));
  }, [rows]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (group && r.group !== group) return false;
      if (status && statusOf(r) !== status) return false;
      if (!term) return true;
      return (enb[r.key] ?? r.en).toLowerCase().includes(term) || (valueOf(r) ?? '').toLowerCase().includes(term);
    });
    if (order === 'az') out.sort((x, y) => (enb[x.key] ?? x.en).localeCompare(enb[y.key] ?? y.en));
    else if (order === 'missing') out.sort((x, y) => Number(statusOf(y) === 'missing') - Number(statusOf(x) === 'missing'));
    else if (order === 'section') out.sort((x, y) => groupName(x.group).localeCompare(groupName(y.group)));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, group, status, mine, base, lang, autos, enb, order]);

  async function save(key: string, value: string) {
    const ref = doc(db, 'translations', lang);
    const cur = mine[key];
    const clean = value.trim();
    try {
      if (clean === '' || (lang === 'en' && clean === key && !key.startsWith('@'))) {
        if (cur === undefined) return;
        await updateDoc(ref, new FieldPath('strings', key), deleteField(), new FieldPath('auto', key), deleteField());
      } else {
        if (clean === cur && !autos[key]) return;
        try { await updateDoc(ref, new FieldPath('strings', key), clean, new FieldPath('auto', key), deleteField(), 'updatedAt', serverTimestamp()); }
        catch { await setDoc(ref, { strings: { [key]: clean }, updatedAt: serverTimestamp() }, { merge: true }); }
      }
      setNote('');
    } catch {
      setNote(tx("Could not save. Only an administrator can change the texts."));
    }
  }

  async function translateMissing() {
    if (lang === 'en') return;
    const todo = rows.filter((r) => statusOf(r) === 'missing');
    if (!todo.length) return;
    setBusy('translate');
    setNote('');
    let done = 0;
    try {
      for (let i = 0; i < todo.length; i += 60) {
        const chunk = todo.slice(i, i + 60);
        const res = await translateTexts({ lang: lang as 'fr' | 'es' | 'it', items: chunk.map((r) => ({ key: r.key, text: r.en })) });
        const out = res.data.translations ?? {};
        const strings: StringMap = {};
        const auto: Record<string, boolean> = {};
        Object.entries(out).forEach(([k, v]) => { if (v) { strings[k] = v; auto[k] = true; } });
        if (Object.keys(strings).length) await setDoc(doc(db, 'translations', lang), { strings, auto, updatedAt: serverTimestamp() }, { merge: true });
        done += Object.keys(strings).length;
        setNote(`${tx("Translating…")} ${done} / ${todo.length}`);
      }
      setNote(`${done} ${tx("texts translated automatically. Read them and correct what you like.")}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setNote(`${tx("Automatic translation failed.")} ${msg}`);
    }
    setBusy('');
  }

  async function exportJson() {
    const out: StringMap = {};
    rows.forEach((r) => { const v = valueOf(r) ?? (lang === 'en' ? enb[r.key] ?? r.en : ''); out[r.key] = v; });
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `texts-${lang}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    setBusy('import');
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      const strings: StringMap = {};
      Object.entries(data).forEach(([k, v]) => { if (typeof v === 'string' && v.trim()) strings[k] = v.trim(); });
      // only keys that exist, and only what differs from what is shown now
      const known = new Set(rows.map((r) => r.key));
      const apply: StringMap = {};
      Object.entries(strings).forEach(([k, v]) => { if (known.has(k) && v !== (valueOf(rows.find((r) => r.key === k) as Row) ?? '')) apply[k] = v; });
      const n = Object.keys(apply).length;
      if (n) await setDoc(doc(db, 'translations', lang), { strings: apply, updatedAt: serverTimestamp() }, { merge: true });
      setNote(`${n} ${tx("texts imported.")}`);
    } catch {
      setNote(tx("That file could not be read. Use a file exported from this screen."));
    }
    setBusy('');
    if (fileRef.current) fileRef.current.value = '';
  }

  const langLabel = LANGS.find((l) => l.code === lang)?.label ?? '';
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="lg zp">
      <Banner eyebrow={tx("Translations")} title={tx("Languages & texts")} sub={tx("Every text of the admin panel and the mobile app is listed here. Change a wording and it shows on both, in that language, within seconds.")}>
        {lang !== 'en' && stats.missing > 0 && <button type="button" className="loc-btn solid" disabled={busy === 'translate'} onClick={() => void translateMissing()}>{busy === 'translate' ? tx("Translating…") : `${tx("Translate the")} ${stats.missing.toLocaleString()} ${tx("missing texts")}`}</button>}
        <button type="button" className="loc-btn ghost" onClick={() => void exportJson()}>{tx("Download language file (JSON)")}</button>
        <button type="button" className="loc-btn ghost" disabled={busy === 'import'} onClick={() => fileRef.current?.click()}>{tx("Upload edited file")}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importJson(e.target.files[0])} />
      </Banner>

      <div className="lg-tabs" role="tablist">
        {LANGS.map((l) => (
          <button key={l.code} type="button" role="tab" aria-selected={lang === l.code} className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)}>
            <b>{l.short}</b><span>{l.label}</span>
          </button>
        ))}
      </div>

      <Kpis items={[
        { icon: 'Aa', label: tx("Texts"), value: stats.total.toLocaleString(), hint: langLabel, active: !status && !group && !q, onClick: () => { setQ(''); setGroup(''); setStatus(''); } },
        { icon: '✓', label: lang === 'en' ? tx("Original wording") : tx("Translated"), value: `${pct}%`, hint: `${stats.done.toLocaleString()} ${tx("of")} ${stats.total.toLocaleString()}`, gold: true, active: status === 'built-in', onClick: () => setStatus(status === 'built-in' ? '' : 'built-in') },
        { icon: '!', label: tx("Missing"), value: stats.missing.toLocaleString(), hint: lang === 'en' ? tx("Nothing to translate") : tx("Shown in English until filled"), red: true, active: status === 'missing', onClick: () => setStatus(status === 'missing' ? '' : 'missing') },
        { icon: '✎', label: tx("Changed by you"), value: stats.edited.toLocaleString(), hint: tx("Click to list them"), gold: true, active: status === 'edited', onClick: () => setStatus(status === 'edited' ? '' : 'edited') },
      ]} />

      <div className="lg-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search a word or a sentence…")} aria-label={tx("Search")} />
        <Dropdown label={tx("Section")} value={group} onChange={setGroup} options={groups} allLabel={tx("All sections")} />
        <Dropdown
          label={tx("Status")}
          value={status}
          onChange={(v) => setStatus(v as Status)}
          allLabel={tx("All texts")}
          options={[{ value: 'missing', label: tx("Missing") }, { value: 'edited', label: tx("Changed by you") }, { value: 'auto', label: tx("Auto-translated") }, { value: 'built-in', label: tx("Built-in") }]}
        />
        <Dropdown label={tx("Order")} value={order} onChange={setOrder} allLabel={tx("Default order")} options={[{ value: 'az', label: 'A → Z' }, { value: 'section', label: tx("By section") }, { value: 'missing', label: tx("Missing first") }]} />
        {(q || group || status) && <button type="button" className="lg-clear" onClick={() => { setQ(''); setGroup(''); setStatus(''); }}>{tx("Clear")} ✕</button>}
      </div>

      {note && <p className="lg-note" role="status">{note}</p>}
      <p className="lg-count">{list.length.toLocaleString()} {tx("texts")} · {tx("Press Enter or leave the box to save. Use {0} for a number or name inside a sentence and keep it as it is.")}</p>

      <div className="lg-list">
        {list.slice(0, shown).map((r) => {
          const s = statusOf(r);
          return (
            <Entry key={`${lang}|${r.key}`} row={r} en={enb[r.key] ?? r.en} lang={lang} value={valueOf(r) ?? ''} status={s} onSave={(v) => void save(r.key, v)} onReset={() => void save(r.key, '')} />
          );
        })}
        {list.length === 0 && <div className="lg-empty">{tx("No text matches these filters.")}</div>}
      </div>
      {list.length > shown && <button type="button" className="lg-more" onClick={showMore}>{tx("Show")} {Math.min(40, list.length - shown)} {tx("more")} · {(list.length - shown).toLocaleString()} {tx("left")}</button>}
    </div>
  );
}

function Entry({ row, en, lang, value, status, onSave, onReset }: { row: Row; en: string; lang: Lang; value: string; status: Status; onSave: (v: string) => void; onReset: () => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const rowsN = Math.min(6, Math.max(1, Math.ceil(Math.max(text.length, en.length) / 70)));
  return (
    <div className={`lg-row ${status}`}>
      <div className="lg-en">
        <em>{groupName(row.group)}{row.template ? ` · ${tx("sentence with values")}` : ''}</em>
        <p>{en}</p>
      </div>
      <div className="lg-edit">
        <textarea
          rows={rowsN}
          value={text}
          placeholder={lang === 'en' ? en : tx("Not translated yet")}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== value && onSave(text)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          aria-label={`${en} — ${lang}`}
        />
        <span className={`lg-st ${status}`}>{status === 'edited' ? tx("Changed") : status === 'auto' ? tx("Auto") : status === 'missing' ? tx("Missing") : tx("Built-in")}</span>
        {(status === 'edited' || status === 'auto') && <button type="button" className="lg-reset" onClick={onReset} title={tx("Go back to the built-in wording")}>↺</button>}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, ClipboardCheck, Plus, Send, Users } from 'lucide-react';
import { collection, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import {
  createQacaid as createQacaidFn,
  allocateQacaid as allocateQacaidFn,
  removeQacaidAllocation as removeAllocationFn,
  submitProgressReport as submitProgressFn,
  setQacaidLevel,
} from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { useLevels } from '@/lib/useLevels';
import { notify } from '@/lib/notify';
import Dropdown from '@/components/Dropdown';
import { CountryName } from '@/components/CountryFlag';
import { EB_COLS, EB_SOFT, EbHero, EbPanel, EbPill, EbSearch, EbTable, type EbCol } from '@/components/Eb';
import { tx } from '@/lib/i18n/tr';

interface QacaidRow {
  id: string;
  code: string;
  title: string;
  melody: string;
  levelId?: string;
  status: 'active' | 'retired';
}
interface AllocationRow {
  id: string;
  qacaidId: string;
  groupId: string;
}
interface ReportRow {
  id: string;
  groupId: string;
  period: string;
  masteryPct: number;
  melodyPct: number;
  timingPct: number;
  directivesPct: number;
  submittedAt?: { seconds: number };
}

/** Pedagogical committee — repertoire (book), which kurel has which assigned, and periodic progress reports. */
export default function CurriculumManage() {
  const { activeLeafGroups: leafGroups, byId, locationOf } = useGroupHierarchy();
  const { t } = useLocale();
  const g18 = t.programmePedagogique;
  const { levels, byId: levelById, accessibleFrom } = useLevels();
  const [qacaid, setQacaid] = useState<QacaidRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [kq, setKq] = useState('');
  const [kLevel, setKLevel] = useState('');
  const [kCountry, setKCountry] = useState('');
  const [mq, setMq] = useState('');
  const [mLevel, setMLevel] = useState('');

  useEffect(() => {
    const unsub1 = onSnapshot(query(collection(db, 'qacaid'), orderBy('code', 'asc')), (snap) => {
      setQacaid(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QacaidRow, 'id'>) })));
      setLoading(false);
    });
    const unsub2 = onSnapshot(collection(db, 'qacaidAllocations'), (snap) =>
      setAllocations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AllocationRow, 'id'>) })))
    );
    const unsub3 = onSnapshot(query(collection(db, 'progressReports'), orderBy('submittedAt', 'desc')), (snap) =>
      setReports(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReportRow, 'id'>) })))
    );
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // ---- Create book ----
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [melody, setMelody] = useState('');
  const [levelId, setLevelId] = useState('');
  const [submittingQ, setSubmittingQ] = useState(false);

  async function handleCreateQacaid(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!levelId) {
      setError(g18.levelRequired);
      return;
    }
    setSubmittingQ(true);
    try {
      await createQacaidFn({ code: code.trim(), title: title.trim(), melody: melody.trim(), levelId });
      setCode('');
      setTitle('');
      setMelody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : g18.createFailed);
    } finally {
      setSubmittingQ(false);
    }
  }

  // ---- Allocate to selected kurel ----
  const [allocateQacaidId, setAllocateQacaidId] = useState('');
  async function handleAllocate() {
    if (!selectedGroupId || !allocateQacaidId) return;
    try {
      await allocateQacaidFn({ qacaidId: allocateQacaidId, groupId: selectedGroupId });
      setAllocateQacaidId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : g18.allocateFailed);
    }
  }

  // ---- Progress report ----
  const [period, setPeriod] = useState('');
  const [masteryPct, setMasteryPct] = useState('80');
  const [melodyPct, setMelodyPct] = useState('80');
  const [timingPct, setTimingPct] = useState('80');
  const [directivesPct, setDirectivesPct] = useState('80');
  const [submittingReport, setSubmittingReport] = useState(false);

  async function handleSubmitReport() {
    if (!selectedGroupId || !period.trim()) return;
    setSubmittingReport(true);
    try {
      await submitProgressFn({
        groupId: selectedGroupId,
        period: period.trim(),
        masteryPct: Number(masteryPct),
        melodyPct: Number(melodyPct),
        timingPct: Number(timingPct),
        directivesPct: Number(directivesPct),
      });
      setPeriod('');
    } catch (err) {
      setError(err instanceof Error ? err.message : g18.reportFailed);
    } finally {
      setSubmittingReport(false);
    }
  }

  // Levels the selected kurel may draw material from (its own + the ones it grants).
  const permittedLevelIds = accessibleFrom(selectedGroupId ? byId[selectedGroupId]?.levelId : undefined);

  const selectedAllocations = useMemo(
    () => (selectedGroupId ? allocations.filter((a) => a.groupId === selectedGroupId) : []),
    [allocations, selectedGroupId]
  );
  const selectedReports = useMemo(
    () => (selectedGroupId ? reports.filter((r) => r.groupId === selectedGroupId) : []),
    [reports, selectedGroupId]
  );
  const latestReport = selectedReports[0];

  const levelOpts = levels.map((l) => ({ value: l.id, label: l.name }));
  const countryOpts = Array.from(new Map(leafGroups.map((g) => locationOf(g.id).country).filter((c): c is NonNullable<typeof c> => !!c).map((c) => [c.id, c.name])).entries()).map(([value, label]) => ({ value, label }));
  const kTerm = kq.trim().toLowerCase();
  const kurelRows = leafGroups.filter((g) => {
    const { city, country } = locationOf(g.id);
    return (!kLevel || (kLevel === '__none__' ? !g.levelId : g.levelId === kLevel)) && (!kCountry || country?.id === kCountry) && (!kTerm || `${g.name} ${city?.name ?? ''} ${country?.name ?? ''}`.toLowerCase().includes(kTerm));
  });
  const mTerm = mq.trim().toLowerCase();
  const matRows = qacaid.filter((q) => (!mLevel || (mLevel === '__none__' ? !q.levelId : q.levelId === mLevel)) && (!mTerm || `${q.code} ${q.title} ${q.melody}`.toLowerCase().includes(mTerm)));
  const sel = selectedGroupId ? byId[selectedGroupId] : undefined;
  const selLoc = selectedGroupId ? locationOf(selectedGroupId) : undefined;

  const matCols: EbCol<QacaidRow>[] = [
    { key: 'code', label: g18.codeLabel, width: '14%', sort: (q) => q.code.toLowerCase(), onCell: (q) => setMq(q.code), hint: tx("Show this book"), render: (q) => <span>{q.code}</span> },
    { key: 'title', label: g18.titleLabel, width: '30%', sort: (q) => q.title.toLowerCase(), onCell: (q) => setMq(q.title), hint: tx("Show this book"), render: (q) => <b>{q.title}</b> },
    { key: 'melody', label: g18.melodyLabel, width: '20%', sort: (q) => q.melody.toLowerCase(), onCell: (q) => setMq(q.melody), hint: tx("Show only this melody"), render: (q) => <span>{q.melody}</span> },
    { key: 'level', label: g18.levelLabel, width: '36%', sort: (q) => levelById[q.levelId ?? '']?.rank ?? 99, render: (q) => (
      <Dropdown label={g18.levelLabel} value={q.levelId ?? ''} allLabel={q.levelId ? undefined : g18.noLevel} options={levelOpts} className="eb2-dd" onChange={async (v) => {
        if (!v) return;
        try { await setQacaidLevel({ qacaidId: q.id, levelId: v }); }
        catch (err) { notify(err instanceof Error ? err.message : g18.levelChangeFailed, 'error'); }
      }} />
    ) },
  ];

  return (
    <div className="eb2">
      <EbHero title={g18.title} sub={g18.subtitle} />
      {error && <p className="eb2-err" role="alert">{error}</p>}

      <div className="eb2-grid g2">
        <EbPanel icon={<Users size={20} />} title={g18.kurels} count={`${kurelRows.length} / ${leafGroups.length}`} note={g18.selectHint}>
          <div className="eb2-form" style={{ paddingBottom: 6 }}>
            <EbSearch value={kq} onChange={setKq} placeholder={tx("Search a kurel")} />
            <div className="eb2-inline">
              <Dropdown label={tx("Level")} value={kLevel} onChange={setKLevel} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level") }, ...levelOpts]} />
              <Dropdown label={tx("Country")} value={kCountry} onChange={setKCountry} allLabel={tx("All countries")} options={countryOpts} />
            </div>
          </div>
          {loading ? <p className="kt-empty">{t.common.loading}</p> : (
            <div className="eb2-scrollbox eb2-list">
              {kurelRows.length === 0 && <p className="eb2-empty-row">{tx("No kurel matches these filters.")}</p>}
              {kurelRows.map((g, i) => {
                const { city, country } = locationOf(g.id);
                const count = allocations.filter((a) => a.groupId === g.id).length;
                return (
                  <button key={g.id} type="button" className={`eb2-row${selectedGroupId === g.id ? ' on' : ''}`} style={{ ['--c' as string]: EB_COLS[i % EB_COLS.length], ['--cb' as string]: EB_SOFT[i % EB_SOFT.length] }} onClick={() => setSelectedGroupId(g.id)}>
                    <span className="top"><b>{g.name}</b><EbPill tone={count ? 'ok' : ''}>{g18.qacaidCount(count)}</EbPill></span>
                    <small>{city?.name ?? '—'} · <CountryName name={country?.name} size={16} />{g.levelId && levelById[g.levelId] ? ` · ${levelById[g.levelId].name}` : ''}</small>
                  </button>
                );
              })}
            </div>
          )}
        </EbPanel>

        <EbPanel icon={<ClipboardCheck size={20} />} title={sel ? sel.name : tx("Kurel details")} count={sel && latestReport ? latestReport.period : undefined}>
          {!selectedGroupId ? <p className="eb2-empty-row">{g18.selectKurel}</p> : (
            <>
              {selLoc && <p className="eb2-note">{selLoc.city?.name ?? '—'} · <CountryName name={selLoc.country?.name} size={16} /></p>}
              {latestReport && (
                <div className="eb2-mini">
                  {[[g18.mastery, latestReport.masteryPct], [g18.melody, latestReport.melodyPct], [g18.timing, latestReport.timingPct], [g18.directives, latestReport.directivesPct]].map(([label, v], i) => (
                    <div key={label as string} className="eb2-metric" style={{ ['--c' as string]: EB_COLS[i], ['--cb' as string]: EB_SOFT[i] } as React.CSSProperties}><span>{label as string}</span><strong>{v as number}%</strong></div>
                  ))}
                </div>
              )}

              <h3 className="eb2-sub">{g18.allocated}</h3>
              <div className="eb2-list">
                {selectedAllocations.length === 0 ? <p className="eb2-empty-row">{g18.noneAllocated}</p> : selectedAllocations.map((a, i) => {
                  const q = qacaid.find((x) => x.id === a.qacaidId);
                  if (!q) return null;
                  return (
                    <div key={a.id} className="eb2-row" style={{ ['--c' as string]: EB_COLS[i % EB_COLS.length], cursor: 'default' }}>
                      <span className="top"><b>{q.code} — {q.title}</b><span className="eb2-acts-row"><EbPill tone={q.levelId && levelById[q.levelId] ? 'ok' : 'red'}>{q.levelId && levelById[q.levelId] ? levelById[q.levelId].name : g18.noLevel}</EbPill><button type="button" className="eb2-bt red" onClick={() => removeAllocationFn({ qacaidId: q.id, groupId: selectedGroupId })}>{g18.remove}</button></span></span>
                      <small>{q.melody}</small>
                    </div>
                  );
                })}
              </div>
              <div className="eb2-pad" style={{ paddingTop: 14 }}>
                {permittedLevelIds.length === 0 ? <p className="eb2-err">{g18.kurelHasNoLevel}</p> : <small className="eb2-hint">{g18.onlyPermitted}</small>}
                <div className="eb2-inline">
                  <Dropdown label={g18.allocate} value={allocateQacaidId} onChange={setAllocateQacaidId} allLabel={g18.allocatePlaceholder} options={qacaid.filter((q) => !selectedAllocations.some((a) => a.qacaidId === q.id)).filter((q) => permittedLevelIds.includes(q.levelId ?? '')).map((q) => ({ value: q.id, label: `${q.code} — ${q.title}` }))} />
                  <button type="button" className="eb2-bt pri" disabled={!allocateQacaidId || permittedLevelIds.length === 0} onClick={handleAllocate} style={{ padding: '0 22px' }}><Plus size={15} /> {g18.allocate}</button>
                </div>
              </div>

              <h3 className="eb2-sub">{g18.newReport}</h3>
              <div className="eb2-form" style={{ paddingTop: 8 }}>
                <div className="field"><label className="l">{g18.period}</label><input type="text" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder={g18.periodPlaceholder} /></div>
                <div className="eb2-mini" style={{ padding: 0 }}>
                  {([[g18.mastery, masteryPct, setMasteryPct], [g18.melody, melodyPct, setMelodyPct], [g18.timing, timingPct, setTimingPct], [g18.directives, directivesPct, setDirectivesPct]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                    <div className="field" key={label}><label className="l">{label} %</label><input type="number" min={0} max={100} value={val} onChange={(e) => setter(e.target.value)} /></div>
                  ))}
                </div>
                <div className="eb2-form-act"><button type="button" className="eb2-bt pri" disabled={submittingReport || !period.trim()} onClick={handleSubmitReport}><Send size={15} /> {submittingReport ? g18.sending : g18.submitReport}</button></div>
              </div>
            </>
          )}
        </EbPanel>
      </div>

      <div className="eb2-grid g2">
        <EbPanel icon={<BookOpen size={20} />} title={g18.materialsTitle} count={`${matRows.length} / ${qacaid.length}`}
          actions={<><EbSearch value={mq} onChange={setMq} placeholder={tx("Search a book or a melody")} /><Dropdown label={tx("Level")} value={mLevel} onChange={setMLevel} allLabel={tx("All levels")} options={[{ value: '__none__', label: tx("No level") }, ...levelOpts]} /></>}>
          <EbTable rows={matRows} cols={matCols} rowKey={(q) => q.id} loading={loading} empty={qacaid.length === 0 ? g18.materialsEmpty : tx("No book matches these filters.")} />
        </EbPanel>

        <EbPanel icon={<Plus size={20} />} title={g18.newQacaid}>
          <form onSubmit={handleCreateQacaid} className="eb2-form">
            <div className="field"><label className="l" htmlFor="q-code">{g18.codeLabel}</label><input id="q-code" type="text" required value={code} onChange={(e) => setCode(e.target.value)} placeholder={tx("Material code")} /></div>
            <div className="field"><label className="l" htmlFor="q-title">{g18.titleLabel}</label><input id="q-title" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="field"><label className="l" htmlFor="q-melody">{g18.melodyLabel}</label><input id="q-melody" type="text" required value={melody} onChange={(e) => setMelody(e.target.value)} /></div>
            <Dropdown label={g18.levelLabel} value={levelId} onChange={setLevelId} allLabel={g18.selectLevel} options={levelOpts} />
            {levels.length === 0 && <small>{g18.noLevelsYet}</small>}
            <div className="eb2-form-act"><button type="submit" className="eb2-bt pri" disabled={submittingQ} style={{ padding: '13px 24px' }}><Plus size={15} /> {submittingQ ? g18.creating : g18.addToRepertoire}</button></div>
          </form>
        </EbPanel>
      </div>
    </div>
  );
}

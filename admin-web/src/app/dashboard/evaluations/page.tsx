'use client';

import '../../px/index.css';
import { useMemo, useState } from 'react';
import { orderBy, limit as fsLimit, where } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useGroupMembers } from '@/lib/useGroupMembers';
import { fmt } from '@/lib/liveStats';
import { notify } from '@/lib/notify';
import { submitEvaluation, reviewEvaluation, giveProgramFeedback } from '@/lib/functions';
import FormDialog from '@/components/FormDialog';
import Dropdown from '@/components/Dropdown';
import { PersonLink } from '@/components/MemberProfile';
import { Pill, Th, Clear, useSort } from '@/components/kit';
import { CxBanner, CxBar, CxCard, CxDonut, CxInitials, CxLine, CxStats, CxTabs } from '@/components/Cx';
import { Award, BarChart3, Calendar, CheckCircle2, ClipboardCheck, Clock, Headphones, Hourglass, Layers, Plus, Search, TrendingUp, Undo2, UserRound, Users } from 'lucide-react';
import { tx } from '@/lib/i18n/tr';

type Stage = 'pending_head' | 'pending_central' | 'approved' | 'returned';
interface Evaluation {
  memberId: string;
  memberName: string;
  groupId: string;
  periodType: 'monthly' | 'semester';
  period: string;
  scores: { pronunciation: number; voice: number; discipline: number; attendance: number };
  average: number;
  comment?: string;
  evaluatorName: string;
  stage: Stage;
  history: { action: string; actorName: string; comment?: string }[];
}
interface Track { title: string; category: string; fileUrl: string; linkedEventId?: string; durationSeconds?: number }
interface Program { eventId: string; groupId: string; allocatedSeconds: number; status: string; items: { title: string; plannedSeconds: number; actualSeconds?: number; rating?: number }[]; feedback?: { text: string; kind: string; byName: string } }

const STAGE: Record<Stage, string> = { pending_head: 'Awaiting kurel leader', pending_central: 'Awaiting central approval', approved: 'Approved', returned: 'Returned' };
const CRITERIA: { key: keyof Evaluation['scores']; label: string; short: string }[] = [
  { key: 'pronunciation', label: 'Pronunciation', short: 'Pronunciation' },
  { key: 'voice', label: 'Vocal quality', short: 'Voice' },
  { key: 'discipline', label: 'Discipline', short: 'Discipline' },
  { key: 'attendance', label: 'Attendance', short: 'Attendance' },
];
const mmss = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`;

function currentPeriod(type: 'monthly' | 'semester') {
  const d = new Date();
  return type === 'monthly' ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : `${d.getFullYear()}-S${d.getMonth() < 6 ? 1 : 2}`;
}

/** Evaluation — monthly/half-yearly marks, validation circuit and audio feedback, all from Firebase. */
export default function EvaluationPage() {
  const { byId, activeLeafGroups } = useGroupHierarchy();
  const rowsRaw = useCollection<Evaluation>('evaluations', [orderBy('updatedAt', 'desc'), fsLimit(500)]);
  const rows = useMemo(() => rowsRaw ?? [], [rowsRaw]);
  const [periodType, setPeriodType] = useState<'monthly' | 'semester'>('monthly');
  const [dialog, setDialog] = useState<'new' | { returnId: string } | null>(null);
  const [formGroup, setFormGroup] = useState('');
  const members = useGroupMembers(formGroup);
  const [busy, setBusy] = useState(false);

  const period = currentPeriod(periodType);
  const current = rows.filter((r) => r.periodType === periodType && r.period === period);
  const approvedNow = current.filter((r) => r.stage === 'approved');
  const pending = rows.filter((r) => r.stage === 'pending_head' || r.stage === 'pending_central');
  const returned = rows.filter((r) => r.stage === 'returned');
  const mean = (list: Evaluation[], k: keyof Evaluation['scores']) => (list.length ? Math.round((list.reduce((a, r) => a + r.scores[k], 0) / list.length) * 10) / 10 : null);
  const overall = current.length ? Math.round((current.reduce((a, r) => a + r.average, 0) / current.length) * 10) / 10 : null;

  // Audio evaluation
  const tracks = useCollection<Track>('audioTracks', [where('category', '==', 'performance')]);
  const linked = (tracks ?? []).filter((t) => t.linkedEventId);
  const [trackId, setTrackId] = useState('');
  const track = linked.find((t) => t.id === trackId) ?? linked[0];
  const programsRaw = useCollection<Program>('eventPrograms', track?.linkedEventId ? [where('eventId', '==', track.linkedEventId)] : [where('eventId', '==', '__none__')], track?.linkedEventId ?? '');
  const programs = programsRaw ?? [];
  const [programId, setProgramId] = useState('');
  const program = programs.find((p) => p.id === programId) ?? programs[0];
  const [kind, setKind] = useState('encouragement');
  const [feedback, setFeedback] = useState('');
  const planned = program?.items.reduce((a, i) => a + i.plannedSeconds, 0) ?? 0;
  const actualItems = program?.items.filter((i) => i.actualSeconds !== undefined) ?? [];
  const actual = actualItems.reduce((a, i) => a + (i.actualSeconds ?? 0), 0);
  const rated = program?.items.filter((i) => i.rating !== undefined) ?? [];
  const quality = rated.length ? Math.round((rated.reduce((a, i) => a + (i.rating ?? 0), 0) / rated.length) * 10) / 10 : null;

  async function review(id: string, decision: 'advance' | 'return', comment?: string) {
    setBusy(true);
    try {
      await reviewEvaluation({ evaluationId: id, decision, comment });
      notify(decision === 'advance' ? 'Evaluation moved forward' : 'Evaluation returned to the evaluator', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update the evaluation', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback() {
    if (!program) return;
    setBusy(true);
    try {
      await giveProgramFeedback({ programId: program.id, text: feedback, kind });
      setFeedback('');
      notify('Feedback sent to the kurel leaders', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not send the feedback', 'error');
    } finally {
      setBusy(false);
    }
  }

  const [stageF, setStageF] = useState('');
  const [grpF, setGrpF] = useState('');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const view = rows.filter((r) =>
    (!stageF || (stageF === 'pending' ? r.stage.startsWith('pending') : r.stage === stageF)) && (!grpF || r.groupId === grpF) &&
    (!term || r.memberName.toLowerCase().includes(term) || r.evaluatorName.toLowerCase().includes(term)));
  const { sorted, sort, toggle } = useSort(view, { member: (r) => r.memberName.toLowerCase(), group: (r) => (byId[r.groupId]?.name ?? '').toLowerCase(), period: (r) => r.period, p: (r) => r.scores.pronunciation, v: (r) => r.scores.voice, d: (r) => r.scores.discipline, a: (r) => r.scores.attendance, avg: (r) => r.average, stage: (r) => r.stage });
  const filtering = !!(stageF || grpF || q);
  const clear = () => { setStageF(''); setGrpF(''); setQ(''); };
  const setStage = (v: string) => setStageF(stageF === v ? '' : v);
  const scoreTone = (n: number) => (n >= 14 ? 'ok' : n >= 10 ? 'gold' : 'red') as 'ok' | 'gold' | 'red';
  const stageTone = (st: Stage) => (st === 'approved' ? 'ok' : st === 'returned' ? 'red' : 'gold') as 'ok' | 'gold' | 'red';
  const groupsUsed = Array.from(new Set(rows.map((r) => r.groupId))).filter((g) => byId[g]);

  const monthly = rows.filter((r) => r.periodType === 'monthly');
  const trend = useMemo(() => {
    const m = new Map<string, number[]>();
    monthly.forEach((r) => { const a = m.get(r.period) ?? []; a.push(r.average); m.set(r.period, a); });
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])).slice(-11).map(([k, v]) => ({ k, v: Math.round((v.reduce((n, x) => n + x, 0) / v.length) * 10) / 10 }));
  }, [monthly]);
  const [tab, setTab] = useState<'overall' | 'member' | 'group' | 'zone' | 'attendance' | 'activities'>('overall');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const aggregate = (keyOf: (r: Evaluation) => string, nameOf: (k: string) => string) => {
    const m = new Map<string, Evaluation[]>();
    rows.forEach((r) => { const k = keyOf(r); if (!k) return; (m.get(k) ?? m.set(k, []).get(k)!).push(r); });
    return [...m.entries()].map(([k, list]) => ({ k, name: nameOf(k), n: list.length, avg: Math.round((list.reduce((a, r) => a + r.average, 0) / list.length) * 10) / 10, att: Math.round((list.reduce((a, r) => a + r.scores.attendance, 0) / list.length) * 10) / 10 })).sort((a, b) => b.avg - a.avg);
  };
  const byMember = useMemo(() => aggregate((r) => r.memberId, (k) => rows.find((r) => r.memberId === k)?.memberName ?? k), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const byGroupAgg = useMemo(() => aggregate((r) => r.groupId, (k) => byId[k]?.name ?? k), [rows, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const byZoneAgg = useMemo(() => aggregate((r) => { const g = byId[r.groupId]; const c = g?.parentGroupId ? byId[g.parentGroupId] : undefined; return c?.name ?? ''; }, (k) => k), [rows, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const grade = (v: number) => (v >= 16 ? tx("Excellent") : v >= 14 ? tx("Good") : v >= 10 ? tx("Fair") : tx("Needs work"));
  const rank = (list: { k: string; name: string; n: number; avg: number; att: number }[], att?: boolean) => (
    <ul className="ev-rank">{list.slice(0, 20).map((x, i) => (<li key={x.k}><b>{i + 1}</b><CxInitials name={x.name} /><span><strong>{x.name}</strong><small>{x.n} {tx("evaluations")}</small></span><CxBar pct={((att ? x.att : x.avg) / 20) * 100} tone="gold" thick /><em>{att ? x.att : x.avg} / 20</em></li>))}{list.length === 0 && <li className="ev-none">{tx("No evaluation yet.")}</li>}</ul>
  );

  return (
    <div className="px px-index">
      <div className="zp cx-page ev-page">
        <CxBanner icon={<ClipboardCheck size={26} />} kicker={tx("Pedagogy")} title={tx("Evaluation report")} sub={tx("Comprehensive evaluation of members, groups, zones, attendance and overall activities.")}>
          <Dropdown label={tx("Period type")} value={periodType} onChange={(v) => setPeriodType(v as 'monthly' | 'semester')} options={[{ value: 'monthly', label: tx("Monthly") }, { value: 'semester', label: tx("Half-yearly") }]} className="lm-dd ev-dd" />
          <button className="cx-btn gold" type="button" onClick={() => setDialog('new')}><Plus size={18} />{tx("New evaluation")}</button>
        </CxBanner>

        <CxStats items={[
          { label: tx("Completed evaluations"), value: fmt(rowsRaw === null ? null : current.length), icon: <ClipboardCheck size={24} />, tone: 'green', onClick: () => setStageF('') },
          { label: tx("Pending"), value: fmt(rowsRaw === null ? null : pending.length), icon: <Hourglass size={24} />, tone: 'amber', onClick: () => setStage('pending') },
          { label: tx("Approved"), value: fmt(rowsRaw === null ? null : approvedNow.length), badge: current.length ? `${Math.round((approvedNow.length / current.length) * 1000) / 10}%` : undefined, icon: <CheckCircle2 size={24} />, tone: 'green', onClick: () => setStage('approved') },
          { label: tx("Returned"), value: fmt(rowsRaw === null ? null : returned.length), icon: <Undo2 size={24} />, tone: 'red', onClick: () => setStage('returned') },
        ]} />

        <CxTabs value={tab} onChange={(v) => setTab(v as typeof tab)} items={[
          { value: 'overall', label: tx("Overall"), icon: <Users size={20} /> },
          { value: 'member', label: tx("By member"), icon: <UserRound size={20} /> },
          { value: 'group', label: tx("By group"), icon: <Users size={20} /> },
          { value: 'zone', label: tx("By zone"), icon: <Layers size={20} /> },
          { value: 'attendance', label: tx("Attendance"), icon: <Calendar size={20} /> },
          { value: 'activities', label: tx("Activities"), icon: <BarChart3 size={20} /> },
        ]} />

        {tab === 'overall' && (<>
          <div className="cx-grid cx-g2">
            <CxCard icon={<Award size={22} />} title={tx("Overall performance")} sub={tx("Weighted average of all evaluation criteria for the period.")} right={<span className="cx-pill amber">{period}</span>}>
              <div className="ev-overall">
                <CxDonut size={170} big={<>{overall === null ? '—' : overall}<small className="ev-of"> / 20</small></>} label={overall === null ? undefined : <><b className="ev-pc">{Math.round((overall / 20) * 100)}%</b><span className="ev-grade">{grade(overall)}</span></>} slices={[{ value: overall ?? 0, color: '#1f9d63' }, { value: 20 - (overall ?? 0), color: '#e6ece8' }]} />
                <ul className="ev-crit">
                  {CRITERIA.map((c) => { const v = mean(current, c.key); return <li key={c.key}><span>{tx(c.label)}</span><CxBar pct={((v ?? 0) / 20) * 100} thick /><b>{v === null ? '—' : v} / 20</b></li>; })}
                </ul>
              </div>
            </CxCard>
            <CxCard icon={<TrendingUp size={22} />} title={tx("Performance trend")} sub={tx("Overall average score over time.")}>
              {trend.length === 0 ? <p className="kt-empty">{tx("No evaluation yet.")}</p> : <CxLine labels={trend.map((t) => MON[Number(t.k.slice(5, 7)) - 1] ?? t.k)} values={trend.map((t) => t.v)} min={0} max={20} />}
            </CxCard>
          </div>
          <div className="cx-grid cx-g32">
            <CxCard icon={<BarChart3 size={22} />} title={tx("Results by criterion")} sub={tx("Average score and ranking for the current period.")}>
              <table className="cx-table ev-crit-t"><thead><tr><th>{tx("Criterion")}</th><th>{tx("Average (/20)")}</th><th>{tx("Achievement")}</th></tr></thead>
                <tbody>{CRITERIA.map((c) => { const v = mean(current, c.key); return <tr key={c.key}><td><b>{tx(c.label)}</b></td><td>{v === null ? '—' : v}</td><td><span className="ev-ach"><CxBar pct={((v ?? 0) / 20) * 100} tone="gold" thick /><em>{v === null ? '—' : `${Math.round((v / 20) * 1000) / 10}%`}</em></span></td></tr>; })}</tbody></table>
            </CxCard>
            <div className="ev-side">
              <CxCard icon={<Layers size={22} />} title={tx("Approval flow")} sub={`${tx("Progress of the")} ${periodType === 'monthly' ? tx("monthly") : tx("half-yearly")} ${tx("period")}`}>
                <div className="ev-flow">
                  <button type="button" className="ok" onClick={() => setStage('approved')}><CheckCircle2 size={20} /><small>{tx("Submitted")}</small><b>{current.length}</b></button><i>→</i>
                  <button type="button" className="warn" onClick={() => setStage('pending')}><Hourglass size={20} /><small>{tx("In review")}</small><b>{current.filter((r) => r.stage.startsWith('pending')).length}</b></button><i>→</i>
                  <button type="button" className="ok" onClick={() => setStage('approved')}><CheckCircle2 size={20} /><small>{tx("Approved")}</small><b>{approvedNow.length}</b></button><i>→</i>
                  <button type="button" className="bad" onClick={() => setStage('returned')}><Undo2 size={20} /><small>{tx("Returned")}</small><b>{current.filter((r) => r.stage === 'returned').length}</b></button>
                </div>
              </CxCard>
              <CxCard icon={<Calendar size={22} />} title={tx("Attendance & activities overview")}>
                <div className="cx-two">
                  <div className="ev-mini"><small>{tx("Attendance score")}</small><b>{mean(current, 'attendance') ?? '—'} / 20</b></div>
                  <div className="ev-mini warm"><small>{tx("Discipline score")}</small><b>{mean(current, 'discipline') ?? '—'} / 20</b></div>
                </div>
              </CxCard>
            </div>
          </div>
        </>)}

        {tab === 'member' && <CxCard dark icon={<UserRound size={22} />} title={tx("Results by member")} sub={tx("Average over every evaluation, best first.")}>{rank(byMember)}</CxCard>}
        {tab === 'group' && <CxCard dark icon={<Users size={22} />} title={tx("Results by group")} sub={tx("Average over every evaluation of the group.")}>{rank(byGroupAgg)}</CxCard>}
        {tab === 'zone' && <CxCard dark icon={<Layers size={22} />} title={tx("Results by city and zone")} sub={tx("Average over every evaluation of the area.")}>{rank(byZoneAgg)}</CxCard>}
        {tab === 'attendance' && <CxCard dark icon={<Calendar size={22} />} title={tx("Attendance score by group")} sub={tx("Average of the attendance criterion.")}>{rank([...byGroupAgg].sort((a, b) => b.att - a.att), true)}</CxCard>}

        <CxCard dark id="ev-circuit" icon={<Users size={22} />} title={tx("Evaluations in the circuit")} sub={tx("Pedagogy president → kurel leader → central approval. Members see a result only once it is approved.")}
          right={<>
            <label className="cx-search ev-s"><Search size={16} /><input type="search" placeholder={tx("Search a member or an evaluator")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <Dropdown label={tx("Group")} value={grpF} onChange={setGrpF} allLabel={tx("All groups")} options={groupsUsed.map((g) => ({ value: g, label: byId[g]?.name ?? '' }))} className="loc-dd" />
            <Dropdown label={tx("Stage")} value={stageF} onChange={setStageF} allLabel={tx("Any status")} options={[{ value: 'pending', label: tx("Pending") }, { value: 'approved', label: tx("Approved") }, { value: 'returned', label: tx("Returned") }]} className="loc-dd" />
            {filtering && <Clear onClick={clear} />}
          </>}>
          <div className="cx-scroll">
            <table className="cx-table ev-table">
              <thead><tr><Th k="member" sort={sort} toggle={toggle}>{tx("Member")}</Th><Th k="group" sort={sort} toggle={toggle}>{tx("Kurel")}</Th><Th k="period" sort={sort} toggle={toggle}>{tx("Period")}</Th><Th k="p" sort={sort} toggle={toggle} num>{tx("Pron.")}</Th><Th k="v" sort={sort} toggle={toggle} num>{tx("Voice")}</Th><Th k="d" sort={sort} toggle={toggle} num>{tx("Discipline")}</Th><Th k="a" sort={sort} toggle={toggle} num>{tx("Attendance")}</Th><Th k="avg" sort={sort} toggle={toggle} num>{tx("Score (/20)")}</Th><Th k="stage" sort={sort} toggle={toggle}>{tx("Status")}</Th><th /></tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td><span className="ev-who"><CxInitials name={r.memberName} size={34} /><span><PersonLink userId={r.memberId}><strong>{r.memberName}</strong></PersonLink><small>{tx("by")} {r.evaluatorName}</small></span></span></td>
                    <td><button type="button" className="kt-link" onClick={() => setGrpF(r.groupId)}>{byId[r.groupId]?.name ?? ''}</button></td>
                    <td>{r.period}</td>
                    <td className="num"><Pill tone={scoreTone(r.scores.pronunciation)}>{r.scores.pronunciation}</Pill></td>
                    <td className="num"><Pill tone={scoreTone(r.scores.voice)}>{r.scores.voice}</Pill></td>
                    <td className="num"><Pill tone={scoreTone(r.scores.discipline)}>{r.scores.discipline}</Pill></td>
                    <td className="num"><Pill tone={scoreTone(r.scores.attendance)}>{r.scores.attendance}</Pill></td>
                    <td className="num"><b>{r.average}</b></td>
                    <td><button type="button" className="kt-link" onClick={() => setStage(r.stage.startsWith('pending') ? 'pending' : r.stage)}><Pill tone={stageTone(r.stage)}>{tx(STAGE[r.stage])}</Pill></button></td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {(r.stage === 'pending_head' || r.stage === 'pending_central') && (
                        <>
                          <button type="button" className="cx-btn ok sm" disabled={busy} onClick={() => review(r.id, 'advance')}>{r.stage === 'pending_head' ? tx("Validate") : tx("Approve")}</button>{' '}
                          <button type="button" className="cx-btn red sm" disabled={busy} onClick={() => setDialog({ returnId: r.id })}>{tx("Return")}</button>
                        </>
                      )}
                      {r.stage === 'returned' && <small>{r.history[r.history.length - 1]?.comment ?? ''}</small>}
                    </td>
                  </tr>
                ))}
                {rowsRaw !== null && sorted.length === 0 && <tr><td colSpan={10} className="cx-empty">{rows.length === 0 ? tx("No evaluation yet. Use “New evaluation” to score a member.") : tx("No evaluation matches these filters.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </CxCard>

        {(tab === 'overall' || tab === 'activities') && (
          <CxCard icon={<Headphones size={22} />} title={tx("Audio evaluation of the performance")} sub={tx("Listen to the linked recording while writing the feedback for the kurel.")} right={<span className={`cx-pill ${program?.status === 'performed' ? 'green' : 'amber'}`}>{program ? (program.status === 'performed' ? tx("Performed") : tx("Programme")) : '—'}</span>}>
          <div className="ev-audio">
            <div className="ev-player">
              <Dropdown label={tx("Performance recording")} value={track?.id ?? ''} onChange={(v) => { setTrackId(v); setProgramId(''); }} options={linked.map((t) => ({ value: t.id, label: t.title }))} allLabel={linked.length === 0 ? tx("No performance linked to an event") : undefined} />
              {track ? <audio controls preload="none" src={track.fileUrl} style={{ width: '100%' }} /> : <span className="kt-note">—</span>}
              {programs.length > 1 && <Dropdown label={tx("Kurel programme")} value={program?.id ?? ''} onChange={setProgramId} options={programs.map((p) => ({ value: p.id, label: byId[p.groupId]?.name ?? p.groupId }))} />}
            </div>
            <div className="ev-feedback">
              <CxStats items={[
                { label: tx("Planned time"), value: program ? mmss(planned) : '—', icon: <Clock size={20} />, tone: 'green' },
                { label: tx("Actual time"), value: program && actualItems.length ? mmss(actual) : '—', icon: <Clock size={20} />, tone: 'amber' },
                { label: tx("Sound quality"), value: quality === null ? '—' : `${quality}/10`, icon: <Headphones size={20} />, tone: 'blue' },
                { label: tx("Status"), value: program ? (program.status === 'performed' ? tx("Performed") : tx("Pending")) : '—', icon: <CheckCircle2 size={20} />, tone: 'violet' },
              ]} />
              {program?.feedback && <p className="kt-note">{tx("Last feedback (")}{program.feedback.kind}, {program.feedback.byName}): {program.feedback.text}</p>}
              <Dropdown label={tx("Feedback type")} value={kind} onChange={setKind} options={[{ value: 'encouragement', label: tx("Encouragement") }, { value: 'correction', label: tx("Corrective directive") }, { value: 'reinforcement', label: tx("Reinforcement directive") }]} />
              <textarea className="ev-text" aria-label={tx("Pedagogical feedback")} placeholder={tx("Remarks, encouragement and guidelines for the kurel…")} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={!program}></textarea>
              <button type="button" className="cx-btn green" disabled={!program || !feedback.trim() || busy} onClick={sendFeedback}>{tx("Send feedback to the kurel")}</button>
            </div>
          </div>
        
          </CxCard>
        )}
      </div>

      {dialog === 'new' && (
        <FormDialog
          title={tx("New evaluation")}
          onValuesChange={(v) => setFormGroup(v.groupId)}
          intro="Four separate marks out of 20. The evaluation then goes to the kurel leader for validation, then to central approval."
          submitLabel={tx("Submit for validation")}
          onClose={() => setDialog(null)}
          fields={[
            { name: 'groupId', label: tx("Kurel"), type: 'select', required: true, options: activeLeafGroups.map((g) => ({ value: g.id, label: g.name })) },
            { name: 'memberId', label: tx("Member"), type: 'select', required: true, options: members.map((m) => ({ value: m.id, label: m.name })), hint: formGroup ? undefined : tx("Choose a kurel first") },
            { name: 'periodType', label: tx("Type"), type: 'select', required: true, initial: periodType, options: [{ value: 'monthly', label: tx("Monthly") }, { value: 'semester', label: 'Half-yearly' }] },
            { name: 'period', label: tx("Period"), required: true, initial: period, placeholder: tx("2026-10 or 2026-S2") },
            ...CRITERIA.map((c) => ({ name: c.key, label: `${c.label} (/20)`, type: 'number' as const, required: true, min: 0, max: 20 })),
            { name: 'comment', label: tx("Comment"), type: 'textarea' },
          ]}
          onSubmit={(v) => {
            return submitEvaluation({
              memberId: v.memberId, groupId: v.groupId, periodType: v.periodType, period: v.period, comment: v.comment,
              scores: { pronunciation: Number(v.pronunciation), voice: Number(v.voice), discipline: Number(v.discipline), attendance: Number(v.attendance) },
            }).then(() => notify('Evaluation submitted', 'success'));
          }}
        />
      )}
      {dialog && dialog !== 'new' && (
        <FormDialog
          title={tx("Return the evaluation")}
          intro="A reason is required; the evaluator is notified."
          submitLabel={tx("Return")}
          onClose={() => setDialog(null)}
          fields={[{ name: 'comment', label: tx("Reason"), type: 'textarea', required: true }]}
          onSubmit={(v) => reviewEvaluation({ evaluationId: dialog.returnId, decision: 'return', comment: v.comment })}
        />
      )}
    </div>
  );
}

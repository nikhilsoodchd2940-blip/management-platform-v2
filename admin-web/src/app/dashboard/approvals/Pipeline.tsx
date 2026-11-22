'use client';

import { looseMatch } from '@/lib/looseMatch';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { orderBy, limit as fsLimit } from 'firebase/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { notify } from '@/lib/notify';
import {
  createAdmissionApplication, advanceAdmission, completeAdmission,
  openRenewalCampaign, recordRenewalPayment, closeRenewalCampaign,
  requestKurelTransfer, giveTransferOpinion, decideTransfer,
} from '@/lib/functions';
import { useCount } from '@/lib/liveStats';
import FormDialog from '@/components/FormDialog';
import Dropdown from '@/components/Dropdown';
import { PersonLink } from '@/components/MemberProfile';
import { formatMoney } from '@/lib/money';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { tx, dateLocale } from '@/lib/i18n/tr';
import { Calendar, Coins, CreditCard, Filter, Layers, Plus, Search, Users } from 'lucide-react';

type Stage = 'requested' | 'daara_verification' | 'test' | 'pedagogy_opinion' | 'head_validation' | 'final_validation' | 'account_created' | 'rejected';
interface Application { userId?: string; updatedAt?: unknown; candidateName: string; matricule: string; phone?: string; groupId?: string; stage: Stage; testAt?: unknown; testLocation?: string; history: { stage: Stage; actorName: string; comment?: string }[] }
const STAGE_LABEL: Record<Stage, string> = {
  requested: 'Request', daara_verification: 'Verification', test: 'Test', pedagogy_opinion: 'Pedagogical opinion',
  head_validation: 'Local validation', final_validation: 'Final validation', account_created: 'Account created', rejected: 'Rejected',
};
const NEXT_LABEL: Partial<Record<Stage, string>> = {
  requested: 'Verification done', daara_verification: 'Schedule test / skip test', test: 'Record test result',
  pedagogy_opinion: 'Pedagogical opinion', head_validation: 'Validate (kurel head)', final_validation: 'Create account',
};
const when = (ms: number) => (ms ? new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const ORDER: Stage[] = ['requested', 'daara_verification', 'test', 'pedagogy_opinion', 'head_validation', 'final_validation', 'account_created'];

/** Admission pipeline — request → verification → test → opinion → validations → account & kurel. */
export function Admissions({ newSignal = 0 }: { newSignal?: number }) {
  const { activeLeafGroups, byId } = useGroupHierarchy();
  const raw = useCollection<Application>('admissionApplications', [orderBy('updatedAt', 'desc'), fsLimit(100)]);
  const rows = raw ?? [];
  const [filter, setFilter] = useState('');
  const [showF, setShowF] = useState(false);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState('');
  useEffect(() => { if (newSignal > 0) setDialog('new'); }, [newSignal]);
  const [dialog, setDialog] = useState<null | 'new' | { id: string; stage: Stage }>(null);
  const shown = rows.filter((a) => (!filter || a.stage === filter) && looseMatch(q, `${a.candidateName} ${a.matricule} ${a.phone ?? ''}`));
  const counts = (s: string) => rows.filter((a) => a.stage === s).length;
  const act = (fn: () => Promise<unknown>, ok: string) => fn().then(() => notify(ok, 'success')).catch((e: Error) => notify(e.message, 'error'));

  const sel = dialog && dialog !== 'new' ? rows.find((r) => r.id === dialog.id) : undefined;
  const stageFields = () => {
    if (!sel) return [];
    switch (sel.stage) {
      case 'daara_verification': return [
        { name: 'mode', label: tx("Test"), type: 'select' as const, required: true, options: [{ value: 'schedule', label: tx("Schedule a test session") }, { value: 'skip', label: tx("No test needed") }] },
        { name: 'testAt', label: tx("Test date and time"), type: 'datetime-local' as const },
        { name: 'testLocation', label: tx("Test location") },
      ];
      case 'test': return [{ name: 'testResult', label: tx("Result"), type: 'select' as const, required: true, options: [{ value: 'passed', label: tx("Passed") }, { value: 'failed', label: tx("Failed") }] }];
      case 'pedagogy_opinion': return [{ name: 'opinion', label: tx("Opinion of the pedagogical committee"), type: 'select' as const, required: true, options: [{ value: 'favourable', label: tx("Favourable") }, { value: 'unfavourable', label: tx("Unfavourable") }] }];
      case 'final_validation': return [
        { name: 'phone', label: tx("Phone (E.164)"), type: 'tel' as const, required: true, initial: sel.phone ?? '', placeholder: '+221…' },
        { name: 'groupId', label: tx("Kurel"), type: 'select' as const, required: true, initial: sel.groupId ?? '', options: activeLeafGroups.map((g) => ({ value: g.id, label: g.name })) },
      ];
      default: return [];
    }
  };

  return (
    <section className="ap-pane cx-card">
      <header><i aria-hidden><Layers size={22} /></i>
        <div><h2>{tx("Admission Applications")}</h2><p>{shown.length} {tx("of")} {rows.length} {tx("shown. Click a row to see its history.")}</p></div>
        <div className="ap-right"><button type="button" className="cx-btn green" onClick={() => setDialog('new')}><Plus size={16} />{tx("New application")}</button></div>
      </header>
      <div className="ap-stages">
        <button type="button" className={!filter ? 'on' : ''} onClick={() => setFilter('')}>{tx("All")}<em>{rows.length}</em></button>
        {(Object.keys(STAGE_LABEL) as Stage[]).map((st) => <button type="button" key={st} className={filter === st ? 'on' : ''} onClick={() => setFilter(filter === st ? '' : st)}>{STAGE_LABEL[st]}<em>{counts(st)}</em></button>)}
      </div>
      <div className="ap-bar"><label className="ap-srch"><Search size={17} aria-hidden /><input type="search" placeholder={tx("Search by name or matricule…")} value={q} onChange={(e) => setQ(e.target.value)} /></label><button type="button" className={`ap-fbtn${showF || filter ? " on" : ""}`} aria-expanded={showF} onClick={() => setShowF(!showF)}><Filter size={16} aria-hidden />{tx("Filters")}</button>{(showF || filter) && <Dropdown label={tx("Stage")} value={filter} onChange={setFilter} allLabel="All stages" options={(Object.keys(STAGE_LABEL) as Stage[]).map((st) => ({ value: st, label: STAGE_LABEL[st] }))} />}</div>
      <div className="ap-twrap">
        <table className="ap-table">
          <thead><tr><th>{tx("Candidate")}</th><th>{tx("Matricule")}</th><th>{tx("Stage")}</th><th>{tx("Group")}</th><th>{tx("Last update")}</th><th className="act">{tx("Actions")}</th></tr></thead>
          <tbody>
            {raw === null && <tr><td colSpan={6} className="ap-none">{tx("Loading…")}</td></tr>}
            {raw !== null && shown.length === 0 && <tr><td colSpan={6} className="ap-none">{tx("No application")}{filter || q ? tx(" matches") : tx(" yet. Use “New application” to register a candidate")}.</td></tr>}
            {shown.map((a) => {
              const last = a.history[a.history.length - 1];
              const idx = ORDER.indexOf(a.stage);
              const done = a.stage === 'account_created';
              const bad = a.stage === 'rejected';
              return (
                <Fragment key={a.id}>
                  <tr className={`row${openId === a.id ? ' open' : ''}`} onClick={() => setOpenId(openId === a.id ? '' : a.id)}>
                    <td onClick={(e) => e.stopPropagation()}>{a.userId ? <PersonLink userId={a.userId}><b className="ap-nm">{a.candidateName}</b></PersonLink> : <b className="ap-nm">{a.candidateName}</b>}<small className="ap-sub">{a.phone || tx("No phone")}</small></td>
                    <td><code className="ap-id">{a.matricule}</code></td>
                    <td>
                      <span className={`ap-stage${done ? ' done' : bad ? ' bad' : ''}`}>{STAGE_LABEL[a.stage]}</span>
                      {!bad && <span className="ap-prog" aria-hidden><i style={{ width: `${Math.round(((idx + 1) / ORDER.length) * 100)}%` }} /></span>}
                      {a.stage === 'test' && a.testAt ? <small className="ap-sub">{tx("Test")} {when(tsMs(a.testAt))} {a.testLocation ?? ''}</small> : null}
                    </td>
                    <td>{a.groupId ? byId[a.groupId]?.name ?? '' : <span className="ap-miss">{tx("Not chosen")}</span>}</td>
                    <td><span className="ap-age"><b>{last?.actorName || '—'}</b><small>{when(tsMs(a.updatedAt))}</small></span></td>
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      {!done && !bad ? (
                        <>
                          <button type="button" className="ap-btn ok" onClick={() => setDialog({ id: a.id, stage: a.stage })}>{NEXT_LABEL[a.stage]}</button>
                          <button type="button" className="ap-btn no" onClick={() => {
                            const reason = window.prompt('Reason for rejecting this application');
                            if (reason) void act(() => advanceAdmission({ applicationId: a.id, reject: true, comment: reason }), 'Application rejected');
                          }}>{tx("Reject")}</button>
                        </>
                      ) : <span className={`ap-stage ${done ? 'done' : 'bad'}`}>{done ? tx("Finished") : tx("Closed")}</span>}
                    </td>
                  </tr>
                  {openId === a.id && (
                    <tr className="detail"><td colSpan={6}>
                      <ol className="ap-hist">
                        {a.history.map((h, i) => <li key={i}><b>{STAGE_LABEL[h.stage]}</b><span>{h.actorName}{h.comment ? ` — ${h.comment}` : ''}</span></li>)}
                        {a.history.length === 0 && <li><span>{tx("No step recorded yet.")}</span></li>}
                      </ol>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog === 'new' && (
        <FormDialog
          title={tx("New application")}
          intro="The candidate must first be in good standing with Hizbut Tarqiyyah. Matricule format: DK04/067 (city, cell code, member number)."
          submitLabel={tx("Register the application")}
          onClose={() => setDialog(null)}
          fields={[
            { name: 'candidateName', label: tx("Full name"), required: true },
            { name: 'matricule', label: tx("Matricule"), required: true, placeholder: 'DK04/067' },
            { name: 'phone', label: tx("Phone (E.164)"), type: 'tel', placeholder: '+221…' },
            { name: 'groupId', label: tx("Kurel applied to"), type: 'select', options: activeLeafGroups.map((g) => ({ value: g.id, label: g.name })) },
          ]}
          onSubmit={(v) => createAdmissionApplication({ ...v }).then(() => notify('Application registered. Verify the matricule with the daara administrator by email.', 'success'))}
        />
      )}
      {sel && dialog && dialog !== 'new' && (
        <FormDialog
          title={`${STAGE_LABEL[sel.stage]} — ${sel.candidateName}`}
          submitLabel={sel.stage === 'final_validation' ? tx("Create the account and assign the kurel") : tx("Confirm")}
          onClose={() => setDialog(null)}
          fields={[...stageFields(), { name: 'comment', label: tx("Comment"), type: 'textarea' }]}
          onSubmit={async (v) => {
            if (sel.stage === 'final_validation') await completeAdmission({ applicationId: dialog.id, phone: v.phone, groupId: v.groupId });
            else if (sel.stage === 'daara_verification') await advanceAdmission({ applicationId: dialog.id, comment: v.comment, ...(v.mode === 'skip' ? { skipTest: true } : { testAtMs: new Date(v.testAt).getTime(), testLocation: v.testLocation }) });
            else await advanceAdmission({ applicationId: dialog.id, comment: v.comment, testResult: v.testResult, opinion: v.opinion });
            notify('Application updated', 'success');
          }}
        />
      )}
    </section>
  );
}

interface Campaign { year: number; startAt: unknown; endAt: unknown; feeCents: number; currency: string; status: 'open' | 'closed' }

/** Annual renewal campaign (one month maximum), payments and automatic suspension of non-payers. */
export function RenewalCard() {
  const camps = useCollection<Campaign>('renewalCampaigns', [orderBy('startAt', 'desc'), fsLimit(5)]);
  const current = camps?.find((c) => c.status === 'open') ?? camps?.[0];
  const paid = useCount('renewals', current ? [['campaignId', '==', current.id], ['status', '==', 'paid']] : [['campaignId', '==', '__none__']], 30000);
  const suspended = useCount('renewals', current ? [['campaignId', '==', current.id], ['status', '==', 'suspended']] : [['campaignId', '==', '__none__']], 30000);
  const approved = useCount('users', [['registrationStatus', '==', 'approved']], 60000);
  const [dialog, setDialog] = useState<null | 'open' | 'pay'>(null);
  const awaiting = current && approved !== null && paid !== null && suspended !== null ? Math.max(0, approved - paid - suspended) : null;
  const run = (fn: () => Promise<unknown>, ok: string) => fn().then(() => notify(ok, 'success')).catch((e: Error) => notify(e.message, 'error'));
  const ended = current ? tsMs(current.endAt) <= Date.now() : false;

  return (
    <section className="ap-pane cx-card">
      <header><i aria-hidden><Calendar size={22} /></i>
        <div><h2>{tx("Annual Renewal")} {current ? current.year : ''}</h2>{current ? <p className="ap-rn"><span><Calendar size={16} aria-hidden />{new Date(tsMs(current.startAt)).toLocaleDateString(dateLocale())} → {new Date(tsMs(current.endAt)).toLocaleDateString(dateLocale())}</span><span><Coins size={16} aria-hidden />{tx("Fee")}: {formatMoney(current.feeCents, current.currency, 'en-US')}</span>{current.status === 'closed' && <span>{tx("Closed")}</span>}</p> : <p>{tx("One common campaign, one month at most.")}</p>}</div>
        <div className="ap-right">
          {(!current || current.status === 'closed') && <button type="button" className="fx2-btn primary" onClick={() => setDialog('open')}>{tx("Open the campaign")}</button>}
          {current?.status === 'open' && <button type="button" className="cx-btn green" onClick={() => setDialog('pay')}><CreditCard size={16} />{tx("Record a payment")}</button>}
          {current?.status === 'open' && <button type="button" className="cx-btn" disabled={!ended} title={ended ? '' : tx("Available once the period is over")} onClick={() => run(() => closeRenewalCampaign({ campaignId: current.id }), 'Campaign closed; unpaid members suspended')}>{tx("Close and suspend non-payers")}</button>}
        </div>
      </header>
      <div className="ap-stats">
        <div className="g"><span>{tx("Confirmed")}</span><strong>{current ? (paid ?? '—') : '—'}</strong><small>{tx("Paid the fee")}</small></div>
        <div className="y"><span>{tx("Awaiting Payment")}</span><strong>{awaiting ?? '—'}</strong><small>{tx("Not yet paid")}</small></div>
        <div className="r"><span>{tx("Suspended")}</span><strong>{current ? (suspended ?? '—') : '—'}</strong><small>{tx("After the deadline")}</small></div>
        <div className="p"><span>{tx("Fee per Member")}</span><strong>{current ? formatMoney(current.feeCents, current.currency, 'en-US') : '—'}</strong><small>{current ? (current.status === 'open' ? tx("Campaign open") : tx("Campaign closed")) : tx("No campaign")}</small></div>
      </div>
      {current?.status === 'open' && !ended && <p className="ap-warn">{tx("Closing and suspending non-payers is possible once the period ends on")} {new Date(tsMs(current.endAt)).toLocaleDateString(dateLocale())}.</p>}
      {dialog === 'open' && (
        <FormDialog
          title={tx("Open the renewal campaign")}
          intro="The common renewal date starts after the Gamou and lasts one month at most. The amount depends on the country; set it per campaign."
          submitLabel={tx("Open")}
          onClose={() => setDialog(null)}
          fields={[
            { name: 'year', label: tx("Year"), type: 'number', required: true, initial: String(new Date().getFullYear()) },
            { name: 'start', label: tx("Start"), type: 'date', required: true },
            { name: 'end', label: tx("End (max 31 days)"), type: 'date', required: true },
            { name: 'fee', label: tx("Fee"), type: 'number', required: true, min: 0 },
            { name: 'currency', label: tx("Currency"), required: true, placeholder: 'XOF', initial: 'XOF' },
          ]}
          onSubmit={(v) => openRenewalCampaign({ year: Number(v.year), startMs: new Date(v.start).getTime(), endMs: new Date(v.end).getTime() + 86399000, feeCents: Math.round(Number(v.fee) * 100), currency: v.currency }).then(() => notify('Campaign opened', 'success'))}
        />
      )}
      {dialog === 'pay' && current && (
        <FormDialog
          title={tx("Record a renewal payment")}
          intro="Fees are checked at renewal. A payment equal to the fee confirms the member."
          onClose={() => setDialog(null)}
          fields={[
            { name: 'userId', label: tx("Member"), type: 'member', required: true },
            { name: 'paid', label: `Amount paid (${current.currency})`, type: 'number', min: 0, initial: String(current.feeCents / 100) },
          ]}
          onSubmit={async (v) => {
            const userId = v.userId;
            await recordRenewalPayment({ campaignId: current.id, userId, paidCents: Math.round(Number(v.paid) * 100) });
            notify('Payment recorded', 'success');
          }}
        />
      )}
    </section>
  );
}

interface Transfer { userName: string; memberMatricule: string; toGroupId: string; stage: 'zone_opinion' | 'decision' | 'approved' | 'rejected'; zoneOpinion?: string; attendanceRatePct?: number; requestedByName: string }

/** Additional-kurel requests: kurel request → zone opinion → decision by senior management. */
export function TransferTools() {
  const { activeLeafGroups, byId } = useGroupHierarchy();
  const raw = useCollection<Transfer>('transferRequests', [orderBy('updatedAt', 'desc'), fsLimit(30)]);
  const rows = useMemo(() => (raw ?? []).filter((t) => t.stage === 'zone_opinion' || t.stage === 'decision'), [raw]);
  const [dialog, setDialog] = useState(false);
  const run = (fn: () => Promise<unknown>, ok: string) => fn().then(() => notify(ok, 'success')).catch((e: Error) => notify(e.message, 'error'));
  return (
    <>
      <section className="ap-pane cx-card">
        <header><i aria-hidden><Users size={22} /></i>
          <div><h2>{tx("Group Transfers")}</h2><p>{tx("Zone opinion first, then the decision of senior management.")}</p></div>
        </header>
        <div className="ap-tr-bar"><span className="ap-count">{rows.length}</span><button type="button" className="cx-btn green" onClick={() => setDialog(true)}><Plus size={16} />{tx("Request a member for another group")}</button></div>
        {rows.length === 0 && <p className="ap-none ap-dash"><Users size={30} />{tx("No transfer waiting.")}</p>}
        <div className="ap-cards">
          {rows.map((t) => (
            <article className="ap-req" key={t.id}>
              <div>
                <b>{t.userName}</b><small>{t.memberMatricule} → {byId[t.toGroupId]?.name ?? ''}</small>
                <p>{tx("Requested by")} {t.requestedByName}{t.attendanceRatePct !== undefined ? ` · attendance ${t.attendanceRatePct}%` : ''}{t.zoneOpinion ? ` · zone: ${t.zoneOpinion}` : ''}</p>
                <span className="ap-stage">{t.stage === 'zone_opinion' ? tx("Zone opinion") : tx("Decision")}</span>
              </div>
              <footer>
                {t.stage === 'zone_opinion' && (<>
                  <button type="button" className="ap-btn no" onClick={() => run(() => giveTransferOpinion({ requestId: t.id, opinion: 'unfavourable' }), 'Opinion recorded')}>{tx("Unfavourable")}</button>
                  <button type="button" className="ap-btn ok" onClick={() => run(() => giveTransferOpinion({ requestId: t.id, opinion: 'favourable' }), 'Opinion recorded')}>{tx("Favourable")}</button>
                </>)}
                {t.stage === 'decision' && (<>
                  <button type="button" className="ap-btn no" onClick={() => run(() => decideTransfer({ requestId: t.id, approve: false }), 'Request declined')}>{tx("Decline")}</button>
                  <button type="button" className="ap-btn ok" onClick={() => run(() => decideTransfer({ requestId: t.id, approve: true }), 'Member added to the kurel')}>{tx("Approve")}</button>
                </>)}
              </footer>
            </article>
          ))}
        </div>
      </section>
      {dialog && (
        <FormDialog
          title={tx("Add a member of another kurel")}
          intro="Find the member by country, zone, city or kurel. The request goes to the zone for an opinion, then to senior management. Special kurels also require a local kurel and enough attendance."
          submitLabel={tx("Send the request")}
          onClose={() => setDialog(false)}
          fields={[
            { name: 'userId', label: tx("Member to add"), type: 'member', required: true },
            { name: 'toGroupId', label: tx("Kurel"), type: 'select', required: true, options: activeLeafGroups.map((g) => ({ value: g.id, label: g.name })) },
            { name: 'note', label: tx("Note"), type: 'textarea' },
          ]}
          onSubmit={async (v) => {
            const snap = await getDoc(doc(db, 'users', v.userId));
            const matricule = (snap.data()?.memberId as string | undefined) ?? '';
            if (!matricule) throw new Error('This member has no matricule yet. Add it on the Members page first.');
            await requestKurelTransfer({ matricule, toGroupId: v.toGroupId, note: v.note });
            notify('Request sent to the zone', 'success');
          }}
        />
      )}
    </>
  );
}


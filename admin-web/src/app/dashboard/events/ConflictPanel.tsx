'use client';

import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/MemberPicker';
import { PersonLink } from '@/components/MemberProfile';
import { checkDraftConflicts, setEventExclusions, type DraftConflict, type SharedMember } from '@/lib/functions';
import { tx, dateLocale } from '@/lib/i18n/tr';

export interface ConflictDraft {
  startAtMs: number;
  endAtMs: number;
  subGroupIds: string[];
  sites: { id: string; name: string; lat?: number; lng?: number; groupIds: string[] }[];
  slots: { groupId: string; startMs: number; endMs: number }[];
  shifts: { id: string; label: string; startMs: number; endMs: number; siteIds?: string[]; supervisors: { userId: string }[] }[];
  excludeEventId?: string;
  excludedUserIds?: string[];
}

export interface ConflictActions {
  removeGroups: (ids: string[]) => void;
  excludeMembers: (m: { id: string; name: string }[]) => void;
  restoreMembers: (ids: string[]) => void;
  removeSupervisors: (userIds: string[], shiftIds?: string[]) => void;
  /** Members already taken out of this event. */
  excluded: { id: string; name: string }[];
  groupName: (id: string) => string;
}

export interface ConflictState {
  /** True once the last check finished. */
  checked: boolean;
  critical: number;
  approved: boolean;
}

const TYPE_LABEL: Record<DraftConflict['type'], string> = {
  group: 'Group', member: 'Member', cross_event: 'Other event', performance: 'Travel time', site: 'Site', supervisor: 'Supervisor', shift: 'Shift',
};

const when = (ms?: number) => (ms ? new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Looks for conflicts of the draft (groups, members, sites, supervisors, shifts) and checks again
 * whenever the schedule or an assignment changes. Critical conflicts must be solved, or accepted
 * by a senior administrator, before the event can be created.
 */
export default function ConflictPanel({ draft, canApprove, onState, actions }: { draft: ConflictDraft | null; canApprove: boolean; onState: (s: ConflictState) => void; actions?: ConflictActions }) {
  const [nonce, setNonce] = useState(0);
  const [working, setWorking] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<DraftConflict[]>([]);
  const [shared, setShared] = useState<SharedMember[]>([]);
  const [sharedTotal, setSharedTotal] = useState(0);
  const [approved, setApproved] = useState(false);
  const [showShared, setShowShared] = useState(false);
  const [view, setView] = useState<'all' | 'critical' | 'warning'>('all');
  const [checked, setChecked] = useState(false);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const key = useMemo(() => (draft ? JSON.stringify(draft) : '') + nonce, [draft, nonce]);

  useEffect(() => {
    if (!draft) {
      setConflicts([]);
      setShared([]);
      setChecked(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const h = window.setTimeout(async () => {
      try {
        const res = await checkDraftConflicts({ ...draft });
        if (cancelled) return;
        setConflicts(res.data.conflicts);
        setShared(res.data.sharedMembers);
        setSharedTotal(res.data.sharedTotal ?? res.data.sharedMembers.length);
        setError('');
        setChecked(true);
        setApproved(false); // the schedule changed: the approval must be given again
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : tx("The check failed"));
          setChecked(false);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const critical = conflicts.filter((c) => c.severity === 'critical');
  const warnings = conflicts.filter((c) => c.severity === 'warning');
  useEffect(() => {
    onState({ checked, critical: critical.length, approved });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, critical.length, approved]);

  if (!draft) return <p className="fx3-note">{tx("Choose the groups first: the conflict check then runs by itself and again after every change.")}</p>;

  async function takeOutOfOther(c: DraftConflict) {
    if (!c.otherEventId || !c.members?.length) return;
    if (!confirm(`Take ${c.members.length} member${c.members.length === 1 ? '' : 's'} out of “${c.otherEventTitle}”? They will no longer be invited to that event.`)) return;
    setWorking(c.id);
    try {
      await setEventExclusions({ eventId: c.otherEventId, remove: c.members.map((m) => m.id) });
      setNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("The action failed"));
    } finally {
      setWorking('');
    }
  }

  const buttons = (c: DraftConflict) => {
    if (!actions) return null;
    const many = (c.members?.length ?? 0) > 1;
    const who = c.members?.length === 1 ? c.members[0].name : `these ${c.members?.length ?? 0} members`;
    const out: { label: string; run: () => void; busy?: boolean }[] = [];
    if (c.type === 'group' && c.groupIds?.length) out.push({ label: `Remove ${actions.groupName(c.groupIds[0])} from this event`, run: () => actions.removeGroups(c.groupIds!) });
    if (c.type === 'member') {
      if (c.members?.length) out.push({ label: `Take ${who} out of this event`, run: () => actions.excludeMembers(c.members!) });
      (c.groupIds ?? []).forEach((g) => out.push({ label: `Remove ${actions.groupName(g)} from this event`, run: () => actions.removeGroups([g]) }));
    }
    if (c.type === 'cross_event' && c.members?.length) {
      out.push({ label: `Take ${who} out of this event`, run: () => actions.excludeMembers(c.members!) });
      if (c.otherEventId) out.push({ label: `Take ${who} out of “${c.otherEventTitle}” instead`, run: () => void takeOutOfOther(c), busy: working === c.id });
    }
    if ((c.type === 'supervisor' || c.type === 'shift') && c.members?.length && c.shiftIds?.length) {
      if (c.shiftIds.length === 2) {
        out.push({ label: `Remove ${many ? 'them' : c.members[0].name} from the first shift`, run: () => actions.removeSupervisors(c.members!.map((m) => m.id), [c.shiftIds![0]]) });
        out.push({ label: `Remove ${many ? 'them' : c.members[0].name} from the second shift`, run: () => actions.removeSupervisors(c.members!.map((m) => m.id), [c.shiftIds![1]]) });
      } else {
        out.push({ label: `Remove ${many ? 'them' : c.members[0].name} from this shift`, run: () => actions.removeSupervisors(c.members!.map((m) => m.id), c.shiftIds) });
      }
    }
    if (!out.length) return null;
    return <footer className="cf4-a">{out.map((b, i) => <button type="button" key={b.label} className={`cf4-b${i > 0 ? ' warn' : ''}`} disabled={b.busy} onClick={b.run}>{b.busy ? tx("Working…") : b.label}</button>)}</footer>;
  };

  const row = (c: DraftConflict) => (
    <article key={c.id} className={`cf4 ${c.severity}`}>
      <div className="cf4-h">
        <span className={`cf4-ico ${c.severity}`} aria-hidden>{c.severity === 'critical' ? '!' : 'i'}</span>
        <div><b>{c.title}</b><small>{TYPE_LABEL[c.type]} · {c.otherEventTitle ?? (c.place || tx("No place"))}{c.startMs ? ` · ${when(c.startMs)} → ${when(c.endMs)}` : ''}</small></div>
        <span className={`cf4-st ${c.severity}`}>{c.severity === 'critical' ? tx("Must be solved") : tx("Warning")}</span>
      </div>
      <p className="cf4-d">{c.detail}{c.suggestion ? <em> {c.suggestion}</em> : null}</p>
      {((c.affectedGroups?.length ?? 0) > 0 || (c.members?.length ?? 0) > 0) && (
        <div className="cf4-w">
          {(c.members ?? []).slice(0, 6).map((m) => <PersonLink key={m.id} userId={m.id}><span className="cf4-p"><Avatar name={m.name} size={20} />{m.name}</span></PersonLink>)}
          {(c.members?.length ?? 0) > 6 && <i>+{(c.members?.length ?? 0) - 6} {tx("more")}</i>}
          {(c.affectedGroups ?? []).map((g) => <span className="cf4-g" key={g}>{g}</span>)}
        </div>
      )}
      {buttons(c)}
    </article>
  );
  const LIMIT = 12;

  return (
    <div className="cf">
      <div className={`cf-bar ${busy ? 'busy' : critical.length ? 'bad' : warnings.length ? 'warn' : 'ok'}`}>
        {busy ? tx("Checking the schedule…") : error ? error : critical.length ? `${critical.length} critical conflict${critical.length === 1 ? '' : 's'}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}` : warnings.length ? `No critical conflict, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : tx("No conflict found")}
      </div>
      {!busy && conflicts.length > 0 && (
        <div className="cf3">
          <div className="cf3-tabs">
            {([['all', `All (${conflicts.length})`], ['critical', `Must be solved (${critical.length})`], ['warning', `Warnings (${warnings.length})`]] as const).map(([k, l]) => <button type="button" key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
          </div>
          {(['critical', 'warning'] as const).filter((sev) => view === 'all' || view === sev).map((sev) => {
            const list = sev === 'critical' ? critical : warnings;
            if (!list.length) return null;
            return (
              <section key={sev} className="cf3-sec">
                <h4 className={sev}>{sev === 'critical' ? tx("Must be solved before the event is created") : tx("Warnings, the event can still be created")}<em>{list.length}</em></h4>
                <div className="cf4-grid">{(more[sev] ? list : list.slice(0, LIMIT)).map(row)}</div>
                {list.length > LIMIT && <button type="button" className="gp-btn cf4-more" onClick={() => setMore({ ...more, [sev]: !more[sev] })}>{more[sev] ? tx("Show fewer") : `Show all ${list.length}`}</button>}
              </section>
            );
          })}
        </div>
      )}
      {!busy && critical.length > 0 && (
        canApprove ? (
          <label className="fx3-switch">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            <span>{tx("I accept these")} {critical.length} {tx("critical conflict")}{critical.length === 1 ? '' : 's'} {tx("and create the event anyway")}</span>
          </label>
        ) : (
          <p className="fx3-hint">{tx("Solve the critical conflicts above. Only a senior administrator can accept them.")}</p>
        )
      )}
      {actions && actions.excluded.length > 0 && (
        <div className="cf-out">
          <b>{actions.excluded.length} {tx("member")}{actions.excluded.length === 1 ? '' : 's'} {tx("taken out of this event")}</b>
          <div>
            {actions.excluded.slice(0, 30).map((m) => <button type="button" key={m.id} className="cf-chip" onClick={() => actions.restoreMembers([m.id])} title={tx("Click to put back")}>{m.name} <span aria-hidden>{tx("↺ put back")}</span></button>)}
            {actions.excluded.length > 30 && <em>{tx("and")} {actions.excluded.length - 30} {tx("more")}</em>}
          </div>
          <button type="button" className="gp-btn" onClick={() => actions.restoreMembers(actions.excluded.map((m) => m.id))}>{tx("Put everybody back")}</button>
        </div>
      )}
      {sharedTotal > 0 && (
        <div className="cf-shared">
          <button type="button" className="btn btn-secondary" onClick={() => setShowShared(!showShared)}>
            {showShared ? tx("Hide") : tx("Show")} {tx("the")} {sharedTotal} {tx("member")}{sharedTotal === 1 ? '' : 's'} {tx("in several groups")}
          </button>
          {showShared && (
            <div className="cf4-grid">
              {shared.map((m) => (
                <article key={m.userId} className="mm-card">
                  <header><Avatar name={m.name} size={44} /><div><b><PersonLink userId={m.userId}>{m.name}</PersonLink></b><small>{tx("In")} {m.groups.length} {tx("groups of this event")}</small></div></header>
                  <div className="mm-tbl" role="table">
                    <div className="mm-th" role="row"><span>{tx("Date and time")}</span><span>{tx("Group")}</span><span>{tx("Place")}</span><span>{tx("Slot")}</span></div>
                    {m.groups.map((g) => (
                      <div className="mm-tr" role="row" key={g.groupId}>
                        <b>{g.hasSlot ? <>{when(g.startMs)}<small> {tx("to")} {when(g.endMs)}</small></> : '—'}</b><span>{g.groupName}</span><span>{g.place || '—'}</span><em>{g.hasSlot ? tx("Planned") : tx("No slot yet")}</em>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {sharedTotal > shared.length && <p className="fx3-note">{tx("And")} {sharedTotal - shared.length} {tx("more.")}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { addEventNote, addExtraSlot, adjustSchedule, extendPerformance, getEventAttendance, scheduleImpacts, setAudioRun, setEventRun, setLiveStatus, type AttendanceGroup, type DelayImpact, type LiveStatus, type RunState } from '@/lib/functions';
import FormDialog from '@/components/FormDialog';
import ImpactPanel from './ImpactPanel';
import HistoryList from './HistoryList';
import { notify } from '@/lib/notify';
import TimingAnalysis from './TimingAnalysis';
import LiveSections from './LiveSections';
import { tx, dateLocale } from '@/lib/i18n/tr';

export interface Slot {
  id: string;
  groupId: string;
  groupName: string;
  startMs: number;
  endMs: number;
  originalStartMs?: number;
  status: LiveStatus;
  delayMinutes?: number;
  delayReason?: string;
  atRisk?: boolean;
  atRiskReason?: string;
  actualStartMs?: number;
  actualEndMs?: number;
  timeZone?: string;
  cityName?: string;
  /** Moved along by the clock (not by a supervisor). */
  auto?: boolean;
  extendedMinutes?: number;
  performanceRemark?: string;
  /** Each audio of the performance: when its own start button was pressed, and when it stopped. */
  audioRuns?: Record<string, { startedMs: number; endedMs?: number; pausedMs?: number; pausedAtMs?: number; remark?: string; rating?: number }>;
  /** What the group performs: the audio and books chosen for this slot. */
  audio?: { status: string; items: { title: string; artist?: string; type: string; seconds: number }[] } | null;
}
export interface LogRow { id: string; type: string; byName: string; detail: string; before?: string; after?: string; groupName?: string; atMs: number }
export interface SiteLite { id: string; name: string; groupIds?: string[]; supervisorName?: string }
export interface ShiftLite { id: string; label: string; startMs?: number; endMs?: number; startAt?: { toMillis?: () => number }; endAt?: { toMillis?: () => number }; siteId?: string; siteIds?: string[]; supervisors: { userId: string; name: string; role: 'main' | 'member' }[] }

const LABEL: Record<LiveStatus, string> = { upcoming: 'Upcoming', ready: 'Ready', in_progress: 'In progress', completed: 'Completed', delayed: 'Delayed', cancelled: 'Cancelled' };
const TYPE_LABEL: Record<string, string> = {
  event_created: 'Created', conflicts_accepted: 'Conflicts accepted', shifts_set: 'Supervision', sites_set: 'Places', status: 'Status', delay: 'Delay', schedule_adjusted: 'Schedule', note: 'Note', escalation: 'Escalated', conflicts_found: 'Conflict',
};
const hm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * Live board of one event: every place with its groups and their status, delay reporting with the
 * groups it affects, schedule changes, notes and escalation, and the full history of the event.
 */
export default function LiveBoard({
  eventId,
  sites,
  shifts,
  feed,
  rights = ['status', 'delay', 'notes', 'adjust', 'cancel'],
  members,
  run: runProp,
  level,
  onReport,
  onChanged,
  quick,
}: {
  eventId: string;
  sites: SiteLite[];
  shifts: ShiftLite[];
  /** Data supplied by the caller (supervisor workspace). Without it the board listens to the database (administrators). */
  feed?: { slots: Slot[]; log: LogRow[] };
  /** Members who perform in several groups (supervisor view), to spot clashes. */
  members?: { name: string; groups: string[] }[];
  /** What the signed-in person may do. */
  rights?: string[];
  /** Start, pause and end state per place (supervisor view). The admin view reads it from the event itself. */
  run?: RunState;
  /** Level of the signed-in supervisor (supervisor view). */
  level?: string;
  /** Lets a supervisor send a prepared report up the chain (supervisor view). */
  onReport?: (preset: { about: string; kind: 'urgent'; text: string }) => void;
  onChanged?: () => void;
  /** Supervisor view: shows the quick actions inside the card of the group on stage. */
  quick?: { eventId: string; onOpen?: (n: number) => void };
}) {
  const can = (r: string) => rights.includes(r);
  const [slotsRaw, setSlots] = useState<Slot[]>([]);
  const [attGroups, setAttGroups] = useState<Record<string, AttendanceGroup>>({});
  const [attDecide, setAttDecide] = useState(false);
  const loadAtt = useCallback(async () => {
    if (!eventId) return;
    try {
      const r = (await getEventAttendance({ eventId })).data;
      setAttGroups(Object.fromEntries(r.groups.map((g) => [g.groupId, g])));
      setAttDecide(r.canDecide);
    } catch { /* the board still works without it */ }
  }, [eventId]);
  useEffect(() => { void loadAtt(); const h = window.setInterval(() => void loadAtt(), 10000); return () => window.clearInterval(h); }, [loadAtt]);
  const [audioMap, setAudioMap] = useState<Record<string, NonNullable<Slot['audio']>>>({});
  const slots = useMemo(() => (feed ? slotsRaw : slotsRaw.map((x) => ({ ...x, audio: audioMap[x.id] ?? null }))), [slotsRaw, audioMap, feed]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [delayFor, setDelayFor] = useState<Slot | null>(null);
  const [cancelFor, setCancelFor] = useState<Slot | null>(null);
  const [impacts, setImpacts] = useState<{ from: string; list: DelayImpact[]; late?: boolean } | null>(null);
  const [runState, setRunState] = useState<RunState>({});
  const [note, setNote] = useState('');
  const [escalate, setEscalate] = useState(false);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<'live' | 'history' | 'analysis'>('live');
  const [moveFor, setMoveFor] = useState<Slot | null>(null);
  const [correctFor, setCorrectFor] = useState<Slot | null>(null);
  const [extendFor, setExtendFor] = useState<Slot | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (feed) {
      setSlots(feed.slots);
      setLog(feed.log);
      return;
    }
    if (!eventId) return;
    const u1 = onSnapshot(query(collection(db, 'eventSlots'), where('eventId', '==', eventId)), (snap) => {
      setSlots(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown> & { startAt?: { toMillis(): number }; endAt?: { toMillis(): number }; originalStartAt?: { toMillis(): number }; actualStartAt?: { toMillis(): number }; actualEndAt?: { toMillis(): number } };
        return {
          id: d.id, groupId: x.groupId as string, groupName: (x.groupName as string) ?? '', startMs: x.startAt?.toMillis() ?? 0, endMs: x.endAt?.toMillis() ?? 0,
          originalStartMs: x.originalStartAt?.toMillis(), status: (x.liveStatus as LiveStatus) ?? (x.performanceStatus === 'completed' ? 'completed' : x.performanceStatus === 'started' ? 'in_progress' : 'upcoming'),
          delayMinutes: x.delayMinutes as number | undefined, delayReason: x.delayReason as string | undefined, atRisk: x.atRisk === true, atRiskReason: x.atRiskReason as string | undefined,
          actualStartMs: x.actualStartAt?.toMillis(), actualEndMs: x.actualEndAt?.toMillis(), timeZone: x.timeZone as string | undefined, auto: x.liveAuto === true, extendedMinutes: x.extendedMinutes as number | undefined, performanceRemark: (x.performanceRemark as string | undefined) ?? '',
          audioRuns: Object.fromEntries(Object.entries((x.audioRuns ?? {}) as Record<string, { startedAt?: { toMillis(): number }; endedAt?: { toMillis(): number }; pausedAt?: { toMillis(): number }; pausedMs?: number; remark?: string; rating?: number }>).map(([k, r]) => [k, { startedMs: r.startedAt?.toMillis() ?? 0, endedMs: r.endedAt?.toMillis(), pausedMs: r.pausedMs ?? 0, pausedAtMs: r.pausedAt?.toMillis(), remark: r.remark ?? '', rating: r.rating ?? 0 }])),
        };
      }).sort((a, b) => a.startMs - b.startMs));
    });
    const u3 = onSnapshot(query(collection(db, 'performanceSelections'), where('eventId', '==', eventId)), (snap) => {
      const m: Record<string, NonNullable<Slot['audio']>> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as { slotId?: string; status?: string; items?: { title?: string; artist?: string; type?: string; durationSeconds?: number }[] };
        m[x.slotId ?? d.id] = { status: x.status ?? 'submitted', items: (x.items ?? []).map((i) => ({ title: i.title ?? '', artist: i.artist ?? '', type: i.type ?? 'audio', seconds: i.durationSeconds ?? 0 })) };
      });
      setAudioMap(m);
    }, () => undefined);
    const u2 = onSnapshot(query(collection(db, 'eventLog'), where('eventId', '==', eventId)), (snap) => {
      setLog(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown> & { at?: { toMillis(): number } };
        return { id: d.id, type: x.type as string, byName: (x.byName as string) ?? '', detail: (x.detail as string) ?? '', before: x.before as string | undefined, after: x.after as string | undefined, groupName: x.groupName as string | undefined, atMs: x.at?.toMillis() ?? 0 };
      }).sort((a, b) => b.atMs - a.atMs));
    });
    return () => { u1(); u2(); u3(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, feed]);

  useEffect(() => {
    if (feed || runProp) { setRunState(runProp ?? {}); return; }
    if (!eventId) return;
    return onSnapshot(doc(db, 'events', eventId), (snap) => {
      const lr = (snap.data()?.liveRun ?? {}) as Record<string, { state: 'running' | 'paused' | 'ended'; at?: { toMillis(): number } }>;
      setRunState(Object.fromEntries(Object.entries(lr).map(([k, v]) => [k, { state: v.state, atMs: v.at?.toMillis() ?? 0 }])));
    });
  }, [eventId, feed, runProp]);

  const [tick, setTick] = useState(0);
  useEffect(() => { const h = window.setInterval(() => setTick((t) => t + 1), 10000); return () => window.clearInterval(h); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [tick, slots]);

  async function bulkPerformed(list: Slot[]) {
    if (!confirm(`Mark all ${list.length} performances as performed at their planned times? Only do this if they really took place.`)) return;
    setBusy('bulk');
    try {
      for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map((s) => setLiveStatus({ eventId, slotId: s.id, status: 'completed', actualStartMs: s.startMs, actualEndMs: s.endMs })));
      notify(`${list.length} performances marked as performed`, 'success');
      onChanged?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not update all of them', 'error');
    } finally {
      setBusy('');
    }
  }

  async function extendBy(s: Slot, minutes: number) {
    setBusy(s.id);
    try {
      const res = await extendPerformance({ eventId, slotId: s.id, minutes });
      notify(`${s.groupName}: ${minutes} more minutes`, 'success');
      onChanged?.();
      setImpacts({ from: s.groupName, list: res.data.impacts });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not extend', 'error');
    } finally {
      setBusy('');
    }
  }

  async function setStatusRaw(s: Slot, times: { actualStartMs: number; actualEndMs: number }) {
    setBusy(s.id);
    try {
      await setLiveStatus({ eventId, slotId: s.id, status: 'completed', ...times });
      notify(`${s.groupName}: times corrected`, 'success');
      onChanged?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not update', 'error');
      throw e;
    } finally {
      setBusy('');
    }
  }

  async function setStatus(s: Slot, status: LiveStatus, extra?: { reason?: string; delayMinutes?: number; force?: boolean }) {
    setBusy(s.id);
    try {
      const res = await setLiveStatus({ eventId, slotId: s.id, status, ...extra });
      notify(`${s.groupName}: ${LABEL[status]}`, 'success');
      onChanged?.();
      if ((status === 'delayed' || status === 'completed') && res.data.impacts.length) setImpacts({ from: s.groupName, list: res.data.impacts, late: status === 'completed' });
    } catch (e) {
      const d = (e as { details?: { code?: string } }).details;
      if (d?.code === 'on-stage-clash' && !extra?.force) {
        setBusy('');
        if (confirm(`${(e as Error).message}\n\nPress OK to start it anyway. The other supervisors will be told that two groups are on stage.`)) return await setStatus(s, status, { ...extra, force: true });
        return;
      }
      notify(e instanceof Error ? e.message : 'Could not update', 'error');
      throw e;
    } finally {
      setBusy('');
    }
  }

  async function applyImpacts(mode: 'shift' | 'shorten') {
    if (!impacts) return;
    setBusy('apply');
    try {
      const list = mode === 'shorten' ? impacts.list.filter((i) => i.first) : impacts.list;
      await adjustSchedule({
        eventId,
        changes: list.map((i) => (mode === 'shorten' ? { slotId: i.slotId, newStartMs: i.suggestedStartMs, newEndMs: i.originalEndMs } : { slotId: i.slotId, newStartMs: i.suggestedStartMs })),
        note: `${impacts.late ? `${impacts.from} finished late` : `Delay of ${impacts.from}`}${mode === 'shorten' ? ', next performance shortened' : ''}`,
      });
      notify(mode === 'shorten' ? 'The next performance was shortened. Groups and supervisors were notified.' : 'Schedule updated. Groups and supervisors were notified.', 'success');
      onChanged?.();
      setImpacts(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not change the schedule', 'error');
    } finally {
      setBusy('');
    }
  }

  async function fixSchedule(s: Slot) {
    setBusy(s.id);
    try {
      const res = await scheduleImpacts({ eventId, slotId: s.id });
      setImpacts({ from: s.groupName, list: res.data.impacts });
      if (res.data.impacts.length === 0) notify(`${s.groupName} does not push anyone back`, 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not check the schedule', 'error');
    } finally {
      setBusy('');
    }
  }

  const runAction = (action: 'start' | 'pause' | 'resume' | 'end') => runEventAction({ eventId, action, slots, runState, setBusy, onChanged });

  async function sendNote() {
    if (note.trim().length < 2) return;
    setBusy('note');
    try {
      await addEventNote({ eventId, text: note.trim(), escalate });
      setNote('');
      setEscalate(false);
      notify(escalate ? 'Sent to the main supervisors' : 'Note added', 'success');
      onChanged?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not add the note', 'error');
    } finally {
      setBusy('');
    }
  }

  function audioDo(s: Slot, i: number, action: 'start' | 'pause' | 'resume' | 'stop' | 'remark' | 'rate' | 'groupRemark', extra?: { remark?: string; rating?: number }) {
    setAudioRun({ eventId, slotId: s.id, index: i, action, ...extra }).then(() => onChanged?.()).catch((e: Error) => notify(e.message, 'error'));
  }

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [['When', 'Type', 'By', 'Group', 'Before', 'After', 'Detail'], ...[...log].reverse().map((l) => [new Date(l.atMs).toISOString(), TYPE_LABEL[l.type] ?? l.type, l.byName, l.groupName ?? '', l.before ?? '', l.after ?? '', l.detail])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `event-history-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="lb">
      <div className="lb-tabs">
        <button type="button" className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>{tx("Live board")}</button>
        <button type="button" className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>{tx("History (")}{log.length})</button>
        <button type="button" className={tab === 'analysis' ? 'on' : ''} onClick={() => setTab('analysis')}>{tx("Timing analysis")}</button>
      </div>

      {tab === 'live' ? (
        <>
          <RunBar run={runState} slots={slots} now={now} can={can} busy={busy} onAction={runAction} />

          {can('adjust') && (
            <div className="lb-toolbar">
              <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>{tx("+ Add a performance at a custom time")}</button>
            </div>
          )}

          {impacts && (
            <ImpactPanel
              from={impacts.from}
              late={impacts.late}
              list={impacts.list}
              canAdjust={can('adjust')}
              busy={busy === 'apply'}
              reportTo={level === 'member' ? 'your site manager' : level === 'manager' ? 'the main supervisor' : 'the administration'}
              onApply={applyImpacts}
              onReport={onReport ? () => {
                const first = impacts.list[0];
                onReport({
                  about: impacts.from,
                  kind: 'urgent',
                  text: `${impacts.from} ${impacts.late ? 'finished late' : 'is delayed'} and pushes back ${impacts.list.length} performance${impacts.list.length === 1 ? '' : 's'}${first ? `, starting with ${first.groupName} (${hm(first.originalStartMs)} to ${hm(first.suggestedStartMs)}, ${first.shiftMinutes} min later)` : ''}. Please decide: move everything later or shorten the next performance.`,
                });
                setImpacts(null);
              } : undefined}
              onClose={() => setImpacts(null)}
            />
          )}

          <LiveSections
            slots={slots}
            run={runState}
            members={members}
            now={now}
            sites={sites}
            shifts={shifts}
            can={can}
            busy={busy}
            act={{
              start: (s) => setStatus(s, 'in_progress').catch(() => undefined),
              finish: (s) => setStatus(s, 'completed').catch(() => undefined),
              delay: (s) => setDelayFor(s),
              cancel: (s) => setCancelFor(s),
              move: (s) => setMoveFor(s),
              correct: (s) => setCorrectFor(s),
              setStatus: (s, st) => setStatus(s, st).catch(() => undefined),
              extend: (s, m) => extendBy(s, m),
              bulkPerformed: (list) => bulkPerformed(list),
              fixSchedule: (s) => fixSchedule(s),
              extendCustom: (s) => setExtendFor(s),
              audioStart: (s, i) => audioDo(s, i, 'start'),
              audioStop: (s, i) => audioDo(s, i, 'stop'),
              audioDo: (s, i, action, extra) => audioDo(s, i, action, extra),
            }}
            quick={quick}
            attendance={{ eventId, byGroup: attGroups, canDecide: attDecide, reload: () => void loadAtt() }}
          />

          {can('notes') && <div className="lb-note">
            <h4>{tx("Notes and instructions")}</h4>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx("Write a note for the event timeline…")} rows={2} />
            <div className="lb-actions">
              <label className="fx3-switch"><input type="checkbox" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} /><span>{tx("Escalate to the main supervisors")}</span></label>
              <button type="button" className="btn btn-primary" disabled={busy === 'note' || note.trim().length < 2} onClick={sendNote}>{tx("Add")}</button>
            </div>
          </div>}
        </>
      ) : tab === 'analysis' ? (
        <TimingAnalysis slots={slots} />
      ) : (
        <div className="lb-hist">
          <div className="lb-actions"><button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={log.length === 0}>{tx("Download the history (CSV)")}</button></div>
          {log.length === 0 && <p className="fx3-note">{tx("Nothing recorded yet.")}</p>}
          <HistoryList rows={log} labels={TYPE_LABEL} />
        </div>
      )}

      {moveFor && (
        <FormDialog
          title={`Change the times: ${moveFor.groupName}`}
          intro="Choose the start and the end you want. A shorter or longer performance is allowed. The group and the supervisors are told."
          submitLabel={tx("Save the times")}
          onClose={() => setMoveFor(null)}
          fields={[
            { name: 'time', label: `Start (now ${hm(moveFor.startMs)})`, type: 'time', required: true, initial: hm(moveFor.startMs) },
            { name: 'end', label: `End (now ${hm(moveFor.endMs)})`, type: 'time', required: true, initial: hm(moveFor.endMs) },
            { name: 'note', label: tx("Reason (optional)"), type: 'text' },
          ]}
          onSubmit={async (v) => {
            const at = (t: string) => { const d = new Date(moveFor.startMs); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); };
            const st = at(v.time);
            let en = at(v.end);
            if (en <= st) en += 86400000;
            setBusy(moveFor.id);
            try {
              await adjustSchedule({ eventId, changes: [{ slotId: moveFor.id, newStartMs: st, newEndMs: en }], note: v.note?.trim() || undefined });
              notify('New times saved. The group was notified.', 'success');
              onChanged?.();
            } finally { setBusy(''); }
            setMoveFor(null);
          }}
        />
      )}
      {extendFor && (
        <FormDialog
          title={`Give more time: ${extendFor.groupName}`}
          intro="The performance ends later by the minutes you choose. You then see who this pushes back."
          submitLabel={tx("Add the time")}
          onClose={() => setExtendFor(null)}
          fields={[{ name: 'minutes', label: tx("Minutes to add (1 to 180)"), type: 'number', required: true, min: 1, max: 180, initial: '20' }]}
          onSubmit={async (v) => { await extendBy(extendFor, Number(v.minutes)); setExtendFor(null); }}
        />
      )}
      {adding && (() => {
        const groups = Array.from(new Map(slots.map((x) => [x.groupId, x.groupName])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
        const today = new Date(Math.max(now, slots[0]?.startMs ?? now));
        const ymdLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        return (
          <FormDialog
            title={tx("Add a performance at a custom time")}
            intro="For a group that must perform again, or one that was left out. It must fit inside the event. The group and the supervisors are told."
            submitLabel={tx("Add it")}
            onClose={() => setAdding(false)}
            fields={[
              { name: 'groupId', label: tx("Group"), type: 'select', required: true, options: groups.map(([id, name]) => ({ value: id, label: name })) },
              { name: 'date', label: tx("Day"), type: 'date', required: true, initial: ymdLocal },
              { name: 'start', label: tx("Start"), type: 'time', required: true },
              { name: 'end', label: tx("End"), type: 'time', required: true },
              { name: 'note', label: tx("Note (optional)"), type: 'text' },
            ]}
            onSubmit={async (v) => {
              const at = (t: string) => new Date(`${v.date}T${t}:00`).getTime();
              const st = at(v.start);
              let en = at(v.end);
              if (en <= st) en += 86400000;
              const send = (force: boolean) => addExtraSlot({ eventId, groupId: v.groupId, startMs: st, endMs: en, note: v.note?.trim() || undefined, force });
              try {
                await send(false);
              } catch (e) {
                const d = (e as { details?: { code?: string } }).details;
                if (d?.code === 'slot-overlap' && confirm(`${(e as Error).message}\n\nPress OK to add it anyway.`)) await send(true);
                else throw e;
              }
              notify('Performance added. The group was notified.', 'success');
              onChanged?.();
              setAdding(false);
            }}
          />
        );
      })()}
      {correctFor && (
        <FormDialog
          title={`Correct the real times — ${correctFor.groupName}`}
          intro="Use this when the automatic times were not what really happened."
          submitLabel={tx("Save the times")}
          onClose={() => setCorrectFor(null)}
          fields={[
            { name: 'start', label: tx("Real start"), type: 'time', required: true, initial: hm(correctFor.actualStartMs ?? correctFor.startMs) },
            { name: 'end', label: tx("Real end"), type: 'time', required: true, initial: hm(correctFor.actualEndMs ?? correctFor.endMs) },
          ]}
          onSubmit={async (v) => {
            const at = (t: string) => { const d = new Date(correctFor.startMs); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); };
            let st = at(v.start), en = at(v.end);
            if (en <= st) en += 86400000;
            if (st < correctFor.startMs - 12 * 3600000) st += 86400000;
            await setStatusRaw(correctFor, { actualStartMs: st, actualEndMs: en });
            setCorrectFor(null);
          }}
        />
      )}
      {delayFor && (
        <FormDialog
          title={`Report a delay — ${delayFor.groupName}`}
          intro="Supervisors, the main supervisor and the agents of this event are told right away. The groups that share members with this one are checked."
          submitLabel={tx("Report the delay")}
          onClose={() => setDelayFor(null)}
          fields={[
            { name: 'minutes', label: tx("Delay in minutes"), type: 'number', required: true, min: 1, max: 600, initial: '15' },
            { name: 'reason', label: tx("Reason"), type: 'textarea', required: true, placeholder: tx("For example: the sound system is not ready") },
          ]}
          onSubmit={async (v) => { await setStatus(delayFor, 'delayed', { delayMinutes: Number(v.minutes), reason: v.reason.trim() }); setDelayFor(null); }}
        />
      )}
      {cancelFor && (
        <FormDialog
          title={`Cancel the performance — ${cancelFor.groupName}`}
          submitLabel={tx("Cancel the performance")}
          onClose={() => setCancelFor(null)}
          fields={[{ name: 'reason', label: tx("Reason"), type: 'textarea', required: true }]}
          onSubmit={async (v) => { await setStatus(cancelFor, 'cancelled', { reason: v.reason.trim() }); setCancelFor(null); }}
        />
      )}
    </div>
  );
}

/** Start, pause, resume or end an event, with the questions that go with it. Used by the live board and by the event page. */
export async function runEventAction({ eventId, action, slots, runState, setBusy, onChanged }: { eventId: string; action: 'start' | 'pause' | 'resume' | 'end'; slots: Slot[]; runState: RunState; setBusy: (v: string) => void; onChanged?: () => void }) {
  const waitingList = slots.filter((s) => ['upcoming', 'ready', 'delayed'].includes(s.status));
  const onStageList = slots.filter((s) => s.status === 'in_progress');
  let shiftMinutes = 0;
  let cancelRemaining = false;
  if (action === 'pause' && !confirm(tx("Pause the event? The clock stops: nothing starts by itself and no over-time alerts are sent until you resume."))) return;
  if (action === 'resume') {
    const at = Math.min(...Object.values(runState).filter((r) => r.state === 'paused').map((r) => r.atMs));
    const mins = Number.isFinite(at) ? Math.round((Date.now() - at) / 60000) : 0;
    if (mins >= 2 && waitingList.length > 0 && confirm(`The event was paused for ${mins} minutes.\n\nPress OK to move the ${waitingList.length} performances that have not started ${mins} minutes later.\nPress Cancel to resume and keep their times.`)) shiftMinutes = mins;
  }
  if (action === 'end') {
    if (!confirm(`End the event?${onStageList.length ? ` ${onStageList.length} group${onStageList.length === 1 ? '' : 's'} on stage will be marked as finished now.` : ''}`)) return;
    if (waitingList.length > 0) cancelRemaining = confirm(`${waitingList.length} performance${waitingList.length === 1 ? ' has' : 's have'} not started.\n\nPress OK to cancel them (the event ended before their turn).\nPress Cancel to leave them as they are.`);
  }
  setBusy('run');
  try {
    await setEventRun({ eventId, action, shiftMinutes, cancelRemaining });
    notify({ start: 'The event has started', pause: 'The event is paused', resume: 'The event continues', end: 'The event has ended' }[action], 'success');
    onChanged?.();
  } catch (e) {
    notify(e instanceof Error ? e.message : 'Could not change the event', 'error');
  } finally {
    setBusy('');
  }
}

/** Start, pause and end of the event: the state is shown clearly and only the buttons that make sense are offered. */
export function RunBar({ run, slots, now, can, busy, onAction }: { run: RunState; slots: Slot[]; now: number; can: (r: string) => boolean; busy: string; onAction: (a: 'start' | 'pause' | 'resume' | 'end') => void }) {
  const states = Object.values(run);
  const paused = states.some((r) => r.state === 'paused');
  const ended = states.length > 0 && states.every((r) => r.state === 'ended');
  const started = states.some((r) => r.state === 'running');
  const firstStart = slots.length ? Math.min(...slots.map((s) => s.originalStartMs ?? s.startMs)) : 0;
  const before = !started && !paused && !ended && firstStart > now + 15 * 60000;
  // Nobody pressed Start yet: the clock runs the day, but the supervisor can always start it by hand.
  const notPressed = !started && !paused && !ended;
  const since = paused ? Math.min(...states.filter((r) => r.state === 'paused').map((r) => r.atMs)) : ended ? Math.max(...states.map((r) => r.atMs)) : 0;
  const label = ended ? `Ended at ${hm(since)}` : paused ? `Paused since ${hm(since)} (${Math.max(1, Math.round((now - since) / 60000))} min)` : before ? 'Not started yet' : notPressed ? 'Running by the clock. Nobody pressed Start' : 'Running';
  const tone = ended ? 'ended' : paused ? 'paused' : before ? 'wait' : 'live';
  return (
    <div className={`lb-run ${tone}`}>
      <div className="lb-run-state"><i aria-hidden /><b>{tx("Event:")} {label}</b>{paused && <span>{tx("The clock is stopped. Nothing starts by itself.")}</span>}{ended && <span>{tx("Nothing starts by itself. You can still correct the times.")}</span>}</div>
      {can('status') && (
        <div className="lb-actions">
          {(notPressed || ended) && <button type="button" className="btn btn-primary" disabled={busy === 'run'} onClick={() => onAction('start')}>{ended ? tx("Reopen the event") : tx("Start the event now")}</button>}
          {paused && <button type="button" className="btn btn-primary" disabled={busy === 'run'} onClick={() => onAction('resume')}>{tx("Resume")}</button>}
          {!paused && !ended && !before && <button type="button" className="btn btn-secondary" disabled={busy === 'run'} onClick={() => onAction('pause')}>{tx("Pause")}</button>}
          {!ended && <button type="button" className="btn btn-secondary danger" disabled={busy === 'run'} onClick={() => onAction('end')}>{tx("End the event")}</button>}
        </div>
      )}
    </div>
  );
}

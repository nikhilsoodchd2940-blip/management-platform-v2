'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, where, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { onSnapshot } from '@/lib/firestore';
import { useCollection, tsMs } from '@/lib/useCollection';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { deleteEventSlot, reorderEventSlots, reviewPerformanceSelection, setMemberPerformingGroup, upsertEventSlot } from '@/lib/functions';
import { dayKeyInZone, formatDuration, formatInZone, zonedToUtcMs, DEFAULT_TIME_ZONE } from '@/lib/timeZones';
import FormDialog from '@/components/FormDialog';
import { notify } from '@/lib/notify';
import { useMyScope } from '@/lib/useMyScope';
import EditEvent from './EditEvent';
import ReviewDialog from './ReviewDialog';
import { ResourcePicker } from './BookPicker';
import { RemarksBox, SELECTION_LABEL, othersFor, type Remark, type Selection, type Slot } from './planParts';
import { tx } from '@/lib/i18n/tr';

interface EventDoc { title: string; status?: string; subGroupIds: string[]; startAt: Timestamp; endAt: Timestamp }

/** Schedule of one multi-day event: each group's slot, its resource selection, approval, and saved remarks. */
export default function EventPlan({ eventId, onChangeEvent }: { eventId: string; onChangeEvent?: () => void }) {
  const { byId, activeLeafGroups } = useGroupHierarchy();
  const live = useMemo(() => new Set(activeLeafGroups.map((g) => g.id)), [activeLeafGroups]);
  const myScope = useMyScope();
  const isGroupAdmin = myScope.scope?.role === 'group_manager';
  const [event, setEvent] = useState<EventDoc | null>(null);
  const slots = useCollection<Slot>('eventSlots', [where('eventId', '==', eventId)], eventId);
  const selections = useCollection<Selection & { groupId: string }>('performanceSelections', [where('eventId', '==', eventId)], eventId);
  const remarks = useCollection<Remark>('performanceRemarks', [where('eventId', '==', eventId)], eventId);
  const [slotDialog, setSlotDialog] = useState<null | { slot?: Slot }>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const [reject, setReject] = useState<Slot | null>(null);
  const [notes, setNotes] = useState('');
  const [editingEvent, setEditingEvent] = useState(false);
  // Performance order: the admin can switch drag and drop on, move groups, then save the new order.
  const [reorder, setReorder] = useState(false);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [dragId, setDragId] = useState('');
  const [overId, setOverId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => onSnapshot(doc(db, 'events', eventId), (s) => setEvent(s.exists() ? (s.data() as EventDoc) : null)), [eventId]);

  const selOf = (id: string) => (selections ?? []).find((s) => s.id === id);
  // Groups that were deleted never appear in the plan.
  const sorted = useMemo(() => [...(slots ?? [])].filter((s) => live.has(s.groupId)).sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt)), [slots]);
  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    sorted.forEach((s) => {
      const k = dayKeyInZone(tsMs(s.startAt), s.timeZone);
      m.set(k, [...(m.get(k) ?? []), s]);
    });
    return Array.from(m.entries());
  }, [sorted]);

  /** The order of a day as shown: the saved one, or the one being rearranged. */
  const shown = (day: string, list: Slot[]) => { const o = draft[day]; if (!o) return list; const m = new Map(list.map((x) => [x.id, x])); return o.map((id) => m.get(id)).filter(Boolean) as Slot[]; };
  /** New starts when the groups of a day take a new order: the first start and the gaps between positions stay, each group keeps its own length. */
  const previewStarts = (list: Slot[], order: Slot[]) => {
    const out = new Map<string, number>();
    let prevEnd = 0;
    order.forEach((s, k) => {
      const gap = k === 0 ? 0 : Math.max(0, tsMs(list[k].startAt) - tsMs(list[k - 1].endAt));
      const start = k === 0 ? tsMs(list[0].startAt) : prevEnd + gap;
      out.set(s.id, start);
      prevEnd = start + (tsMs(s.endAt) - tsMs(s.startAt));
    });
    return out;
  };
  const changed = Object.keys(draft).filter((d) => { const l = days.find((x) => x[0] === d)?.[1]; return l && draft[d].some((id, i) => id !== l[i].id); });
  const moveTo = (day: string, list: Slot[], from: string, to: string) => {
    if (from === to) return;
    const cur = shown(day, list).map((x) => x.id);
    const a = cur.indexOf(from), b = cur.indexOf(to);
    if (a < 0 || b < 0) return;
    cur.splice(b, 0, cur.splice(a, 1)[0]);
    setDraft((d) => ({ ...d, [day]: cur }));
  };
  const nudge = (day: string, list: Slot[], id: string, by: number) => {
    const cur = shown(day, list).map((x) => x.id);
    const a = cur.indexOf(id), b = a + by;
    if (a < 0 || b < 0 || b >= cur.length) return;
    cur.splice(b, 0, cur.splice(a, 1)[0]);
    setDraft((d) => ({ ...d, [day]: cur }));
  };
  async function saveOrder() {
    const items: { slotId: string; startAtMs: number }[] = [];
    for (const d of changed) {
      const list = days.find((x) => x[0] === d)![1];
      const order = shown(d, list);
      previewStarts(list, order).forEach((startAtMs, slotId) => items.push({ slotId, startAtMs }));
    }
    if (!items.length) return;
    setSaving(true);
    try { const r = await reorderEventSlots({ eventId, items }); notify(`Order saved. ${r.data.moved} group time${r.data.moved === 1 ? '' : 's'} updated.`, 'success'); setDraft({}); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save the order', 'error'); }
    setSaving(false);
  }

  const cityTz = (groupId: string) => byId[byId[groupId]?.parentGroupId ?? '']?.timeZone || DEFAULT_TIME_ZONE;

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); notify(ok, 'success'); } catch (e) { notify(e instanceof Error ? e.message : 'Action failed', 'error'); }
  }

  const locked = (s: Slot) => s.performanceStatus === 'started' || s.performanceStatus === 'completed';
  if (!event) return null;
  const eventGroups = event.subGroupIds.filter((g) => live.has(g));
  const scheduled = new Set(sorted.map((s) => s.groupId));

  return (
    <section className="card" style={{ marginBottom: '1rem' }}>
      <div className="section-head" style={{ marginBottom: '0.6rem' }}>
        <div>
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{tx("Event plan")}</h2>
          <p style={{ margin: 0, fontSize: '0.84rem' }}>{scheduled.size} {tx("of")} {eventGroups.length} {tx("groups scheduled. Each slot shows the local time of its city.")}</p>
        </div>
        {!isGroupAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            {event.status !== 'cancelled' && days.length > 0 && (
              <label className={`ep-toggle${reorder ? ' on' : ''}`} title={tx("Turn on to rearrange the performance order by dragging the groups")}>
                <input type="checkbox" role="switch" checked={reorder} onChange={(e) => { setReorder(e.target.checked); if (!e.target.checked) setDraft({}); }} />
                <i aria-hidden="true" /><span>{tx("Reorder by dragging")}</span>
              </label>
            )}
            {event.status !== 'cancelled' && <button className="fx2-btn" onClick={() => (onChangeEvent ? onChangeEvent() : setEditingEvent(true))}>{onChangeEvent ? tx("Change dates and groups") : tx("Edit event dates and groups")}</button>}
            <button className="fx2-btn primary" onClick={() => setSlotDialog({})}>{tx("+ Add a group slot")}</button>
          </div>
        )}
      </div>

      {reorder && (
        <div className={`ep-bar${changed.length ? ' dirty' : ''}`} role="status">
          <span className="ep-bar-i" aria-hidden="true">⇅</span>
          <p><b>{changed.length ? `Order changed on ${changed.length} day${changed.length === 1 ? '' : 's'}` : tx("Drag the grip of a group, or use the arrows, to change the order")}</b><small>{changed.length ? tx("The first start of the day and the gaps stay. Every group keeps its allowed time and the following times shift. Hosts are told of their new time when you save.") : tx("Groups are moved inside their own day. Times are recalculated when you save.")}</small></p>
          {changed.length > 0 && <><button type="button" className="fx2-btn" onClick={() => setDraft({})} disabled={saving}>{tx("Discard")}</button><button type="button" className="fx2-btn primary" onClick={() => void saveOrder()} disabled={saving}>{saving ? tx("Saving…") : tx("Save the new order")}</button></>}
        </div>
      )}

      {slots === null ? <p>{tx("Loading…")}</p> : days.length === 0 ? <p className="fx2-empty">{tx("No slot yet. Add the first group's slot to build the schedule.")}</p> : days.map(([day, list], i) => (
        <section key={day} className="ep-day">
          <h3 className="ep-dh"><b>{tx("Day")} {i + 1}</b><span>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: list[0].timeZone }).format(new Date(tsMs(list[0].startAt)))}</span><em>{list.length} {tx("group")}{list.length === 1 ? '' : 's'}</em></h3>
          <table className={`fx2-table ep-table${reorder ? ' ep-on' : ''}`}>
            <thead><tr><th className="ep-no">{tx("No.")}</th><th>{tx("Time (local)")}</th><th>{tx("Group")}</th><th>{tx("Time allowed")}</th><th>{tx("Books")}</th><th /></tr></thead>
            <tbody>
              {(() => { const order = shown(day, list); const pv = draft[day] ? previewStarts(list, order) : null; return order.map((s, n) => {
                const sel = selOf(s.id);
                const st = SELECTION_LABEL[sel?.status ?? 'none'];
                const sMs = pv?.get(s.id) ?? tsMs(s.startAt);
                const eMs = sMs + (tsMs(s.endAt) - tsMs(s.startAt));
                const moved = !!pv && sMs !== tsMs(s.startAt);
                const canDrag = reorder && !locked(s);
                return (
                  <tr key={s.id} draggable={canDrag} className={`${dragId === s.id ? 'ep-drag' : ''}${overId === s.id && dragId && dragId !== s.id ? ' ep-over' : ''}${moved ? ' ep-moved' : ''}`}
                    onDragStart={(e) => { if (!canDrag) return; setDragId(s.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
                    onDragOver={(e) => { if (reorder && dragId) { e.preventDefault(); setOverId(s.id); } }}
                    onDrop={(e) => { e.preventDefault(); if (dragId) moveTo(day, list, dragId, s.id); setDragId(''); setOverId(''); }}
                    onDragEnd={() => { setDragId(''); setOverId(''); }}>
                    <td className="ep-no">
                      <span className="ep-n" title={`Performance number ${n + 1} of day ${i + 1}`}>{n + 1}</span>
                      {reorder && (
                        <span className="ep-grip">
                          <i aria-hidden="true" title={canDrag ? tx("Drag to move") : tx("Already started")}>⋮⋮</i>
                          <button type="button" disabled={!canDrag || n === 0} onClick={() => nudge(day, list, s.id, -1)} aria-label={`Move ${s.groupName} up`}>▲</button>
                          <button type="button" disabled={!canDrag || n === order.length - 1} onClick={() => nudge(day, list, s.id, 1)} aria-label={`Move ${s.groupName} down`}>▼</button>
                        </span>
                      )}
                    </td>
                    <td className="ep-time">{formatInZone(sMs, s.timeZone, false)}<div style={{ color: '#5b6776' }}>{tx("to")} {formatInZone(eMs, s.timeZone, false)}</div>{moved && <em className="ep-new">{tx("new time")}</em>}</td>
                    <td><strong>{s.groupName}</strong><div style={{ color: '#5b6776' }}>{byId[s.cityId]?.name}</div></td>
                    <td>{formatDuration(s.allocatedSeconds)}</td>
                    <td>
                      <span className={`fx2-pill ${st.cls}`}>{st.text}</span>{s.performanceStatus === 'started' && <> <span className="fx2-pill ok">{tx("On stage")}</span></>}{s.performanceStatus === 'completed' && <> <span className="fx2-pill">{tx("Finished")}</span></>}
                      {sel && sel.items.length > 0 && <div style={{ fontSize: '0.8rem' }}>{sel.items.map((x) => `${x.title}${x.artist ? ` · ${x.artist}` : ''} (${formatDuration(x.durationSeconds)})`).join(' · ')}<br />{tx("Total")} {formatDuration(sel.totalSeconds)} {tx("of")} {formatDuration(sel.allocatedSeconds)}</div>}
                      {sel?.reason && <div style={{ fontSize: '0.8rem', color: '#a02820' }}>{sel.reason}</div>}
                      {(sel?.rejectedItems ?? []).map((r) => <div key={`${r.type}:${r.id}`} style={{ fontSize: '0.8rem', color: '#a02820' }}>{tx("Rejected:")} {r.title}. {r.reason}</div>)}
                      {sel && sel.status !== 'rejected' && sel.status !== 'cancelled' && othersFor((selections ?? []).filter((o) => live.has(o.groupId)), sel, (g) => byId[g]?.name ?? 'A group').filter((o) => o.keys.some((k) => sel.items.some((i) => `${i.type}:${i.id}` === k))).map((o, n) => <div key={n} className="fx2-pill warn" style={{ marginTop: 4 }}>{tx("Same books as")} {o.groupName}</div>)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!isGroupAdmin && sel?.status === 'submitted' && (
                        <>
                          <button className="fx2-btn primary" onClick={() => setReject(s)}>{tx("Review books")}</button>{' '}
                          <button className="fx2-btn" onClick={() => run(() => reviewPerformanceSelection({ slotId: s.id, decision: 'approve' }), 'Selection approved')}>{tx("Approve all")}</button>{' '}
                        </>
                      )}
                      {!isGroupAdmin && sel?.status === 'approved' && !locked(s) && <><button className="fx2-btn" onClick={() => setReject(s)}>{tx("Change decision")}</button>{' '}</>}
                      <button className={`fx2-btn${isGroupAdmin ? ' primary' : ''}`} disabled={locked(s)} title={locked(s) ? tx("Already started or finished") : ''} onClick={() => setPick(s)}>{tx("Choose books")}</button>{' '}
                      {!isGroupAdmin && <button className="fx2-btn" disabled={locked(s)} title={locked(s) ? tx("Already started or finished") : ''} onClick={() => setSlotDialog({ slot: s })}>{tx("Edit")}</button>}{' '}
                      {!isGroupAdmin && <button className="fx2-btn danger" disabled={s.performanceStatus === 'started'} onClick={() => confirm(`Remove the slot of ${s.groupName}?`) && run(() => deleteEventSlot({ slotId: s.id }), 'Slot removed')}>{tx("Remove")}</button>}
                      {!isGroupAdmin && <div className="ep-rem" style={{ textAlign: 'left', whiteSpace: 'normal' }}><RemarksBox slot={s} remarks={remarks ?? []} /></div>}
                    </td>
                  </tr>
                );
              }); })()}
            </tbody>
          </table>
        </section>
      ))}

      {!isGroupAdmin && <MemberConflicts eventId={eventId} />}

      {editingEvent && <EditEvent eventId={eventId} onClose={() => setEditingEvent(false)} />}
      {slotDialog && (
        <FormDialog
          title={slotDialog.slot ? `Edit the slot of ${slotDialog.slot.groupName}` : tx("Add a group slot")}
          intro="Enter the date and time as they are in the group's city. The system stores one exact moment and shows every viewer the right local time."
          submitLabel={tx("Save slot")}
          onClose={() => setSlotDialog(null)}
          fields={[
            { name: 'groupId', label: tx("Group"), type: 'select', required: true, initial: slotDialog.slot?.groupId ?? '', options: eventGroups.map((g) => ({ value: g, label: `${byId[g]?.name ?? g}${byId[byId[g]?.parentGroupId ?? '']?.timeZone ? '' : ' (default time zone: Senegal)'}` })) },
            { name: 'date', label: tx("Date"), type: 'date', required: true, initial: slotDialog.slot ? dayKeyInZone(tsMs(slotDialog.slot.startAt), slotDialog.slot.timeZone) : '' },
            { name: 'time', label: tx("Start time"), type: 'time', required: true, initial: slotDialog.slot ? new Intl.DateTimeFormat('en-GB', { timeZone: slotDialog.slot.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(tsMs(slotDialog.slot.startAt))) : '' },
            { name: 'minutes', label: tx("Time allowed (minutes)"), type: 'number', required: true, initial: slotDialog.slot ? String(Math.round(slotDialog.slot.allocatedSeconds / 60)) : '60' },
            { name: 'allowOverlap', label: tx("Two groups at the same time?"), type: 'select', initial: slotDialog.slot?.allowOverlap ? 'yes' : 'no', options: [{ value: 'no', label: tx("No, block overlapping slots") }, { value: 'yes', label: tx("Yes, allow this slot to overlap another group") }] },
          ]}
          onSubmit={async (v) => {
            const tz = cityTz(v.groupId);
            const res = await upsertEventSlot({ eventId, slotId: slotDialog.slot?.id, groupId: v.groupId, startAtMs: zonedToUtcMs(v.date, v.time, tz), durationMinutes: Number(v.minutes), allowOverlap: v.allowOverlap === 'yes' });
            notify('Slot saved', 'success');
            const n = res.data.memberConflicts ?? 0;
            if (n > 0) notify(`${n} member(s) of this group also belong to another group performing at the same time. Their primary group was chosen by default. Review them below.`, 'info');
          }}
        />
      )}

      {reject && selOf(reject.id) && <ReviewDialog slotId={reject.id} groupName={reject.groupName} eventTitle={event.title} selection={selOf(reject.id)!} others={othersFor((selections ?? []).filter((o) => live.has(o.groupId)), reject, (g) => byId[g]?.name ?? 'A group')} onClose={() => setReject(null)} />}

      {pick && <ResourcePicker slot={pick} current={selOf(pick.id)} onClose={() => setPick(null)} setNotes={setNotes} />}
      {notes && <p className="error-text">{notes}</p>}
    </section>
  );
}

interface Choice { id: string; eventId: string; userId: string; userName: string; groupIds: string[]; groupNames: string[]; chosenGroupId: string; chosenBy: string }

/** Members who belong to two groups that perform at the same time: by default they perform with their primary group. */
function MemberConflicts({ eventId }: { eventId: string }) {
  const rows = useCollection<Choice>('performanceMemberChoices', [where('eventId', '==', eventId)], `mc-${eventId}`);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="card" style={{ margin: '1rem 0', background: '#fff8e8' }}>
      <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{tx("Members in two groups performing at the same time (")}{rows.length})</h3>
      <p style={{ fontSize: '0.82rem', margin: '0.2rem 0 0.6rem' }}>{tx("A member cannot perform with two groups at once. By default the member performs with their primary group. You can change it here.")}</p>
      <table className="fx2-table">
        <thead><tr><th>{tx("Member")}</th><th>{tx("Groups")}</th><th>{tx("Performs with")}</th><th>{tx("Chosen by")}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><strong>{r.userName}</strong></td>
              <td>{r.groupNames.join(' and ')}</td>
              <td>
                <select value={r.chosenGroupId} onChange={async (e) => { try { await setMemberPerformingGroup({ eventId, userId: r.userId, groupId: e.target.value }); notify('Saved', 'success'); } catch (err) { notify(err instanceof Error ? err.message : 'Could not save', 'error'); } }}>
                  {r.groupIds.map((g, i) => <option key={g} value={g}>{r.groupNames[i]}</option>)}
                </select>
              </td>
              <td>{r.chosenBy === 'primary' ? tx("Primary group (default)") : r.chosenBy === 'default' ? tx("Default") : tx("An admin")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

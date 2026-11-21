'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, limit as fsLimit, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { updateLogisticsTask as updateLogisticsTaskFn, type LogisticsStatus } from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';

interface HistoryEntry {
  status: LogisticsStatus;
  actorName: string;
  comment?: string;
  at?: { seconds: number };
}

interface TaskRow {
  id: string;
  resourceRequestId: string;
  groupId: string;
  itemsDescription: string;
  quantity?: number;
  deliveryLocation?: string;
  deliveryAt?: { seconds: number };
  assignedToUserId?: string;
  assignedToName?: string;
  status: LogisticsStatus;
  history: HistoryEntry[];
}

const PIPELINE: LogisticsStatus[] = ['pending', 'assigned', 'preparing', 'dispatched', 'delivered', 'completed'];

function statusPill(status: LogisticsStatus, label: string) {
  if (status === 'completed' || status === 'delivered') return <span className="status">{label}</span>;
  if (status === 'pending') return <span className="status gold">{label}</span>;
  return <span className="status blue">{label}</span>;
}

const LIST_CAP = 300;

/**
 * Logistics — tasks are created automatically by reviewResourceRequest
 * when a request receives its final approval; nothing here creates
 * them. A task's status can only move forward (verified server-side in
 * updateLogisticsTask).
 */
export default function LogisticsManage() {
  const { t: tr, formatDate } = useLocale();
  const l18 = tr.logistics;
  const STATUS_LABELS = l18.statuses;
  const fmt = (ts?: { seconds: number }) => formatDate(ts, true);
  const { user } = useAuth();
  const { byId, locationOf } = useGroupHierarchy();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'logisticsTasks'), orderBy('createdAt', 'desc'), fsLimit(LIST_CAP)), (snap) => {
      setTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaskRow, 'id'>) })));
      setLoading(false);
    });
  }, []);

  const actorName = user?.email ?? 'Admin';

  async function run(
    task: TaskRow,
    payload: { taskId: string; status?: LogisticsStatus; assignedToUserId?: string; assignedToName?: string }
  ) {
    setError(null);
    setBusyId(task.id);
    try {
      await updateLogisticsTaskFn({ ...payload, comment: comments[task.id]?.trim() || undefined, actorName });
      setComments((prev) => ({ ...prev, [task.id]: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : l18.updateFailed);
    } finally {
      setBusyId(null);
    }
  }

  async function handleAssign(task: TaskRow, userId: string) {
    const id = userId.trim();
    if (!id) return;
    const snap = await getDoc(doc(db, 'users', id));
    if (!snap.exists()) {
      setError(l18.noUserWithId);
      return;
    }
    await run(task, { taskId: task.id, assignedToUserId: id, assignedToName: (snap.data()?.displayName as string) || id });
  }

  async function handleAssignToMe(task: TaskRow) {
    if (!user) return;
    await run(task, { taskId: task.id, assignedToUserId: user.uid, assignedToName: actorName });
  }

  const visible = tasks.filter((t) => !statusFilter || t.status === statusFilter);
  const countBy = (s: LogisticsStatus) => tasks.filter((t) => t.status === s).length;

  return (
    <div>
      <div className="section-head">
        <div>
          <h1>{l18.title}</h1>
          <p>{l18.subtitle}</p>
        </div>
      </div>

      <section className="card command">
        <div className="command-stats cols-6" style={{ marginTop: 0 }}>
          {PIPELINE.map((s) => (
            <div key={s}>
              <span>{STATUS_LABELS[s]}</span>
              <strong>{countBy(s)}</strong>
              <small>{l18.tasksUnit}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="card filters" style={{ gridTemplateColumns: '1fr' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{l18.allStatuses}</option>
          {PIPELINE.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </section>

      {error && <p className="error-text">{error}</p>}

      <section className="card panel">
        <div className="panel-head">
          <div>
            <h2>{l18.panelTitle}</h2>
            <p>{l18.shown(visible.length)}</p>
          </div>
        </div>
        {loading ? (
          <p>{tr.common.loading}</p>
        ) : visible.length === 0 ? (
          <p className="empty" style={{ display: 'block' }}>
            {l18.empty}
          </p>
        ) : (
          <div className="members">
            {visible.map((t) => {
              const open = openId === t.id;
              const { city, country } = locationOf(t.groupId);
              const nextStatus = PIPELINE[PIPELINE.indexOf(t.status) + 1] as LogisticsStatus | undefined;
              return (
                <div key={t.id} className="kurel" style={{ padding: 0 }}>
                  <button
                    type="button"
                    className="member-row"
                    style={{ gridTemplateColumns: '1fr auto', border: 0, background: 'transparent' }}
                    onClick={() => setOpenId(open ? null : t.id)}
                  >
                    <div>
                      <strong>
                        {t.itemsDescription}
                        {t.quantity !== undefined ? ` × ${t.quantity}` : ''}
                      </strong>
                      <span>
                        {byId[t.groupId]?.name ?? '—'} · {city?.name ?? '—'} · {country?.name ?? '—'}
                      </span>
                      <span>
                        {l18.delivery} {t.deliveryLocation || '—'} · {fmt(t.deliveryAt)} · {l18.assignedTo} {t.assignedToName || l18.nobodyYet}
                      </span>
                    </div>
                    {statusPill(t.status, STATUS_LABELS[t.status])}
                  </button>

                  {open && (
                    <div style={{ padding: '0 0.75rem 0.85rem' }}>
                      <div className="section-title">
                        <h3>{l18.history}</h3>
                      </div>
                      <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '0.75rem' }}>
                        {t.history.map((h, i) => (
                          <div key={i} className="activity">
                            <div className="activity-head">
                              <strong>{STATUS_LABELS[h.status]}</strong>
                              <small>{fmt(h.at)}</small>
                            </div>
                            <span>{l18.by} {h.actorName}</span>
                            {h.comment && <span>“{h.comment}”</span>}
                          </div>
                        ))}
                      </div>

                      {t.status !== 'completed' && (
                        <>
                          <input
                            placeholder={l18.commentPlaceholder}
                            value={comments[t.id] ?? ''}
                            onChange={(e) => setComments((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--line)', borderRadius: 10, marginBottom: '0.5rem' }}
                          />
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                            <input
                              placeholder={l18.assignPlaceholder}
                              value={assigneeIds[t.id] ?? ''}
                              onChange={(e) => setAssigneeIds((prev) => ({ ...prev, [t.id]: e.target.value }))}
                              style={{ flex: 1, minWidth: 180, padding: '0.5rem', border: '1px solid var(--line)', borderRadius: 10 }}
                            />
                            <button type="button" className="secondary" disabled={busyId === t.id} onClick={() => handleAssign(t, assigneeIds[t.id] ?? '')}>
                              {l18.assign}
                            </button>
                            <button type="button" className="secondary" disabled={busyId === t.id} onClick={() => handleAssignToMe(t)}>
                              {l18.assignToMe}
                            </button>
                          </div>
                          {nextStatus && nextStatus !== 'assigned' && (
                            <button
                              type="button"
                              className="primary"
                              disabled={busyId === t.id || t.status === 'pending'}
                              title={t.status === 'pending' ? l18.assignFirst : undefined}
                              onClick={() => run(t, { taskId: t.id, status: nextStatus })}
                            >
                              {busyId === t.id ? '…' : l18.markAs(STATUS_LABELS[nextStatus])}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, limit as fsLimit, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { updateLogisticsTask as updateLogisticsTaskFn, type LogisticsStatus } from '@/lib/functions';
import { tx } from '@/lib/i18n/tr';
import { useLocale } from '@/lib/i18n/LocaleContext';
import Link from 'next/link';
import { Check, ChevronDown, MapPin, Package, Truck, User } from 'lucide-react';
import Dropdown from '@/components/Dropdown';
import { PersonLink } from '@/components/MemberProfile';
import { CxPill, CxStats } from '@/components/Cx';

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

  const TONE: Record<string, 'green' | 'amber' | 'blue'> = { pending: 'amber', assigned: 'blue', preparing: 'blue', dispatched: 'blue', delivered: 'green', completed: 'green' };
  return (
    <div className="cx-page lm">
      <CxStats items={PIPELINE.map((s, i) => ({
        label: STATUS_LABELS[s], value: countBy(s), sub: l18.tasksUnit,
        icon: i === 0 ? <Package size={18} /> : i < 4 ? <Truck size={18} /> : <Check size={18} />,
        tone: (['amber', 'blue', 'violet', 'teal', 'green', 'green'] as const)[i],
        onClick: () => setStatusFilter(statusFilter === s ? '' : s),
      }))} cols={6} />

      <div className="lm-bar">
        <Dropdown label={l18.allStatuses} value={statusFilter} onChange={setStatusFilter} allLabel={l18.allStatuses} options={PIPELINE.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        <span className="lm-count">{l18.shown(visible.length)}</span>
        <Link href="/dashboard/resource-requests" className="cx-btn sm">{tx("All requests")}</Link>
        <Link href="/dashboard/equipment" className="cx-btn sm">{tx("Equipment catalog")}</Link>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="lm-list">
        {loading && <p className="cx-empty">{tr.common.loading}</p>}
        {!loading && visible.length === 0 && <p className="cx-empty">{l18.empty}</p>}
        {visible.map((t) => {
          const open = openId === t.id;
          const { city, country } = locationOf(t.groupId);
          const nextStatus = PIPELINE[PIPELINE.indexOf(t.status) + 1] as LogisticsStatus | undefined;
          const step = PIPELINE.indexOf(t.status);
          return (
            <article key={t.id} className={`lm-task${open ? ' open' : ''}`}>
              <div className="lm-row" role="button" tabIndex={0} onClick={() => setOpenId(open ? null : t.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(open ? null : t.id); }}>
                <span className="lm-ico"><Package size={20} /></span>
                <div className="lm-main">
                  <b>{t.itemsDescription}{t.quantity !== undefined ? ` × ${t.quantity}` : ''}</b>
                  <small onClick={(e) => e.stopPropagation()}><Link href="/dashboard/groups">{byId[t.groupId]?.name ?? '—'}</Link> · {city?.name ?? '—'} · {country?.name ?? '—'}</small>
                  <small><MapPin size={12} /> {t.deliveryLocation || '—'} · {fmt(t.deliveryAt)}</small>
                </div>
                <div className="lm-who" onClick={(e) => e.stopPropagation()}><User size={14} />{t.assignedToUserId ? <PersonLink userId={t.assignedToUserId}>{t.assignedToName || t.assignedToUserId}</PersonLink> : <em>{l18.nobodyYet}</em>}</div>
                <CxPill tone={TONE[t.status] ?? 'blue'}>{STATUS_LABELS[t.status]}</CxPill>
                <ChevronDown size={18} className="lm-chev" />
              </div>
              <div className="lm-steps" aria-hidden>{PIPELINE.map((s, i) => <i key={s} className={i <= step ? 'on' : ''} title={STATUS_LABELS[s]} />)}</div>

              {open && (
                <div className="lm-body">
                  <div className="lm-hist">
                    <h4>{l18.history}</h4>
                    {t.history.map((h, i) => (
                      <div key={i} className="lm-h"><i /><div><b>{STATUS_LABELS[h.status]}</b><small>{fmt(h.at)} · {l18.by} {h.actorName}</small>{h.comment && <p>“{h.comment}”</p>}</div></div>
                    ))}
                  </div>
                  {t.status !== 'completed' && (
                    <div className="lm-act">
                      <input placeholder={l18.commentPlaceholder} value={comments[t.id] ?? ''} onChange={(e) => setComments((prev) => ({ ...prev, [t.id]: e.target.value }))} />
                      <div className="lm-as">
                        <input placeholder={l18.assignPlaceholder} value={assigneeIds[t.id] ?? ''} onChange={(e) => setAssigneeIds((prev) => ({ ...prev, [t.id]: e.target.value }))} />
                        <button type="button" className="cx-btn sm" disabled={busyId === t.id} onClick={() => handleAssign(t, assigneeIds[t.id] ?? '')}>{l18.assign}</button>
                        <button type="button" className="cx-btn sm" disabled={busyId === t.id} onClick={() => handleAssignToMe(t)}>{l18.assignToMe}</button>
                      </div>
                      {nextStatus && nextStatus !== 'assigned' && (
                        <button type="button" className="cx-btn green" disabled={busyId === t.id || t.status === 'pending'} title={t.status === 'pending' ? l18.assignFirst : undefined} onClick={() => run(t, { taskId: t.id, status: nextStatus })}>
                          {busyId === t.id ? '…' : l18.markAs(STATUS_LABELS[nextStatus])}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

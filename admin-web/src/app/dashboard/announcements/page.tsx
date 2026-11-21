'use client';

import { keepLiveGroups } from '@/lib/useGroupHierarchy';

import { useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query, limit, Timestamp } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { sendAnnouncement as sendAnnouncementFn } from '@/lib/functions';
import CommsHeader from '@/components/CommsHeader';
import { useLocale } from '@/lib/i18n/LocaleContext';

interface GroupRow {
  id: string;
  name: string;
  type: 'main' | 'country' | 'city' | 'group';
  parentGroupId?: string;
  status: 'active' | 'archived';
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  target: 'all' | 'group';
  targetGroupId?: string;
  recipientCount: number;
  createdAt?: Timestamp;
}

/**
 * "Annonces et notifications" — the admin control for what shows up in
 * the mobile app's NotificationsScreen and the bell badge on Home.
 * Nothing wrote to the `notifications` collection before this (see
 * sendAnnouncement's own note); this is that sender, plus a history
 * list so an admin can see what's already gone out.
 */
export default function AnnouncementsPage() {
  const { t, formatDate } = useLocale();
  const n18 = t.announcements;
  const [allGroups, setAllGroups] = useState<GroupRow[]>([]);
  const [history, setHistory] = useState<AnnouncementRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<'all' | 'group'>('all');
  const [targetGroupId, setTargetGroupId] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'groups'), orderBy('name')), (snap) => {
      setAllGroups(keepLiveGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GroupRow, 'id'>) }))));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(50)), (snap) => {
      setHistory(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AnnouncementRow, 'id'>) })));
      setHistoryLoading(false);
    });
  }, []);

  const groupById = useMemo(() => {
    const map: Record<string, GroupRow> = {};
    allGroups.forEach((g) => (map[g.id] = g));
    return map;
  }, [allGroups]);

  const pathLabel = useMemo(() => {
    const cache: Record<string, string> = {};
    function build(groupId: string): string {
      if (cache[groupId]) return cache[groupId];
      const node = groupById[groupId];
      if (!node) return groupId;
      const label = node.parentGroupId ? `${build(node.parentGroupId)} / ${node.name}` : node.name;
      cache[groupId] = label;
      return label;
    }
    return build;
  }, [groupById]);

  const leafGroups = useMemo(
    () =>
      allGroups
        .filter((g) => g.type === 'group' && g.status === 'active')
        .map((g) => ({ ...g, path: pathLabel(g.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [allGroups, pathLabel]
  );

  async function handleSend() {
    setSendError(null);
    setSendSuccess(null);
    if (target === 'group' && !targetGroupId) {
      setSendError(n18.chooseGroup);
      return;
    }
    setSending(true);
    try {
      const result = await sendAnnouncementFn({
        title: title.trim(),
        body: body.trim(),
        target,
        ...(target === 'group' ? { targetGroupId } : {}),
      });
      setSendSuccess(n18.sentTo(result.data.recipientCount));
      setTitle('');
      setBody('');
      setTargetGroupId('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : n18.sendFailed);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <CommsHeader />

      <div className="split split-wide">
        <div className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{n18.historyTitle}</h2>
          {historyLoading ? (
            <p style={{ color: 'var(--ink-soft)' }}>{t.common.loading}</p>
          ) : history.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>{n18.historyEmpty}</p>
          ) : (
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>{n18.colTitle}</th>
                  <th>{n18.colTarget}</th>
                  <th>{n18.colRecipients}</th>
                  <th>{n18.colSent}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', maxWidth: 360 }}>{a.body}</div>
                    </td>
                    <td>{a.target === 'all' ? n18.allMembers : a.targetGroupId ? pathLabel(a.targetGroupId) : n18.groupWord}</td>
                    <td>{a.recipientCount}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                      {a.createdAt ? formatDate(a.createdAt.toDate(), true) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{n18.sendTitle}</h2>
          <div className="field">
            <label htmlFor="a-title">{n18.titleLabel}</label>
            <input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={n18.titlePlaceholder} />
          </div>
          <div className="field">
            <label htmlFor="a-body">{n18.messageLabel}</label>
            <textarea
              id="a-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}
            />
          </div>
          <div className="field">
            <label>{n18.sendTo}</label>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.88rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input type="radio" checked={target === 'all'} onChange={() => setTarget('all')} />
                {n18.allMembers}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input type="radio" checked={target === 'group'} onChange={() => setTarget('group')} />
                {n18.oneGroup}
              </label>
            </div>
          </div>
          {target === 'group' && (
            <div className="field">
              <label htmlFor="a-group">{n18.groupLabel}</label>
              <select id="a-group" value={targetGroupId} onChange={(e) => setTargetGroupId(e.target.value)}>
                <option value="">{n18.selectGroup}</option>
                {leafGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.path}
                  </option>
                ))}
              </select>
            </div>
          )}
          {sendError && <p className="error-text">{sendError}</p>}
          {sendSuccess && <p style={{ color: 'var(--success, #16a34a)', fontSize: '0.85rem' }}>{sendSuccess}</p>}
          <button
            className="btn btn-primary"
            disabled={!title.trim() || !body.trim() || sending}
            onClick={handleSend}
            style={{ width: '100%' }}
          >
            {sending ? n18.sending : n18.send}
          </button>
        </div>
      </div>
    </div>
  );
}

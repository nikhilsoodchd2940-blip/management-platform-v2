'use client';

import { useCallback, useEffect, useState } from 'react';
import ThreadList from '@/components/ThreadList';
import { getSupervisorThreads, type SupervisorThread } from '@/lib/functions';
import { tx } from '@/lib/i18n/tr';

/**
 * The administration's view of what supervisors report: urgent problems, questions and requests, with the
 * level each report is waiting at. The administration can answer, take over from the chain, or mark it dealt with.
 * Renders nothing when nobody has reported anything.
 */
export default function SupervisorInbox({ eventId }: { eventId: string }) {
  const [threads, setThreads] = useState<SupervisorThread[]>([]);
  const [open, setOpen] = useState(true);
  const load = useCallback(async () => {
    try { setThreads((await getSupervisorThreads({ eventId })).data.threads); } catch { /* shown next time */ }
  }, [eventId]);
  useEffect(() => {
    setThreads([]);
    load();
    const h = window.setInterval(load, 10000);
    return () => window.clearInterval(h);
  }, [load]);

  if (threads.length === 0) return null;
  const forAdmin = threads.filter((t) => t.status === 'open' && t.handler === 'admin').length;
  const openAll = threads.filter((t) => t.status === 'open').length;
  return (
    <section className="si">
      <button type="button" className="si-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h3>{tx("Reports from supervisors")}</h3>
        <span className={forAdmin ? 'hot' : ''}>{forAdmin ? `${forAdmin} waiting for the administration` : tx("Nothing waiting for the administration")}</span>
        <span>{openAll} {tx("open")}</span>
        <i>{open ? tx("Hide") : tx("Show")}</i>
      </button>
      {open && <ThreadList eventId={eventId} threads={threads} onChanged={load} isAdmin />}
    </section>
  );
}

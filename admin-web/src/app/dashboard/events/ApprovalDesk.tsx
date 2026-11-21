'use client';

import { useCallback, useEffect, useState } from 'react';
import { where } from 'firebase/firestore';
import { useCollection } from '@/lib/useCollection';
import { loadListInbox } from '@/lib/listInbox';
import { listBookSuggestions } from '@/lib/functions';
import ListInbox from './ListInbox';
import PendingApprovals from './PendingApprovals';
import BookSuggestions from '@/components/BookSuggestions';
import { tx } from '@/lib/i18n/tr';

type Tab = 'member-lists' | 'book-suggestions' | 'book-approvals';

/**
 * Everything that waits for a decision, in one panel with three tabs and live counts:
 * member lists, books suggested by groups, and the books groups chose for their slots.
 * The three original screens are unchanged and stay mounted, so their data and anchors keep working.
 */
export default function ApprovalDesk({ titleOf }: { titleOf: (eventId: string) => string }) {
  const [tab, setTab] = useState<Tab>('member-lists');
  const [lists, setLists] = useState<number | null>(null);
  const [books, setBooks] = useState<number | null>(null);
  const submitted = useCollection<{ id: string }>('performanceSelections', [where('status', '==', 'submitted')], 'desk');

  const loadCounts = useCallback(() => {
    loadListInbox().then((r) => setLists(r.items.length)).catch(() => setLists((x) => x ?? 0));
    listBookSuggestions({}).then((r) => setBooks(r.data.suggestions.filter((s) => s.status === 'pending').length)).catch(() => setBooks((x) => x ?? 0));
  }, []);
  useEffect(() => { loadCounts(); const h = window.setInterval(loadCounts, 20000); return () => window.clearInterval(h); }, [loadCounts]);

  // A link such as …/events#book-approvals opens that tab.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      if (h === 'member-lists' || h === 'book-suggestions' || h === 'book-approvals') setTab(h);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const tiles: { id: Tab; label: string; hint: string; n: number | null }[] = [
    { id: 'member-lists', label: tx("Member lists"), hint: tx("waiting for approval"), n: lists },
    { id: 'book-suggestions', label: tx("Books suggested"), hint: tx("suggested by groups"), n: books },
    { id: 'book-approvals', label: tx("Book choices"), hint: tx("chosen for performance slots"), n: submitted === null ? null : submitted.length },
  ];

  return (
    <section className="ed-desk" aria-label={tx("Waiting for a decision")}>
      <header className="ed-desk-head">
        <div>
          <h2>{tx("Waiting for a decision")}</h2>
          <p>{tx("Member lists, books suggested by groups and the books chosen for each slot.")}</p>
        </div>
      </header>
      <div className="ed-tiles" role="tablist">
        {tiles.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`ed-tile${tab === t.id ? ' on' : ''}${(t.n ?? 0) > 0 ? ' hot' : ''}`} onClick={() => setTab(t.id)}>
            <strong>{t.n === null ? '—' : t.n}</strong>
            <span>{t.label}</span>
            <small>{t.hint}</small>
          </button>
        ))}
      </div>
      <div className="ed-body">
        <div id="member-lists" className="anchor" hidden={tab !== 'member-lists'}><ListInbox /></div>
        <div id="book-suggestions" className="anchor" hidden={tab !== 'book-suggestions'}><BookSuggestions always /></div>
        <div id="book-approvals" className="anchor" hidden={tab !== 'book-approvals'}><PendingApprovals titleOf={titleOf} /></div>
      </div>
    </section>
  );
}

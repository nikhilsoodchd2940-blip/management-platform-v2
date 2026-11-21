'use client';

import { useState } from 'react';
import { tx } from '@/lib/i18n/tr';

/** A small inline box that asks for a reason before a refusal or a removal, so the reason can be told to the people concerned. */
export default function ReasonBox({ label, confirm, busy, onConfirm, onCancel, min = 3 }: { label: string; confirm: string; busy?: boolean; onConfirm: (reason: string) => void; onCancel: () => void; min?: number }) {
  const [text, setText] = useState('');
  const ok = text.trim().length >= min;
  return (
    <div className="mls-reason">
      <label>{label}</label>
      <textarea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Write the reason in a few words")} />
      <div>
        <button type="button" className="btn btn-primary" disabled={!ok || busy} onClick={() => onConfirm(text.trim())}>{busy ? tx("Saving…") : confirm}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>{tx("Cancel")}</button>
      </div>
    </div>
  );
}

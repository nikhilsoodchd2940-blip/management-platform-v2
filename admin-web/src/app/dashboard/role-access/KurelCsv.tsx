'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { parseCsvWithHeader } from '@/lib/csv';
import { setKurelRoles } from '@/lib/functions';
import { notify } from '@/lib/notify';
import { KUREL_FIELDS, KUREL_ROLES } from './roles';
import { tx } from '@/lib/i18n/tr';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES: Record<string, string[]> = {
  leaderId: ['superviseur', 'leader', 'kurel leader', 'responsible', 'responsable'],
  surveillantId: ['surveillant', 'surveillant general', 'general supervisor'],
  surveillantDeputyId: ['second surveillant', 'second general supervisor', 'surveillant deputy', 'deputy surveillant'],
  pedagogyPresidentId: ['pedagogy president', 'president pedagogy', 'pedagogie', 'pedagogy'],
  socialId: ['social'],
  socialDeputyId: ['second social', 'social deputy', 'deputy social'],
  administrationId: ['administration', 'admin'],
  administrationDeputyId: ['second administration', 'administration deputy', 'deputy administration'],
  choirMasterId: ['choir master', 'maitre de choeurs', 'maitre de choeur', 'choir'],
};
const roleOfText = (t: string) => {
  const n = norm(t);
  return KUREL_ROLES.find((r) => norm(r.label) === n || norm(r.key) === n || norm(r.key.replace(/Id$/, '')) === n || (ALIASES[r.key] ?? []).includes(n));
};

interface Row { line: number; kurelText: string; roleText: string; memberText: string; groupId?: string; kurel?: string; roleKey?: string; role?: string; userId?: string; person?: string; error?: string; done?: boolean }

export default function KurelCsv({ onClose }: { onClose: () => void }) {
  const { activeLeafGroups } = useGroupHierarchy();
  const [rows, setRows] = useState<Row[]>([]);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const template = () => {
    const k = activeLeafGroups[0]?.name ?? 'Kurel name';
    const text = `kurel,role,member\n"${k}",Superviseur,DK04/067\n"${k}",General supervisor,+221771234567\n"${k}",Choir master,DK04/012\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'kurel-team-template.csv';
    a.click();
  };

  const findUser = async (t: string): Promise<{ id: string; name: string } | null> => {
    const users = collection(db, 'users');
    const tries: [string, string][] = [['memberId', t]];
    const digits = t.replace(/[^\d+]/g, '');
    if (digits.length >= 6) tries.push(['phone', digits.startsWith('+') ? digits : `+${digits}`], ['phone', digits]);
    for (const [f, v] of tries) {
      const s = await getDocs(query(users, where(f, '==', v), limit(1)));
      if (!s.empty) return { id: s.docs[0].id, name: String(s.docs[0].data().displayName ?? '') };
    }
    return null;
  };

  const read = async (f: File) => {
    setErr(''); setBusy(true); setFile(f.name);
    try {
      const recs = parseCsvWithHeader(await f.text());
      if (recs.length === 0) { setErr(tx("The file has no rows.")); setRows([]); return; }
      const pick = (r: Record<string, string>, keys: string[]) => keys.map((k) => r[k]).find((v) => v) ?? '';
      const cache = new Map<string, { id: string; name: string } | null>();
      const out: Row[] = [];
      const seen = new Set<string>(); const seenPerson = new Set<string>();
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        const row: Row = { line: i + 2, kurelText: pick(r, ['kurel', 'kurel name', 'group', 'daara']), roleText: pick(r, ['role', 'function', 'fonction']), memberText: pick(r, ['member', 'member id', 'memberid', 'matricule', 'phone']) };
        if (!row.kurelText && !row.roleText && !row.memberText) continue;
        const g = activeLeafGroups.find((x) => norm(x.name) === norm(row.kurelText));
        const role = roleOfText(row.roleText);
        if (!g) row.error = `Kurel “${row.kurelText}” not found`;
        else if (!role) row.error = `Role “${row.roleText}” not recognised`;
        else if (!row.memberText) row.error = 'Member is empty';
        else {
          row.groupId = g.id; row.kurel = g.name; row.roleKey = role.key; row.role = role.label;
          if (!cache.has(row.memberText)) cache.set(row.memberText, await findUser(row.memberText));
          const u = cache.get(row.memberText);
          if (!u) row.error = 'No member with this ID or phone';
          else {
            row.userId = u.id; row.person = u.name;
            if (seen.has(`${g.id}|${role.key}`)) row.error = 'This role is given twice for this kurel in the file';
            else if (seenPerson.has(`${g.id}|${u.id}`)) row.error = 'This member already has another role in this kurel in the file';
            else { seen.add(`${g.id}|${role.key}`); seenPerson.add(`${g.id}|${u.id}`); }
          }
        }
        out.push(row);
      }
      setRows(out);
    } catch (e) { setErr(e instanceof Error ? e.message : tx("The file could not be read.")); } finally { setBusy(false); }
  };

  const good = rows.filter((r) => !r.error && !r.done);
  const apply = async () => {
    setBusy(true);
    const groups = [...new Set(good.map((r) => r.groupId!))];
    let okRows = 0;
    const next = [...rows];
    for (const gid of groups) {
      const mine = next.filter((r) => r.groupId === gid && !r.error && !r.done);
      try {
        const cur = ((await getDoc(doc(db, 'kurelRoles', gid))).data() ?? {}) as Record<string, unknown>;
        const keep: Record<string, unknown> = { groupId: gid, choirDeputyIds: cur.choirDeputyIds ?? [], committeeIds: cur.committeeIds ?? [] };
        KUREL_FIELDS.forEach((f) => { if (cur[f]) keep[f] = cur[f]; });
        mine.forEach((r) => { keep[r.roleKey!] = r.userId; });
        await setKurelRoles(keep);
        mine.forEach((r) => { r.done = true; okRows++; });
      } catch (e) {
        mine.forEach((r) => { r.error = (e as { message?: string }).message || 'Could not be saved'; });
      }
    }
    setRows(next); setBusy(false);
    if (okRows) notify(`${okRows} role${okRows === 1 ? '' : 's'} assigned`, 'success');
  };

  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ra-modal" role="dialog" aria-modal="true" aria-label={tx("Import kurel team")}>
        <header>
          <div><h2>{tx("Import kurel team from CSV")}</h2><p>{tx("One row per person: kurel, role, and the member ID or phone number.")}</p></div>
          <button type="button" aria-label={tx("Close")} onClick={onClose}>×</button>
        </header>
        <div className="ra-body">
          <section className="ra-step">
            <div className="ra-quick">
              <button type="button" onClick={() => input.current?.click()}>{tx("Choose a CSV file")}</button>
              <button type="button" onClick={template}>{tx("Download the template")}</button>
              <span>{file || tx("No file chosen")}</span>
            </div>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
            <p className="ra-hint">{tx("Columns:")} <b>{tx("kurel")}</b> {tx("(exact kurel name),")} <b>{tx("role")}</b> {tx("(Superviseur, General supervisor, Second general supervisor, Pedagogy president, Social, Second social, Administration, Second administration, Choir master) and")} <b>{tx("member")}</b> {tx("(member ID or full phone number). Roles already held in a kurel are replaced.")}</p>
            {err && <p className="ra-err">{err}</p>}
          </section>
          {rows.length > 0 && (
            <section className="ra-step">
              <div className="ra-quick"><b>{good.length} {tx("ready")}</b><span>{rows.filter((r) => r.error).length} {tx("with a problem ·")} {rows.filter((r) => r.done).length} {tx("done")}</span></div>
              <div className="ra-twrap">
                <table className="ra-table">
                  <thead><tr><th>{tx("Line")}</th><th>{tx("Kurel")}</th><th>{tx("Role")}</th><th>{tx("Member")}</th><th>{tx("Result")}</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line}>
                        <td>{r.line}</td><td>{r.kurel ?? r.kurelText}</td><td>{r.role ?? r.roleText}</td><td>{r.person ?? r.memberText}</td>
                        <td className={r.error ? 'no' : 'yes'}>{r.done ? tx("Assigned") : r.error ?? tx("Ready")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
        <footer>
          <span className="ra-sum">{tx("Rows with a problem are skipped.")}</span>
          <button type="button" className="ra-ghost" onClick={onClose}>{tx("Close")}</button>
          <button type="button" className="ra-go" disabled={busy || good.length === 0} onClick={apply}>{busy ? tx("Working…") : `Assign ${good.length} role${good.length === 1 ? '' : 's'}`}</button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

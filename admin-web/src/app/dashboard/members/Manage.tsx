'use client';

import { looseMatch } from '@/lib/looseMatch';
import { keepLiveGroups, useGroupHierarchy } from '@/lib/useGroupHierarchy';
import { useCollection } from '@/lib/useCollection';
import { useZones } from '@/lib/useZones';
import { collection as fsCollection, getDocs as fsGetDocs, query as fsQuery, where as fsWhere } from 'firebase/firestore';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, orderBy, query } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { subscribeUsers } from '@/lib/scopedUsers';
import { db, storage } from '@/lib/firebase';
import { useMembershipsByUser } from '@/lib/useMemberships';
import Dropdown from '@/components/Dropdown';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { parseCsvWithHeader, recordsFromRows } from '@/lib/csv';
import { DEFAULT_DIAL, DIAL_CODES, splitDialCode, withDialCode } from '@/lib/dialCodes';
import * as XLSX from 'xlsx';
import {
  addMember as addMemberFn,
  importMembers as importMembersFn,
  assignHostToGroups as assignHostFn,
  assignMemberToGroups as assignMemberFn,
  setMemberStatus as setMemberStatusFn,
  deleteMember as deleteMemberFn,
  updateMember as updateMemberFn,
  removeMemberFromGroup as removeMemberFromGroupFn,
  adminSetMemberPhoto as adminSetMemberPhotoFn,
  adminRemoveMemberPhoto as adminRemoveMemberPhotoFn,
  setMembershipRole as setMembershipRoleFn,
  setPrimaryGroup as setPrimaryGroupFn,
} from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { Upload, UserPlus, Users } from 'lucide-react';
import { tx } from '@/lib/i18n/tr';

interface GroupRow {
  id: string;
  name: string;
  type: 'main' | 'country' | 'city' | 'group';
  parentGroupId?: string;
  status: 'active' | 'archived';
}

interface MemberRow {
  id: string;
  displayName: string;
  phone: string;
  memberId: string;
  photoUrl: string;
  registrationStatus: string;
  status: string;
  primaryGroupId?: string;
}

/** "Member since" is a year. Accepts 2019, or a full date (2019-03-25, 25/03/2019) which is cut to its year; empty when it is not valid. */
function normaliseSince(v: string): string {
  const t = v.trim();
  if (!t) return '';
  const thisYear = new Date().getFullYear();
  const ok = (y: number) => (y >= 1900 && y <= 2100 ? String(y) : '');
  // Excel stores a year typed into a date-formatted cell as a day number: 2019 shows as 7/12/1905. Turn it back into the year.
  const serial = (y: number, mo: number, d: number) => Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  const back = (n: number) => (n >= 1900 && n <= thisYear ? String(n) : '');
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso && Number(iso[1]) === 1905) { const r = back(serial(1905, Number(iso[2]), Number(iso[3]))); if (r) return r; }
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](1905|05)(?!\d)/.exec(t);
  if (dmy) {
    const a = Number(dmy[1]); const b = Number(dmy[2]);
    const r = (a <= 12 ? back(serial(1905, a, b)) : '') || (b <= 12 ? back(serial(1905, b, a)) : '');
    if (r) return r;
  }
  // A plain year, or any date that contains a four digit year (2019-03-25, 25/03/2019, 25 Mar 2019, 3/25/2019 0:00).
  const four = /(?:^|[^\d])((?:19|20)\d{2})(?!\d)/.exec(t);
  if (four) return ok(Number(four[1]));
  // Spreadsheets that turned the year into a date often show it with two digits (3/25/19).
  const two = /^\d{1,2}[-/.]\d{1,2}[-/.](\d{2})$/.exec(t);
  if (two) { const yy = Number(two[1]); const full = 2000 + yy; return ok(full > thisYear ? 1900 + yy : full); }
  // A raw spreadsheet date number (days since 1900), for example 43549.
  if (/^\d{5}$/.test(t)) return ok(new Date(Math.round((Number(t) - 25569) * 86400000)).getUTCFullYear());
  return '';
}

interface CsvPreviewRow {
  memberId: string;
  phone: string;
  displayName: string;
  email?: string;
  memberSince?: string;
  country?: string;
  city?: string;
  group?: string;
  groupId?: string; // resolved from country/city/group, if all three were given and matched
  groupError?: string; // country/city/group given but couldn't be resolved — informational, doesn't block the row
  rowError?: string; // missing required field — this row will be skipped on upload
}


type SortKey = 'name' | 'memberId' | 'phone' | 'registration' | 'status' | 'groups' | 'primaryGroup';

const PAGE_SIZE = 100;

// Mirrors firebase/functions/src/utils/phone.ts's E164_RE exactly — the
// backend is the actual source of truth (it's what will reject or
// accept the number), this is just so the CSV preview can tell the
// admin about a bad phone number before they click Upload instead of
// after.
const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * CSV exports very commonly drop the leading "+" from phone numbers
 * (Excel/Sheets tend to strip it since the cell "looks numeric"), which
 * otherwise fails E.164 validation on every single row with a confusing
 * error. If a number is all digits with no "+", this assumes the
 * country code is already there (as in "919000000002") and adds the
 * "+" back rather than guessing a country code from scratch.
 */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-().]/g, '');
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('+')) return trimmed;
  if (/^\d+$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}

/**
 * A full, browsable, multi-select member list (rather than
 * search-only), so bulk group/Host assignment doesn't require
 * one-at-a-time searching. Reuses the existing single-user
 * assignMemberToGroups/assignHostToGroups callables — bulk selection
 * loops over them client-side rather than needing a new bulk Cloud
 * Function. Also shows each member's current group/Host assignments
 * live, pulled from groupMemberships.
 *
 * Groups are shown by their FULL PATH (Country / City / Group), not
 * just the leaf name — with the 4-level hierarchy (Main Group ->
 * Country -> City -> Group), two different leaf groups can share a
 * name (e.g. two orgs each with a group literally named "Group A" in
 * different cities), so the leaf name alone is ambiguous.
 */
export default function MembersManage({ view = 'all', openEdit, openAdd, onEditDone }: { /** Which tool this panel shows: only "Add a member" (+ bulk upload), only the assign-to-kurel list, or both. */ view?: 'add' | 'assign' | 'all'; openEdit?: { id: string; n: number }; openAdd?: { n: number }; /** Called when an editor opened from the member page is saved or closed, so the page can take you back. */ onEditDone?: () => void }) {
  const editFromPage = useRef(false);
  const { t } = useLocale();
  const m18 = t.members;
  const [allGroups, setAllGroups] = useState<GroupRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const membershipsByUser = useMembershipsByUser(memberIds);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [filterText, setFilterText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignGroupIds, setAssignGroupIds] = useState<string[]>([]);
  const [assignCountryId, setAssignCountryId] = useState('');
  const [assignCityId, setAssignCityId] = useState('');
  // True once every checked group is already an active membership for
  // every selected member — in that case "Assign as Member" would be a
  // pure no-op, so it's hidden and only "Assign as Host" (a real
  // action: promotes their existing membership) stays visible. Keeps
  // the panel from asking the admin to redo something already done.
  const selectedAlreadyMembersOfCheckedGroups = useMemo(() => {
    if (selectedIds.size === 0 || assignGroupIds.length === 0) return false;
    return Array.from(selectedIds).every((uid) =>
      assignGroupIds.every((gid) => (membershipsByUser[uid] ?? []).some((ms) => ms.groupId === gid))
    );
  }, [selectedIds, assignGroupIds, membershipsByUser]);
  const [assignBusy, setAssignBusy] = useState<'member' | 'host' | null>(null);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);

  const [newPhone, setNewPhone] = useState('');
  const [newDial, setNewDial] = useState(DEFAULT_DIAL);
  const [newPhone2, setNewPhone2] = useState('');
  const [newDial2, setNewDial2] = useState(DEFAULT_DIAL);
  const [editPhone2, setEditPhone2] = useState('');
  const [editDial2, setEditDial2] = useState(DEFAULT_DIAL);
  const [editOrig2, setEditOrig2] = useState('');
  const [newMemberId, setNewMemberId] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newSince, setNewSince] = useState('');
  const [newCountryId, setNewCountryId] = useState('');
  const [newCityId, setNewCityId] = useState('');
  const [newGroupIds, setNewGroupIds] = useState<string[]>([]);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // CSV bulk upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvPreviewRow[]>([]);
  const [csvParseError, setCsvParseError] = useState<string | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResults, setCsvResults] = useState<{ memberId: string; phone: string; error?: string }[] | null>(
    null
  );

  // Approval queue moved to its own page (dashboard/approvals) — keeps
  // this page focused on the full roster instead of mixing a
  // work-through-this-queue view with a browsable list.
  const [enlargedPhotoUrl, setEnlargedPhotoUrl] = useState<string | null>(null);

  // Row actions (deactivate/activate, delete)
  const [rowActionBusyId, setRowActionBusyId] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  // Edit member modal
  const [editingId, setEditingId] = useState<string | null>(null);
  // The member being edited gets their own live listener, so their groups show even when they are not in the loaded list.
  const editOwnIds = useMemo(() => (editingId ? [editingId] : []), [editingId]);
  const editOwn = useMembershipsByUser(editOwnIds);
  const [editName, setEditName] = useState('');
  const [editMemberId, setEditMemberId] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSince, setEditSince] = useState('');
  const [editDial, setEditDial] = useState('');
  const [editOrig, setEditOrig] = useState({ name: '', memberId: '', phone: '', email: '', since: '' });
  const [editCountryId, setEditCountryId] = useState('');
  const [editCityId, setEditCityId] = useState('');
  const [editAddGroupId, setEditAddGroupId] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusyGroupId, setEditBusyGroupId] = useState<string | null>(null);
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);
  const [editPhotoRemoving, setEditPhotoRemoving] = useState(false);
  const [primaryGroupSaving, setPrimaryGroupSaving] = useState(false);
  const [primaryGroupError, setPrimaryGroupError] = useState<string | null>(null);
  const editPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'groups'), orderBy('name')), (snap) => {
      setAllGroups(keepLiveGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GroupRow, 'id'>) }))));
    });
  }, []);

  const groupById = useMemo(() => {
    const map: Record<string, GroupRow> = {};
    allGroups.forEach((g) => (map[g.id] = g));
    return map;
  }, [allGroups]);

  // "USA / Houston / Houston A" — walks parentGroupId up to the root.
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

  // "usa|houston|houston a" (lowercased country|city|group) -> leaf group
  // id, used to resolve the CSV's separate country/city/group columns.
  // Keyed on all three together (not just the group name) since two
  // different cities can each have a group with the same name.
  const groupIdByTriple = useMemo(() => {
    const map: Record<string, string> = {};
    leafGroups.forEach((g) => {
      const city = g.parentGroupId ? groupById[g.parentGroupId] : undefined;
      const country = city?.parentGroupId ? groupById[city.parentGroupId] : undefined;
      if (country && city) {
        map[`${country.name.toLowerCase()}|${city.name.toLowerCase()}|${g.name.toLowerCase()}`] = g.id;
      }
    });
    return map;
  }, [leafGroups, groupById]);

  // Country -> City -> Group scoping for the "Add member" form, so the
  // group checklist only ever shows groups under the city just picked
  // (mirrors the same drill-down used on the Groups page) instead of a
  // flat list of every group in the org by full path.
  const countries = useMemo(
    () => allGroups.filter((g) => g.type === 'country' && g.status === 'active').sort((a, b) => a.name.localeCompare(b.name)),
    [allGroups]
  );
  const citiesOfNewCountry = useMemo(
    () =>
      allGroups
        .filter((g) => g.type === 'city' && g.status === 'active' && g.parentGroupId === newCountryId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allGroups, newCountryId]
  );
  const groupsInNewCity = useMemo(
    () => leafGroups.filter((g) => g.parentGroupId === newCityId),
    [leafGroups, newCityId]
  );

  // Same Country -> City -> Group scoping, for the "add a group" picker
  // inside the Edit member modal.
  const citiesOfEditCountry = useMemo(
    () =>
      allGroups
        .filter((g) => g.type === 'city' && g.status === 'active' && g.parentGroupId === editCountryId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allGroups, editCountryId]
  );
  const groupsInEditCity = useMemo(
    () => leafGroups.filter((g) => g.parentGroupId === editCityId),
    [leafGroups, editCityId]
  );

  // Same Country -> City -> Group scoping, for the bulk "Assign to
  // Groups" picker below the member table — lets an admin navigate to
  // ANY country/city in the org (not just ones the selected member(s)
  // already belong to) rather than scrolling one flat list of every
  // group everywhere.
  const citiesOfAssignCountry = useMemo(
    () =>
      allGroups
        .filter((g) => g.type === 'city' && g.status === 'active' && g.parentGroupId === assignCountryId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allGroups, assignCountryId]
  );
  const groupsInAssignCity = useMemo(
    () => leafGroups.filter((g) => g.parentGroupId === assignCityId),
    [leafGroups, assignCityId]
  );

  // Debounced copy of the search box, so we query the server once the
  // admin pauses typing rather than on every keystroke.
  const [serverTerm, setServerTerm] = useState('');
  useEffect(() => setPageSize(PAGE_SIZE), [serverTerm]);
  useEffect(() => {
    const handle = window.setTimeout(() => setServerTerm(filterText.trim().toLowerCase()), 300);
    return () => window.clearTimeout(handle);
  }, [filterText]);

  useEffect(() => {
    if (!openAdd || openAdd.n === 0) return;
    const t2 = window.setTimeout(() => {
      document.getElementById('add-member-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      document.getElementById('m-name')?.focus();
    }, 250);
    return () => window.clearTimeout(t2);
  }, [openAdd?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same filters as the Member management home page: country, city, zone, kurel, role, status…
  const hier = useGroupHierarchy();
  const zoneRows = useZones();
  const scopes = useCollection<{ role: string }>('adminScopes', []);
  const adminRoles = useCollection<{ isSuperAdmin?: boolean }>('adminRoles', []);
  const [fCountry, setFCountry] = useState('');
  const [fCity, setFCity] = useState('');
  const [fZone, setFZone] = useState('');
  const [fKurel, setFKurel] = useState('');
  const [fRole, setFRole] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCount, setFCount] = useState('');
  const [fProfile, setFProfile] = useState('');
  const [areaIds, setAreaIds] = useState<string[] | null>(null);
  const ROLE_NAMES: Record<string, string> = { super_admin: 'Super Admin', zone_admin: 'Zone Manager', city_manager: 'City Manager', city_zone_manager: 'City Zone Manager', group_manager: 'Group Admin', host: 'Host', member: 'Member' };
  const anyFilter = !!(fCountry || fCity || fZone || fKurel || fRole || fStatus || fCount || fProfile);
  const areaGroups = useMemo(
    () => fCountry || fZone || fCity || fKurel
      ? hier.activeLeafGroups.filter((g) => {
          if (fKurel) return g.id === fKurel;
          const c = g.parentGroupId ? hier.byId[g.parentGroupId] : undefined;
          if (!c) return false;
          if (fCountry && c.parentGroupId !== fCountry) return false;
          if (fCity && c.id !== fCity) return false;
          if (fZone && c.zoneId !== fZone) return false;
          return true;
        })
      : null,
    [fCountry, fZone, fCity, fKurel, hier.activeLeafGroups, hier.byId]
  );
  const areaKey = areaGroups ? areaGroups.map((g) => g.id).join(',') : '';
  useEffect(() => {
    if (!areaGroups) { setAreaIds(null); return; }
    let cancelled = false;
    (async () => {
      const uids = new Set<string>();
      const ids = areaGroups.map((g) => g.id);
      for (let i = 0; i < ids.length; i += 30) {
        const s2 = await fsGetDocs(fsQuery(fsCollection(db, 'groupMemberships'), fsWhere('groupId', 'in', ids.slice(i, i + 30)), fsWhere('status', '==', 'active')));
        s2.docs.forEach((d) => uids.add(d.data().userId as string));
      }
      if (!cancelled) setAreaIds([...uids]);
    })().catch(() => !cancelled && setAreaIds([]));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey]);

  useEffect(() => {
    // Admin can read all `users` docs per firestore.rules. With no search
    // text: the first `pageSize` members by name. With search text: the
    // match is done by Firestore over the WHOLE directory (name prefix, or
    // phone prefix when the text starts with "+" or a digit) — the old
    // version only filtered the ≤100 rows already loaded, so anyone
    // further down the alphabet simply "didn't exist" until you pressed
    // Load more enough times.
    if (areaGroups && areaIds === null) return;
    return subscribeUsers(
      { term: serverTerm, pageSize, onlyIds: areaIds ?? undefined },
      (docs) => {
        setMembers(
          docs.map((d) => ({
            id: d.id,
            displayName: (d.data().displayName as string) || '',
            phone: (d.data().phone as string) || '',
            memberId: (d.data().memberId as string) || '',
            photoUrl: (d.data().photoUrl as string) || '',
            registrationStatus: (d.data().registrationStatus as string) || 'not_registered',
            status: (d.data().status as string) || 'active',
            primaryGroupId: (d.data().primaryGroupId as string) || undefined,
          }))
        );
        setLoadingMembers(false);
      },
      () => setLoadingMembers(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, serverTerm, areaIds]);

  const filteredMembers = useMemo(() => {
    const term = filterText.trim().toLowerCase();
    const roleSet = (uid: string) => {
      const out = new Set<string>();
      const sc = (scopes ?? []).find((x) => x.id === uid);
      if (sc && ROLE_NAMES[sc.role]) out.add(sc.role);
      if ((adminRoles ?? []).find((x) => x.id === uid)?.isSuperAdmin) out.add('super_admin');
      if ((membershipsByUser[uid] ?? []).some((k) => k.role === 'host')) out.add('host');
      if (out.size === 0) out.add('member');
      return out;
    };
    const base = members.filter((m) => {
      if (term && !looseMatch(term, `${m.displayName} ${m.phone}`)) return false;
      if (fRole && !roleSet(m.id).has(fRole)) return false;
      if (fStatus === 'active' && m.status !== 'active') return false;
      if (fStatus === 'suspended' && m.status !== 'disabled') return false;
      if (fCount && (membershipsByUser[m.id]?.length ?? 0) !== Number(fCount)) return false;
      if (fProfile === 'complete' && !m.photoUrl) return false;
      if (fProfile === 'incomplete' && m.photoUrl) return false;
      return true;
    });

    const sorted = [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case 'memberId':
          cmp = a.memberId.localeCompare(b.memberId);
          break;
        case 'phone':
          cmp = a.phone.localeCompare(b.phone);
          break;
        case 'registration':
          cmp = a.registrationStatus.localeCompare(b.registrationStatus);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'groups':
          cmp = (membershipsByUser[a.id]?.length ?? 0) - (membershipsByUser[b.id]?.length ?? 0);
          break;
        case 'primaryGroup':
          // Members without a Primary Group set sort to the end
          // regardless of direction — they're the ones needing
          // attention, so "ascending" surfacing them first would be
          // backwards from what an admin scanning this column wants.
          if (!a.primaryGroupId && !b.primaryGroupId) cmp = 0;
          else if (!a.primaryGroupId) cmp = 1;
          else if (!b.primaryGroupId) cmp = -1;
          else cmp = pathLabel(a.primaryGroupId).localeCompare(pathLabel(b.primaryGroupId));
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, filterText, sortKey, sortDir, membershipsByUser, fRole, fStatus, fCount, fProfile, scopes, adminRoles]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortableHeader({ label, sortableKey }: { label: string; sortableKey: SortKey }) {
    const active = sortKey === sortableKey;
    return (
      <th
        onClick={() => handleSort(sortableKey)}
        style={{ cursor: 'pointer', userSelect: 'none', color: active ? 'var(--accent)' : undefined }}
        title={m18.sortBy(label)}
      >
        {label} {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
      </th>
    );
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const allVisible = filteredMembers.every((m) => prev.has(m.id));
      const next = new Set(prev);
      if (allVisible) {
        filteredMembers.forEach((m) => next.delete(m.id));
      } else {
        filteredMembers.forEach((m) => next.add(m.id));
      }
      return next;
    });
  }

  function toggleGroup(list: string[], setList: (v: string[]) => void, groupId: string) {
    setList(list.includes(groupId) ? list.filter((id) => id !== groupId) : [...list, groupId]);
  }

  async function handleBulkAssign(kind: 'member' | 'host') {
    if (selectedIds.size === 0 || assignGroupIds.length === 0) return;
    setAssignBusy(kind);
    setAssignMsg(null);
    const ids = Array.from(selectedIds);
    let succeeded = 0;
    let failed = 0;
    let firstError = '';
    for (const userId of ids) {
      try {
        if (kind === 'member') {
          await assignMemberFn({ userId, groupIds: assignGroupIds, strict: true });
        } else {
          await assignHostFn({ userId, groupIds: assignGroupIds });
        }
        succeeded++;
      } catch (e) {
        failed++;
        if (!firstError && e instanceof Error) firstError = e.message;
      }
    }
    setAssignMsg(`${m18.assigned(succeeded, kind, failed)}${firstError ? ` ${firstError}` : ''}`);
    setAssignBusy(null);
    setSelectedIds(new Set());
    setAssignGroupIds([]);
    setAssignCountryId('');
    setAssignCityId('');
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddSubmitting(true);
    try {
      await addMemberFn({
        phone: withDialCode(newDial, newPhone),
        secondaryPhone: newPhone2.trim() ? withDialCode(newDial2, newPhone2) : undefined,
        memberId: newMemberId,
        displayName: newName,
        email: newEmail || undefined,
        memberSince: newSince || undefined,
        groupIds: newGroupIds,
      });
      setNewPhone('');
      setNewPhone2('');
      setNewMemberId('');
      setNewEmail('');
      setNewName('');
      setNewSince('');
      setNewCountryId('');
      setNewCityId('');
      setNewGroupIds([]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : m18.errAddMember);
    } finally {
      setAddSubmitting(false);
    }
  }

  function handleCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvResults(null);
    setCsvParseError(null);
    setCsvFileName(file.name);

    const isExcel = /\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml');

    const reader = new FileReader();
    reader.onload = () => {
      try {
        let parsed: Record<string, string>[];
        if (isExcel) {
          // raw:false forces Excel's own displayed-string representation
          // for every cell — for the phone column (locked to Text format
          // by downloadTemplate below) that's just the string as typed,
          // "+" and all, rather than a re-parsed number.
          const data = new Uint8Array(reader.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
          parsed = recordsFromRows(rows);
        } else {
          const text = String(reader.result ?? '');
          parsed = parseCsvWithHeader(text);
        }

        if (parsed.length === 0) {
          setCsvParseError(m18.csvNoRows);
          setCsvRows([]);
          return;
        }
        const rows: CsvPreviewRow[] = parsed.map((r) => {
          const memberId = r['memberid'] ?? r['member id'] ?? '';
          const rawPhone = r['phone'] ?? r['mobile'] ?? r['mobile number'] ?? '';
          const csvCode = (r['countrycode'] ?? r['country code'] ?? r['dial code'] ?? '').trim();
          const phone = csvCode && rawPhone ? withDialCode(csvCode.startsWith('+') ? csvCode : `+${csvCode}`, rawPhone) : rawPhone.trim().startsWith('+') ? normalizePhone(rawPhone) : withDialCode(DEFAULT_DIAL, rawPhone);
          const displayName = r['displayname'] ?? r['name'] ?? r['full name'] ?? '';
          const email = r['email'] ?? '';
          const sinceRaw = (r['membersince'] ?? r['member since'] ?? r['since'] ?? '').trim();
          const since = normaliseSince(sinceRaw);
          const country = r['country'] ?? '';
          const city = r['city'] ?? '';
          const groupName = r['group'] ?? r['groupname'] ?? r['group name'] ?? '';

          let groupId: string | undefined;
          let groupError: string | undefined;
          if (country || city || groupName) {
            if (!country || !city || !groupName) {
              groupError = m18.csvGroupTogether;
            } else {
              groupId = groupIdByTriple[`${country.toLowerCase()}|${city.toLowerCase()}|${groupName.toLowerCase()}`];
              if (!groupId) groupError = m18.csvGroupNotFound(groupName, city, country);
            }
          }

          // Validate with the SAME rule the backend enforces
          // (requireE164 in firebase/functions/src/utils/phone.ts), so a
          // row that will be rejected on upload is flagged here in the
          // preview instead — "0 with errors" should mean the upload
          // will actually succeed, not just that required columns were
          // present.
          let rowError: string | undefined;
          if (!memberId) rowError = m18.csvMissingMemberId;
          else if (!rawPhone) rowError = m18.csvMissingPhone;
          else if (!E164_RE.test(phone)) {
            rowError = m18.csvPhoneFormat(rawPhone);
          } else if (!displayName) rowError = m18.csvMissingName;
          else if (sinceRaw && !since) rowError = 'Member since must be a year, for example 2019';
          else if (since && Number(since) > new Date().getFullYear()) rowError = 'Member since is in the future';

          return {
            memberId,
            phone,
            displayName,
            email: email || undefined,
            memberSince: since || undefined,
            country: country || undefined,
            city: city || undefined,
            group: groupName || undefined,
            groupId,
            groupError,
            rowError,
          };
        });
        setCsvRows(rows);
      } catch (err) {
        setCsvParseError(err instanceof Error ? err.message : m18.csvParseFailed);
        setCsvRows([]);
      }
    };
    reader.onerror = () => setCsvParseError(m18.csvReadFailed);
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  function resetCsvUpload() {
    setCsvFileName(null);
    setCsvRows([]);
    setCsvParseError(null);
    setCsvResults(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleCsvUpload() {
    const validRows = csvRows.filter((r) => !r.rowError);
    if (validRows.length === 0) return;
    setCsvUploading(true);
    setCsvResults(null);
    try {
      // importMembers caps at 500 rows per call — chunk larger files.
      const chunks: CsvPreviewRow[][] = [];
      for (let i = 0; i < validRows.length; i += 500) chunks.push(validRows.slice(i, i + 500));

      const allResults: { memberId: string; phone: string; error?: string }[] = [];
      for (const chunk of chunks) {
        const res = await importMembersFn({
          rows: chunk.map((r) => ({
            memberId: r.memberId,
            phone: r.phone,
            displayName: r.displayName,
            email: r.email,
            memberSince: r.memberSince,
            groupIds: r.groupId ? [r.groupId] : [],
          })),
        });
        allResults.push(...res.data.results);
      }
      setCsvResults(allResults);
    } catch (err) {
      setCsvResults([{ memberId: '', phone: '', error: err instanceof Error ? err.message : m18.csvUploadFailed }]);
    } finally {
      setCsvUploading(false);
    }
  }

  /**
   * Downloads an .xlsx (not .csv) with the phone column pre-formatted
   * as Text (number format '@') for the header row plus 500 rows below
   * it. This is the actual fix for phone numbers losing their "+" —
   * plain CSV carries no formatting metadata at all, so Excel/Sheets
   * auto-detects a "+15551234567"-looking cell as numeric and silently
   * drops the "+" the moment the file is reopened or saved. Locking the
   * column to Text in the file itself means that auto-detection never
   * kicks in, regardless of what's typed or pasted into it.
   */
  function downloadTemplate() {
    const headers = ['memberId', 'countryCode', 'phone', 'displayName', 'email', 'memberSince', 'country', 'city', 'group'];
    // Header row only — no example data.
    const ws = XLSX.utils.aoa_to_sheet([headers]);

    const TEXT_COLS = [2, 5]; // phone (C) and memberSince (F), 0-indexed: kept as text so a year never turns into a date
    const ROWS_TO_FORMAT = 500;
    for (let r = 1; r <= ROWS_TO_FORMAT; r++) {
      for (const c of TEXT_COLS) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const existing = ws[addr];
        if (existing) {
          existing.t = 's';
          existing.z = '@';
        } else {
          ws[addr] = { t: 's', v: '', z: '@' };
        }
      }
    }
    const range = XLSX.utils.decode_range(ws['!ref'] as string);
    range.e.r = Math.max(range.e.r, ROWS_TO_FORMAT);
    ws['!ref'] = XLSX.utils.encode_range(range);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Members');
    XLSX.writeFile(wb, 'members-template.xlsx');
  }

  async function handleToggleMembershipRole(userId: string, groupId: string, currentRole: 'member' | 'host', groupLabel: string) {
    const nextRole = currentRole === 'host' ? 'member' : 'host';
    if (
      !confirm(
        nextRole === 'host'
          ? m18.confirmPromote(groupLabel)
          : m18.confirmDemote(groupLabel)
      )
    ) {
      return;
    }
    setRowActionError(null);
    setRowActionBusyId(`${userId}:${groupId}`);
    try {
      await setMembershipRoleFn({ userId, groupId, role: nextRole });
    } catch (err) {
      setRowActionError(err instanceof Error ? err.message : m18.errChangeRole);
    } finally {
      setRowActionBusyId(null);
    }
  }

  async function handleToggleStatus(userId: string, currentStatus: string, name: string) {    const nextStatus = currentStatus === 'disabled' ? 'active' : 'disabled';
    if (nextStatus === 'disabled' && !confirm(m18.confirmDeactivate(name))) {
      return;
    }
    setRowActionError(null);
    setRowActionBusyId(userId);
    try {
      await setMemberStatusFn({ userId, status: nextStatus });
    } catch (err) {
      setRowActionError(err instanceof Error ? err.message : m18.errUpdateMember);
    } finally {
      setRowActionBusyId(null);
    }
  }

  async function handleDeleteMember(userId: string, name: string) {
    if (!confirm(m18.confirmDelete(name))) {
      return;
    }
    setRowActionError(null);
    setRowActionBusyId(userId);
    try {
      await deleteMemberFn({ userId });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    } catch (err) {
      setRowActionError(err instanceof Error ? err.message : m18.errDeleteMember);
    } finally {
      setRowActionBusyId(null);
    }
  }

  // "Edit the profile" on the page above opens the editor right here, without scrolling to the list.
  const [directMember, setDirectMember] = useState<MemberRow | null>(null);
  useEffect(() => {
    if (!openEdit || openEdit.n === 0 || !openEdit.id) return;
    let cancelled = false;
    getDoc(doc(db, 'users', openEdit.id)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const d = snap.data();
      const row: MemberRow = {
        id: snap.id,
        displayName: (d.displayName as string) || '',
        phone: (d.phone as string) || '',
        memberId: (d.memberId as string) || '',
        photoUrl: (d.photoUrl as string) || '',
        registrationStatus: (d.registrationStatus as string) || 'not_registered',
        status: (d.status as string) || 'active',
        primaryGroupId: (d.primaryGroupId as string) || undefined,
      };
      setDirectMember(row);
      editFromPage.current = true;
      openEditModal(row);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new click (n) should reopen the editor
  }, [openEdit?.n]);

  // Keep the page behind a dialog from scrolling while it is open.
  useEffect(() => {
    if (!editingId && !enlargedPhotoUrl) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editingId, enlargedPhotoUrl]);

  function openEditModal(m: MemberRow) {
    setEditingId(m.id);
    setEditName(m.displayName);
    setEditMemberId(m.memberId);
    const sp = splitDialCode(m.phone);
    setEditDial(sp.code || DEFAULT_DIAL);
    setEditPhone(sp.local);
    setEditPhone2(''); setEditDial2(DEFAULT_DIAL); setEditOrig2('');
    setEditEmail('');
    setEditSince('');
    setEditOrig({ name: m.displayName, memberId: m.memberId, phone: m.phone, email: '', since: '' });
    getDoc(doc(db, 'users', m.id)).then((snap) => {
      const em = (snap.data()?.email as string) || '';
      setEditEmail((cur) => (cur === '' ? em : cur));
      const since = ((snap.data()?.memberSince as string) || '').slice(0, 4);
      setEditSince((cur) => (cur === '' ? since : cur));
      setEditOrig((o) => ({ ...o, email: em, since }));
      const p2 = (snap.data()?.secondaryPhone as string) || '';
      if (p2) { const sp2 = splitDialCode(p2); setEditDial2(sp2.code || DEFAULT_DIAL); setEditPhone2((cur) => cur || sp2.local); }
      setEditOrig2(p2);
    }).catch(() => {});
    setEditCountryId('');
    setEditCityId('');
    setEditAddGroupId('');
    setEditError(null);
  }

  // Escape closes the open dialog (edit modal first, then the photo preview).
  useEffect(() => {
    if (!editingId && !enlargedPhotoUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (enlargedPhotoUrl) setEnlargedPhotoUrl(null);
      else closeEditModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, enlargedPhotoUrl]);

  function closeEditModal() {
    setEditingId(null);
    if (editFromPage.current) {
      editFromPage.current = false;
      onEditDone?.();
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setEditError(null);
    setEditSaving(true);
    try {
      const payload: Record<string, string> = { userId: editingId };
      if (editName.trim() !== editOrig.name) payload.displayName = editName.trim();
      if (editMemberId.trim() !== editOrig.memberId) payload.memberId = editMemberId.trim();
      const fullPhone = withDialCode(editDial, editPhone);
      if (fullPhone && fullPhone !== normalizePhone(editOrig.phone)) payload.phone = fullPhone;
      const fullPhone2 = editPhone2.trim() ? withDialCode(editDial2, editPhone2) : '';
      if (fullPhone2 !== editOrig2) payload.secondaryPhone = fullPhone2;
      if (editEmail.trim() !== editOrig.email) payload.email = editEmail.trim();
      if (editSince !== editOrig.since) payload.memberSince = editSince;
      if (Object.keys(payload).length > 1) await updateMemberFn(payload as never);
      closeEditModal();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : m18.errSaveChanges);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleAddGroupToEditing() {
    if (!editingId || !editAddGroupId) return;
    setEditError(null);
    setEditBusyGroupId(editAddGroupId);
    try {
      await assignMemberFn({ userId: editingId, groupIds: [editAddGroupId], strict: true });
      setEditCountryId('');
      setEditCityId('');
      setEditAddGroupId('');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : m18.errAddGroup);
    } finally {
      setEditBusyGroupId(null);
    }
  }

  async function handleRemoveGroupFromEditing(groupId: string) {
    if (!editingId) return;
    setEditError(null);
    setEditBusyGroupId(groupId);
    try {
      await removeMemberFromGroupFn({ userId: editingId, groupId });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : m18.errRemoveGroup);
    } finally {
      setEditBusyGroupId(null);
    }
  }

  // groupId === '' means "no Primary Group" (the dropdown's own empty
  // option) — sent to the Function as null, which clears the field
  // rather than trying to set it to an empty string.
  async function handleSetPrimaryGroup(groupId: string) {
    if (!editingId) return;
    setPrimaryGroupError(null);
    setPrimaryGroupSaving(true);
    try {
      await setPrimaryGroupFn({ userId: editingId, groupId: groupId === '' ? null : groupId });
    } catch (err) {
      setPrimaryGroupError(err instanceof Error ? err.message : m18.errSetPrimary);
    } finally {
      setPrimaryGroupSaving(false);
    }
  }

  async function handleEditPhotoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editingId) return;
    setEditError(null);
    setEditPhotoUploading(true);
    try {
      const path = `profilePhotos/${editingId}/photo.jpg`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file, { contentType: file.type || 'image/jpeg' });
      const photoUrl = await getDownloadURL(ref);
      await adminSetMemberPhotoFn({ userId: editingId, photoUrl });
      setDirectMember((d) => (d && d.id === editingId ? { ...d, photoUrl } : d));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : m18.errUploadPhoto);
    } finally {
      setEditPhotoUploading(false);
      if (editPhotoInputRef.current) editPhotoInputRef.current.value = '';
    }
  }

  async function handleRemoveEditPhoto() {
    if (!editingId || !editingMember) return;
    if (
      !confirm(
        m18.confirmRemovePhoto(editingMember.displayName || m18.noName)
      )
    ) {
      return;
    }
    setEditError(null);
    setEditPhotoRemoving(true);
    try {
      await adminRemoveMemberPhotoFn({ userId: editingId });
      setDirectMember((d) => (d && d.id === editingId ? { ...d, photoUrl: '' } : d));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : m18.errRemovePhoto);
    } finally {
      setEditPhotoRemoving(false);
    }
  }

  const editingMember = editingId ? members.find((m) => m.id === editingId) ?? directMember ?? undefined : undefined;
  const editingMemberships = editingId ? editOwn[editingId] ?? membershipsByUser[editingId] ?? [] : [];

  return (
    <div>
      <nav className="am-tabs" aria-label={m18.title}>
        {([['am-all-card', tx("Members"), Users], ['add-member-card', tx("Add Member"), UserPlus], ['am-bulk-card', tx("Bulk Upload"), Upload]] as const).map(([id, label, Icon], i) => (
          <button type="button" key={id} className={i === 1 && view !== 'assign' ? 'on' : ''} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon size={16} />{label}</button>
        ))}
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Right column: Add member + Bulk upload, stacked together so
            they stay next to the member list regardless of how tall the
            table on the left gets — previously these were two separate
            grid children, so with a long member list the second card
            (Bulk upload) fell to a new grid row below the ENTIRE table
            instead of staying next to Add member. */}
        {view !== 'assign' && (
        <div className="am-wrap">
        {/* Add member */}
        <form onSubmit={handleAdd} className="card am-form" id="add-member-card">
          <header className="am-head">
            <span className="am-ico" aria-hidden>+</span>
            <div><h2>{m18.addTitle}</h2><p>{m18.addHelp}</p></div>
          </header>

          <section className="am-sec">
            <h3>{tx("Identity")}</h3>
            <div className="am-grid">
              <div className="field s5"><label htmlFor="m-name">{m18.fullName}</label><input id="m-name" required value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
              <div className="field s3"><label htmlFor="m-memberid">{m18.colMemberId}</label><input id="m-memberid" required placeholder="M-1001" value={newMemberId} onChange={(e) => setNewMemberId(e.target.value)} /></div>
              <div className="field s4"><label htmlFor="m-since">{tx("Member since")}</label><input id="m-since" type="number" inputMode="numeric" min={1900} max={new Date().getFullYear()} placeholder="e.g. 2019" value={newSince} onChange={(e) => setNewSince(e.target.value.slice(0, 4))} /></div>
            </div>
          </section>

          <section className="am-sec">
            <h3>{tx("Contact")}</h3>
            <div className="am-grid">
              <div className="field s6">
                <label htmlFor="m-phone">{tx("Phone")}</label>
                <div className="am-phone">
                  <select aria-label={tx("Country code")} value={newDial} onChange={(e) => setNewDial(e.target.value)}>
                    {DIAL_CODES.map((d) => <option key={d.code + d.label} value={d.code}>{d.label}</option>)}
                  </select>
                  <input id="m-phone" required inputMode="tel" placeholder={tx("Number without the country code")} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                </div>
              </div>
              <div className="field s6">
                <label htmlFor="m-phone2">{tx("Secondary phone (optional)")}</label>
                <div className="am-phone">
                  <select aria-label={tx("Secondary country code")} value={newDial2} onChange={(e) => setNewDial2(e.target.value)}>
                    {DIAL_CODES.map((d) => <option key={d.code + d.label} value={d.code}>{d.label}</option>)}
                  </select>
                  <input id="m-phone2" inputMode="tel" placeholder={tx("Number without the country code")} value={newPhone2} onChange={(e) => setNewPhone2(e.target.value)} />
                </div>
              </div>
              <div className="field s6"><label htmlFor="m-email">{m18.emailOptional}</label><input id="m-email" type="email" placeholder={tx("name@example.com")} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
            </div>
          </section>

          <section className="am-sec">
            <h3>{tx("Groups")} <em>{tx("optional")}</em></h3>
            <div className="am-grid">
              <div className="field s4">
                <label htmlFor="m-country">{tx("Country")}</label>
                <select id="m-country" value={newCountryId} onChange={(e) => { setNewCountryId(e.target.value); setNewCityId(''); setNewGroupIds([]); }}>
                  <option value="">{m18.selectCountry}</option>
                  {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field s4">
                <label htmlFor="m-city">{tx("City")}</label>
                <select id="m-city" value={newCityId} onChange={(e) => { setNewCityId(e.target.value); setNewGroupIds([]); }} disabled={!newCountryId}>
                  <option value="">{newCountryId ? m18.selectCity : m18.selectCountryFirst}</option>
                  {citiesOfNewCountry.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field s4 am-picked"><label>{tx("Selected")}</label><div className="am-count"><b>{newGroupIds.length}</b><span>{tx("group")}{newGroupIds.length === 1 ? '' : 's'}</span></div></div>
              <div className="s12 am-groups">
                {!newCityId ? <p>{m18.pickCountryCity}</p> : groupsInNewCity.length === 0 ? <p>{m18.noGroupsInCity}</p> : groupsInNewCity.map((g) => (
                  <label key={g.id} className={newGroupIds.includes(g.id) ? 'on' : ''}>
                    <input type="checkbox" checked={newGroupIds.includes(g.id)} onChange={() => toggleGroup(newGroupIds, setNewGroupIds, g.id)} />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          </section>

          <footer className="am-foot">
            {addError && <p className="error-text">{addError}</p>}
            <button type="submit" className="btn btn-primary" disabled={addSubmitting}>{addSubmitting ? m18.adding : m18.addSubmit}</button>
          </footer>
        </form>

        {/* Bulk upload via CSV/Excel */}
        <div className="card am-bulk" id="am-bulk-card">
          <header className="am-head">
            <span className="am-ico alt" aria-hidden>↑</span>
            <div><h2>{m18.bulkTitle}</h2><p>{tx("Add many members at once from an Excel or CSV file.")}</p></div>
          </header>

          <ol className="am-steps">
            <li>
              <span className="n">1</span>
              <div><b>{tx("Get the template")}</b><p>{tx("Phone numbers are kept as text so the + is never lost.")}</p>
                <button type="button" className="btn btn-secondary" onClick={downloadTemplate}>{m18.downloadTemplate}</button></div>
            </li>
            <li>
              <span className="n">2</span>
              <div><b>{tx("Fill the columns")}</b>
                <div className="am-cols">
                  {['memberId', 'phone', 'displayName'].map((c) => <code key={c} className="req">{c}</code>)}
                  {['email', 'memberSince', 'country', 'city', 'group'].map((c) => <code key={c}>{c}</code>)}
                </div>
                <p><span className="am-key req" /> {tx("required ·")} <span className="am-key" /> {tx("optional. Country, city and group go together to assign a group. For several groups, add another row with the same member ID. Member since is a year, like 2019. Fill in the downloaded Excel template and upload that .xlsx file as it is: its Member since column is set to Text, so Excel never turns a year into a date. Saving it as CSV first loses that setting.")}</p>
              </div>
            </li>
            <li>
              <span className="n">3</span>
              <div><b>{tx("Upload the file")}</b>
                <label className="am-drop">
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleCsvFile} />
                  <span><b>{csvFileName ?? tx("Choose a file")}</b><small>{csvFileName ? tx("Click to choose another one") : '.xlsx or .csv'}</small></span>
                </label>
              </div>
            </li>
          </ol>

          {csvParseError && <p className="error-text">{csvParseError}</p>}

          {csvFileName && csvRows.length > 0 && (
            <div>
              <p style={{ fontSize: '0.85rem' }}>
                <strong>{csvFileName}</strong> — {m18.rowsParsed(csvRows.length, csvRows.filter((r) => r.rowError).length)}
              </p>

              {csvRows.some((r) => !r.rowError && r.groupError) && (
                <div
                  style={{
                    background: 'var(--warn-soft)',
                    color: 'var(--warn)',
                    border: '1px solid var(--warn)',
                    borderRadius: 8,
                    padding: '0.6rem 0.8rem',
                    fontSize: '0.82rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  ⚠ <strong>{m18.groupWarnRows(csvRows.filter((r) => !r.rowError && r.groupError).length)}</strong>{' '}
                  {m18.groupWarnMid} <strong>{m18.groupWarnBold}</strong> {m18.groupWarnEnd}
                </div>
              )}

              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                <div className="table-scroll"><table>
                  <thead>
                    <tr>
                      <th>{m18.colMemberId}</th>
                      <th>{m18.colPhone}</th>
                      <th>{m18.colName}</th>
                      <th>{tx("Member since")}</th>
                      <th>{m18.colCountry}</th>
                      <th>{m18.colCity}</th>
                      <th>{m18.colGroup}</th>
                      <th>{m18.colIssue}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.map((r, i) => (
                      <tr key={i} style={r.groupError && !r.rowError ? { background: 'var(--warn-soft)' } : undefined}>
                        <td>{r.memberId || '—'}</td>
                        <td>{r.phone || '—'}</td>
                        <td>{r.displayName || '—'}</td>
                        <td>{r.memberSince || '—'}</td>
                        <td>{r.country || '—'}</td>
                        <td>{r.city || '—'}</td>
                        <td style={{ fontSize: '0.78rem' }}>
                          {r.group || '—'}
                          {r.groupId && <span style={{ color: 'var(--ok, #1e7e34)' }}> ✓</span>}
                          {r.groupError && <span style={{ color: 'var(--warn)' }} title={r.groupError}> ⚠</span>}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: r.rowError ? 'var(--danger, #c0392b)' : 'var(--warn)' }}>
                          {r.rowError ?? r.groupError ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={csvUploading || csvRows.every((r) => r.rowError)}
                  onClick={handleCsvUpload}
                >
                  {csvUploading ? m18.uploading : m18.uploadRows(csvRows.filter((r) => !r.rowError).length)}
                </button>
                <button type="button" className="btn btn-secondary" onClick={resetCsvUpload} disabled={csvUploading}>
                  {m18.clear}
                </button>
              </div>
            </div>
          )}

          {csvResults && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
              <p style={{ fontSize: '0.85rem' }}>
                <strong>{csvResults.filter((r) => !r.error).length}</strong> {m18.succeeded}{' '}
                <strong>{csvResults.filter((r) => r.error).length}</strong> {m18.failed}
              </p>
              {(() => {
                const uploadedNoGroup = csvResults.filter(
                  (r) => !r.error && csvRows.find((cr) => cr.memberId === r.memberId && !cr.rowError)?.groupError
                );
                return (
                  uploadedNoGroup.length > 0 && (
                    <div
                      style={{
                        background: 'var(--warn-soft)',
                        color: 'var(--warn)',
                        border: '1px solid var(--warn)',
                        borderRadius: 8,
                        padding: '0.6rem 0.8rem',
                        fontSize: '0.82rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      ⚠ <strong>{uploadedNoGroup.length}</strong> {m18.afterWarnMid}{' '}
                      <strong>{m18.afterWarnBold}</strong> {m18.afterWarnEnd}{' '}
                      {uploadedNoGroup.map((r) => r.memberId).join(', ')}
                    </div>
                  )
                );
              })()}
              {csvResults.filter((r) => r.error).length > 0 && (
                <ul style={{ fontSize: '0.78rem', color: 'var(--danger, #c0392b)', paddingLeft: '1.2rem' }}>
                  {csvResults
                    .filter((r) => r.error)
                    .map((r, i) => (
                      <li key={i}>
                        {r.memberId || r.phone || m18.rowWord}: {r.error}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
        </div>
        )}
        {/* All members, multi-select */}
        {view !== 'add' && (
        <div className="card mm-all" id="am-all-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>{m18.allMembers}</h2>
            <input
              placeholder={m18.filterPlaceholder}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--line)', borderRadius: 8, fontSize: '0.85rem' }}
            />
          </div>

          <div className="mfx">
            <select value={fCountry} onChange={(e) => { setFCountry(e.target.value); setFCity(''); setFZone(''); setFKurel(''); }}>
              <option value="">{tx("All countries")}</option>
              {hier.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={fCity} onChange={(e) => { setFCity(e.target.value); setFKurel(''); }}>
              <option value="">{tx("All cities")}</option>
              {hier.cities.filter((c) => (!fCountry || c.parentGroupId === fCountry) && (!fZone || c.zoneId === fZone)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={fZone} onChange={(e) => { setFZone(e.target.value); setFCity(''); setFKurel(''); }}>
              <option value="">{tx("All zones")}</option>
              {(zoneRows ?? []).filter((z) => !fCountry || z.countryId === fCountry).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <select value={fKurel} onChange={(e) => setFKurel(e.target.value)}>
              <option value="">{tx("All kurels")}</option>
              {hier.activeLeafGroups.filter((g) => { const c = g.parentGroupId ? hier.byId[g.parentGroupId] : undefined; return !!c && (!fCity || c.id === fCity) && (!fZone || c.zoneId === fZone) && (!fCountry || c.parentGroupId === fCountry); }).map((g) => <option key={g.id} value={g.id}>{g.name} ({hier.byId[g.parentGroupId ?? '']?.name ?? ''})</option>)}
            </select>
            <select value={fRole} onChange={(e) => setFRole(e.target.value)}>
              <option value="">{tx("All roles")}</option>
              {Object.entries(ROLE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">{tx("All statuses")}</option>
              <option value="active">{tx("Active")}</option>
              <option value="suspended">{tx("Suspended")}</option>
            </select>
            <select value={fCount} onChange={(e) => setFCount(e.target.value)}>
              <option value="">{tx("Any number of kurels")}</option>
              <option value="1">{tx("1 kurel")}</option>
              <option value="2">{tx("2 kurels")}</option>
              <option value="3">{tx("3 kurels")}</option>
            </select>
            <select value={fProfile} onChange={(e) => setFProfile(e.target.value)}>
              <option value="">{tx("All profiles")}</option>
              <option value="complete">{tx("Complete")}</option>
              <option value="incomplete">{tx("Incomplete")}</option>
            </select>
            {anyFilter && <button type="button" className="btn btn-secondary mfx-clear" onClick={() => { setFCountry(''); setFCity(''); setFZone(''); setFKurel(''); setFRole(''); setFStatus(''); setFCount(''); setFProfile(''); }}>{tx("Clear filters")}</button>}
          </div>

          {rowActionError && <p className="error-text">{rowActionError}</p>}

          {loadingMembers ? (
            <p>{t.common.loading}</p>
          ) : filteredMembers.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)' }}>{m18.noMembers}</p>
          ) : (
            <>
              <div className="table-scroll"><table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={filteredMembers.length > 0 && filteredMembers.every((m) => selectedIds.has(m.id))}
                        onChange={toggleSelectAllVisible}
                      />
                    </th>
                    <th style={{ width: 44 }}></th>
                    <SortableHeader label={m18.colName} sortableKey="name" />
                    <SortableHeader label={m18.colMemberId} sortableKey="memberId" />
                    <SortableHeader label={m18.colPhone} sortableKey="phone" />
                    <SortableHeader label={m18.colGroups} sortableKey="groups" />
                    <SortableHeader label={m18.colPrimaryGroup} sortableKey="primaryGroup" />
                    <SortableHeader label={m18.colRegistration} sortableKey="registration" />
                    <SortableHeader label={m18.colStatus} sortableKey="status" />
                    <th>{m18.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m) => {
                    const memberships = membershipsByUser[m.id] ?? [];
                    return (
                      <tr key={m.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(m.id)}
                            onChange={() => toggleSelected(m.id)}
                          />
                        </td>
                        <td>
                          {m.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- external Storage URL, not a local/optimizable asset
                            <img
                              src={m.photoUrl}
                              alt={m.displayName || m18.noName}
                              onClick={() => setEnlargedPhotoUrl(m.photoUrl)}
                              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }}
                              title={m18.clickToViewFull}
                            />
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                background: 'var(--line)',
                                color: 'var(--ink-soft)',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.7rem',
                              }}
                            >
                              —
                            </span>
                          )}
                        </td>
                        <td>
                          <strong>{m.displayName || m18.noName}</strong>
                        </td>
                        <td>{m.memberId || <span style={{ color: 'var(--ink-soft)' }}>—</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{m.phone}</td>
                        <td style={{ minWidth: 220 }}>
                          {memberships.length === 0 ? (
                            <span style={{ color: 'var(--ink-soft)', fontSize: '0.82rem' }}>{m18.notLinked}</span>
                          ) : (
                            <div className="group-chip-list">
                              {memberships.map((ms) => (
                                <div key={ms.groupId} className="group-chip">
                                  <span className="group-chip-path">{pathLabel(ms.groupId)}</span>
                                  <button
                                    type="button"
                                    className={ms.role === 'host' ? 'badge badge-host' : 'badge badge-member'}
                                    style={{ border: 'none', cursor: 'pointer' }}
                                    disabled={rowActionBusyId === `${m.id}:${ms.groupId}`}
                                    title={ms.role === 'host' ? m18.demoteTitle : m18.promoteTitle}
                                    onClick={() => handleToggleMembershipRole(m.id, ms.groupId, ms.role, pathLabel(ms.groupId))}
                                  >
                                    {rowActionBusyId === `${m.id}:${ms.groupId}`
                                      ? '…'
                                      : ms.role === 'host'
                                      ? m18.roleHost
                                      : m18.roleMember}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          {m.primaryGroupId ? (
                            <span style={{ fontSize: '0.85rem' }}>{pathLabel(m.primaryGroupId)}</span>
                          ) : memberships.length === 0 ? (
                            <span style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>—</span>
                          ) : (
                            // Primary Group is required once a member has
                            // any groups at all — flagged here (rather
                            // than silently blank) so it's easy for an
                            // admin to spot who still needs one set,
                            // without this column blocking anything that
                            // already works for members it hasn't been
                            // set for yet.
                            <span className="badge" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }} title={m18.clickEditToSet}>
                              {m18.notSet}
                            </span>
                          )}
                        </td>
                        <td>{m.registrationStatus === 'not_registered' ? (
                            <span className="badge" style={{ background: 'var(--line)', color: 'var(--ink-soft)' }}>
                              {m18.regNotRegistered}
                            </span>
                          ) : m.registrationStatus === 'pending_approval' ? (
                            <span className="badge" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                              {m18.regPending}
                            </span>
                          ) : m.registrationStatus === 'approved' ? (
                            <span className="badge" style={{ background: '#e6f4ea', color: '#1e7e34' }}>{m18.regApproved}</span>
                          ) : (
                            <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                              {m18.regRejected}
                            </span>
                          )}
                        </td>
                        <td>
                          <span
                            className="badge"
                            style={
                              m.status === 'disabled'
                                ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
                                : { background: 'var(--line)', color: 'var(--ink-soft)' }
                            }
                          >
                            {m.status === 'disabled' ? m18.statusDisabled : m.status === 'active' ? m18.statusActive : m.status}
                          </span>
                        </td>
                        <td style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button className="btn btn-secondary" onClick={() => openEditModal(m)}>
                            {m18.edit}
                          </button>
                          <button
                            className="btn btn-secondary"
                            disabled={rowActionBusyId === m.id}
                            onClick={() => handleToggleStatus(m.id, m.status, m.displayName || m18.noName)}
                          >
                            {m.status === 'disabled' ? m18.activate : m18.deactivate}
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ color: 'var(--danger, #c0392b)' }}
                            disabled={rowActionBusyId === m.id}
                            onClick={() => handleDeleteMember(m.id, m.displayName || m18.noName)}
                          >
                            {m18.delete}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              {members.length === pageSize && (
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: '1rem' }}
                  onClick={() => setPageSize((p) => p + PAGE_SIZE)}
                >
                  {m18.loadMore}
                </button>
              )}
            </>
          )}

          {selectedIds.size > 0 && (
            <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--line)' }}>
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
                {m18.assignHeadingBefore} <strong>{selectedIds.size}</strong> {m18.assignHeadingAfter}
              </h3>

              <div className="form-row-2" style={{ marginBottom: '0.75rem' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="bulk-country">{m18.countryLabel}</label>
                  <select
                    id="bulk-country"
                    value={assignCountryId}
                    onChange={(e) => {
                      setAssignCountryId(e.target.value);
                      setAssignCityId('');
                      setAssignGroupIds([]);
                    }}
                  >
                    <option value="">{m18.selectCountry}</option>
                    {countries.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="bulk-city">{m18.cityLabel}</label>
                  <select
                    id="bulk-city"
                    value={assignCityId}
                    onChange={(e) => {
                      setAssignCityId(e.target.value);
                      setAssignGroupIds([]);
                    }}
                    disabled={!assignCountryId}
                  >
                    <option value="">{assignCountryId ? m18.selectCity : m18.selectCountryFirst}</option>
                    {citiesOfAssignCountry.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!assignCityId ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '0.75rem' }}>
                  {m18.assignPickHelp}
                </p>
              ) : groupsInAssignCity.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '0.75rem' }}>
                  {m18.noGroupsInCity}
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', maxHeight: 220, overflowY: 'auto' }}>
                  {groupsInAssignCity.map((g) => (
                    <label
                      key={g.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: '0.85rem',
                        border: '1px solid var(--line)',
                        borderRadius: 999,
                        padding: '0.25rem 0.65rem',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={assignGroupIds.includes(g.id)}
                        onChange={() => toggleGroup(assignGroupIds, setAssignGroupIds, g.id)}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {!selectedAlreadyMembersOfCheckedGroups && (
                  <button
                    className="btn btn-secondary"
                    disabled={assignBusy !== null || assignGroupIds.length === 0}
                    onClick={() => handleBulkAssign('member')}
                  >
                    {assignBusy === 'member' ? m18.assigning : m18.assignAsMember}
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={assignBusy !== null || assignGroupIds.length === 0}
                  onClick={() => handleBulkAssign('host')}
                >
                  {assignBusy === 'host' ? m18.assigning : m18.assignAsHost}
                </button>
              </div>
              {selectedAlreadyMembersOfCheckedGroups && (
                <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '0.5rem' }}>
                  {m18.alreadyMembers}
                </p>
              )}
              {assignMsg && <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{assignMsg}</p>}
            </div>
          )}
        </div>
        )}

      </div>

      {editingId && editingMember &&
        createPortal(
        <div
          onClick={closeEditModal}
          role="dialog"
          aria-modal="true"
          aria-label={m18.editTitle}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          {/* Restructured into a sticky header + two-column body (scrollable
              fields on the left, a persistent Save sidebar on the right) so
              Save is always reachable without scrolling back up — the old
              single scrolling column buried it partway down, below the name/
              phone/photo fields and above the groups section. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="card em"
            style={{ width: 'min(860px, 100%)', maxHeight: '90vh', padding: 0, display: 'flex', flexDirection: 'column' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid var(--line)',
                flexShrink: 0,
              }}
            >
              <div>
                <h2 style={{ fontSize: '1rem', margin: 0 }}>{m18.editTitle}</h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', margin: '0.2rem 0 0' }}>
                  {m18.editHelp}
                </p>
              </div>
              <button type="button" className="btn btn-secondary" onClick={closeEditModal}>
                {m18.close}
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-body-main">
                <div className="field">
                  <label htmlFor="e-name">{m18.fullName}</label>
                  <input id="e-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="e-memberid">{m18.colMemberId}</label>
                  <input id="e-memberid" value={editMemberId} onChange={(e) => setEditMemberId(e.target.value)} />
                </div>
                <div className="field em-full">
                  <label htmlFor="e-phone">{m18.editPhone}</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <div className="em-dial"><Dropdown label={tx("Code")} value={editDial} onChange={setEditDial} options={DIAL_CODES.map((d) => ({ value: d.code, label: d.label }))} /></div>
                    <input id="e-phone" inputMode="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={{ flex: 1 }} />
                  </div>
                </div>
                <div className="field em-full">
                  <label htmlFor="e-phone2">{tx("Secondary phone (optional)")}</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <div className="em-dial"><Dropdown label={tx("Code")} value={editDial2} onChange={setEditDial2} options={DIAL_CODES.map((d) => ({ value: d.code, label: d.label }))} /></div>
                    <input id="e-phone2" inputMode="tel" value={editPhone2} onChange={(e) => setEditPhone2(e.target.value)} style={{ flex: 1 }} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="e-since">{tx("Member since")}</label>
                  <input id="e-since" type="number" inputMode="numeric" min={1900} max={new Date().getFullYear()} placeholder="e.g. 2019" value={editSince} onChange={(e) => setEditSince(e.target.value.slice(0, 4))} />
                </div>
                <div className="field">
                  <label htmlFor="e-email">{m18.emailOptional}</label>
                  <input id="e-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder={tx("jane@example.com")} />
                </div>

                <div className="field em-full em-photo">
                  <label>{m18.profilePhoto}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {editingMember.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external Storage URL, not a local/optimizable asset
                      <img
                        src={editingMember.photoUrl}
                        alt={editingMember.displayName || m18.noName}
                        onClick={() => setEnlargedPhotoUrl(editingMember.photoUrl)}
                        title={m18.clickToViewFull}
                        style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', cursor: 'zoom-in' }}
                      />
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          background: 'var(--line)',
                          color: 'var(--ink-soft)',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                        }}
                      >
                        {m18.none}
                      </span>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <input
                        ref={editPhotoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleEditPhotoUpload}
                        disabled={editPhotoUploading || editPhotoRemoving}
                        style={{ fontSize: '0.8rem' }}
                      />
                      {editPhotoUploading && <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{m18.uploadingPhoto}</span>}
                      {editingMember.photoUrl && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ color: 'var(--danger, #c0392b)', width: 'fit-content' }}
                          disabled={editPhotoUploading || editPhotoRemoving}
                          onClick={handleRemoveEditPhoto}
                        >
                          {editPhotoRemoving ? m18.removing : m18.removePhoto}
                        </button>
                      )}
                    </div>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: '0.35rem' }}>
                    {m18.photoHelp}
                  </p>
                </div>

                <div className="em-full em-groups">
                  <h3 style={{ fontSize: '0.9rem', marginTop: 0 }}>{m18.currentGroups}</h3>
                  {editingMemberships.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{m18.notLinkedYet}</p>
                  ) : (
                    <div className="group-chip-list" style={{ marginBottom: '1rem' }}>
                      {editingMemberships.map((ms) => (
                        <div key={ms.groupId} className="group-chip">
                          <span className="group-chip-path">
                            {pathLabel(ms.groupId)}
                            {ms.role === 'host' && <span className="badge badge-host" style={{ marginLeft: '0.4rem' }}>{m18.roleHost}</span>}
                          </span>
                          <button
                            className="btn btn-secondary"
                            style={{ color: 'var(--danger, #c0392b)' }}
                            disabled={editBusyGroupId === ms.groupId}
                            onClick={() => handleRemoveGroupFromEditing(ms.groupId)}
                          >
                            {m18.remove}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <h3 style={{ fontSize: '0.9rem' }}>{m18.primaryGroup}</h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '-0.3rem' }}>
                    {m18.primaryHelp}
                  </p>
                  {editingMemberships.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                      {m18.addGroupFirst}
                    </p>
                  ) : (
                    <div className="field" style={{ marginBottom: '1rem' }}>
                      <Dropdown label={tx("Primary group")} value={editingMember.primaryGroupId ?? ''} onChange={(v) => { if (!primaryGroupSaving) handleSetPrimaryGroup(v); }} allLabel={m18.noPrimarySet} options={editingMemberships.map((ms) => ({ value: ms.groupId, label: pathLabel(ms.groupId) }))} />
                      {primaryGroupSaving && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{m18.saving}</span>
                      )}
                      {primaryGroupError && <p className="error-text">{primaryGroupError}</p>}
                    </div>
                  )}

                  <h3 style={{ fontSize: '0.9rem' }}>{m18.addToGroup}</h3>
                  <div className="em-add">
                    <Dropdown label={m18.countryLabel} value={editCountryId} onChange={(v) => { setEditCountryId(v); setEditCityId(''); setEditAddGroupId(''); }} allLabel={m18.selectCountry} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
                    <Dropdown label={m18.cityLabel} value={editCityId} onChange={(v) => { setEditCityId(v); setEditAddGroupId(''); }} allLabel={editCountryId ? m18.selectCity : m18.selectCountryFirst} options={editCountryId ? citiesOfEditCountry.map((c) => ({ value: c.id, label: c.name })) : []} />
                    <Dropdown label={m18.groupLabel} value={editAddGroupId} onChange={setEditAddGroupId} allLabel={editCityId ? m18.selectGroup : m18.selectCityFirst} options={editCityId ? groupsInEditCity.map((g) => ({ value: g.id, label: g.name })) : []} />
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={!editAddGroupId || editBusyGroupId === editAddGroupId}
                    onClick={handleAddGroupToEditing}
                    style={{ width: '100%' }}
                  >
                    {editBusyGroupId === editAddGroupId ? m18.adding : m18.addToGroupButton}
                  </button>
                </div>
              </div>

              {/* Persistent sidebar — stays put regardless of how far the
                  left column is scrolled, per the "Save must not require
                  scrolling back up" requirement. */}
              <div className="modal-body-side">
                <button className="btn btn-primary" disabled={editSaving} onClick={handleSaveEdit} style={{ width: '100%' }}>
                  {editSaving ? m18.saving : m18.saveChanges}
                </button>
                {editError && <p className="error-text" style={{ fontSize: '0.75rem' }}>{editError}</p>}
                <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)' }}>
                  {m18.saveHelp}
                </p>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
      {enlargedPhotoUrl &&
        createPortal(
          <div
            onClick={() => setEnlargedPhotoUrl(null)}
            role="dialog"
            aria-modal="true"
            aria-label={m18.photoAlt}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.82)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2000,
              cursor: 'zoom-out',
              padding: '1rem',
            }}
          >
            <button
              type="button"
              aria-label={m18.close}
              onClick={() => setEnlargedPhotoUrl(null)}
              style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.95)', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- external Storage URL, not a local/optimizable asset */}
            <img
              src={enlargedPhotoUrl}
              alt={m18.photoAlt}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '92vw', maxHeight: '90vh', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', cursor: 'default' }}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

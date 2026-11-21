'use client';

import DateTimePicker from '@/components/DateTimePicker';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, doc, documentId, getDoc, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore';
import { onSnapshot } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useGroupHierarchy } from '@/lib/useGroupHierarchy';
import {
  createResourceRequest as createResourceRequestFn,
  reviewResourceRequest as reviewResourceRequestFn,
  type ResourceCategory,
} from '@/lib/functions';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { useLevels } from '@/lib/useLevels';

type Stage = 'admin_review' | 'zone_manager_review' | 'top_management_review' | 'approved' | 'rejected';

interface ApprovalStep {
  stage: Stage;
  action: 'submitted' | 'approved' | 'rejected';
  actorName: string;
  comment?: string;
  at?: { seconds: number };
}

interface RequestRow {
  id: string;
  requestedBy: string;
  requestedByName: string;
  groupId: string;
  category: ResourceCategory;
  itemsDescription: string;
  quantity?: number;
  purpose?: string;
  deliveryLocation?: string;
  neededBy?: { seconds: number };
  stage: Stage;
  approvalHistory: ApprovalStep[];
  logisticsTaskId?: string;
  createdAt?: { seconds: number };
}

interface MemberOption {
  id: string;
  name: string;
  role: 'member' | 'host';
}

function stagePill(stage: Stage, label: string) {
  if (stage === 'approved') return <span className="status">{label}</span>;
  if (stage === 'rejected') return <span className="status red">{label}</span>;
  return <span className="status gold">{label}</span>;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const LIST_CAP = 300;

/**
 * Resource requests: Member/Host → Admin → Zone lead → Leadership. An
 * admin records the request on behalf of a member or a host (there is
 * no mobile submission screen yet), choosing an item from the equipment
 * catalog — only items the kurel's level allows. Who may act at each
 * stage is verified server-side by reviewResourceRequest; this page only
 * decides which buttons to SHOW, so no action that would be refused is
 * offered.
 */
export default function ResourceRequestsPage() {
  const { t, formatDate } = useLocale();
  const r18 = t.resourceRequests;
  const CATEGORY_LABELS: Record<ResourceCategory, string> = r18.categories;
  const STAGE_LABELS: Record<Stage, string> = r18.stages;
  const STAGE_SHORT_LABELS: Record<Stage, string> = r18.stagesShort;
  const fmt = (ts?: { seconds: number }) => formatDate(ts, true);
  const { user } = useAuth();
  const { countries, citiesOf, groupsOf, locationOf, byId } = useGroupHierarchy();

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Own role, to decide which stage buttons to show.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [zoneCityIds, setZoneCityIds] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'adminRoles', user.uid)).then((snap) => {
      const data = snap.data();
      setIsSuperAdmin(Boolean(data?.isSuperAdmin));
      setZoneCityIds((data?.zoneManagerCityIds as string[] | undefined) ?? []);
    });
  }, [user]);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'resourceRequests'), orderBy('createdAt', 'desc'), fsLimit(LIST_CAP)), (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RequestRow, 'id'>) })));
      setLoading(false);
    });
  }, []);

  // ---- Create form ----
  const [countryId, setCountryId] = useState('');
  const [cityId, setCityId] = useState('');
  const [groupId, setGroupId] = useState('');
  const cities = useMemo(() => citiesOf(countryId), [citiesOf, countryId]);
  const groups = useMemo(() => groupsOf(cityId), [groupsOf, cityId]);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [requesterId, setRequesterId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [itemsDescription, setItemsDescription] = useState('');
  const { accessibleFrom } = useLevels();
  const [catalog, setCatalog] = useState<{ id: string; name: string; levelId?: string; quantityAvailable?: number }[]>([]);
  useEffect(() => {
    return onSnapshot(query(collection(db, 'equipment'), where('status', '==', 'active'), orderBy('name')), (snap) =>
      setCatalog(
        snap.docs.map((d) => ({
          id: d.id,
          name: (d.data().name as string) ?? '',
          levelId: (d.data().levelId as string) || undefined,
          quantityAvailable: typeof d.data().quantityAvailable === 'number' ? (d.data().quantityAvailable as number) : undefined,
        }))
      )
    );
  }, []);
  // Only equipment this kurel's level allows — the server re-checks it on submit.
  const permittedLevelIds = accessibleFrom(groupId ? byId[groupId]?.levelId : undefined);
  const eligibleEquipment = useMemo(
    () => catalog.filter((c) => !!c.levelId && permittedLevelIds.includes(c.levelId)),
    [catalog, permittedLevelIds]
  );
  const [quantity, setQuantity] = useState('');
  const [purpose, setPurpose] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setRequesterId('');
    if (!groupId) {
      setMemberOptions([]);
      return;
    }
    (async () => {
      const ms = await getDocs(
        query(collection(db, 'groupMemberships'), where('groupId', '==', groupId), where('status', '==', 'active'))
      );
      const roleByUser: Record<string, 'member' | 'host'> = {};
      ms.docs.forEach((d) => (roleByUser[d.data().userId as string] = d.data().role as 'member' | 'host'));
      const ids = Object.keys(roleByUser);
      const batches = await Promise.all(
        chunk(ids, 30).map((c) => getDocs(query(collection(db, 'users'), where(documentId(), 'in', c))))
      );
      const opts: MemberOption[] = [];
      batches.forEach((b) =>
        b.docs.forEach((d) =>
          opts.push({ id: d.id, name: (d.data().displayName as string) || d.id, role: roleByUser[d.id] })
        )
      );
      opts.sort((a, b) => a.name.localeCompare(b.name));
      setMemberOptions(opts);
    })();
  }, [groupId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const requester = memberOptions.find((m) => m.id === requesterId);
    if (!groupId || !requester) {
      setFormError(r18.chooseKurelAndPerson);
      return;
    }
    if (!equipmentId) {
      setFormError(r18.chooseEquipment);
      return;
    }
    setSubmitting(true);
    try {
      await createResourceRequestFn({
        groupId,
        requestedBy: requester.id,
        requestedByName: requester.name,
        equipmentId,
        itemsDescription: itemsDescription.trim() || undefined,
        quantity: quantity.trim() ? Number(quantity) : undefined,
        purpose: purpose.trim() || undefined,
        deliveryLocation: deliveryLocation.trim() || undefined,
        neededByMs: neededBy ? new Date(neededBy).getTime() : undefined,
      });
      setEquipmentId('');
      setItemsDescription('');
      setQuantity('');
      setPurpose('');
      setDeliveryLocation('');
      setNeededBy('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : r18.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function canAct(r: RequestRow): boolean {
    if (r.stage === 'admin_review') return true; // the server checks the 'requests' permission
    if (r.stage === 'top_management_review') return isSuperAdmin;
    if (r.stage === 'zone_manager_review') {
      const cityOfGroup = locationOf(r.groupId).city?.id;
      return isSuperAdmin || (!!cityOfGroup && zoneCityIds.includes(cityOfGroup));
    }
    return false;
  }

  async function handleReview(r: RequestRow, decision: 'approve' | 'reject') {
    setActionError(null);
    setBusyId(r.id);
    try {
      await reviewResourceRequestFn({
        requestId: r.id,
        decision,
        comment: comments[r.id]?.trim() || undefined,
        actorName: user?.email ?? 'Admin',
      });
      setComments((prev) => ({ ...prev, [r.id]: '' }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : r18.decisionFailed);
    } finally {
      setBusyId(null);
    }
  }

  const visible = requests.filter((r) => !stageFilter || r.stage === stageFilter);
  const counts = {
    pending: requests.filter((r) => r.stage !== 'approved' && r.stage !== 'rejected').length,
    approved: requests.filter((r) => r.stage === 'approved').length,
    rejected: requests.filter((r) => r.stage === 'rejected').length,
  };

  return (
    <div>
      <div className="section-head">
        <div>
          <h1>{r18.title}</h1>
          <p>{r18.subtitle}</p>
        </div>
      </div>

      <section className="card command">
        <div className="command-stats cols-4" style={{ marginTop: 0 }}>
          <div>
            <span>{r18.statTotal}</span>
            <strong>{requests.length}</strong>
            <small>{r18.statTotalHint}</small>
          </div>
          <div>
            <span>{r18.statPending}</span>
            <strong>{counts.pending}</strong>
            <small>{r18.statPendingHint}</small>
          </div>
          <div>
            <span>{r18.statApproved}</span>
            <strong>{counts.approved}</strong>
            <small>{r18.statApprovedHint}</small>
          </div>
          <div>
            <span>{r18.statRejected}</span>
            <strong>{counts.rejected}</strong>
            <small>{r18.statRejectedHint}</small>
          </div>
        </div>
      </section>

      <section className="card filters" style={{ gridTemplateColumns: '1fr' }}>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">{r18.allStages}</option>
          {(Object.keys(STAGE_LABELS) as Stage[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </section>

      {actionError && <p className="error-text">{actionError}</p>}

      <div className="workspace workspace-requests">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h2>{r18.requests}</h2>
              <p>{r18.shown(visible.length)}</p>
            </div>
          </div>
          {loading ? (
            <p>{t.common.loading}</p>
          ) : visible.length === 0 ? (
            <p className="empty" style={{ display: 'block' }}>
              {r18.empty}
            </p>
          ) : (
            <div className="members">
              {visible.map((r) => {
                const { city, country } = locationOf(r.groupId);
                const open = openId === r.id;
                return (
                  <div key={r.id} className="kurel" style={{ padding: 0 }}>
                    <button
                      type="button"
                      className="member-row"
                      style={{ gridTemplateColumns: '1fr auto', border: 0, background: 'transparent' }}
                      onClick={() => setOpenId(open ? null : r.id)}
                    >
                      <div>
                        <strong>{r.itemsDescription}</strong>
                        <span>
                          {CATEGORY_LABELS[r.category]}
                          {r.quantity !== undefined ? r18.qty(r.quantity) : ''} · {r.requestedByName}
                        </span>
                        <span>
                          {byId[r.groupId]?.name ?? '—'} · {city?.name ?? '—'} · {country?.name ?? '—'}
                        </span>
                      </div>
                      {stagePill(r.stage, STAGE_LABELS[r.stage])}
                    </button>

                    {open && (
                      <div style={{ padding: '0 0.75rem 0.85rem' }}>
                        <div className="info-grid cols-3">
                          <div className="info">
                            <span>{r18.neededBy}</span>
                            <strong>{fmt(r.neededBy)}</strong>
                          </div>
                          <div className="info">
                            <span>{r18.deliveryLocation}</span>
                            <strong>{r.deliveryLocation || '—'}</strong>
                          </div>
                          <div className="info">
                            <span>{r18.submittedOn}</span>
                            <strong>{fmt(r.createdAt)}</strong>
                          </div>
                        </div>
                        {r.purpose && (
                          <p style={{ fontSize: '0.82rem', margin: '0 0 0.6rem' }}>
                            <strong>{r18.purpose}</strong> {r.purpose}
                          </p>
                        )}

                        <div className="section-title">
                          <h3>{r18.approvalHistory}</h3>
                        </div>
                        <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '0.75rem' }}>
                          {r.approvalHistory.map((h, i) => (
                            <div key={i} className="activity">
                              <div className="activity-head">
                                <strong>
                                  {h.action === 'submitted' ? r18.actionSubmitted : h.action === 'approved' ? r18.actionApproved : r18.actionRejected} —{' '}
                                  {STAGE_SHORT_LABELS[h.stage]}
                                </strong>
                                <small>{fmt(h.at)}</small>
                              </div>
                              <span>{r18.by} {h.actorName}</span>
                              {h.comment && <span>“{h.comment}”</span>}
                            </div>
                          ))}
                        </div>

                        {r.stage !== 'approved' && r.stage !== 'rejected' &&
                          (canAct(r) ? (
                            <div>
                              <input
                                placeholder={r18.commentPlaceholder}
                                value={comments[r.id] ?? ''}
                                onChange={(e) => setComments((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--line)', borderRadius: 10, marginBottom: '0.5rem' }}
                              />
                              <div className="actions">
                                <button type="button" className="primary" disabled={busyId === r.id} onClick={() => handleReview(r, 'approve')}>
                                  {busyId === r.id ? '…' : r18.approve}
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ color: 'var(--danger)' }}
                                  disabled={busyId === r.id}
                                  onClick={() => handleReview(r, 'reject')}
                                >
                                  {r18.reject}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
                              {r18.notYourStep(STAGE_LABELS[r.stage])}
                            </p>
                          ))}
                        {r.stage === 'approved' && r.logisticsTaskId && (
                          <p style={{ fontSize: '0.8rem' }}>
                            {r18.logisticsCreatedBefore} <a href="/dashboard/logistics">{r18.logisticsLink}</a>.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <form onSubmit={handleCreate} className="card" style={{ alignSelf: 'start' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{r18.newRequest}</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '-0.4rem' }}>
            {r18.newRequestHelp}
          </p>

          <div className="field">
            <label htmlFor="rr-country">{r18.countryLabel}</label>
            <select
              id="rr-country"
              value={countryId}
              onChange={(e) => {
                setCountryId(e.target.value);
                setCityId('');
                setGroupId('');
              }}
            >
              <option value="">{r18.selectPlaceholder}</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rr-city">{r18.cityLabel}</label>
            <select
              id="rr-city"
              value={cityId}
              disabled={!countryId}
              onChange={(e) => {
                setCityId(e.target.value);
                setGroupId('');
              }}
            >
              <option value="">{r18.selectPlaceholder}</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rr-group">{r18.kurelLabel}</label>
            <select id="rr-group" value={groupId} disabled={!cityId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{r18.selectPlaceholder}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rr-requester">{r18.requestedFor}</label>
            <select id="rr-requester" value={requesterId} disabled={!groupId} onChange={(e) => setRequesterId(e.target.value)}>
              <option value="">{groupId ? r18.selectMemberOrHost : r18.chooseKurelFirst}</option>
              {memberOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.role === 'host' ? r18.hostSuffix : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="rr-equipment">{r18.equipmentLabel}</label>
            <select id="rr-equipment" required value={equipmentId} disabled={!groupId || eligibleEquipment.length === 0} onChange={(e) => setEquipmentId(e.target.value)}>
              <option value="">{groupId ? r18.selectEquipment : r18.chooseKurelFirst}</option>
              {eligibleEquipment.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.quantityAvailable !== undefined ? ` — ${r18.inStock(c.quantityAvailable)}` : ''}
                </option>
              ))}
            </select>
            {groupId && permittedLevelIds.length === 0 && <p className="error-text" style={{ marginTop: '0.4rem' }}>{r18.kurelNoLevel}</p>}
            {groupId && permittedLevelIds.length > 0 && eligibleEquipment.length === 0 && (
              <p className="error-text" style={{ marginTop: '0.4rem' }}>{r18.noEligibleEquipment}</p>
            )}
            {groupId && eligibleEquipment.length > 0 && <small style={{ color: 'var(--ink-soft)' }}>{r18.onlyEligible}</small>}
          </div>
          <div className="field">
            <label htmlFor="rr-items">{r18.notesLabel}</label>
            <input id="rr-items" value={itemsDescription} onChange={(e) => setItemsDescription(e.target.value)} placeholder={r18.notesPlaceholder} />
          </div>
          <div className="field">
            <label htmlFor="rr-qty">{r18.quantityLabel}</label>
            <input id="rr-qty" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rr-purpose">{r18.purposeLabel}</label>
            <input id="rr-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rr-location">{r18.locationLabel}</label>
            <input id="rr-location" value={deliveryLocation} onChange={(e) => setDeliveryLocation(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rr-needed">{r18.neededLabel}</label>
            <DateTimePicker id="rr-needed" value={neededBy} onChange={setNeededBy} />
          </div>

          {formError && <p className="error-text">{formError}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? r18.submitting : r18.submit}
          </button>
        </form>
      </div>
    </div>
  );
}

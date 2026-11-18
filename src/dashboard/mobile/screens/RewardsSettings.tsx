import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Coins, Copy, Loader, Plus, Rocket, Save, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  SECTIONS,
  api,
  fmt,
  getPath,
  setPath,
  toLocalInput,
  type Field,
  type Json,
  type Payload,
  type ReviewItem,
  type Version,
} from '../../lib/rewardsAdmin';

/* Phone version of Admin → JulinePoints. Same data and rules as the desktop
   page (shared in lib/rewardsAdmin): versioned, effective-dated settings, a
   referral review queue and the platform-funded cost summary. */

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm';

export default function MobileRewardsSettings() {
  const { user } = useAuth();
  const notification = useNotification();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Json | null>(null);
  const [note, setNote] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api('GET'));
    } catch (e: any) {
      notification.error('Could not load rewards settings', e.message);
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => data?.versions.find((v) => v.id === data.active_version_id) || null, [data]);
  const programmeOn = active?.policy?.programme?.enabled === true;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      notification.success('Done', ok);
      await load();
    } catch (e: any) {
      notification.error('Failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const openFrom = (v: Version) => {
    setEditingId(v.status === 'draft' ? v.id : null);
    setDraft(structuredClone(v.policy));
    setNote(v.status === 'draft' ? v.note || '' : `Based on version ${v.version}`);
    setEffectiveFrom('');
    setEditorOpen(true);
  };

  const saveDraft = () =>
    run(async () => {
      if (!draft) return;
      const res = editingId
        ? await api('POST', { action: 'update_draft', id: editingId, policy: draft, note })
        : await api('POST', { action: 'create_draft', policy: draft, note });
      setEditingId(res.version.id);
    }, 'Draft saved');

  const publish = () =>
    run(async () => {
      if (!editingId) return;
      if (!window.confirm('Publish this version? It becomes immutable and applies to new events from its effective time.')) return;
      await api('POST', {
        action: 'publish',
        id: editingId,
        reason: note,
        effective_from: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
      });
      setEditorOpen(false);
      setEditingId(null);
      setDraft(null);
    }, 'Version published');

  const cancelVersion = (v: Version) =>
    run(async () => {
      if (!window.confirm(`Cancel scheduled version ${v.version}?`)) return;
      await api('POST', { action: 'cancel', id: v.id });
    }, 'Scheduled version cancelled');

  const deleteDraft = (v: Version) =>
    run(async () => {
      if (!window.confirm(`Delete draft ${v.version}?`)) return;
      await api('POST', { action: 'delete_draft', id: v.id });
    }, 'Draft deleted');

  const reviewAward = (item: ReviewItem, decision: 'approve' | 'reject') =>
    run(async () => {
      if (!window.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} this referral (${item.points} pts to ${item.referrer})?`)) return;
      await api('POST', { action: 'review_award', id: item.id, decision });
    }, decision === 'approve' ? 'Referral approved' : 'Referral rejected');

  const setField = (path: string, value: unknown) => setDraft((d) => (d ? setPath(d, path, value) : d));

  const renderField = (f: Field) => {
    if (!draft) return null;
    const v = getPath(draft, f.path);
    let input;
    if (f.kind === 'bool') {
      input = <input type="checkbox" className="h-5 w-5" checked={v === true} onChange={(e) => setField(f.path, e.target.checked)} />;
    } else if (typeof f.kind === 'object') {
      input = (
        <select className={inputCls} style={{ fontSize: '16px' }} value={v ?? ''} onChange={(e) => setField(f.path, e.target.value)}>
          {f.kind.select.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    } else if (f.kind === 'datetime') {
      input = (
        <input
          type="datetime-local"
          className={inputCls}
          style={{ fontSize: '16px' }}
          value={toLocalInput(v)}
          onChange={(e) => setField(f.path, e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    } else if (f.kind === 'text') {
      input = <input className={inputCls} style={{ fontSize: '16px' }} value={v ?? ''} onChange={(e) => setField(f.path, e.target.value)} />;
    } else {
      const optional = f.kind === 'optint';
      input = (
        <input
          type="number"
          inputMode="decimal"
          className={inputCls}
          style={{ fontSize: '16px' }}
          value={v ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            setField(f.path, raw === '' ? (optional ? null : 0) : Number(raw));
          }}
        />
      );
    }
    if (f.kind === 'bool') {
      return (
        <label key={f.path} className="flex items-start justify-between gap-3 py-1">
          <span>
            <span className="block text-sm font-medium text-gray-800">{f.label}</span>
            {f.hint && <span className="block text-xs text-gray-500">{f.hint}</span>}
          </span>
          {input}
        </label>
      );
    }
    return (
      <label key={f.path} className="block">
        <span className="text-xs font-medium text-gray-700">{f.label}</span>
        <div className="mt-1">{input}</div>
        {f.hint && <span className="text-xs text-gray-500">{f.hint}</span>}
      </label>
    );
  };

  const tiers: Json[] = draft?.referral?.tiers || [];
  const setTiers = (next: Json[]) => setField('referral.tiers', next);
  const cost = data?.cost;
  const ngn = (n: number) => `₦${Number(n).toLocaleString()}`;

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <Coins className="h-5 w-5 text-amber-600" /> JulinePoints
              </h1>
              <p className="text-xs text-gray-500">Versioned settings. Changes apply to new events only.</p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                programmeOn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {programmeOn ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Wallets" value={String(data?.totals.wallets ?? 0)} />
                <Stat label="Outstanding" value={`${(data?.totals.outstanding_points ?? 0).toLocaleString()} pts`} />
                <Stat label="Ledger drift" value={data?.totals.reconciliation_drift_accounts == null ? 'n/a' : String(data.totals.reconciliation_drift_accounts)} />
                <Stat label="Active version" value={active ? `v${active.version}` : 'none'} />
              </div>

              {cost && (
                <section className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                  <h2 className="text-sm font-semibold text-gray-900">Platform-funded cost</h2>
                  <p className="mb-2 text-[11px] text-gray-500">From the points ledger; vendor earnings are never reduced by points.</p>
                  <dl className="divide-y divide-gray-100 text-sm">
                    <CostRow label="Issued" value={`${Number(cost.issued_points).toLocaleString()} pts · ${ngn(cost.issued_ngn)}`} />
                    <CostRow label="Redeemed at checkout" value={`${Number(cost.redeemed_points).toLocaleString()} pts · ${ngn(cost.redeemed_ngn)}`} />
                    <CostRow label="Restored (cancel/refund)" value={`${Number(cost.restored_points).toLocaleString()} pts · ${ngn(cost.restored_ngn)}`} />
                    <CostRow label="Net redeemed cost" value={ngn(Number(cost.redeemed_ngn) - Number(cost.restored_ngn))} strong />
                    <CostRow label="Pending (not vested)" value={`${Number(cost.pending_points).toLocaleString()} pts`} />
                  </dl>
                </section>
              )}

              {(data?.review_queue?.length ?? 0) > 0 && (
                <section className="rounded-xl bg-white p-3 ring-1 ring-amber-300">
                  <h2 className="mb-2 text-sm font-semibold text-gray-900">Referrals awaiting review ({data?.review_queue?.length})</h2>
                  <div className="space-y-3">
                    {data?.review_queue?.map((r) => (
                      <div key={r.id} className="text-sm">
                        <p className="text-gray-900">
                          <span className="font-medium">{r.referrer}</span> referred <span className="font-medium">{r.referee}</span>
                        </p>
                        <p className="text-xs text-gray-500">
                          Order {r.order_number ?? '—'} · ₦{Number(r.qualifying_amount).toLocaleString()} · {r.points} pts · flagged:{' '}
                          {r.signals.map((s) => s.replace(/_/g, ' ')).join(', ')}
                        </p>
                        {isAdmin && (
                          <div className="mt-2 flex gap-2">
                            <button type="button" disabled={busy} onClick={() => void reviewAward(r, 'approve')} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-green-600 py-2 text-xs font-semibold text-white disabled:opacity-60">
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button type="button" disabled={busy} onClick={() => void reviewAward(r, 'reject')} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-50 py-2 text-xs font-semibold text-red-600 disabled:opacity-60">
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h2 className="mb-2 text-sm font-semibold text-gray-900">Versions</h2>
                <div className="space-y-2">
                  {(data?.versions || []).map((v) => {
                    const scheduled = v.status === 'published' && v.effective_from && new Date(v.effective_from) > new Date();
                    const isActive = v.id === data?.active_version_id;
                    const label = isActive ? 'active' : scheduled ? 'scheduled' : v.status;
                    return (
                      <div key={v.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-gray-900">
                            v{v.version}{' '}
                            <span
                              className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                isActive ? 'bg-green-100 text-green-700' : scheduled ? 'bg-blue-100 text-blue-700' : v.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {label}
                            </span>
                          </p>
                          <span className="text-[11px] text-gray-500">{v.status === 'draft' ? `created ${fmt(v.created_at)}` : `from ${fmt(v.effective_from)}`}</span>
                        </div>
                        {v.note && <p className="mt-1 text-xs text-gray-500">{v.note}</p>}
                        {isAdmin && (
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
                            {v.status === 'draft' ? (
                              <button type="button" disabled={busy} onClick={() => openFrom(v)} className="text-primary-600">Edit</button>
                            ) : (
                              <button type="button" disabled={busy} onClick={() => openFrom(v)} className="flex items-center gap-1 text-primary-600">
                                <Copy className="h-3.5 w-3.5" /> New draft from this
                              </button>
                            )}
                            {scheduled && (
                              <button type="button" disabled={busy} onClick={() => void cancelVersion(v)} className="text-red-500">Cancel</button>
                            )}
                            {v.status === 'draft' && (
                              <button type="button" disabled={busy} onClick={() => void deleteDraft(v)} className="ml-auto text-red-500" aria-label="Delete draft">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <details className="rounded-xl bg-white ring-1 ring-gray-100">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-sm font-semibold text-gray-900">
                  Audit history <ChevronDown className="h-4 w-4 text-gray-400" />
                </summary>
                <ul className="divide-y divide-gray-100 px-3 pb-2 text-xs">
                  {(data?.audit || []).map((a) => (
                    <li key={a.id} className="py-2">
                      <span className="font-medium text-gray-900">{a.action}</span> · {a.actor_email || 'system'}
                      <div className="text-gray-500">
                        {fmt(a.created_at)}
                        {a.reason ? ` · ${a.reason}` : ''}
                      </div>
                    </li>
                  ))}
                  {(data?.audit || []).length === 0 && <li className="py-2 text-gray-500">No changes yet.</li>}
                </ul>
              </details>
            </>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={editorOpen} onClose={() => setEditorOpen(false)} ariaLabel="JulinePoints settings draft">
        <h3 className="text-base font-bold">{editingId ? 'Edit draft' : 'New draft'}</h3>
        <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
          {SECTIONS.map((s, i) => (
            <details key={s.title} open={i === 0} className="rounded-lg border border-gray-200">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold text-gray-900">
                {s.title} <ChevronDown className="h-4 w-4 text-gray-400" />
              </summary>
              <div className="space-y-3 px-3 pb-3">
                {s.fields.map(renderField)}
                {s.title === 'Referral programme' && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-gray-700">Reward tiers (contiguous; last tier open-ended)</p>
                    {tiers.map((t, idx) => (
                      <div key={idx} className="mb-2 rounded-lg bg-gray-50 p-2">
                        <div className="grid grid-cols-3 gap-2">
                          <label className="text-[11px] text-gray-500">
                            From ₦
                            <input type="number" inputMode="numeric" className={inputCls} style={{ fontSize: '16px' }} value={t.min_ngn}
                              onChange={(e) => setTiers(tiers.map((x, j) => (j === idx ? { ...x, min_ngn: Number(e.target.value) } : x)))} />
                          </label>
                          <label className="text-[11px] text-gray-500">
                            Under ₦
                            <input type="number" inputMode="numeric" className={inputCls} style={{ fontSize: '16px' }} value={t.max_ngn ?? ''} placeholder="no limit"
                              onChange={(e) => setTiers(tiers.map((x, j) => (j === idx ? { ...x, max_ngn: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                          </label>
                          <label className="text-[11px] text-gray-500">
                            Points
                            <input type="number" inputMode="numeric" className={inputCls} style={{ fontSize: '16px' }} value={t.points}
                              onChange={(e) => setTiers(tiers.map((x, j) => (j === idx ? { ...x, points: Number(e.target.value) } : x)))} />
                          </label>
                        </div>
                        <button type="button" className="mt-1 text-xs text-red-500" onClick={() => setTiers(tiers.filter((_, j) => j !== idx))}>Remove tier</button>
                      </div>
                    ))}
                    <button type="button" className="flex items-center gap-1 text-xs font-semibold text-primary-600"
                      onClick={() => setTiers([...tiers, { min_ngn: tiers[tiers.length - 1]?.max_ngn ?? 0, max_ngn: null, points: 0 }])}>
                      <Plus className="h-3.5 w-3.5" /> Add tier
                    </button>
                  </div>
                )}
              </div>
            </details>
          ))}
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Change note / reason (audited)</span>
            <input className={`${inputCls} mt-1`} style={{ fontSize: '16px' }} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Effective from (blank = now)</span>
            <input type="datetime-local" className={`${inputCls} mt-1`} style={{ fontSize: '16px' }} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => void saveDraft()} className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-60">
            <Save className="h-4 w-4" /> Save draft
          </button>
          <button type="button" disabled={busy || !editingId} onClick={() => void publish()} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
            <Rocket className="h-4 w-4" /> Publish
          </button>
        </div>
        {!editingId && <p className="mt-1 text-center text-[11px] text-gray-500">Save the draft first, then publish.</p>}
      </Sheet>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function CostRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-gray-600">{label}</dt>
      <dd className={strong ? 'font-semibold text-gray-900' : 'text-gray-900'}>{value}</dd>
    </div>
  );
}

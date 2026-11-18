import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Coins, Save, Rocket, XCircle, Plus, Trash2, Copy, X, ShieldAlert, Check } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import {
  Field,
  Json,
  Payload,
  ReviewItem,
  SECTIONS,
  Version,
  api,
  fmt,
  getPath,
  setPath,
  toLocalInput,
} from '../lib/rewardsAdmin';

/* JulinePoints admin: versioned, effective-dated settings (PRD v1.1 §6).
   Every commercial value is edited here and stored in rewards_config_versions;
   nothing is hard-coded in the UI or the functions.

   Desktop layout: a KPI row, then a wide main column (versions table and the
   draft editor) beside a side column (review queue, cost, audit). The phone
   version lives in dashboard/mobile/screens/RewardsSettings.tsx. */

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500';

export function RewardsSettingsPage() {
  const notification = useNotification();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => data?.versions.find((v) => v.id === data.active_version_id) || null, [data]);
  const editingVersion = data?.versions.find((v) => v.id === editingId) || null;
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

  const startFrom = (v: Version) => {
    setEditingId(v.status === 'draft' ? v.id : null);
    setDraft(structuredClone(v.policy));
    setNote(v.status === 'draft' ? v.note || '' : `Based on version ${v.version}`);
    setEffectiveFrom('');
  };

  const saveDraft = () => run(async () => {
    if (!draft) return;
    const res = editingId
      ? await api('POST', { action: 'update_draft', id: editingId, policy: draft, note })
      : await api('POST', { action: 'create_draft', policy: draft, note });
    setEditingId(res.version.id);
  }, 'Draft saved');

  const publish = () => run(async () => {
    if (!editingId) return;
    if (!window.confirm('Publish this version? It becomes immutable and applies to new events from its effective time.')) return;
    await api('POST', {
      action: 'publish', id: editingId, reason: note,
      effective_from: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
    });
    setEditingId(null); setDraft(null);
  }, 'Version published');

  const cancelVersion = (v: Version) => run(async () => {
    if (!window.confirm(`Cancel scheduled version ${v.version}?`)) return;
    await api('POST', { action: 'cancel', id: v.id });
  }, 'Scheduled version cancelled');

  const deleteDraft = (v: Version) => run(async () => {
    if (!window.confirm(`Delete draft ${v.version}?`)) return;
    await api('POST', { action: 'delete_draft', id: v.id });
    if (editingId === v.id) { setEditingId(null); setDraft(null); }
  }, 'Draft deleted');

  const reviewAward = (item: ReviewItem, decision: 'approve' | 'reject') => run(async () => {
    const verb = decision === 'approve' ? 'Approve' : 'Reject';
    if (!window.confirm(`${verb} this referral (${item.points} pts to ${item.referrer})?`)) return;
    await api('POST', { action: 'review_award', id: item.id, decision });
  }, decision === 'approve' ? 'Referral approved; it will vest after delivery and the hold' : 'Referral rejected');

  const setField = (path: string, value: unknown) => setDraft((d) => (d ? setPath(d, path, value) : d));

  const renderField = (f: Field) => {
    if (!draft) return null;
    const v = getPath(draft, f.path);
    if (f.kind === 'bool') {
      return (
        <label key={f.path} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 2xl:col-span-2">
          <span>
            <span className="block text-sm font-medium text-gray-800">{f.label}</span>
            {f.hint && <span className="block text-xs text-gray-500">{f.hint}</span>}
          </span>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-amber-600" checked={v === true}
            onChange={(e) => setField(f.path, e.target.checked)} />
        </label>
      );
    }
    let input;
    if (typeof f.kind === 'object') {
      input = (
        <select className={inputCls} value={v ?? ''} onChange={(e) => setField(f.path, e.target.value)}>
          {f.kind.select.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    } else if (f.kind === 'datetime') {
      input = (
        <input type="datetime-local" className={inputCls} value={toLocalInput(v)}
          onChange={(e) => setField(f.path, e.target.value ? new Date(e.target.value).toISOString() : null)} />
      );
    } else if (f.kind === 'text') {
      input = <input className={inputCls} value={v ?? ''} onChange={(e) => setField(f.path, e.target.value)} />;
    } else {
      const optional = f.kind === 'optint';
      input = (
        <input type="number" className={inputCls} value={v ?? ''} step={f.kind === 'num' ? 'any' : 1}
          onChange={(e) => {
            const raw = e.target.value;
            setField(f.path, raw === '' ? (optional ? null : 0) : Number(raw));
          }} />
      );
    }
    return (
      <label key={f.path} className="block">
        <span className="text-sm font-medium text-gray-700">{f.label}</span>
        <div className="mt-1">{input}</div>
        {f.hint && <span className="mt-0.5 block text-xs text-gray-500">{f.hint}</span>}
      </label>
    );
  };

  const tiers: Json[] = draft?.referral?.tiers || [];
  const setTiers = (next: Json[]) => setField('referral.tiers', next);
  const cost = data?.cost;
  const ngn = (n: number) => `₦${Number(n).toLocaleString()}`;
  const driftCount = data?.totals.reconciliation_drift_accounts;

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Coins className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">JulinePoints settings</h1>
            <p className="max-w-2xl text-sm text-gray-600">
              Versioned and effective-dated. A published version applies to new events only; earned points are never revalued.
            </p>
          </div>
        </div>
        {active && !draft && (
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => startFrom(active)}
          >
            <Copy className="h-4 w-4" /> New draft from active (v{active.version})
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Programme">
          <span className={`inline-flex items-center gap-2 text-lg font-semibold ${programmeOn ? 'text-green-700' : 'text-gray-600'}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${programmeOn ? 'bg-green-500' : 'bg-gray-400'}`} />
            {programmeOn ? 'Enabled' : 'Disabled'}
          </span>
        </Kpi>
        <Kpi label="Wallets"><span className="text-lg font-semibold">{(data?.totals.wallets ?? 0).toLocaleString()}</span></Kpi>
        <Kpi label="Outstanding points">
          <span className="text-lg font-semibold">{(data?.totals.outstanding_points ?? 0).toLocaleString()}</span>
        </Kpi>
        <Kpi label="Ledger drift">
          <span className={`inline-flex items-center gap-1.5 text-lg font-semibold ${driftCount ? 'text-red-600' : 'text-green-700'}`}>
            {driftCount == null ? 'n/a' : driftCount}
            {driftCount === 0 && <Check className="h-4 w-4" />}
          </span>
        </Kpi>
        <Kpi label="Active version"><span className="text-lg font-semibold">{active ? `v${active.version}` : 'none'}</span></Kpi>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <header className="border-b border-gray-200 px-5 py-4 font-semibold text-gray-900">Versions</header>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Version</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Effective from</th>
                    <th className="px-3 py-2.5 font-medium">Note</th>
                    <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(data?.versions || []).map((v) => {
                    const scheduled = v.status === 'published' && v.effective_from && new Date(v.effective_from) > new Date();
                    const isActive = v.id === data?.active_version_id;
                    return (
                      <tr key={v.id} className={editingId === v.id ? 'bg-amber-50/60' : undefined}>
                        <td className="px-5 py-3 font-semibold text-gray-900">v{v.version}</td>
                        <td className="px-3 py-3">
                          <StatusBadge kind={isActive ? 'active' : scheduled ? 'scheduled' : v.status} />
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                          {v.status === 'draft' ? <span className="text-gray-400">not published</span> : fmt(v.effective_from)}
                        </td>
                        <td className="max-w-[18rem] truncate px-3 py-3 text-gray-600" title={v.note || ''}>{v.note || '—'}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                            {v.status === 'draft' && <button className="text-blue-600 hover:underline" disabled={busy} onClick={() => startFrom(v)}>Edit</button>}
                            {v.status !== 'draft' && (
                              <button className="inline-flex items-center gap-1 text-blue-600 hover:underline" disabled={busy} onClick={() => startFrom(v)}>
                                <Copy className="h-3.5 w-3.5" /> New draft from this
                              </button>
                            )}
                            {scheduled && (
                              <button className="inline-flex items-center gap-1 text-red-600 hover:underline" disabled={busy} onClick={() => cancelVersion(v)}>
                                <XCircle className="h-3.5 w-3.5" /> Cancel
                              </button>
                            )}
                            {v.status === 'draft' && (
                              <button className="text-red-600 hover:text-red-700" aria-label="Delete draft" disabled={busy} onClick={() => deleteDraft(v)}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(data?.versions || []).length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-500">No versions yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {draft && (
            <section className="overflow-hidden rounded-xl border border-amber-300 bg-white">
              <header className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingVersion ? `Editing draft v${editingVersion.version}` : 'New draft'}
                </h2>
                <button className="rounded-md p-1 text-gray-500 hover:bg-amber-100" aria-label="Close editor" onClick={() => { setDraft(null); setEditingId(null); }}>
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="grid gap-4 p-5 md:grid-cols-2">
                {SECTIONS.map((s) => (
                  <div key={s.title} className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">{s.title}</h3>
                    <div className="grid gap-3 2xl:grid-cols-2">{s.fields.map(renderField)}</div>
                    {s.title === 'Referral programme' && (
                      <div className="mt-4">
                        <div className="mb-1.5 text-sm font-medium text-gray-700">Reward tiers <span className="font-normal text-gray-500">(contiguous; last tier open-ended)</span></div>
                        <div className="space-y-2">
                          {tiers.map((t, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 text-sm">
                              <span className="text-gray-500">₦</span>
                              <input type="number" className="w-24 rounded border border-gray-300 px-2 py-1" value={t.min_ngn}
                                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, min_ngn: Number(e.target.value) } : x)))} />
                              <span className="text-gray-500">to under ₦</span>
                              <input type="number" className="w-24 rounded border border-gray-300 px-2 py-1" value={t.max_ngn ?? ''} placeholder="no limit"
                                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, max_ngn: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                              <span className="text-gray-500">=</span>
                              <input type="number" className="w-16 rounded border border-gray-300 px-2 py-1" value={t.points}
                                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} />
                              <span className="text-gray-500">pts</span>
                              <button className="ml-auto text-red-600" aria-label="Remove tier" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                            </div>
                          ))}
                        </div>
                        <button className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                          onClick={() => setTiers([...tiers, { min_ngn: (tiers[tiers.length - 1]?.max_ngn ?? 0), max_ngn: null, points: 0 }])}>
                          <Plus className="h-4 w-4" /> Add tier
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <footer className="space-y-4 border-t border-gray-200 bg-gray-50 px-5 py-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Change note / reason (audited)</span>
                    <input className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Effective from (blank = now)</span>
                    <input type="datetime-local" className={`${inputCls} mt-1`} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50" disabled={busy} onClick={saveDraft}>
                    <Save className="h-4 w-4" /> Save draft
                  </button>
                  <button className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50" disabled={busy || !editingId} onClick={publish}
                    title={editingId ? '' : 'Save the draft first'}>
                    <Rocket className="h-4 w-4" /> Publish
                  </button>
                  <button className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50" onClick={() => { setDraft(null); setEditingId(null); }}>Close</button>
                  {!editingId && <span className="text-xs text-gray-500">Save the draft first, then publish.</span>}
                </div>
              </footer>
            </section>
          )}
        </div>

        {/* Side column */}
        <div className="space-y-6">
          {(data?.review_queue?.length ?? 0) > 0 && (
            <section className="overflow-hidden rounded-xl border border-amber-300 bg-white">
              <header className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 font-semibold text-gray-900">
                <ShieldAlert className="h-4 w-4 text-amber-700" /> Referrals awaiting review ({data?.review_queue?.length})
              </header>
              <ul className="divide-y divide-gray-100 text-sm">
                {data?.review_queue?.map((r) => (
                  <li key={r.id} className="space-y-2 px-4 py-3">
                    <div>
                      <div className="break-words"><span className="font-medium">{r.referrer}</span> referred <span className="font-medium">{r.referee}</span></div>
                      <div className="text-xs text-gray-500">
                        Order {r.order_number ?? '—'} · ₦{Number(r.qualifying_amount).toLocaleString()} · {r.points} pts
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.signals.map((s) => (
                          <span key={s} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{s.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50" disabled={busy} onClick={() => reviewAward(r, 'approve')}>Approve</button>
                      <button className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50" disabled={busy} onClick={() => reviewAward(r, 'reject')}>Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {cost && (
            <section className="rounded-xl border border-gray-200 bg-white">
              <header className="border-b border-gray-200 px-4 py-3">
                <h2 className="font-semibold text-gray-900">Platform-funded cost</h2>
                <p className="mt-0.5 text-xs text-gray-500">From the points ledger. Vendors are paid on item prices, never reduced by points.</p>
              </header>
              <dl className="divide-y divide-gray-100 text-sm">
                <CostRow label="Issued" value={`${Number(cost.issued_points).toLocaleString()} pts`} sub={ngn(cost.issued_ngn)} />
                <CostRow label="Redeemed at checkout" value={`${Number(cost.redeemed_points).toLocaleString()} pts`} sub={ngn(cost.redeemed_ngn)} />
                <CostRow label="Restored (cancel / refund)" value={`${Number(cost.restored_points).toLocaleString()} pts`} sub={ngn(cost.restored_ngn)} />
                <CostRow label="Net redeemed cost" value={ngn(Number(cost.redeemed_ngn) - Number(cost.restored_ngn))} strong />
                <CostRow label="Outstanding liability" value={`${Number(cost.outstanding_points).toLocaleString()} pts`} />
                <CostRow label="Pending, not yet vested" value={`${Number(cost.pending_points).toLocaleString()} pts`} />
              </dl>
            </section>
          )}

          <section className="rounded-xl border border-gray-200 bg-white">
            <header className="border-b border-gray-200 px-4 py-3 font-semibold text-gray-900">Audit history</header>
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto text-sm">
              {(data?.audit || []).map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-gray-900">{a.action.replace(/_/g, ' ').toLowerCase()}</span>
                    <span className="shrink-0 text-xs text-gray-400">{fmt(a.created_at)}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {a.actor_email || 'system'}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </div>
                </li>
              ))}
              {(data?.audit || []).length === 0 && <li className="px-4 py-3 text-gray-500">No changes yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3.5">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      {children}
    </div>
  );
}

function CostRow({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-gray-600">{label}</dt>
      <dd className="text-right">
        <span className={strong ? 'font-semibold text-gray-900' : 'text-gray-900'}>{value}</span>
        {sub && <span className="block text-xs text-gray-500">{sub}</span>}
      </dd>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  scheduled: 'bg-blue-100 text-blue-700',
  draft: 'bg-amber-100 text-amber-700',
  published: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-600',
};

function StatusBadge({ kind }: { kind: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[kind] || 'bg-gray-100 text-gray-600'}`}>{kind}</span>
  );
}

export default RewardsSettingsPage;

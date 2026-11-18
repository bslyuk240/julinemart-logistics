import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Coins, Save, Rocket, XCircle, Plus, Trash2, Copy } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { functionsAuthHeader } from '../mobile/lib/functionsAuth';

/* JulinePoints admin: versioned, effective-dated settings (PRD v1.1 §6).
   Every commercial value is edited here and stored in rewards_config_versions;
   nothing is hard-coded in the UI or the functions. */

type Json = Record<string, any>;

interface Version {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'cancelled';
  effective_from: string | null;
  policy: Json;
  note: string | null;
  created_at: string;
  published_at: string | null;
}
interface AuditRow { id: string; actor_email: string | null; action: string; created_at: string; reason: string | null }
interface ReviewItem {
  id: string; order_number: string | number | null; referrer: string; referee: string;
  qualifying_amount: number; points: number; signals: string[]; created_at: string;
}
interface Payload {
  review_queue?: ReviewItem[];
  active_version_id: string | null;
  versions: Version[];
  audit: AuditRow[];
  totals: { wallets: number; outstanding_points: number; reconciliation_drift_accounts: number | null };
}

type FieldKind = 'bool' | 'int' | 'num' | 'text' | 'datetime' | 'optint' | { select: string[] };
interface Field { path: string; label: string; kind: FieldKind; hint?: string }

const SECTIONS: { title: string; fields: Field[] }[] = [
  { title: 'Programme', fields: [
    { path: 'programme.enabled', label: 'Programme enabled', kind: 'bool', hint: 'Master switch. Off = no earning or spending.' },
    { path: 'programme.name', label: 'Reward name', kind: 'text' },
    { path: 'programme.launch_at', label: 'Launch cutoff (new-account bonus)', kind: 'datetime', hint: 'Only accounts registered at/after this get the sign-up bonus.' },
    { path: 'programme.timezone', label: 'Claim timezone (IANA)', kind: 'text' },
    { path: 'programme.points_to_ngn', label: '1 point = ₦', kind: 'num' },
  ] },
  { title: 'Sign-up and daily check-in', fields: [
    { path: 'signup.enabled', label: 'Sign-up bonus enabled', kind: 'bool' },
    { path: 'signup.points', label: 'Sign-up bonus (points)', kind: 'int' },
    { path: 'signup.require_verified_email', label: 'Require verified email', kind: 'bool' },
    { path: 'daily_claim.enabled', label: 'Daily claim enabled', kind: 'bool' },
    { path: 'daily_claim.points', label: 'Daily claim (points)', kind: 'int' },
    { path: 'streak.enabled', label: 'Streak bonus enabled', kind: 'bool' },
    { path: 'streak.length_days', label: 'Streak length (days)', kind: 'int' },
    { path: 'streak.bonus_points', label: 'Streak bonus (points)', kind: 'int' },
    { path: 'streak.reset_policy', label: 'Missed-day policy', kind: { select: ['reset', 'grace'] } },
    { path: 'streak.grace_days', label: 'Grace days', kind: 'int' },
  ] },
  { title: 'Purchase rewards', fields: [
    { path: 'purchase.enabled', label: 'Purchase rewards enabled', kind: 'bool' },
    { path: 'purchase.rate_percent', label: 'Rate (% of eligible merchandise)', kind: 'num' },
    { path: 'purchase.rounding', label: 'Rounding', kind: { select: ['floor', 'round', 'ceil'] } },
    { path: 'purchase.max_points_per_order', label: 'Max points per order', kind: 'optint', hint: 'Empty = no cap.' },
    { path: 'purchase.hold_days', label: 'Return/refund hold (days)', kind: 'int' },
    { path: 'purchase.include_points_funded_value', label: 'Earn on points-funded value', kind: 'bool' },
  ] },
  { title: 'Referral programme', fields: [
    { path: 'referral.enabled', label: 'Referrals enabled', kind: 'bool' },
    { path: 'referral.window_days', label: 'Attribution window (days)', kind: 'int' },
    { path: 'referral.hold_days', label: 'Fulfilment hold (days)', kind: 'int' },
  ] },
  { title: 'Checkout redemption', fields: [
    { path: 'redemption.enabled', label: 'Redemption enabled', kind: 'bool' },
    { path: 'redemption.cap_percent', label: 'Cap (% of eligible merchandise)', kind: 'num' },
    { path: 'redemption.min_points', label: 'Minimum redemption (points)', kind: 'int' },
    { path: 'redemption.max_points_per_order', label: 'Max points per order', kind: 'optint', hint: 'Empty = no cap.' },
    { path: 'redemption.partial_allowed', label: 'Allow partial use', kind: 'bool' },
    { path: 'redemption.reservation_minutes', label: 'Hold points at checkout (minutes)', kind: 'optint', hint: 'Empty = 60.' },
  ] },
  { title: 'Expiry and adjustments', fields: [
    { path: 'expiry.enabled', label: 'Points expire', kind: 'bool' },
    { path: 'expiry.days', label: 'Expire after (days)', kind: 'int' },
    { path: 'expiry.warn_days', label: 'Warn before (days)', kind: 'int' },
    { path: 'adjustments.dual_approval_threshold_points', label: 'Dual-approval threshold (points)', kind: 'int' },
  ] },
];

const getPath = (o: Json, path: string) => path.split('.').reduce((a: any, k) => (a == null ? a : a[k]), o);
const setPath = (o: Json, path: string, value: unknown): Json => {
  const next = structuredClone(o);
  const keys = path.split('.');
  let cur: any = next;
  keys.slice(0, -1).forEach((k) => { cur = cur[k]; });
  cur[keys[keys.length - 1]] = value;
  return next;
};
const toLocalInput = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().slice(0, 16) : '';
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

async function api(method: 'GET' | 'POST', body?: Json) {
  const res = await fetch('/api/admin-rewards-config', {
    method,
    headers: { 'Content-Type': 'application/json', ...(await functionsAuthHeader()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const detail = Array.isArray(data.details) ? `: ${data.details.join('; ')}` : '';
    throw new Error(`${data.error || 'Request failed'}${detail}`);
  }
  return data;
}

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
    const base = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm';
    let input;
    if (f.kind === 'bool') {
      input = (
        <input type="checkbox" className="h-4 w-4" checked={v === true}
          onChange={(e) => setField(f.path, e.target.checked)} />
      );
    } else if (typeof f.kind === 'object') {
      input = (
        <select className={base} value={v ?? ''} onChange={(e) => setField(f.path, e.target.value)}>
          {f.kind.select.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    } else if (f.kind === 'datetime') {
      input = (
        <input type="datetime-local" className={base} value={toLocalInput(v)}
          onChange={(e) => setField(f.path, e.target.value ? new Date(e.target.value).toISOString() : null)} />
      );
    } else if (f.kind === 'text') {
      input = <input className={base} value={v ?? ''} onChange={(e) => setField(f.path, e.target.value)} />;
    } else {
      const optional = f.kind === 'optint';
      input = (
        <input type="number" className={base} value={v ?? ''} step={f.kind === 'num' ? 'any' : 1}
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
        {f.hint && <span className="text-xs text-gray-500">{f.hint}</span>}
      </label>
    );
  };

  const tiers: Json[] = draft?.referral?.tiers || [];
  const setTiers = (next: Json[]) => setField('referral.tiers', next);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Coins className="h-6 w-6 text-amber-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">JulinePoints settings</h1>
          <p className="text-sm text-gray-600">
            Versioned and effective-dated. A published version applies to new events only; earned points are never revalued.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Programme" value={active?.policy?.programme?.enabled ? 'Enabled' : 'Disabled'} />
        <Stat label="Wallets" value={String(data?.totals.wallets ?? 0)} />
        <Stat label="Outstanding points" value={(data?.totals.outstanding_points ?? 0).toLocaleString()} />
        <Stat
          label="Ledger drift"
          value={data?.totals.reconciliation_drift_accounts == null ? 'n/a' : String(data.totals.reconciliation_drift_accounts)}
        />
      </div>

      {(data?.review_queue?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-amber-300 bg-white">
          <header className="border-b border-gray-200 px-4 py-3 font-semibold">
            Referrals awaiting review ({data?.review_queue?.length})
          </header>
          <ul className="divide-y divide-gray-100 text-sm">
            {data?.review_queue?.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <div><span className="font-medium">{r.referrer}</span> referred <span className="font-medium">{r.referee}</span></div>
                  <div className="text-gray-500">
                    Order {r.order_number ?? '—'} · ₦{Number(r.qualifying_amount).toLocaleString()} · {r.points} pts ·{' '}
                    flagged: {r.signals.map((s) => s.replace(/_/g, ' ')).join(', ')}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="text-sm text-blue-600 hover:underline" disabled={busy} onClick={() => reviewAward(r, 'approve')}>Approve</button>
                  <button className="text-sm text-red-600 hover:underline" disabled={busy} onClick={() => reviewAward(r, 'reject')}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3 font-semibold">Versions</header>
        <ul className="divide-y divide-gray-100">
          {(data?.versions || []).map((v) => {
            const scheduled = v.status === 'published' && v.effective_from && new Date(v.effective_from) > new Date();
            return (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <span className="font-medium">v{v.version}</span>{' '}
                  <Badge>{v.id === data?.active_version_id ? 'active' : scheduled ? 'scheduled' : v.status}</Badge>{' '}
                  <span className="text-gray-500">
                    {v.status === 'draft' ? `created ${fmt(v.created_at)}` : `effective ${fmt(v.effective_from)}`}
                    {v.note ? ` · ${v.note}` : ''}
                  </span>
                </div>
                <div className="flex gap-2">
                  {v.status === 'draft' && <button className="text-sm text-blue-600 hover:underline" disabled={busy} onClick={() => startFrom(v)}>Edit</button>}
                  {v.status === 'draft' && <button className="text-sm text-red-600 hover:underline" disabled={busy} onClick={() => deleteDraft(v)}><Trash2 className="inline h-4 w-4" /></button>}
                  {v.status !== 'draft' && <button className="text-sm text-blue-600 hover:underline" disabled={busy} onClick={() => startFrom(v)}><Copy className="inline h-4 w-4" /> New draft from this</button>}
                  {scheduled && <button className="text-sm text-red-600 hover:underline" disabled={busy} onClick={() => cancelVersion(v)}><XCircle className="inline h-4 w-4" /> Cancel</button>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {draft && (
        <section className="space-y-5 rounded-xl border border-amber-300 bg-white p-4">
          <h2 className="text-lg font-semibold">
            {editingVersion ? `Editing draft v${editingVersion.version}` : 'New draft'}
          </h2>
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="mb-2 font-medium text-gray-800">{s.title}</h3>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{s.fields.map(renderField)}</div>
              {s.title === 'Referral programme' && (
                <div className="mt-3">
                  <div className="mb-1 text-sm font-medium text-gray-700">Reward tiers (contiguous; last tier open-ended)</div>
                  {tiers.map((t, i) => (
                    <div key={i} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                      <span>₦</span>
                      <input type="number" className="w-28 rounded border px-2 py-1" value={t.min_ngn}
                        onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, min_ngn: Number(e.target.value) } : x)))} />
                      <span>to &lt; ₦</span>
                      <input type="number" className="w-28 rounded border px-2 py-1" value={t.max_ngn ?? ''} placeholder="no limit"
                        onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, max_ngn: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                      <span>→</span>
                      <input type="number" className="w-20 rounded border px-2 py-1" value={t.points}
                        onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} />
                      <span>points</span>
                      <button className="text-red-600" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button className="text-sm text-blue-600 hover:underline" onClick={() => setTiers([...tiers, { min_ngn: (tiers[tiers.length - 1]?.max_ngn ?? 0), max_ngn: null, points: 0 }])}>
                    <Plus className="inline h-4 w-4" /> Add tier
                  </button>
                </div>
              )}
            </div>
          ))}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Change note / reason (audited)</span>
              <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Effective from (blank = now)</span>
              <input type="datetime-local" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy} onClick={saveDraft}>
              <Save className="h-4 w-4" /> Save draft
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy || !editingId} onClick={publish}
              title={editingId ? '' : 'Save the draft first'}>
              <Rocket className="h-4 w-4" /> Publish
            </button>
            <button className="rounded-lg border px-4 py-2 text-sm" onClick={() => { setDraft(null); setEditingId(null); }}>Close</button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3 font-semibold">Audit history</header>
        <ul className="divide-y divide-gray-100 text-sm">
          {(data?.audit || []).map((a) => (
            <li key={a.id} className="px-4 py-2">
              <span className="font-medium">{a.action}</span> · {a.actor_email || 'unknown'} · {fmt(a.created_at)}
              {a.reason ? <span className="text-gray-500"> · {a.reason}</span> : null}
            </li>
          ))}
          {(data?.audit || []).length === 0 && <li className="px-4 py-3 text-gray-500">No changes yet.</li>}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
function Badge({ children }: { children: string }) {
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{children}</span>;
}

export default RewardsSettingsPage;

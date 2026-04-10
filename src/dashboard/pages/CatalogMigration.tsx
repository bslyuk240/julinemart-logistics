/**
 * Catalog Migration Runner
 *
 * Triggers the three-phase WooCommerce → Supabase catalog migration
 * with live progress feedback. Admin only.
 *
 * Route: /admin/catalog-migration
 */

import React, { useCallback, useRef, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

// ─── types ────────────────────────────────────────────────────────────────────

type Phase = 'taxonomy' | 'products' | 'variations';
type RunStatus = 'idle' | 'running' | 'done' | 'error';
type WooStatus = 'publish' | 'draft';

interface PhaseResult {
  phase: Phase;
  page?: number;
  processed?: number;
  categories?: number;
  tags?: number;
  attributes?: number;
  errors: string[];
  has_more?: boolean;
  total_pages?: number;
  success: boolean;
  message?: string;
}

interface Log {
  ts: string;
  level: 'info' | 'success' | 'error' | 'warn';
  text: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function now() {
  return new Date().toLocaleTimeString();
}

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return `Bearer ${data.session?.access_token || ''}`;
}

async function runPhase(phase: Phase, page: number, wooStatus: WooStatus = 'publish'): Promise<PhaseResult> {
  const auth = await getAuthHeader();
  const base = window.location.origin;
  const url = `${base}/.netlify/functions/woo-migrate-catalog?phase=${phase}&page=${page}&woo_status=${wooStatus}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
  return json as PhaseResult;
}

// Delay between pages to avoid hammering IONOS shared hosting
const INTER_PAGE_DELAY_MS = 1500;
// Longer delay between variation pages — each page makes 3 WC calls so the server
// needs more recovery time than the single-call product pages.
const VAR_INTER_PAGE_DELAY_MS = 5000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── component ────────────────────────────────────────────────────────────────

export default function CatalogMigration() {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [logs, setLogs] = useState<Log[]>([]);
  const [progress, setProgress] = useState({ phase: '' as Phase | '', page: 0, totalPages: 0, processed: 0 });
  // Tracks last successfully completed page per phase so Resume skips already-done work
  const [checkpoint, setCheckpoint] = useState({ taxDone: false, productPage: 0, varPage: 0 });
  const abortRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Draft migration state (products only — no taxonomy/variations needed)
  const [draftStatus, setDraftStatus] = useState<RunStatus>('idle');
  const [draftLogs, setDraftLogs] = useState<Log[]>([]);
  const [draftPage, setDraftPage] = useState(0);
  const draftAbortRef = useRef(false);
  const draftLogEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((level: Log['level'], text: string) => {
    setLogs((prev) => [...prev, { ts: now(), level, text }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const runMigration = useCallback(async (resume = false) => {
    abortRef.current = false;
    if (!resume) {
      setLogs([]);
      setCheckpoint({ taxDone: false, productPage: 0, varPage: 0 });
    }
    setStatus('running');
    setProgress({ phase: '', page: 0, totalPages: 0, processed: 0 });

    // Snapshot checkpoint at start so the closure is stable
    const from = resume ? checkpoint : { taxDone: false, productPage: 0, varPage: 0 };

    try {
      // ── Phase 1: Taxonomy ────────────────────────────────────────────────
      if (!from.taxDone) {
        addLog('info', '▶ Phase 1/3 — Syncing categories, tags, and attributes...');
        setProgress((p) => ({ ...p, phase: 'taxonomy' }));

        const taxResult = await runPhase('taxonomy', 1);
        if (!taxResult.success) throw new Error(taxResult.errors?.[0] || 'Taxonomy sync failed');

        addLog('success', `✓ Categories: ${taxResult.categories}  Tags: ${taxResult.tags}  Attributes: ${taxResult.attributes}`);
        if (taxResult.errors?.length) {
          taxResult.errors.forEach((e) => addLog('warn', `  ⚠ ${e}`));
        }
        setCheckpoint((c) => ({ ...c, taxDone: true }));
      } else {
        addLog('info', '↷ Phase 1/3 — Taxonomy already synced, skipping...');
      }

      if (abortRef.current) { addLog('warn', 'Aborted by user.'); setStatus('idle'); return; }

      // ── Phase 2: Products ────────────────────────────────────────────────
      const startProductPage = from.productPage + 1;
      if (from.productPage > 0) {
        addLog('info', `▶ Phase 2/3 — Resuming products from page ${startProductPage}...`);
      } else {
        addLog('info', '▶ Phase 2/3 — Syncing products...');
      }
      let productPage = startProductPage;
      let totalProductsProcessed = 0;

      while (true) {
        if (abortRef.current) { addLog('warn', 'Aborted by user.'); setStatus('idle'); return; }

        setProgress((p) => ({ ...p, phase: 'products', page: productPage }));
        addLog('info', `  Page ${productPage}...`);

        const result = await runPhase('products', productPage);
        if (!result.success) throw new Error(result.errors?.[0] || `Products page ${productPage} failed`);

        totalProductsProcessed += result.processed || 0;
        setProgress((p) => ({ ...p, processed: totalProductsProcessed }));
        addLog('success', `  ✓ Page ${productPage}: ${result.processed} products synced`);
        if (result.errors?.length) {
          result.errors.forEach((e) => addLog('warn', `    ⚠ ${e}`));
        }

        setCheckpoint((c) => ({ ...c, productPage }));
        if (!result.has_more) break;
        productPage++;
        await delay(INTER_PAGE_DELAY_MS);
      }

      addLog('success', `✓ Products complete — ${totalProductsProcessed} synced this run`);

      if (abortRef.current) { addLog('warn', 'Aborted by user.'); setStatus('idle'); return; }

      // ── Phase 3: Variations ──────────────────────────────────────────────
      const startVarPage = from.varPage + 1;
      if (from.varPage > 0) {
        addLog('info', `▶ Phase 3/3 — Resuming variations from page ${startVarPage}...`);
      } else {
        addLog('info', '▶ Phase 3/3 — Syncing product variations...');
      }
      let varPage = startVarPage;
      let totalVarProcessed = 0;
      let varTotalPages = 1;

      while (true) {
        if (abortRef.current) { addLog('warn', 'Aborted by user.'); setStatus('idle'); return; }

        setProgress((p) => ({ ...p, phase: 'variations', page: varPage, totalPages: varTotalPages }));
        addLog('info', `  Page ${varPage}${varTotalPages > 1 ? `/${varTotalPages}` : ''}...`);

        const result = await runPhase('variations', varPage);
        if (!result.success) throw new Error(result.errors?.[0] || `Variations page ${varPage} failed`);

        if (result.total_pages) varTotalPages = result.total_pages;
        totalVarProcessed += result.processed || 0;
        setProgress((p) => ({ ...p, processed: totalVarProcessed, totalPages: varTotalPages }));
        addLog('success', `  ✓ Page ${varPage}: ${result.processed} variable products processed`);
        if (result.errors?.length) {
          result.errors.forEach((e) => addLog('warn', `    ⚠ ${e}`));
        }

        setCheckpoint((c) => ({ ...c, varPage }));
        if (!result.has_more) break;
        varPage++;
        await delay(VAR_INTER_PAGE_DELAY_MS);
      }

      addLog('success', `✓ Variations complete — ${totalVarProcessed} variable products processed`);
      addLog('success', '🎉 Migration complete! Catalog is now live in Supabase.');
      setStatus('done');
    } catch (e: any) {
      addLog('error', `✗ ${e.message || String(e)}`);
      setStatus('error');
    }
  }, [addLog, checkpoint]);

  const abort = () => { abortRef.current = true; };
  const reset = () => {
    setStatus('idle');
    setLogs([]);
    setProgress({ phase: '', page: 0, totalPages: 0, processed: 0 });
    setCheckpoint({ taxDone: false, productPage: 0, varPage: 0 });
  };

  // ── Draft migration runner ────────────────────────────────────────────────────
  const addDraftLog = useCallback((level: Log['level'], text: string) => {
    setDraftLogs((prev) => [...prev, { ts: now(), level, text }]);
    setTimeout(() => draftLogEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const runDraftMigration = useCallback(async (resume = false) => {
    draftAbortRef.current = false;
    if (!resume) { setDraftLogs([]); setDraftPage(0); }
    setDraftStatus('running');
    const startPage = resume ? draftPage + 1 : 1;
    addDraftLog('info', `▶ Importing WooCommerce DRAFT products (starting page ${startPage})...`);
    addDraftLog('info', 'Drafts will appear in Supabase with status = "draft" — not visible to customers until published.');

    let page = startPage;
    let total = 0;
    try {
      while (true) {
        if (draftAbortRef.current) { addDraftLog('warn', 'Aborted.'); setDraftStatus('idle'); return; }
        addDraftLog('info', `  Page ${page}...`);
        const result = await runPhase('products', page, 'draft');
        if (!result.success) throw new Error(result.error || result.errors?.[0] || `Page ${page} failed`);
        total += result.processed || 0;
        setDraftPage(page);
        addDraftLog('success', `  ✓ Page ${page}: ${result.processed} draft products imported`);
        if (result.errors?.length) result.errors.forEach((e) => addDraftLog('warn', `    ⚠ ${e}`));
        if (!result.has_more) break;
        page++;
        await delay(INTER_PAGE_DELAY_MS);
      }
      addDraftLog('success', `🎉 Done — ${total} draft products imported. Review and publish from the Products page.`);
      setDraftStatus('done');
    } catch (e: any) {
      addDraftLog('error', `✗ ${e.message || String(e)}`);
      setDraftStatus('error');
    }
  }, [addDraftLog, draftPage]);

  const isRunning = status === 'running';
  const phaseLabel: Record<Phase | '', string> = {
    '': '',
    taxonomy: 'Syncing taxonomy',
    products: `Syncing products — page ${progress.page}`,
    variations: `Syncing variations — page ${progress.page}${progress.totalPages > 1 ? `/${progress.totalPages}` : ''}`,
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Catalog Migration</h1>
          <p style={styles.subtitle}>
            Syncs published products from WooCommerce into the Supabase catalog.
            Safe to re-run — all operations are upserts.
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Info card */}
      <div style={styles.infoCard}>
        <strong style={{ fontSize: 13 }}>What this does:</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
          <li><b>Taxonomy</b> — Syncs all 78 categories, 15 tags, and 2 attributes (Colour, Size) into Supabase</li>
          <li><b>Products</b> — Syncs all published products 20 at a time with images, categories, tags, vendor + hub assignments</li>
          <li><b>Variations</b> — Syncs all variations for variable products, with attributes and CJ sourcing metadata</li>
        </ol>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b7280' }}>
          WooCommerce stays running as fallback. Pages are processed with a 1.5s delay to protect the IONOS server.
        </p>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        {!isRunning && status !== 'done' && status !== 'error' && (
          <button onClick={() => runMigration(false)} style={styles.primaryBtn}>
            ▶ Start Migration
          </button>
        )}
        {!isRunning && status === 'error' && (
          <>
            <button onClick={() => runMigration(true)} style={styles.primaryBtn}>
              ↺ Resume Migration
            </button>
            <button onClick={() => runMigration(false)} style={styles.secondaryBtn}>
              Start Fresh
            </button>
          </>
        )}
        {isRunning && (
          <>
            <div style={styles.progressPill}>
              <span style={styles.spinner} />
              {phaseLabel[progress.phase]}
            </div>
            <button onClick={abort} style={styles.dangerBtn}>■ Stop</button>
          </>
        )}
        {status === 'done' && (
          <>
            <div style={{ ...styles.progressPill, background: '#d1fae5', color: '#065f46' }}>
              ✓ Migration complete
            </div>
            <button onClick={reset} style={styles.secondaryBtn}>Run Again</button>
          </>
        )}
        {(status === 'idle') && logs.length > 0 && (
          <button onClick={reset} style={styles.secondaryBtn}>Clear</button>
        )}
      </div>

      {/* Log window */}
      {logs.length > 0 && (
        <div style={styles.logWindow}>
          {logs.map((log, i) => (
            <div key={i} style={{ ...styles.logLine, color: logColor(log.level) }}>
              <span style={styles.logTs}>{log.ts}</span>
              <span>{log.text}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* ── Draft Products Section ─────────────────────────────────────── */}
      <div style={{ marginTop: 36 }}>
        <div style={styles.header}>
          <div>
            <h2 style={{ ...styles.title, fontSize: 18 }}>Import Draft Products (CJ)</h2>
            <p style={styles.subtitle}>
              Imports products currently set as <strong>draft</strong> in WooCommerce into Supabase.
              These are typically CJ-sourced products awaiting review. They land as <code>draft</code> in Supabase and are invisible to customers until you publish them.
            </p>
          </div>
          <StatusBadge status={draftStatus} />
        </div>

        <div style={styles.infoCard}>
          <strong style={{ fontSize: 13 }}>How it works:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
            <li>Pulls only <code>status=draft</code> products from WooCommerce</li>
            <li>Assigns vendor based on SKU prefix (e.g. CJ-sourced products get the correct vendor)</li>
            <li>Does <strong>not</strong> overwrite already-published products</li>
            <li>After import, review and publish each product from the Products page</li>
          </ul>
        </div>

        <div style={styles.controls}>
          {!draftStatus.includes('running') && draftStatus !== 'done' && (
            <button onClick={() => runDraftMigration(false)} style={styles.primaryBtn}>
              ▶ Import Drafts
            </button>
          )}
          {draftStatus === 'error' && (
            <button onClick={() => runDraftMigration(true)} style={{ ...styles.primaryBtn, background: '#d97706' }}>
              ↺ Resume
            </button>
          )}
          {draftStatus === 'running' && (
            <>
              <div style={styles.progressPill}>
                <span style={styles.spinner} />
                Importing draft products — page {draftPage}
              </div>
              <button onClick={() => { draftAbortRef.current = true; }} style={styles.dangerBtn}>■ Stop</button>
            </>
          )}
          {draftStatus === 'done' && (
            <>
              <div style={{ ...styles.progressPill, background: '#d1fae5', color: '#065f46' }}>✓ Import complete</div>
              <button onClick={() => { setDraftStatus('idle'); setDraftLogs([]); setDraftPage(0); }} style={styles.secondaryBtn}>Run Again</button>
            </>
          )}
        </div>

        {draftLogs.length > 0 && (
          <div style={styles.logWindow}>
            {draftLogs.map((log, i) => (
              <div key={i} style={{ ...styles.logLine, color: logColor(log.level) }}>
                <span style={styles.logTs}>{log.ts}</span>
                <span>{log.text}</span>
              </div>
            ))}
            <div ref={draftLogEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { label: string; bg: string; color: string }> = {
    idle: { label: 'Ready', bg: '#f3f4f6', color: '#6b7280' },
    running: { label: 'Running', bg: '#dbeafe', color: '#1d4ed8' },
    done: { label: 'Complete', bg: '#d1fae5', color: '#065f46' },
    error: { label: 'Error', bg: '#fee2e2', color: '#b91c1c' },
  };
  const { label, bg, color } = map[status];
  return (
    <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  );
}

function logColor(level: Log['level']) {
  if (level === 'success') return '#065f46';
  if (level === 'error') return '#b91c1c';
  if (level === 'warn') return '#92400e';
  return '#374151';
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 24, maxWidth: 800, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 4, maxWidth: 560 },

  infoCard: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 10,
    padding: '14px 18px',
    marginBottom: 20,
  },

  controls: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },

  progressPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: '#dbeafe',
    color: '#1d4ed8',
    borderRadius: 20,
    fontSize: 14,
    fontWeight: 500,
  },
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid #93c5fd',
    borderTopColor: '#1d4ed8',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    display: 'inline-block',
  },

  primaryBtn: {
    padding: '10px 22px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '9px 18px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  dangerBtn: {
    padding: '9px 16px',
    background: '#fee2e2',
    color: '#b91c1c',
    border: '1px solid #fca5a5',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },

  logWindow: {
    background: '#111827',
    borderRadius: 10,
    padding: '16px 18px',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 1.8,
    maxHeight: 480,
    overflowY: 'auto',
    border: '1px solid #1f2937',
  },
  logLine: { display: 'flex', gap: 12 },
  logTs: { color: '#6b7280', flexShrink: 0 },
};

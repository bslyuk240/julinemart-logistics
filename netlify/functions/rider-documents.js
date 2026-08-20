/**
 * GET /.netlify/functions/rider-documents
 * A rider's own document lifecycle — status, expiry, rejection reason —
 * for the rider-app Documents screen (docs/rider-app-ux-rebuild.md #17).
 * Display only; no enforcement of expired/rejected documents anywhere.
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  const { data, error } = await adminClient
    .from('rider_documents')
    .select('id, type, file_url, issue_date, expiry_date, status, verified_at, rejection_reason, created_at')
    .eq('rider_id', rider.id)
    .order('created_at', { ascending: false });

  if (error) return jsonResponse(500, { success: false, error: 'Failed to load documents' });

  // "Current" document per type is just the most recent submission —
  // history stays available (older rows) but the screen only needs the
  // latest one per type front and center.
  const current = new Map();
  for (const row of data || []) {
    if (!current.has(row.type)) current.set(row.type, row);
  }

  return jsonResponse(200, {
    success: true,
    data: {
      current: Array.from(current.values()),
      history: data || [],
    },
  });
}

/**
 * Admin document library — upload, list, and delete business documents
 * (partner packs, policies, SOPs) stored in the `admin-documents` bucket
 * with metadata in the `documents` table.
 *
 * GET    /api/admin-documents?category=            list, newest first
 * POST   /api/admin-documents                       upload + create
 *   Body: { title, description?, category?, file_name, content_type, file_base64 }
 * DELETE /api/admin-documents?id=<uuid>              remove file + row (admin only)
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

const BUCKET = 'admin-documents';
const MAX_BYTES = 15 * 1024 * 1024;

function sanitizeFileName(name) {
  return String(name || 'document')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(-120) || 'document';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod === 'GET') {
    const auth = await requireAdmin(event, ['admin', 'manager']);
    if (auth.errorResponse) return auth.errorResponse;
    const { adminClient } = auth;

    const category = event.queryStringParameters?.category || null;
    let query = adminClient.from('documents').select('*').order('created_at', { ascending: false });
    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data: data || [] });
  }

  if (event.httpMethod === 'POST') {
    const auth = await requireAdmin(event, ['admin', 'manager']);
    if (auth.errorResponse) return auth.errorResponse;
    const { adminClient, authUser, profile } = auth;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const { title, description, category, file_name, content_type, file_base64 } = body;
    if (!title || !String(title).trim()) {
      return jsonResponse(400, { success: false, error: 'title is required' });
    }
    if (!file_base64 || !file_name) {
      return jsonResponse(400, { success: false, error: 'file_name and file_base64 are required' });
    }

    let buffer;
    try {
      buffer = Buffer.from(String(file_base64), 'base64');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid base64 payload' });
    }
    if (buffer.length < 16) {
      return jsonResponse(400, { success: false, error: 'File is too small or empty' });
    }
    if (buffer.length > MAX_BYTES) {
      return jsonResponse(400, { success: false, error: 'File must be 15 MB or smaller' });
    }

    const safeName = sanitizeFileName(file_name);
    const cat = (category && String(category).trim()) || 'general';
    const path = `${cat}/${Date.now()}_${safeName}`;

    const { data: uploaded, error: uploadError } = await adminClient.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: content_type || 'application/octet-stream', upsert: false });
    if (uploadError) {
      console.error('admin-documents upload error:', uploadError);
      return jsonResponse(500, { success: false, error: uploadError.message || 'Upload failed' });
    }

    const { data: pub } = adminClient.storage.from(BUCKET).getPublicUrl(uploaded.path);

    const { data: row, error: insertError } = await adminClient
      .from('documents')
      .insert({
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        category: cat,
        file_name: safeName,
        file_path: uploaded.path,
        file_url: pub.publicUrl,
        file_size: buffer.length,
        content_type: content_type || null,
        uploaded_by: authUser.id,
        uploaded_by_name: profile.email || null,
      })
      .select('*')
      .single();

    if (insertError) {
      // Best-effort cleanup so a failed insert doesn't leave an orphaned file.
      await adminClient.storage.from(BUCKET).remove([uploaded.path]).catch(() => {});
      return jsonResponse(500, { success: false, error: insertError.message });
    }

    return jsonResponse(201, { success: true, data: row });
  }

  if (event.httpMethod === 'DELETE') {
    const auth = await requireAdmin(event, ['admin']);
    if (auth.errorResponse) return auth.errorResponse;
    const { adminClient } = auth;

    const id = event.queryStringParameters?.id;
    if (!id) return jsonResponse(400, { success: false, error: 'id is required' });

    const { data: doc, error: fetchError } = await adminClient
      .from('documents')
      .select('file_path')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) return jsonResponse(500, { success: false, error: fetchError.message });
    if (!doc) return jsonResponse(404, { success: false, error: 'Document not found' });

    if (doc.file_path) {
      await adminClient.storage.from(BUCKET).remove([doc.file_path]).catch(() => {});
    }

    const { error: deleteError } = await adminClient.from('documents').delete().eq('id', id);
    if (deleteError) return jsonResponse(500, { success: false, error: deleteError.message });

    return jsonResponse(200, { success: true });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}

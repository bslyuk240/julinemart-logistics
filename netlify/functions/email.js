// Netlify Function: /api/email/*
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Email function misconfigured: missing Supabase env');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Server not configured' })
      };
    }

    // Determine sub-route: /api/email/(config|templates/...)
    const parts = event.path.split('/');
    const idx = parts.findIndex((p) => p === 'email');
    const next = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined; // 'config' | 'templates'
    const id = idx >= 0 && parts.length > idx + 2 ? parts[idx + 2] : undefined; // template id
    const tail = idx >= 0 && parts.length > idx + 3 ? parts[idx + 3] : undefined; // e.g., 'preview'

    // /api/email/config
    if (next === 'config') {
      if (event.httpMethod === 'GET') {
        const { data, error } = await supabase.from('email_config').select('*').single();
        if (error && error.code !== 'PGRST116') {
          throw error;
        }
        const config = data || {
          provider: 'gmail',
          gmail_user: '',
          gmail_password: '',
          sendgrid_api_key: '',
          smtp_host: '',
          smtp_port: 587,
          smtp_user: '',
          smtp_password: '',
          email_from: '',
          email_enabled: false,
          portal_url: 'http://localhost:3002'
        };
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: config }) };
      }

      if (event.httpMethod === 'POST') {
        const payload = JSON.parse(event.body || '{}');
        const { data: existing } = await supabase.from('email_config').select('id').single();
        let result;
        if (existing) {
          result = await supabase
            .from('email_config')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select()
            .single();
        } else {
          result = await supabase.from('email_config').insert({ ...payload }).select().single();
        }
        if (result.error) throw result.error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: result.data }) };
      }

      return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
    }

    // /api/email/templates
    if (next === 'templates') {
      if (event.httpMethod === 'GET' && !id) {
        const { data, error } = await supabase.from('email_templates').select('*').order('name');
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
      }

      if (event.httpMethod === 'GET' && id) {
        const { data, error } = await supabase.from('email_templates').select('*').eq('id', id).single();
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
      }

      if (event.httpMethod === 'PUT' && id) {
        const { subject, html_content, text_content } = JSON.parse(event.body || '{}');
        const { data, error } = await supabase
          .from('email_templates')
          .update({ subject, html_content, text_content, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data, message: 'Template updated successfully' }) };
      }

      if (event.httpMethod === 'POST' && id && tail === 'preview') {
        const sampleData = JSON.parse(event.body || '{}');
        const { data: template, error } = await supabase.from('email_templates').select('*').eq('id', id).single();
        if (error) throw error;
        let html = template.html_content;
        let subject = template.subject;
        Object.keys(sampleData).forEach((key) => {
          const regex = new RegExp(`{{${key}}}`, 'g');
          html = html.replace(regex, sampleData[key]);
          subject = subject.replace(regex, sampleData[key]);
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { subject, html } }) };
      }

      return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Not Found' }) };
  } catch (e) {
    console.error('Email function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Email API error' }) };
  }
}


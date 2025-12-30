// Netlify Function: /api/email/*
import nodemailer from 'nodemailer';
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

const EMAIL_CONFIG = {
  gmail: {
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  },
  sendgrid: {
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY
    }
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  }
};

const renderTemplateString = (template, data) => {
  let output = template || '';
  Object.keys(data || {}).forEach((key) => {
    const value = data[key];
    const replacement = value === null || value === undefined ? '' : String(value);
    output = output.replace(new RegExp(`{{${key}}}`, 'g'), replacement);
  });
  return output;
};

const buildTransportConfigFromDb = (config) => {
  switch (config.provider) {
    case 'gmail':
      return {
        service: 'gmail',
        auth: {
          user: config.gmail_user || undefined,
          pass: config.gmail_password || undefined
        }
      };
    case 'sendgrid':
      return {
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: config.sendgrid_api_key || undefined
        }
      };
    case 'smtp':
      return {
        host: config.smtp_host || undefined,
        port: config.smtp_port || 587,
        secure: config.smtp_port === 465,
        auth: {
          user: config.smtp_user || undefined,
          pass: config.smtp_password || undefined
        }
      };
    default:
      return EMAIL_CONFIG.gmail;
  }
};

const buildTransportConfigFromEnv = () => {
  const provider = process.env.EMAIL_PROVIDER || 'gmail';
  return EMAIL_CONFIG[provider] || EMAIL_CONFIG.gmail;
};

const getRuntimeEmailConfig = async () => {
  const { data, error } = await supabase.from('email_config').select('*').single();
  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  const config = data || null;
  const transportConfig = config ? buildTransportConfigFromDb(config) : buildTransportConfigFromEnv();
  const from =
    (config && (config.email_from || config.gmail_user || config.smtp_user)) ||
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    '';
  return { transportConfig, from };
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

    // /api/email/test
    if (next === 'test') {
      if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
      }

      const payload = JSON.parse(event.body || '{}');
      const recipient = payload.to || payload.email;
      if (!recipient) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing recipient email' }) };
      }

      const { transportConfig, from } = await getRuntimeEmailConfig();
      if (!from) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Sender not configured' }) };
      }

      let subject;
      let html;
      let text;

      if (payload.template_id) {
        const { data: template, error } = await supabase
          .from('email_templates')
          .select('*')
          .eq('id', payload.template_id)
          .single();
        if (error || !template) {
          return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Template not found' }) };
        }
        const sampleData = payload.sample_data || {};
        subject = renderTemplateString(template.subject, sampleData);
        html = renderTemplateString(template.html_content, sampleData);
        text = renderTemplateString(template.text_content, sampleData);
      } else {
        subject = 'JulineMart Email System Test';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
              <h1>Email System Working! ✅</h1>
            </div>
            <div style="padding: 30px;">
              <p>This is a test email from the JulineMart Logistics Orchestrator.</p>
              <p>If you received this, your email configuration is working correctly!</p>
            </div>
          </div>
        `;
        text = 'JulineMart Email System Test - If you received this, your email is working!';
      }

      const transporter = nodemailer.createTransport(transportConfig);
      await transporter.sendMail({
        from,
        to: recipient,
        subject,
        html,
        text
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
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

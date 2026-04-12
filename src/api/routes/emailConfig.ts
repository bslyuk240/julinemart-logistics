import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { AuthRequest } from '../middleware/auth.js';
import nodemailer from 'nodemailer';
import {
  decryptEmailConfigSecrets,
  encryptEmailConfigSecretsForStorage,
  getSmtpDecryptFailureMessage,
  pickEmailConfigForDatabase,
  sanitizeEmailConfigForClient,
} from '../../../shared/emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from '../../../shared/smtpTransport.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Get email configuration
export async function getEmailConfigHandler(req: AuthRequest, res: Response) {
  try {
    // .limit(1).maybeSingle() avoids 500s when 0 rows (PGRST116) or duplicate rows (.single() fails)
    const { data, error } = await supabase
      .from('email_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    // Return config or defaults
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
      portal_url: 'http://localhost:3002',
    };

    const safe = sanitizeEmailConfigForClient(config as Record<string, unknown>);

    return res.status(200).json({
      success: true,
      data: safe,
    });
  } catch (error) {
    console.error('Get email config error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch email configuration';
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch email configuration',
      detail: message,
    });
  }
}

// Save email configuration
export async function saveEmailConfigHandler(req: AuthRequest, res: Response) {
  try {
    const incoming = req.body as Record<string, unknown>;

    const { data: existingRow } = await supabase
      .from('email_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    const secretFields = ['gmail_password', 'sendgrid_api_key', 'smtp_password'] as const;
    const merged: Record<string, unknown> = { ...incoming };
    for (const field of secretFields) {
      const v = merged[field];
      const empty = v == null || String(v).trim() === '';
      if (empty && existingRow?.[field]) {
        merged[field] = (existingRow as Record<string, unknown>)[field];
      }
    }

    const toStore = encryptEmailConfigSecretsForStorage(merged);
    const row = pickEmailConfigForDatabase(toStore);

    let result;
    if (existingRow?.id) {
      result = await supabase
        .from('email_config')
        .update({
          ...row,
          updated_at: new Date().toISOString(),
          updated_by: req.user!.id,
        })
        .eq('id', existingRow.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('email_config')
        .insert({
          ...row,
          created_by: req.user!.id,
          updated_by: req.user!.id,
        })
        .select()
        .single();
    }

    if (result.error) throw result.error;

    // Log activity
    await supabase.from('activity_logs').insert({
      user_id: req.user!.id,
      action: 'update_email_config',
      entity_type: 'email_config',
      entity_id: result.data.id,
      details: { provider: incoming.provider },
    });

    const safe = sanitizeEmailConfigForClient(result.data as Record<string, unknown>);

    return res.status(200).json({
      success: true,
      data: safe,
      message: 'Email configuration saved successfully',
    });
  } catch (error) {
    console.error('Save email config error:', error);
    const message = error instanceof Error ? error.message : 'Failed to save email configuration';
    return res.status(500).json({
      success: false,
      error: 'Failed to save email configuration',
      detail: message,
    });
  }
}

// Test email connection
export async function testEmailConnectionHandler(req: AuthRequest, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;

    const { data: existingRow } = await supabase
      .from('email_config')
      .select('*')
      .limit(1)
      .maybeSingle();
    const secretFields = ['gmail_password', 'sendgrid_api_key', 'smtp_password'] as const;
    const merged: Record<string, unknown> = { ...body };
    for (const field of secretFields) {
      const v = merged[field];
      const empty = v == null || String(v).trim() === '';
      if (empty && existingRow?.[field as keyof typeof existingRow]) {
        merged[field] = existingRow[field as keyof typeof existingRow];
      }
    }
    const config = decryptEmailConfigSecrets(merged) as {
      provider: string;
      gmail_user?: string;
      gmail_password?: string;
      sendgrid_api_key?: string;
      smtp_host?: string;
      smtp_port?: number;
      smtp_user?: string;
      smtp_password?: string;
    };

    const decryptErr = getSmtpDecryptFailureMessage(merged, config as Record<string, unknown>);
    if (decryptErr) {
      return res.status(400).json({
        success: false,
        error: decryptErr,
        code: 'SMTP_DECRYPT_FAILED',
      });
    }

    if (config.provider === 'smtp') {
      const u = normalizeSmtpAuthUser(config.smtp_user);
      const p = normalizeSmtpAuthPass(config.smtp_password);
      if (!u || !p) {
        return res.status(400).json({
          success: false,
          error:
            'SMTP username or password is missing after loading settings. Enter the mailbox password and save, then test again.',
          code: 'SMTP_AUTH_INCOMPLETE',
        });
      }
    }

    let transportConfig: any;

    switch (config.provider) {
      case 'gmail':
        transportConfig = {
          service: 'gmail',
          auth: {
            user: config.gmail_user,
            pass: config.gmail_password,
          },
        };
        break;

      case 'sendgrid':
        transportConfig = {
          host: 'smtp.sendgrid.net',
          port: 587,
          auth: {
            user: 'apikey',
            pass: config.sendgrid_api_key,
          },
        };
        break;

      case 'smtp':
        transportConfig = buildCustomSmtpTransportOptions(config as Record<string, unknown>);
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid email provider',
        });
    }

    // Create transporter and verify
    const transporter = nodemailer.createTransport(transportConfig);
    await transporter.verify();

    return res.status(200).json({
      success: true,
      message: 'Email connection successful',
    });
  } catch (error) {
    console.error('Test connection error:', error);
    const msg = error instanceof Error ? error.message : 'Connection failed';
    let hint: string | undefined;
    if (/535|Invalid login|Authentication credentials invalid|auth/i.test(msg)) {
      hint =
        'The server rejected the username or password. For IONOS: confirm the mailbox password in the control panel, use the full email as SMTP username, try port 465 with SSL, and re-enter the SMTP password in the form if it was changed.';
    }
    return res.status(500).json({
      success: false,
      error: msg,
      ...(hint ? { hint } : {}),
    });
  }
}

// Get all email templates
export async function getEmailTemplatesHandler(req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('name');

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('Get templates error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch email templates',
    });
  }
}

// Get single email template
export async function getEmailTemplateHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get template error:', error);
    return res.status(404).json({
      success: false,
      error: 'Template not found',
    });
  }
}

// Update email template
export async function updateEmailTemplateHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { subject, html_content, text_content } = req.body;

    const { data, error } = await supabase
      .from('email_templates')
      .update({
        subject,
        html_content,
        text_content,
        updated_at: new Date().toISOString(),
        updated_by: req.user!.id,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Log activity
    await supabase.from('activity_logs').insert({
      user_id: req.user!.id,
      action: 'update_email_template',
      entity_type: 'email_template',
      entity_id: id,
      details: { name: data.name },
    });

    return res.status(200).json({
      success: true,
      data,
      message: 'Template updated successfully',
    });
  } catch (error) {
    console.error('Update template error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update template',
    });
  }
}

// Preview email template
export async function previewEmailTemplateHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const sampleData = req.body;

    const { data: template, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Replace variables in template
    let html = template.html_content;
    let subject = template.subject;

    // Replace {{variable}} with sample data
    Object.keys(sampleData).forEach((key) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      html = html.replace(regex, sampleData[key]);
      subject = subject.replace(regex, sampleData[key]);
    });

    return res.status(200).json({
      success: true,
      data: {
        subject,
        html,
      },
    });
  } catch (error) {
    console.error('Preview template error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to preview template',
    });
  }
}

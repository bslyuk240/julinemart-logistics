import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { AuthRequest } from '../middleware/auth.js';
import nodemailer from 'nodemailer';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Get email configuration
export async function getEmailConfigHandler(req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('email_config')
      .select('*')
      .single();

    if (error && error.code !== 'PGRST116') { // Not found is OK
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

    return res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Get email config error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch email configuration',
    });
  }
}

// Save email configuration
export async function saveEmailConfigHandler(req: AuthRequest, res: Response) {
  try {
    const config = req.body;

    // Check if config exists
    const { data: existing } = await supabase
      .from('email_config')
      .select('id')
      .single();

    let result;
    if (existing) {
      // Update existing
      result = await supabase
        .from('email_config')
        .update({
          ...config,
          updated_at: new Date().toISOString(),
          updated_by: req.user!.id,
        })
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      // Insert new
      result = await supabase
        .from('email_config')
        .insert({
          ...config,
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
      details: { provider: config.provider },
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      message: 'Email configuration saved successfully',
    });
  } catch (error) {
    console.error('Save email config error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save email configuration',
    });
  }
}

// Test email connection
export async function testEmailConnectionHandler(req: AuthRequest, res: Response) {
  try {
    const config = req.body;

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
        transportConfig = {
          host: config.smtp_host,
          port: config.smtp_port,
          secure: config.smtp_port === 465,
          auth: {
            user: config.smtp_user,
            pass: config.smtp_password,
          },
        };
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
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
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

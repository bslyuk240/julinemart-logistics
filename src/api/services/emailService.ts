import nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { emailTemplates } from './emailTemplates.js';
import { createClient } from '@supabase/supabase-js';
import { decryptEmailConfigSecrets } from '../../../shared/emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from '../../../shared/smtpTransport.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

type DbEmailConfig = {
  provider: 'gmail' | 'sendgrid' | 'smtp';
  gmail_user: string | null;
  gmail_password: string | null;
  sendgrid_api_key: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password: string | null;
  email_from: string | null;
  email_enabled: boolean | null;
  portal_url: string | null;
};

type RuntimeEmailConfig = {
  enabled: boolean;
  from: string;
  portalUrl: string;
  transportConfig: SMTPTransport.Options;
  transportKey: string;
};

const CONFIG_CACHE_TTL_MS = 60_000;
let cachedRuntimeConfig: { value: RuntimeEmailConfig; fetchedAt: number } | null = null;

// Email configuration
const EMAIL_CONFIG = {
  // Option 1: Gmail (for testing)
  gmail: {
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // your-email@gmail.com
      pass: process.env.EMAIL_PASSWORD, // App-specific password
    },
  },
  
  // Option 2: SendGrid (recommended for production)
  sendgrid: {
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY,
    },
  },
  
  // Option 3: Custom SMTP
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  },
};

function getEnvEmailConfig(): SMTPTransport.Options {
  const provider = process.env.EMAIL_PROVIDER || 'gmail';
  return EMAIL_CONFIG[provider as keyof typeof EMAIL_CONFIG] || EMAIL_CONFIG.gmail;
}

async function loadDbEmailConfig(): Promise<DbEmailConfig | null> {
  try {
    const { data, error } = await supabase
      .from('email_config')
      .select('*')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('Failed to load email config:', error);
      return null;
    }

    return decryptEmailConfigSecrets(data as Record<string, unknown>) as DbEmailConfig;
  } catch (error) {
    console.error('Failed to load email config:', error);
    return null;
  }
}

function buildTransportConfigFromDb(config: DbEmailConfig): SMTPTransport.Options {
  switch (config.provider) {
    case 'gmail':
      return {
        service: 'gmail',
        auth: {
          user: config.gmail_user || undefined,
          pass: config.gmail_password || undefined,
        },
      };
    case 'sendgrid':
      return {
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: config.sendgrid_api_key || undefined,
        },
      };
    case 'smtp':
      return buildCustomSmtpTransportOptions(config as Record<string, unknown>);
    default:
      return getEnvEmailConfig();
  }
}

function buildRuntimeConfigFromDb(config: DbEmailConfig): RuntimeEmailConfig {
  const transportConfig = buildTransportConfigFromDb(config);
  const from =
    config.email_from ||
    config.gmail_user ||
    config.smtp_user ||
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    '';
  const portalUrl =
    config.portal_url || process.env.CUSTOMER_PORTAL_URL || 'http://localhost:3002';
  const enabled = config.email_enabled ?? true;
  const transportKey = JSON.stringify({ provider: config.provider, transportConfig });
  return { enabled, from, portalUrl, transportConfig, transportKey };
}

function buildRuntimeConfigFromEnv(): RuntimeEmailConfig {
  const transportConfig = getEnvEmailConfig();
  const provider = process.env.EMAIL_PROVIDER || 'gmail';
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
  const portalUrl = process.env.CUSTOMER_PORTAL_URL || 'http://localhost:3002';
  const enabled = process.env.EMAIL_ENABLED ? process.env.EMAIL_ENABLED === 'true' : true;
  const transportKey = JSON.stringify({ provider, transportConfig });
  return { enabled, from, portalUrl, transportConfig, transportKey };
}

async function getRuntimeEmailConfig(): Promise<RuntimeEmailConfig> {
  const now = Date.now();
  if (cachedRuntimeConfig && now - cachedRuntimeConfig.fetchedAt < CONFIG_CACHE_TTL_MS) {
    return cachedRuntimeConfig.value;
  }

  const dbConfig = await loadDbEmailConfig();
  const runtime = dbConfig ? buildRuntimeConfigFromDb(dbConfig) : buildRuntimeConfigFromEnv();
  cachedRuntimeConfig = { value: runtime, fetchedAt: now };
  return runtime;
}

function renderTemplateString(
  template: string,
  data: Record<string, string | number | null | undefined>
) {
  let output = template;
  Object.keys(data).forEach((key) => {
    const value = data[key];
    const replacement = value === null || value === undefined ? '' : String(value);
    output = output.replace(new RegExp(`{{${key}}}`, 'g'), replacement);
  });
  return output;
}

async function getEmailTemplateByType(
  type: string,
  data: Record<string, string | number | null | undefined>
) {
  try {
    const { data: template, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('type', type)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('Failed to load email template:', error);
      return null;
    }

    return {
      subject: renderTemplateString(template.subject, data),
      html: renderTemplateString(template.html_content, data),
      text: renderTemplateString(template.text_content, data),
    };
  } catch (error) {
    console.error('Failed to load email template:', error);
    return null;
  }
}

async function getEmailTemplateById(
  id: string,
  data: Record<string, string | number | null | undefined>
) {
  try {
    const { data: template, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('Failed to load email template:', error);
      return null;
    }

    return {
      subject: renderTemplateString(template.subject, data),
      html: renderTemplateString(template.html_content, data),
      text: renderTemplateString(template.text_content, data),
    };
  } catch (error) {
    console.error('Failed to load email template:', error);
    return null;
  }
}

// Create reusable transporter
let transporter: nodemailer.Transporter | null = null;
let transporterKey: string | null = null;

const getTransporter = (config: SMTPTransport.Options, key: string) => {
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport(config);
    transporterKey = key;
  }
  return transporter;
};

// Email sending interface
interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  allowDisabled?: boolean;
}

// Log email to database
async function logEmail(
  orderId: string,
  recipient: string,
  subject: string,
  status: 'sent' | 'failed',
  error?: string
) {
  try {
    await supabase.from('email_logs').insert({
      order_id: orderId,
      recipient,
      subject,
      status,
      error_message: error || null,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to log email:', err);
  }
}

// Send email function
export async function sendEmail(options: SendEmailOptions, orderId?: string): Promise<boolean> {
  try {
    const runtime = await getRuntimeEmailConfig();
    if (!runtime.enabled && !options.allowDisabled) {
      return false;
    }

    if (!runtime.from) {
      console.error('Email sender address not configured');
      return false;
    }

    const transport = getTransporter(runtime.transportConfig, runtime.transportKey);
    
    const mailOptions = {
      from: runtime.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    };

    await transport.sendMail(mailOptions);
    
    if (orderId) {
      await logEmail(orderId, options.to, options.subject, 'sent');
    }
    
    console.log(`✅ Email sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    
    if (orderId) {
      await logEmail(
        orderId,
        options.to,
        options.subject,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
    
    return false;
  }
}

// Helper function to get order data for emails
async function getOrderEmailData(orderId: string, portalUrl: string) {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      *,
      email_notifications_enabled,
      sub_orders (
        id,
        tracking_number,
        status,
        hubs (name, city),
        couriers (name, code)
      )
    `)
    .eq('id', orderId)
    .single();

  if (error || !order) {
    throw new Error('Order not found');
  }

  // Find earliest estimated delivery
  const estimatedDelivery = order.sub_orders
    ?.map((so: any) => so.estimated_delivery_date)
    .filter(Boolean)
    .sort()[0];

  const portalBase = (portalUrl || 'http://localhost:3002').replace(/\/$/, '');
  const trackingUrl = `${portalBase}?order=${order.woocommerce_order_id}&email=${encodeURIComponent(order.customer_email)}`;
  const trackingNumber =
    order.sub_orders?.find((so: any) => so.tracking_number)?.tracking_number || '';

  return {
    orderNumber: order.woocommerce_order_id,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    emailNotificationsEnabled: order.email_notifications_enabled !== false,
    orderDate: new Date(order.created_at).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    deliveryAddress: order.delivery_address,
    deliveryCity: order.delivery_city,
    deliveryState: order.delivery_state,
    totalAmount: order.total_amount,
    shippingFee: order.shipping_fee_paid,
    trackingUrl,
    trackingNumber,
    estimatedDelivery: estimatedDelivery
      ? new Date(estimatedDelivery).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })
      : undefined,
    subOrders: order.sub_orders?.map((so: any) => ({
      trackingNumber: so.tracking_number,
      hubName: so.hubs?.name,
      courierName: so.couriers?.name,
      status: so.status,
    })),
  };
}

// Email notification functions for each order status

export async function sendOrderConfirmationEmail(orderId: string): Promise<boolean> {
  try {
    const runtime = await getRuntimeEmailConfig();
    const data = await getOrderEmailData(orderId, runtime.portalUrl);
    if (!data.customerEmail || !data.emailNotificationsEnabled) return false;

    const templateData = {
      orderNumber: data.orderNumber,
      customerName: data.customerName,
      orderDate: data.orderDate,
      totalAmount: data.totalAmount,
      trackingUrl: data.trackingUrl,
    };
    const template =
      (await getEmailTemplateByType('order_confirmation', templateData)) ||
      emailTemplates.orderConfirmation(data);
    
    return await sendEmail(
      {
        to: data.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
      orderId
    );
  } catch (error) {
    console.error('Failed to send order confirmation:', error);
    return false;
  }
}

export async function sendOrderProcessingEmail(orderId: string): Promise<boolean> {
  try {
    const runtime = await getRuntimeEmailConfig();
    const data = await getOrderEmailData(orderId, runtime.portalUrl);
    if (!data.customerEmail || !data.emailNotificationsEnabled) return false;

    const templateData = {
      orderNumber: data.orderNumber,
      customerName: data.customerName,
      orderDate: data.orderDate,
      totalAmount: data.totalAmount,
      trackingUrl: data.trackingUrl,
    };
    const template =
      (await getEmailTemplateByType('order_processing', templateData)) ||
      emailTemplates.orderProcessing(data);
    
    return await sendEmail(
      {
        to: data.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
      orderId
    );
  } catch (error) {
    console.error('Failed to send processing email:', error);
    return false;
  }
}

export async function sendOrderShippedEmail(orderId: string): Promise<boolean> {
  try {
    const runtime = await getRuntimeEmailConfig();
    const data = await getOrderEmailData(orderId, runtime.portalUrl);
    if (!data.customerEmail || !data.emailNotificationsEnabled) return false;

    const templateData = {
      orderNumber: data.orderNumber,
      customerName: data.customerName,
      trackingNumber: data.trackingNumber,
      trackingUrl: data.trackingUrl,
    };
    const template =
      (await getEmailTemplateByType('order_shipped', templateData)) ||
      emailTemplates.orderShipped(data);
    
    return await sendEmail(
      {
        to: data.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
      orderId
    );
  } catch (error) {
    console.error('Failed to send shipped email:', error);
    return false;
  }
}

export async function sendOutForDeliveryEmail(orderId: string): Promise<boolean> {
  try {
    const runtime = await getRuntimeEmailConfig();
    const data = await getOrderEmailData(orderId, runtime.portalUrl);
    if (!data.customerEmail || !data.emailNotificationsEnabled) return false;

    const templateData = {
      orderNumber: data.orderNumber,
      customerName: data.customerName,
      trackingNumber: data.trackingNumber,
      trackingUrl: data.trackingUrl,
      estimatedDelivery: data.estimatedDelivery,
    };
    const template =
      (await getEmailTemplateByType('out_for_delivery', templateData)) ||
      emailTemplates.outForDelivery(data);
    
    return await sendEmail(
      {
        to: data.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
      orderId
    );
  } catch (error) {
    console.error('Failed to send out for delivery email:', error);
    return false;
  }
}

export async function sendOrderDeliveredEmail(orderId: string): Promise<boolean> {
  try {
    const runtime = await getRuntimeEmailConfig();
    const data = await getOrderEmailData(orderId, runtime.portalUrl);
    if (!data.customerEmail || !data.emailNotificationsEnabled) return false;

    const templateData = {
      orderNumber: data.orderNumber,
      customerName: data.customerName,
      trackingUrl: data.trackingUrl,
    };
    const template =
      (await getEmailTemplateByType('order_delivered', templateData)) ||
      emailTemplates.orderDelivered(data);
    
    return await sendEmail(
      {
        to: data.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
      orderId
    );
  } catch (error) {
    console.error('Failed to send delivered email:', error);
    return false;
  }
}

export async function sendOrderCancelledEmail(
  orderId: string,
  cancellationReason?: string
): Promise<boolean> {
  try {
    const runtime = await getRuntimeEmailConfig();
    const data = await getOrderEmailData(orderId, runtime.portalUrl);
    if (!data.customerEmail || !data.emailNotificationsEnabled) return false;

    const templateData = {
      orderNumber: data.orderNumber,
      customerName: data.customerName,
      trackingUrl: data.trackingUrl,
      cancellationReason: cancellationReason || '',
    };
    const template =
      (await getEmailTemplateByType('order_cancelled', templateData)) ||
      emailTemplates.orderCancelled({
      ...data,
      cancellationReason,
    });
    
    return await sendEmail(
      {
        to: data.customerEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
      orderId
    );
  } catch (error) {
    console.error('Failed to send cancelled email:', error);
    return false;
  }
}

// Test email function
export async function sendTestEmail(to: string): Promise<boolean> {
  const testTemplate = {
    subject: 'JulineMart Email System Test',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
          <h1>Email System Working! ✅</h1>
        </div>
        <div style="padding: 30px;">
          <p>This is a test email from the JulineMart Logistics Orchestrator.</p>
          <p>If you received this, your email configuration is working correctly!</p>
          <p><strong>Email Provider:</strong> ${process.env.EMAIL_PROVIDER || 'Gmail'}</p>
          <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
        </div>
      </div>
    `,
    text: 'JulineMart Email System Test - If you received this, your email is working!',
  };

  return await sendEmail({
    to,
    subject: testTemplate.subject,
    html: testTemplate.html,
    text: testTemplate.text,
    allowDisabled: true,
  });
}

export async function sendTestEmailWithTemplate(
  to: string,
  templateId: string,
  sampleData: Record<string, string | number | null | undefined>
): Promise<boolean> {
  const template = await getEmailTemplateById(templateId, sampleData);
  if (!template) {
    return false;
  }

  return await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    allowDisabled: true,
  });
}

type InfluencerReportOptions = {
  influencerId: string;
  period?: string;
  startDate?: string;
  endDate?: string;
};

function getPeriodRange(options: InfluencerReportOptions) {
  const now = new Date();
  const period = options.period || 'last_7_days';
  let start: Date | null = null;
  let end: Date | null = null;
  let label = '';

  if (options.startDate || options.endDate) {
    start = options.startDate ? new Date(options.startDate) : null;
    end = options.endDate ? new Date(options.endDate) : null;
    label = 'Custom range';
    return { start, end, label };
  }

  switch (period) {
    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      label = 'This month';
      break;
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      label = 'Last month';
      break;
    case 'last_30_days':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      label = 'Last 30 days';
      break;
    case 'all_time':
      label = 'All time';
      break;
    case 'last_7_days':
    default:
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      label = 'Last 7 days';
      break;
  }

  return { start, end, label };
}

function formatAmount(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function buildInfluencerReportTemplate(data: Record<string, string | number>) {
  const subject = `Your sales update - ${data.periodLabel}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0f172a; color: #ffffff; padding: 24px; text-align: center;">
        <h1 style="margin: 0;">Influencer Sales Update</h1>
      </div>
      <div style="padding: 24px; background: #ffffff;">
        <p>Hi ${data.influencerName},</p>
        <p>Here is your sales and commission summary for <strong>${data.periodLabel}</strong>.</p>
        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Orders:</strong> ${data.ordersCount}</p>
          <p><strong>Total Sales:</strong> NGN ${data.totalSales}</p>
          <p><strong>Total Commission:</strong> NGN ${data.totalCommission}</p>
          <p><strong>Pending Commission:</strong> NGN ${data.pendingCommission}</p>
          <p><strong>Paid Commission:</strong> NGN ${data.paidCommission}</p>
        </div>
        <p>Generated on ${data.generatedAt}.</p>
      </div>
    </div>
  `;
  const text = `Influencer Sales Update

Hi ${data.influencerName},

Period: ${data.periodLabel}
Orders: ${data.ordersCount}
Total Sales: NGN ${data.totalSales}
Total Commission: NGN ${data.totalCommission}
Pending Commission: NGN ${data.pendingCommission}
Paid Commission: NGN ${data.paidCommission}

Generated on ${data.generatedAt}.`;

  return { subject, html, text };
}

export async function sendInfluencerReportEmail(
  options: InfluencerReportOptions
): Promise<{ success: boolean; message?: string }> {
  try {
    const { influencerId } = options;
    const { data: influencer, error } = await supabase
      .from('influencers')
      .select('*')
      .eq('id', influencerId)
      .single();

    if (error || !influencer) {
      return { success: false, message: 'Influencer not found' };
    }

    if (!influencer.email) {
      return { success: false, message: 'Influencer has no email' };
    }

    const { start, end, label } = getPeriodRange(options);

    let query = supabase
      .from('influencer_sales')
      .select(
        'product_total, influencer_commission_amount, commission_status, sale_date'
      )
      .eq('influencer_id', influencerId);

    if (start) query = query.gte('sale_date', start.toISOString());
    if (end) query = query.lte('sale_date', end.toISOString());

    const { data: sales, error: salesError } = await query;

    if (salesError) {
      return { success: false, message: 'Failed to load sales' };
    }

    const totals = (sales || []).reduce(
      (acc, sale) => {
        const saleTotal = Number(sale.product_total || 0);
        const commissionTotal = Number(sale.influencer_commission_amount || 0);
        acc.ordersCount += 1;
        acc.totalSales += saleTotal;
        acc.totalCommission += commissionTotal;
        if (sale.commission_status === 'paid') {
          acc.paidCommission += commissionTotal;
        } else {
          acc.pendingCommission += commissionTotal;
        }
        return acc;
      },
      {
        ordersCount: 0,
        totalSales: 0,
        totalCommission: 0,
        pendingCommission: 0,
        paidCommission: 0,
      }
    );

    const templateData = {
      influencerName: influencer.name || 'Influencer',
      periodLabel: label,
      ordersCount: totals.ordersCount,
      totalSales: formatAmount(totals.totalSales),
      totalCommission: formatAmount(totals.totalCommission),
      pendingCommission: formatAmount(totals.pendingCommission),
      paidCommission: formatAmount(totals.paidCommission),
      generatedAt: new Date().toLocaleString('en-US'),
    };

    const template =
      (await getEmailTemplateByType('influencer_report', templateData)) ||
      buildInfluencerReportTemplate(templateData);

    const ok = await sendEmail({
      to: influencer.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    return { success: ok };
  } catch (error) {
    console.error('Failed to send influencer report:', error);
    return { success: false, message: 'Failed to send report' };
  }
}

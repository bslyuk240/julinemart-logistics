import nodemailer from 'nodemailer';
import { emailTemplates } from './emailTemplates.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

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

// Choose email provider based on environment
const getEmailConfig = () => {
  const provider = process.env.EMAIL_PROVIDER || 'gmail';
  return EMAIL_CONFIG[provider as keyof typeof EMAIL_CONFIG] || EMAIL_CONFIG.gmail;
};

// Create reusable transporter
let transporter: nodemailer.Transporter | null = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport(getEmailConfig());
  }
  return transporter;
};

// Email sending interface
interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
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
    const transport = getTransporter();
    
    const mailOptions = {
      from: `"JulineMart" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
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
async function getOrderEmailData(orderId: string) {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      *,
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

  const trackingUrl = `${process.env.CUSTOMER_PORTAL_URL || 'http://localhost:3002'}?order=${order.woocommerce_order_id}&email=${encodeURIComponent(order.customer_email)}`;

  return {
    orderNumber: order.woocommerce_order_id,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
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
    const data = await getOrderEmailData(orderId);
    const template = emailTemplates.orderConfirmation(data);
    
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
    const data = await getOrderEmailData(orderId);
    const template = emailTemplates.orderProcessing(data);
    
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
    const data = await getOrderEmailData(orderId);
    const template = emailTemplates.orderShipped(data);
    
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
    const data = await getOrderEmailData(orderId);
    const template = emailTemplates.outForDelivery(data);
    
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
    const data = await getOrderEmailData(orderId);
    const template = emailTemplates.orderDelivered(data);
    
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
    const data = await getOrderEmailData(orderId);
    const template = emailTemplates.orderCancelled({
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
  });
}

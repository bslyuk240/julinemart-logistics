 --Email Configuration Table
CREATE TABLE IF NOT EXISTS email_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gmail', 'sendgrid', 'smtp')),
  gmail_user text,
  gmail_password text, -- Encrypted in production
  sendgrid_api_key text, -- Encrypted in production
  smtp_host text,
  smtp_port integer DEFAULT 587,
  smtp_user text,
  smtp_password text, -- Encrypted in production
  email_from text NOT NULL,
  email_enabled boolean DEFAULT true,
  portal_url text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);

-- Email Templates Table
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL UNIQUE CHECK (type IN (
    'order_confirmation',
    'order_processing', 
    'order_shipped',
    'out_for_delivery',
    'order_delivered',
    'order_cancelled'
  )),
  subject text NOT NULL,
  html_content text NOT NULL,
  text_content text NOT NULL,
  variables jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);

-- Insert default email templates
INSERT INTO email_templates (name, type, subject, html_content, text_content, variables) VALUES
(
  'Order Confirmation',
  'order_confirmation',
  'Order Confirmed - #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
    .order-info { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Order Confirmed!</h1>
      <p>Thank you for your order, {{customerName}}</p>
    </div>
    <div class="content">
      <p>We''ve received your order and are getting it ready for shipment.</p>
      <div class="order-info">
        <h2>Order Details</h2>
        <p><strong>Order Number:</strong> #{{orderNumber}}</p>
        <p><strong>Order Date:</strong> {{orderDate}}</p>
        <p><strong>Total Amount:</strong> ₦{{totalAmount}}</p>
      </div>
      <div style="text-align: center;">
        <a href="{{trackingUrl}}" class="button">Track Your Order</a>
      </div>
    </div>
  </div>
</body>
</html>',
  'Order Confirmed!

Thank you for your order, {{customerName}}!

Order Number: #{{orderNumber}}
Order Date: {{orderDate}}
Total Amount: ₦{{totalAmount}}

Track your order: {{trackingUrl}}',
  '["orderNumber", "customerName", "orderDate", "totalAmount", "trackingUrl"]'::jsonb
),
(
  'Order Shipped',
  'order_shipped',
  'Order Shipped! Track #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
    .tracking { font-family: monospace; font-size: 18px; background: #f8f9fa; padding: 12px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚚 Order Shipped!</h1>
      <p>Your package is on the way</p>
    </div>
    <div class="content">
      <p>Hi {{customerName}},</p>
      <p>Great news! Your order #{{orderNumber}} has been shipped.</p>
      <div style="margin: 20px 0;">
        <p><strong>Tracking Number:</strong></p>
        <div class="tracking">{{trackingNumber}}</div>
      </div>
      <div style="text-align: center; margin-top: 30px;">
        <a href="{{trackingUrl}}" class="button">Track Live Updates</a>
      </div>
    </div>
  </div>
</body>
</html>',
  'Order Shipped!

Hi {{customerName}},

Your order #{{orderNumber}} has been shipped!

Tracking Number: {{trackingNumber}}

Track your order: {{trackingUrl}}',
  '["orderNumber", "customerName", "trackingNumber", "trackingUrl"]'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_templates_type ON email_templates(type);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);

-- Comments
COMMENT ON TABLE email_config IS 'Stores email provider configuration';
COMMENT ON TABLE email_templates IS 'Customizable email templates with variable support';

SELECT 'Email configuration tables created successfully!' as status;

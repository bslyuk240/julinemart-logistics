 --Insert all 6 email templates

-- 1. Order Confirmation
INSERT INTO email_templates (name, type, subject, html_content, text_content, variables) VALUES
(
  'Order Confirmation',
  'order_confirmation',
  'Order Confirmed - #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #667eea; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
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
      <p>We have received your order and are getting it ready for shipment.</p>
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
)
ON CONFLICT (type) DO UPDATE SET
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  updated_at = now();

-- 2. Order Processing
INSERT INTO email_templates (name, type, subject, html_content, text_content, variables) VALUES
(
  'Order Processing',
  'order_processing',
  'Order Processing - #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #667eea; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📦 Order Being Prepared</h1>
      <p>Your order is being packed</p>
    </div>
    <div class="content">
      <p>Hi {{customerName}},</p>
      <p>Great news! We are currently packing your order and getting it ready for shipment.</p>
      <p><strong>Order #{{orderNumber}}</strong></p>
      <div style="text-align: center; margin-top: 30px;">
        <a href="{{trackingUrl}}" class="button">Track Your Order</a>
      </div>
    </div>
  </div>
</body>
</html>',
  'Order Being Prepared

Hi {{customerName}},

Your order #{{orderNumber}} is being packed and will ship soon!

Track your order: {{trackingUrl}}',
  '["orderNumber", "customerName", "trackingUrl"]'::jsonb
)
ON CONFLICT (type) DO UPDATE SET
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  updated_at = now();

-- 3. Order Shipped
INSERT INTO email_templates (name, type, subject, html_content, text_content, variables) VALUES
(
  'Order Shipped',
  'order_shipped',
  'Order Shipped! Track #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #667eea; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
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
)
ON CONFLICT (type) DO UPDATE SET
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  updated_at = now();

-- 4. Out for Delivery
INSERT INTO email_templates (name, type, subject, html_content, text_content, variables) VALUES
(
  'Out for Delivery',
  'out_for_delivery',
  '🎯 Out for Delivery Today - Order #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #f5576c; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 Out for Delivery!</h1>
      <p>Your package will arrive today</p>
    </div>
    <div class="content">
      <p><strong>Hi {{customerName}},</strong></p>
      <p>Your order #{{orderNumber}} is out for delivery and should arrive today!</p>
      <p>Please ensure someone is available to receive it.</p>
      <div style="text-align: center; margin-top: 30px;">
        <a href="{{trackingUrl}}" class="button">Track Live Location</a>
      </div>
    </div>
  </div>
</body>
</html>',
  'Out for Delivery!

Hi {{customerName}},

Your order #{{orderNumber}} is out for delivery and will arrive TODAY!

Please ensure someone is home to receive it.

Track: {{trackingUrl}}',
  '["orderNumber", "customerName", "trackingUrl"]'::jsonb
)
ON CONFLICT (type) DO UPDATE SET
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  updated_at = now();

-- 5. Order Delivered
INSERT INTO email_templates (name, type, subject, html_content, text_content, variables) VALUES
(
  'Order Delivered',
  'order_delivered',
  '✅ Delivered! Order #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #38ef7d; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Delivered Successfully!</h1>
      <p>Your order has been delivered</p>
    </div>
    <div class="content">
      <p><strong>Congratulations, {{customerName}}!</strong></p>
      <p>Your order #{{orderNumber}} has been successfully delivered. We hope you love your purchase!</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="{{trackingUrl}}" class="button">View Order Details</a>
      </div>
      <p style="text-align: center; color: #667eea;">Thank you for shopping with JulineMart!</p>
    </div>
  </div>
</body>
</html>',
  'Order Delivered Successfully!

Hi {{customerName}},

Your order #{{orderNumber}} has been delivered!

We hope you love your purchase!

Thank you for shopping with JulineMart!',
  '["orderNumber", "customerName", "trackingUrl"]'::jsonb
)
ON CONFLICT (type) DO UPDATE SET
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  updated_at = now();

-- 6. Order Cancelled
INSERT INTO email_templates (name, type, subject, html_content, text_content, variables) VALUES
(
  'Order Cancelled',
  'order_cancelled',
  'Order Cancelled - #{{orderNumber}}',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #f43b47 0%, #fc6767 100%); color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .button { display: inline-block; background: #667eea; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Order Cancelled</h1>
      <p>Your order has been cancelled</p>
    </div>
    <div class="content">
      <p>Hi {{customerName}},</p>
      <p>Your order #{{orderNumber}} has been cancelled as requested.</p>
      <p><strong>Order Amount:</strong> ₦{{totalAmount}}</p>
      <p>If you made payment, your refund will be processed within 5-7 business days.</p>
      <div style="text-align: center; margin-top: 30px;">
        <a href="https://julinemart.com" class="button">Continue Shopping</a>
      </div>
    </div>
  </div>
</body>
</html>',
  'Order Cancelled

Hi {{customerName}},

Your order #{{orderNumber}} has been cancelled.

Order Amount: ₦{{totalAmount}}

If you made payment, refunds will be processed in 5-7 business days.',
  '["orderNumber", "customerName", "totalAmount"]'::jsonb
)
ON CONFLICT (type) DO UPDATE SET
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  updated_at = now();

-- Verify all templates were inserted
SELECT name, type FROM email_templates ORDER BY name;

SELECT 'All 6 email templates inserted successfully!' as status;

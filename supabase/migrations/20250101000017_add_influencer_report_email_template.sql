-- Extend email template types to include influencer reports
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_templates_type_check'
  ) THEN
    ALTER TABLE email_templates DROP CONSTRAINT email_templates_type_check;
  END IF;
END $$;

ALTER TABLE email_templates
ADD CONSTRAINT email_templates_type_check CHECK (type IN (
  'order_confirmation',
  'order_processing',
  'order_shipped',
  'out_for_delivery',
  'order_delivered',
  'order_cancelled',
  'influencer_report'
));

INSERT INTO email_templates (name, type, subject, html_content, text_content, variables)
VALUES (
  'Influencer Report',
  'influencer_report',
  'Your sales update - {{periodLabel}}',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #0f172a; color: #ffffff; padding: 24px; text-align: center; }
    .content { padding: 24px; }
    .summary { background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Influencer Sales Update</h1>
    </div>
    <div class="content">
      <p>Hi {{influencerName}},</p>
      <p>Here is your sales and commission summary for <strong>{{periodLabel}}</strong>.</p>
      <div class="summary">
        <p><strong>Orders:</strong> {{ordersCount}}</p>
        <p><strong>Total Sales:</strong> NGN {{totalSales}}</p>
        <p><strong>Total Commission:</strong> NGN {{totalCommission}}</p>
        <p><strong>Pending Commission:</strong> NGN {{pendingCommission}}</p>
        <p><strong>Paid Commission:</strong> NGN {{paidCommission}}</p>
      </div>
      <p>Generated on {{generatedAt}}.</p>
    </div>
  </div>
</body>
</html>',
  'Influencer Sales Update

Hi {{influencerName}},

Period: {{periodLabel}}
Orders: {{ordersCount}}
Total Sales: NGN {{totalSales}}
Total Commission: NGN {{totalCommission}}
Pending Commission: NGN {{pendingCommission}}
Paid Commission: NGN {{paidCommission}}

Generated on {{generatedAt}}.',
  '["influencerName", "periodLabel", "ordersCount", "totalSales", "totalCommission", "pendingCommission", "paidCommission", "generatedAt"]'::jsonb
)
ON CONFLICT (type) DO NOTHING;

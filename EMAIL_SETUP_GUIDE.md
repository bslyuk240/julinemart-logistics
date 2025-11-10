# 📧 Gmail Setup Guide for Email Notifications

## Quick Setup (5 minutes)

### Step 1: Enable 2-Factor Authentication
1. Go to: https://myaccount.google.com/security
2. Find "2-Step Verification"
3. Click "Get Started" and follow instructions

### Step 2: Generate App Password
1. Go to: https://myaccount.google.com/apppasswords
2. Select "Mail" as the app
3. Select "Other" as the device, name it "JulineMart Logistics"
4. Click "Generate"
5. Copy the 16-character password (e.g., `abcd efgh ijkl mnop`)

### Step 3: Configure Environment Variables
Add to your `.env` file:
```env
EMAIL_PROVIDER=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=abcd efgh ijkl mnop
EMAIL_FROM=JulineMart <your-email@gmail.com>
EMAIL_ENABLED=true
CUSTOMER_PORTAL_URL=http://localhost:3002
```

### Step 4: Test Email Configuration
```bash
# Start your API server
npm run api:dev

# In another terminal, test email:
curl -X POST http://localhost:3001/api/emails/test \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@gmail.com"}'
```

You should receive a test email within seconds!

---

## Production Setup (SendGrid - Recommended)

### Why SendGrid?
- ✅ Reliable delivery
- ✅ Better inbox placement
- ✅ Analytics & tracking
- ✅ Higher sending limits
- ✅ Professional sender reputation

### Setup Steps

1. **Sign up for SendGrid**
   - Visit: https://signup.sendgrid.com
   - Free tier: 100 emails/day

2. **Verify Your Domain**
   - Go to Settings → Sender Authentication
   - Follow domain verification steps
   - This improves email deliverability

3. **Create API Key**
   - Go to Settings → API Keys
   - Click "Create API Key"
   - Name: "JulineMart Production"
   - Permissions: "Full Access" (or "Mail Send")
   - Copy the API key (shown only once!)

4. **Update Environment Variables**
```env
   EMAIL_PROVIDER=sendgrid
   SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
   EMAIL_FROM=JulineMart <noreply@yourdomain.com>
   EMAIL_ENABLED=true
   CUSTOMER_PORTAL_URL=https://track.julinemart.com
```

5. **Test SendGrid**
```bash
   curl -X POST https://your-api.com/api/emails/test \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com"}'
```

---

## Troubleshooting

### Gmail: "Username and Password not accepted"
**Solution:** Make sure you're using an App Password, not your regular Gmail password.

### Gmail: "Less secure app access"
**Solution:** Use App Passwords with 2FA instead of enabling "less secure apps".

### Emails going to spam
**Solutions:**
1. Use SendGrid with verified domain
2. Add SPF/DKIM records to your domain
3. Avoid spam trigger words in subject lines
4. Include unsubscribe link

### SendGrid: "Invalid API Key"
**Solution:** 
1. Verify API key is copied correctly (no extra spaces)
2. Check API key has "Mail Send" permission
3. Generate new API key if needed

### Emails not sending at all
**Debugging:**
1. Check API server logs for errors
2. Verify EMAIL_ENABLED=true in .env
3. Test with curl command above
4. Check email_logs table in database

---

## Email Sending Limits

### Gmail
- **Free:** 500 emails/day
- **Google Workspace:** 2,000 emails/day
- Best for: Testing, small operations

### SendGrid
- **Free:** 100 emails/day
- **Essentials ($15/mo):** 50,000 emails/month
- **Pro ($90/mo):** 1,500,000 emails/month
- Best for: Production use

---

## Email Templates Preview

You can preview email templates by:

1. Creating a test order
2. Manually triggering emails from Order Details page
3. Checking your inbox

Or use this HTML preview tool:
https://htmledit.squarefree.com/

Paste the HTML from `src/api/services/emailTemplates.ts`

---

## Best Practices

### 1. Sender Name
Use: `JulineMart <noreply@julinemart.com>`
Not: `noreply@julinemart.com`

### 2. Subject Lines
✅ Good: "Order Shipped! Track #12345"
❌ Bad: "!!!ORDER SHIPPED!!! CLICK HERE NOW!!!"

### 3. Unsubscribe Link
Required for bulk emails. Add to footer:
```html
<a href="https://julinemart.com/unsubscribe">Unsubscribe</a>
```

### 4. Test Before Production
1. Send to yourself
2. Check spam folder
3. Test on mobile devices
4. Verify all links work

### 5. Monitor Delivery
- Check email_logs table regularly
- Track bounce rates
- Monitor spam complaints

---

## Custom SMTP Configuration

If using another email provider:
```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_username
SMTP_PASSWORD=your_password
EMAIL_FROM=JulineMart <noreply@yourdomain.com>
```

Common SMTP providers:
- **Mailgun:** smtp.mailgun.org:587
- **Amazon SES:** email-smtp.us-east-1.amazonaws.com:587
- **Postmark:** smtp.postmarkapp.com:587
- **Sendinblue:** smtp-relay.sendinblue.com:587

---

## Monitoring & Analytics

### Database Monitoring
```sql
-- Check recent emails
SELECT * FROM email_logs 
ORDER BY sent_at DESC 
LIMIT 50;

-- Check failure rate
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM email_logs
GROUP BY status;

-- Check emails by order
SELECT 
  o.woocommerce_order_id,
  e.subject,
  e.status,
  e.sent_at
FROM email_logs e
JOIN orders o ON o.id = e.order_id
ORDER BY e.sent_at DESC;
```

### SendGrid Analytics
- Go to SendGrid Dashboard → Statistics
- View open rates, click rates, bounces
- Set up webhook for real-time events

---

## FAQ

**Q: Can I use a free email service?**
A: Gmail free works for testing. Use SendGrid/paid service for production.

**Q: How do I customize email templates?**
A: Edit `src/api/services/emailTemplates.ts`

**Q: Can customers unsubscribe from emails?**
A: Yes, add unsubscribe functionality (coming in future update)

**Q: Are emails sent immediately?**
A: Yes, emails are sent synchronously when order status changes.

**Q: Can I schedule emails?**
A: Not yet, but you can implement with node-cron.

**Q: What if email sending fails?**
A: It's logged in email_logs table and doesn't block order updates.

---

## Support

**Gmail Issues:**
- https://support.google.com/mail/answer/185833

**SendGrid Issues:**
- https://docs.sendgrid.com/
- support@sendgrid.com

**System Issues:**
- Check email_logs table
- Review API server logs
- Email: support@julinemart.com

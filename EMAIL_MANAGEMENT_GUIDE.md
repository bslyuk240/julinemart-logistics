# 📧 Email Management System - Complete Guide

## Overview

The Email Management System provides a **visual interface** for configuring email providers and customizing email templates without touching code. Perfect for non-technical staff to manage email communications.

---

## Features

### 1. Visual Email Configuration
- ✅ Switch between Gmail, SendGrid, or custom SMTP
- ✅ Test connection before saving
- ✅ Secure credential storage
- ✅ Enable/disable email notifications

### 2. Template Editor
- ✅ Edit email templates visually
- ✅ Live preview with sample data
- ✅ Variable substitution system
- ✅ HTML and plain text versions
- ✅ Click to copy variables

### 3. Testing Tools
- ✅ Send test emails
- ✅ Connection verification
- ✅ Setup checklist
- ✅ Preview before sending

---

## Accessing Email Settings

### Navigation Path
```
Dashboard → Email Settings
```

**Direct URL:** `http://localhost:3000/dashboard/email-settings`

**Required Role:** Admin only

---

## Configuration Tab

### Step 1: Choose Email Provider

**Gmail (Best for Testing)**
- Free tier: 500 emails/day
- Easy setup with app password
- Good for development/small businesses

**SendGrid (Best for Production)**
- Free tier: 100 emails/day
- Professional deliverability
- Analytics included
- Recommended for live systems

**Custom SMTP**
- Use any SMTP provider
- Full control
- For advanced users

### Step 2: Enter Credentials

#### Gmail Setup
1. Select "Gmail" provider
2. Enter your Gmail address
3. Generate App Password:
   - Go to https://myaccount.google.com/apppasswords
   - Create new app password
   - Copy 16-character code
4. Paste app password
5. Click "Test Connection"

#### SendGrid Setup
1. Select "SendGrid" provider
2. Sign up at https://signup.sendgrid.com
3. Go to Settings → API Keys
4. Create new API key
5. Copy API key (starts with SG.)
6. Paste in Email Settings
7. Click "Test Connection"

#### SMTP Setup
1. Select "SMTP" provider
2. Enter SMTP host (e.g., smtp.mailgun.org)
3. Enter port (usually 587)
4. Enter username
5. Enter password
6. Click "Test Connection"

### Step 3: Configure General Settings

**From Email Address**
```
Format: Display Name <email@domain.com>
Example: JulineMart <noreply@julinemart.com>
```

**Customer Portal URL**
- Development: `http://localhost:3002`
- Production: `https://track.julinemart.com`
- Used for tracking links in emails

**Enable Email Notifications**
- Toggle ON to send emails automatically
- Toggle OFF to disable all emails

### Step 4: Save & Test

1. Click "Save Configuration"
2. Click "Test Connection" to verify
3. Check for green success banner
4. If error, review credentials

---

## Email Templates Tab

### Available Templates

1. **Order Confirmation** - Sent when order is created
2. **Order Processing** - Sent when order is being prepared
3. **Order Shipped** - Sent when order ships with tracking
4. **Out for Delivery** - Sent when package is out for delivery
5. **Order Delivered** - Sent when delivery is completed
6. **Order Cancelled** - Sent when order is cancelled

### Editing Templates

#### 1. Select Template
Click on any template from the list on the left

#### 2. Edit Mode
**Subject Line:**
- Edit the email subject
- Use `{{variables}}` for dynamic content
- Example: `Order #{{orderNumber}} has been shipped!`

**HTML Template:**
- Full HTML email design
- Use variables like `{{customerName}}`
- Professional styling included
- Mobile-responsive

**Plain Text Version:**
- Fallback for text-only email clients
- Should match HTML content
- No HTML tags

#### 3. Available Variables
Each template has specific variables you can use:

**Common Variables:**
- `{{orderNumber}}` - Order ID
- `{{customerName}}` - Customer's name
- `{{customerEmail}}` - Customer's email
- `{{orderDate}}` - When order was placed
- `{{totalAmount}}` - Order total
- `{{shippingFee}}` - Shipping cost
- `{{trackingUrl}}` - Link to tracking page

**Shipping-specific:**
- `{{trackingNumber}}` - Courier tracking number
- `{{courierName}}` - Delivery company name
- `{{estimatedDelivery}}` - Expected delivery date

**How to Use Variables:**
1. Click any variable card to copy
2. Paste into subject or content: `{{variableName}}`
3. System replaces with actual data when sending

#### 4. Preview Template

1. Click "Preview" tab
2. Edit sample data if needed
3. Click "Update Preview"
4. See exactly how email will look
5. Check both desktop and mobile views

#### 5. Save Changes

1. Make your edits
2. Click "Save" button
3. Confirmation appears
4. Template is live immediately

### Template Customization Examples

**Change Subject Line:**
```
Before: Order Confirmed - #{{orderNumber}}
After: 🎉 Your JulineMart Order #{{orderNumber}} is Confirmed!
```

**Add Company Branding:**
```html
<div class="header">
  <img src="https://yourdomain.com/logo.png" alt="Logo" />
  <h1>Order Shipped!</h1>
</div>
```

**Customize Button Color:**
```html
<a href="{{trackingUrl}}" style="background-color: #FF6B6B;">
  Track Your Order
</a>
```

---

## Test & Verify Tab

### Send Test Email

1. Go to "Test & Verify" tab
2. Enter your email address
3. Click "Send Test Email"
4. Check your inbox (and spam folder)
5. Verify email looks correct

### Setup Checklist

Four items must be checked:
1. ✅ Email provider selected
2. ✅ From address configured
3. ✅ Connection tested successfully
4. ✅ Email notifications enabled

All green = ready to go!

---

## How Emails Are Sent

### Automatic Emails

Emails are sent automatically when order status changes:
```
Order Created → Order Confirmation email
↓
Status: processing → Order Processing email
↓
Status: in_transit → Order Shipped email
↓
Status: out_for_delivery → Out for Delivery email
↓
Status: delivered → Order Delivered email
```

### Manual Resend

From any order details page:
1. Scroll to "Email Notifications" section
2. See all sent emails
3. Click "Resend" for failed emails
4. Or use manual trigger buttons

---

## Troubleshooting

### "Connection Failed"

**Gmail:**
- Make sure you're using App Password, not regular password
- Check 2FA is enabled
- Verify email address is correct

**SendGrid:**
- Verify API key is copied correctly (no extra spaces)
- Check API key has "Mail Send" permission
- Try generating a new API key

**SMTP:**
- Verify host and port are correct
- Check username/password
- Try different port (587, 465, 25)

### "Emails Going to Spam"

**Solutions:**
1. Use SendGrid with verified domain
2. Add SPF/DKIM records to your domain
3. Avoid spam trigger words (FREE, URGENT, etc.)
4. Include unsubscribe link
5. Warm up your sending domain slowly

### "Template Not Saving"

**Check:**
1. You're logged in as Admin
2. Browser console for errors
3. API server is running
4. Database connection is working

### "Variables Not Replacing"

**Common Issues:**
- Typo in variable name: `{{orderNumer}}` ❌ `{{orderNumber}}` ✅
- Missing curly braces: `{orderNumber}` ❌ `{{orderNumber}}` ✅
- Extra spaces: `{{ orderNumber }}` ❌ `{{orderNumber}}` ✅

---

## Best Practices

### 1. Template Design

**Do:**
- Use professional, clean design
- Include company branding
- Make buttons prominent
- Test on mobile devices
- Keep text concise

**Don't:**
- Use all caps (LOOKS LIKE SPAM)
- Include too many images (slow load)
- Use red text excessively
- Make emails too long
- Forget plain text version

### 2. Subject Lines

**Good Examples:**
- ✅ "Order #12345 Confirmed - Track Your Package"
- ✅ "🚚 Your Order is On The Way!"
- ✅ "Delivered! Thank You for Shopping With Us"

**Bad Examples:**
- ❌ "!!!ORDER CONFIRMED!!! CLICK NOW!!!"
- ❌ "re: your order"
- ❌ "Message from JulineMart"

### 3. Email Frequency

Don't overwhelm customers:
- Confirmation: Immediate ✅
- Processing: After 1-2 hours ✅
- Shipped: When actually shipped ✅
- Updates: Only when status changes ✅
- Marketing: Separate list (not in order flow) ✅

### 4. Testing Before Production

**Always test:**
1. Send to yourself first
2. Check on desktop and mobile
3. Click all links to verify
4. Check spam folder
5. Ask colleague to review

---

## Advanced: Custom Variables

To add new variables to templates:

1. **Update Template in Database:**
```sql
UPDATE email_templates 
SET variables = variables || '["newVariable"]'::jsonb
WHERE type = 'order_confirmation';
```

2. **Update Email Service:**
Edit `src/api/services/emailService.ts`
Add new variable to `getOrderEmailData()` function

3. **Update Template:**
Use new variable: `{{newVariable}}`

---

## Security Notes

### Credential Storage

- Passwords are stored in database
- In production, use encryption
- Never commit credentials to Git
- Rotate passwords regularly

### Access Control

- Only Admins can access Email Settings
- Changes are logged in Activity Logs
- Templates can't be deleted (only edited)

### Email Limits

**Gmail Free:**
- 500 emails/day
- Risk of account lockout if exceeded

**SendGrid Free:**
- 100 emails/day
- Soft limit (can temporarily exceed)

**Paid Plans:**
- Much higher limits
- Better deliverability
- Professional support

---

## Monitoring Email Delivery

### Check Email Logs

**From Order Details:**
1. Open any order
2. Scroll to "Email Notifications"
3. See all emails sent for that order
4. Check status (sent/failed)
5. View error messages

**From Database:**
```sql
-- Check recent emails
SELECT * FROM email_logs 
ORDER BY sent_at DESC 
LIMIT 50;

-- Check failure rate
SELECT 
  status,
  COUNT(*) as count
FROM email_logs
GROUP BY status;
```

### SendGrid Analytics

If using SendGrid:
1. Go to SendGrid Dashboard
2. Click "Statistics"
3. View open rates, click rates
4. Track bounces and spam reports
5. Set up webhook for real-time events

---

## Migration to Production

### Before Going Live

1. **Switch to SendGrid**
   - Sign up for paid plan
   - Verify your domain
   - Update Email Settings

2. **Update Portal URL**
   - Change from localhost to your domain
   - Update in Email Settings

3. **Test Thoroughly**
   - Send test emails
   - Check all templates
   - Verify all links work

4. **Monitor Delivery**
   - Watch email logs
   - Check bounce rates
   - Adjust as needed

### Domain Verification (SendGrid)

1. Go to SendGrid → Settings → Sender Authentication
2. Click "Verify Your Domain"
3. Add DNS records to your domain:
   - CNAME record for sending
   - TXT record for verification
4. Wait 24-48 hours for propagation
5. Return to SendGrid to complete verification

**Benefits:**
- Much better deliverability
- Fewer emails marked as spam
- Professional sender reputation
- Higher inbox placement rate

---

## FAQ

**Q: Can I use a free email service?**
A: Gmail works for testing. Use SendGrid/paid service for production.

**Q: How do I customize the email design?**
A: Go to Email Settings → Templates → Select template → Edit HTML

**Q: Can customers unsubscribe?**
A: Order transactional emails can't be unsubscribed (legally required), but you can add marketing email preferences.

**Q: What if I break a template?**
A: Contact support - we can restore from backup or provide default template.

**Q: Can I A/B test subject lines?**
A: Not currently, but can be added as a feature.

**Q: How do I add my logo to emails?**
A: Edit template HTML, add: `<img src="https://yoursite.com/logo.png" />`

**Q: Emails delayed - why?**
A: Check email provider status. Gmail/SendGrid sometimes have delays.

**Q: Can I schedule emails?**
A: Currently sends immediately on status change. Scheduling can be added.

---

## Support

**Email Configuration Issues:**
- Check Email Settings → Test & Verify tab
- Review setup checklist
- Test connection

**Template Issues:**
- Preview before saving
- Check variable syntax
- Test with sample data

**Delivery Issues:**
- Check email logs
- Verify provider credentials
- Check spam folder

**Need Help?**
- Email: support@julinemart.com
- Phone: +234 800 000 0000

---

**Last Updated:** January 2025

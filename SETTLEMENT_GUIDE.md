# 💰 Courier Settlement & Payout System Guide

## Overview

The Courier Settlement System tracks what you **OWE** to courier partners vs what customers **PAID** you. It helps you manage courier payouts efficiently and maintain accurate financial records.

---

## Key Concepts

### 1. Settlement Flow
```
Customer Orders → Shipments Created → Delivered
    ↓                                      ↓
Customer Pays                    Courier Earns Fee
(total_amount)                   (shipping_cost)
    ↓                                      ↓
Your Revenue              →        You Owe Courier
                                   (pending payment)
```

### 2. Settlement Statuses

| Status | Description | Action |
|--------|-------------|--------|
| **Pending** | Shipment delivered, payment not yet approved | Review & approve |
| **Approved** | Ready for payment batch | Include in settlement |
| **Paid** | Payment made to courier | Recorded & complete |
| **Disputed** | Issue with shipment/payment | Resolve dispute |

### 3. Money Flow

**Customer Side:**
- Customer pays: ₦10,000 (order total)
- Includes: ₦7,500 (products) + ₦2,500 (shipping)
- You receive: ₦10,000

**Courier Side:**
- Courier delivers shipment
- Courier charges: ₦2,000 (their rate)
- You keep: ₦500 (your shipping profit)
- You owe courier: ₦2,000

---

## Using the Settlement System

### Step 1: View Pending Payments

**Navigation:** Dashboard → Settlements → Pending Payments tab

You'll see:
- Each courier with pending shipments
- Total amount due
- Number of shipments
- Date range

**Example:**
```
Fez Delivery
├─ Pending Shipments: 45
├─ Total Amount Due: ₦180,000
├─ Approved Amount: ₦120,000
└─ Period: Jan 1 - Jan 15, 2025
```

### Step 2: Create Settlement Batch

1. Click **"Create Settlement"** on a courier
2. Review details:
   - Courier name
   - Number of shipments
   - Total amount
   - Date range
3. Adjust date range if needed
4. Click **"Create Settlement"**

**What happens:**
- System creates a settlement batch
- All shipments in range marked as "approved"
- Settlement appears in History tab
- Status: Pending payment

### Step 3: Make Payment to Courier

**In Real Life:**
1. Transfer money to courier's bank account
2. Get payment reference from bank

**In System:**
1. Go to Settlement History tab
2. Find the settlement
3. Click **"Mark as Paid"**
4. Enter:
   - Payment reference (e.g., TRF/2025/001)
   - Payment method (Bank Transfer, Cash, etc.)
   - Payment date
   - Notes (optional)
5. Click **"Mark as Paid"**

**What happens:**
- Settlement status → Paid
- All shipments marked as paid
- Payment recorded in system
- Appears in financial reports

---

## Settlement Modes

### Mode 1: Manual (No API)

**How it works:**
1. Shipments delivered (staff updates status)
2. System calculates amount owed
3. You create settlement batch
4. You pay courier (bank transfer)
5. You mark as paid in system

**Pros:**
- Simple
- No API dependency
- Full control

**Cons:**
- Manual data entry
- Courier may have different records
- Potential discrepancies

### Mode 2: API Integration (Recommended)

**How it works:**
1. Shipments auto-created via API
2. Tracking auto-updates
3. Delivery confirmed automatically
4. System calculates exact amount
5. You create settlement batch
6. You pay courier
7. You mark as paid

**Pros:**
- Accurate tracking
- Real delivery dates
- Matches courier's records
- Less disputes

**Cons:**
- Requires API setup
- Dependent on courier API

---

## Financial Reports

### Dashboard Summary Cards

**Pending Payment**
- Total amount awaiting payment
- Across all couriers
- Real-time updates

**Approved for Payment**
- Shipments approved but not paid
- Ready to create settlement

**Total Paid**
- All-time amount paid to couriers
- Historical tracking

**Pending Shipments**
- Count of delivered shipments awaiting payment

### Export Options

**Settlement Report:**
- Settlement ID
- Courier name
- Period
- Shipments count
- Amount due
- Payment status
- Payment reference

**Shipment-Level Report:**
- Order ID
- Tracking number
- Delivery date
- Amount
- Settlement status
- Payment reference

---

## Best Practices

### 1. Regular Settlement Cycles

**Weekly settlements:**
- Small volume businesses
- Quick payment cycles
- Better cash flow for couriers

**Bi-weekly settlements:**
- Medium volume
- Balanced approach
- Standard in industry

**Monthly settlements:**
- Large volume
- Consolidated payments
- Better for accounting

### 2. Payment Verification

Before marking as paid:
- ✅ Verify bank transfer success
- ✅ Get payment reference
- ✅ Confirm amount matches
- ✅ Keep payment proof

### 3. Dispute Resolution

If courier's records don't match:
1. Export settlement details
2. Compare with courier's invoice
3. Identify discrepancies
4. Mark disputed shipments
5. Resolve before payment

### 4. Record Keeping

**What to keep:**
- Settlement batch reports
- Bank transfer receipts
- Courier invoices
- Reconciliation notes

**How long:**
- Minimum: 2 years
- Recommended: 7 years (tax purposes)

---

## API Endpoints

### Get Pending Payments
```
GET /api/settlements/pending
```

### Create Settlement
```
POST /api/settlements
Body: {
  courier_id: "uuid",
  start_date: "2025-01-01",
  end_date: "2025-01-15"
}
```

### Mark as Paid
```
PUT /api/settlements/:id/mark-paid
Body: {
  payment_reference: "TRF/2025/001",
  payment_method: "bank_transfer",
  payment_date: "2025-01-16",
  notes: "Payment via GTBank"
}
```

### Get Settlement Details
```
GET /api/settlements/:id
```

---

## Database Schema

### sub_orders (shipment tracking)
```sql
- courier_charge: Amount we owe courier
- courier_paid_amount: Amount actually paid
- settlement_status: pending/approved/paid/disputed
- settlement_date: When payment was made
- payment_reference: Bank reference
```

### courier_settlements (batch payments)
```sql
- courier_id: Which courier
- settlement_period_start: Start date
- settlement_period_end: End date
- total_shipments: Count
- total_amount_due: What we owe
- total_amount_paid: What we paid
- status: pending/approved/paid
- payment_reference: Bank reference
```

### settlement_items (shipment links)
```sql
- settlement_id: Batch ID
- sub_order_id: Shipment ID
- amount: Individual amount
```

---

## Troubleshooting

### Issue: Amounts don't match courier's invoice

**Solution:**
1. Check date ranges match
2. Verify all shipments included
3. Check for returned/cancelled items
4. Export both reports and compare

### Issue: Can't create settlement (no pending shipments)

**Solution:**
1. Ensure shipments marked as "delivered"
2. Check settlement_status = "pending"
3. Verify date range includes deliveries

### Issue: Payment marked incorrectly

**Solution:**
1. Admin can edit settlement
2. Update payment details
3. Re-export corrected report

---

## Examples

### Example 1: Weekly Settlement for Fez

**Week of Jan 1-7, 2025:**
- 23 shipments delivered
- Total owed: ₦92,000
- Create settlement batch
- Transfer ₦92,000 to Fez
- Mark paid with reference TRF/2025/001

### Example 2: Monthly Settlement for Multiple Couriers

**January 2025:**
- Fez: 120 shipments, ₦480,000
- GIGL: 85 shipments, ₦340,000
- Kwik: 45 shipments, ₦180,000
- **Total: ₦1,000,000**

Create separate settlements for each courier, pay individually, track references.

---

## Quick Reference

**View what you owe:** Dashboard → Settlements → Pending Payments
**Create payout batch:** Click "Create Settlement" on courier
**Record payment:** Settlement History → "Mark as Paid"
**Export reports:** Click "Export" on any settlement
**Check payment status:** Look for green "Paid" badge

---

**Need Help?**
- Check Activity Logs for payment history
- View API logs for integration issues
- Contact support for dispute resolution

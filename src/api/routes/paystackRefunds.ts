import { Request, Response } from 'express';

/**
 * Paystack Refund Handler for JLO
 * POST /api/refunds/paystack
 */

interface PaystackRefundRequest {
  transaction: string;
  amount?: number; // In kobo
  customer_note?: string;
  merchant_note?: string;
}

export async function paystackRefundHandler(req: Request, res: Response) {
  try {
    const { transaction, amount, customer_note, merchant_note } = req.body as PaystackRefundRequest;

    if (!transaction) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reference is required',
      });
    }

    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecretKey) {
      console.error('Missing Paystack secret key');
      return res.status(500).json({
        success: false,
        error: 'Payment configuration error',
      });
    }

    console.log('🔵 Initiating Paystack refund for transaction:', transaction);
    if (amount) {
      console.log('🔵 Refund amount:', amount, 'kobo');
    } else {
      console.log('🔵 Full refund requested');
    }

    // Build refund payload
    const refundPayload: any = {
      transaction,
      currency: 'NGN',
    };

    if (amount && amount > 0) {
      refundPayload.amount = amount;
    }
    if (customer_note) {
      refundPayload.customer_note = customer_note;
    }
    if (merchant_note) {
      refundPayload.merchant_note = merchant_note;
    }

    // Call Paystack refund endpoint
    const refundResponse = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(refundPayload),
    });

    const refundData = await refundResponse.json();

    if (!refundResponse.ok || !refundData.status) {
      console.error('❌ Paystack refund failed:', refundData);
      return res.status(400).json({
        success: false,
        error: refundData.message || 'Refund failed',
      });
    }

    console.log('✅ Paystack refund initiated:', refundData.data?.id);

    return res.json({
      success: true,
      message: 'Refund initiated successfully',
      data: {
        refundId: refundData.data?.id,
        amount: refundData.data?.amount,
        status: refundData.data?.status,
        expectedAt: refundData.data?.expected_at,
      },
    });
  } catch (error: any) {
    console.error('❌ Refund error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process refund',
    });
  }
}

/**
 * Get Paystack Refund Status
 * GET /api/refunds/paystack/:reference
 */
export async function getPaystackRefundStatus(req: Request, res: Response) {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'Reference is required',
      });
    }

    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecretKey) {
      return res.status(500).json({
        success: false,
        error: 'Payment configuration error',
      });
    }

    const response = await fetch(`https://api.paystack.co/refund/${reference}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      return res.status(400).json({
        success: false,
        error: data.message || 'Failed to fetch refund status',
      });
    }

    return res.json({
      success: true,
      data: data.data,
    });
  } catch (error: any) {
    console.error('❌ Error fetching refund status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch refund status',
    });
  }
}
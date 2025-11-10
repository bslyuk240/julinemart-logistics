import { Request, Response, NextFunction } from 'express';
import {
  sendOrderConfirmationEmail,
  sendOrderProcessingEmail,
  sendOrderShippedEmail,
  sendOutForDeliveryEmail,
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
} from '../services/emailService.js';

// Middleware to auto-send emails when order status changes
export async function autoSendEmailOnStatusChange(
  orderId: string,
  newStatus: string,
  oldStatus?: string
): Promise<void> {
  // Don't send if status hasn't changed
  if (oldStatus === newStatus) return;

  try {
    console.log(`📧 Triggering email for status change: ${oldStatus} → ${newStatus}`);

    switch (newStatus) {
      case 'pending':
        await sendOrderConfirmationEmail(orderId);
        break;
      
      case 'processing':
        await sendOrderProcessingEmail(orderId);
        break;
      
      case 'in_transit':
        await sendOrderShippedEmail(orderId);
        break;
      
      case 'out_for_delivery':
        await sendOutForDeliveryEmail(orderId);
        break;
      
      case 'delivered':
        await sendOrderDeliveredEmail(orderId);
        break;
      
      case 'cancelled':
        await sendOrderCancelledEmail(orderId);
        break;
    }
  } catch (error) {
    console.error('Failed to send status change email:', error);
    // Don't throw - email failure shouldn't block order updates
  }
}

// API endpoint to manually resend email
export async function resendOrderEmailHandler(req: Request, res: Response) {
  try {
    const { orderId, emailType } = req.body;

    if (!orderId || !emailType) {
      return res.status(400).json({
        success: false,
        error: 'orderId and emailType are required',
      });
    }

    let success = false;

    switch (emailType) {
      case 'confirmation':
        success = await sendOrderConfirmationEmail(orderId);
        break;
      case 'processing':
        success = await sendOrderProcessingEmail(orderId);
        break;
      case 'shipped':
        success = await sendOrderShippedEmail(orderId);
        break;
      case 'out_for_delivery':
        success = await sendOutForDeliveryEmail(orderId);
        break;
      case 'delivered':
        success = await sendOrderDeliveredEmail(orderId);
        break;
      case 'cancelled':
        success = await sendOrderCancelledEmail(orderId);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid email type',
        });
    }

    if (success) {
      return res.status(200).json({
        success: true,
        message: 'Email sent successfully',
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Failed to send email',
      });
    }
  } catch (error) {
    console.error('Resend email error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to resend email',
    });
  }
}

// Get email logs for an order
export async function getOrderEmailLogsHandler(req: Request, res: Response) {
  try {
    const { orderId } = req.params;

    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('email_logs')
      .select('*')
      .eq('order_id', orderId)
      .order('sent_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('Get email logs error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch email logs',
    });
  }
}

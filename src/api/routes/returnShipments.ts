import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function getReturnShipmentsByOrder(req: Request, res: Response) {
  try {
    const { orderId } = req.params;

    const { data: requests, error: requestError } = await supabase
      .from('return_requests')
      .select('id')
      .eq('order_id', orderId);

    if (requestError) {
      // If table is missing, avoid breaking order detail view
      if ((requestError as any)?.message?.toLowerCase?.().includes('return_requests')) {
        console.warn('return_requests table missing, returning empty list');
        return res.status(200).json({ success: true, data: [] });
      }
      throw requestError;
    }

    const requestIds = (requests || []).map((r: { id: string }) => r.id);
    if (!requestIds.length) {
      return res.status(200).json({ success: true, data: [] });
    }

    const { data: shipments, error: shipmentError } = await supabase
      .from('return_shipments')
      .select('*')
      .in('return_request_id', requestIds)
      .order('created_at', { ascending: false });

    if (shipmentError) {
      if ((shipmentError as any)?.message?.toLowerCase?.().includes('return_shipments')) {
        console.warn('return_shipments table missing, returning empty list');
        return res.status(200).json({ success: true, data: [] });
      }
      throw shipmentError;
    }

    return res.status(200).json({ success: true, data: shipments || [] });
  } catch (error) {
    console.error('getReturnShipmentsByOrder error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch return shipments',
    });
  }
}

export async function updateReturnShipmentStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }

    const { data, error } = await supabase
      .from('return_shipments')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('updateReturnShipmentStatus error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update return shipment',
    });
  }
}

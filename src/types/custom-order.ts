/** Shared with julinemart-pwa — keep in sync. */

export type CustomFieldType =
  | 'text'
  | 'dropdown'
  | 'long_text'
  | 'date'
  | 'number'
  | 'colour';

export type CustomOrderPilotVertical = 'bakers' | 'printers' | 'tailors';

export type CustomOrderStatus =
  | 'submitted'
  | 'seller_reviewing'
  | 'seller_confirmed'
  | 'proof_sent'
  | 'customer_approved'
  | 'in_production'
  | 'quality_check'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

export interface CustomFieldOption {
  label: string;
  value: string;
  price_delta?: number;
}

export interface CustomFieldDefinition {
  id: string;
  type: CustomFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: CustomFieldOption[];
  price_delta?: number;
  min?: number;
  max?: number;
}

export interface ProductCustomisationSchema {
  id: string;
  product_id: string;
  vendor_id: string;
  pilot_vertical?: CustomOrderPilotVertical | null;
  requires_approval: boolean;
  production_days_min?: number | null;
  production_days_max?: number | null;
  fields: CustomFieldDefinition[];
  created_at?: string;
  updated_at?: string;
}

export interface CustomOrderSpec {
  id: string;
  order_id: string;
  order_item_id?: string | null;
  schema_id?: string | null;
  field_values: Record<string, unknown>;
  price_adjustment: number;
  status: CustomOrderStatus;
  approved_proof_url?: string | null;
  approved_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const CUSTOM_ORDER_STATUS_LABELS: Record<CustomOrderStatus, string> = {
  submitted: 'Submitted',
  seller_reviewing: 'Seller reviewing',
  seller_confirmed: 'Confirmed — production starting',
  proof_sent: 'Proof sent for approval',
  customer_approved: 'Proof approved',
  in_production: 'In production',
  quality_check: 'Quality check',
  ready: 'Ready',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

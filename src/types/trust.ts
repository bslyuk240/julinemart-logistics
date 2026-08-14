export type VerificationLevel = 1 | 2 | 3 | 4 | 5;

export type VerificationType =
  | 'identity'
  | 'phone'
  | 'bank_account'
  | 'business_registration'
  | 'physical_store'
  | 'trusted_seller'
  | 'julinemart_assured';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type SellerVerification = {
  vendor_id: string;
  verification_type: VerificationType;
  status: VerificationStatus;
  verified_at?: string | null;
  expires_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type SellerPerformanceMetrics = {
  successful_orders: number;
  fulfilment_rate: number | null;
  product_accuracy: number | null;
  on_time_dispatch: number | null;
  response_rate: number | null;
  avg_response_minutes: number | null;
  dispute_rate: number | null;
  repeat_customer_rate: number | null;
  seller_quality_score?: number | null;
  computed_at?: string | null;
};

export type VendorTrustProfile = {
  vendor_id: string;
  level: VerificationLevel;
  verifications: VerificationType[];
  metrics: SellerPerformanceMetrics | null;
  protect_eligible: boolean;
};

export const VERIFICATION_LEVEL_LABELS: Record<VerificationLevel, string> = {
  1: 'Identity Verified',
  2: 'Verified Business',
  3: 'Physical Store Verified',
  4: 'Trusted Seller',
  5: 'JulineMart Assured',
};

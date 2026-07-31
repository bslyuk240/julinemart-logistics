-- Manual Shipments: ad-hoc waybills not tied to any customer order or
-- return request. Dispatch-tracking columns deliberately mirror
-- sub_orders' naming exactly so generate-waybill.js's getLaneInfo() and
-- ensureWaybillNumber() work unchanged against this table.

CREATE TABLE public.manual_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_code text NOT NULL,

  sender_hub_id uuid REFERENCES public.hubs(id),
  sender jsonb NOT NULL,        -- {name, address, city, state, phone}
  recipient jsonb NOT NULL,     -- {name, address, city, state, phone}

  item_description text NOT NULL,
  item_weight numeric(10,2) DEFAULT 1,
  item_value numeric(12,2) DEFAULT 0,

  courier_id uuid REFERENCES public.couriers(id),
  tracking_number text,
  courier_shipment_id text,
  courier_tracking_url text,
  courier_waybill text,
  status delivery_status DEFAULT 'pending',
  delivery_person_name text,
  delivery_person_phone text,
  delivery_person_vehicle text,
  metadata jsonb DEFAULT '{}'::jsonb,
  waybill_number text,
  raw_payload jsonb,

  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_manual_shipments_code ON public.manual_shipments (shipment_code);
CREATE UNIQUE INDEX idx_manual_shipments_waybill_number
  ON public.manual_shipments (waybill_number) WHERE waybill_number IS NOT NULL;
CREATE INDEX idx_manual_shipments_status ON public.manual_shipments (status);
CREATE INDEX idx_manual_shipments_tracking ON public.manual_shipments (tracking_number);
CREATE INDEX idx_manual_shipments_created_by ON public.manual_shipments (created_by);

CREATE TRIGGER update_manual_shipments_updated_at
  BEFORE UPDATE ON public.manual_shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

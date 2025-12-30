-- ============================================================
-- WhatsApp Support System Migration
-- ============================================================
-- Purpose: Create tables for WhatsApp Business Platform integration
-- Author: JulineMart Dev Team
-- Date: 2025-01-23
-- ============================================================

-- Step 1: Create WhatsApp chat status enum
CREATE TYPE whatsapp_chat_status AS ENUM ('open', 'assigned', 'closed');

-- Step 2: Create WhatsApp message direction enum
CREATE TYPE whatsapp_message_direction AS ENUM ('inbound', 'outbound');

-- Step 3: Create WhatsApp message type enum
CREATE TYPE whatsapp_message_type AS ENUM ('text', 'image', 'audio', 'video', 'document', 'location', 'contacts', 'sticker');

-- Step 4: Create WhatsApp message status enum
CREATE TYPE whatsapp_message_status AS ENUM ('sent', 'delivered', 'read', 'failed');

-- ============================================================
-- MAIN TABLES
-- ============================================================

-- Step 5: WhatsApp Chats Table
CREATE TABLE IF NOT EXISTS whatsapp_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Customer Info
    customer_phone VARCHAR(20) NOT NULL,
    customer_name VARCHAR(255),
    customer_profile_pic_url TEXT,
    
    -- Chat Status
    status whatsapp_chat_status DEFAULT 'open',
    
    -- Staff Assignment
    assigned_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Order Linking
    linked_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    
    -- Chat Metrics
    last_message_at TIMESTAMP DEFAULT NOW(),
    last_message_preview TEXT,
    unread_count INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    
    -- Customer Service Window (24 hours from last customer message)
    customer_service_window_expires_at TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP,
    
    -- Constraints
    CONSTRAINT whatsapp_chats_phone_unique UNIQUE (customer_phone)
);

-- Step 6: WhatsApp Messages Table
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Chat Reference
    chat_id UUID NOT NULL REFERENCES whatsapp_chats(id) ON DELETE CASCADE,
    
    -- Message Direction & Type
    direction whatsapp_message_direction NOT NULL,
    message_type whatsapp_message_type DEFAULT 'text',
    
    -- Content
    content TEXT,
    
    -- Media (for images, videos, documents, audio)
    media_url TEXT,
    media_mime_type VARCHAR(100),
    media_sha256 VARCHAR(64),
    media_file_size INTEGER,
    
    -- WhatsApp Meta IDs
    meta_message_id VARCHAR(255) UNIQUE,
    meta_wamid VARCHAR(255),
    
    -- Status Tracking
    status whatsapp_message_status DEFAULT 'sent',
    
    -- Staff Info (for outbound messages)
    sent_by_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Context (for replies)
    context_message_id VARCHAR(255),
    
    -- Error Info
    error_code VARCHAR(50),
    error_message TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    delivered_at TIMESTAMP,
    read_at TIMESTAMP
);

-- Step 7: WhatsApp Templates Table (for messages outside 24h window)
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Template Info
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'UTILITY', 'MARKETING', 'AUTHENTICATION'
    language VARCHAR(10) DEFAULT 'en',
    
    -- Template Content
    template_content TEXT NOT NULL,
    
    -- Meta Template Details
    meta_template_id VARCHAR(255),
    meta_template_status VARCHAR(50) DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
    
    -- Usage Stats
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT whatsapp_templates_name_unique UNIQUE (name)
);

-- Step 8: WhatsApp Webhook Events Log (for debugging)
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Event Info
    event_type VARCHAR(50) NOT NULL,
    
    -- Payload
    payload JSONB NOT NULL,
    
    -- Processing Status
    processed BOOLEAN DEFAULT false,
    processing_error TEXT,
    
    -- Timestamps
    received_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================

-- WhatsApp Chats Indexes
CREATE INDEX idx_whatsapp_chats_phone ON whatsapp_chats(customer_phone);
CREATE INDEX idx_whatsapp_chats_status ON whatsapp_chats(status);
CREATE INDEX idx_whatsapp_chats_assigned_staff ON whatsapp_chats(assigned_staff_id) WHERE assigned_staff_id IS NOT NULL;
CREATE INDEX idx_whatsapp_chats_linked_order ON whatsapp_chats(linked_order_id) WHERE linked_order_id IS NOT NULL;
CREATE INDEX idx_whatsapp_chats_last_message ON whatsapp_chats(last_message_at DESC);
CREATE INDEX idx_whatsapp_chats_service_window ON whatsapp_chats(customer_service_window_expires_at) WHERE customer_service_window_expires_at IS NOT NULL;

-- WhatsApp Messages Indexes
CREATE INDEX idx_whatsapp_messages_chat ON whatsapp_messages(chat_id, created_at DESC);
CREATE INDEX idx_whatsapp_messages_meta_id ON whatsapp_messages(meta_message_id) WHERE meta_message_id IS NOT NULL;
CREATE INDEX idx_whatsapp_messages_direction ON whatsapp_messages(direction);
CREATE INDEX idx_whatsapp_messages_status ON whatsapp_messages(status);
CREATE INDEX idx_whatsapp_messages_created ON whatsapp_messages(created_at DESC);

-- WhatsApp Templates Indexes
CREATE INDEX idx_whatsapp_templates_name ON whatsapp_templates(name);
CREATE INDEX idx_whatsapp_templates_active ON whatsapp_templates(is_active) WHERE is_active = true;

-- WhatsApp Webhook Events Indexes
CREATE INDEX idx_whatsapp_webhook_events_type ON whatsapp_webhook_events(event_type);
CREATE INDEX idx_whatsapp_webhook_events_processed ON whatsapp_webhook_events(processed);
CREATE INDEX idx_whatsapp_webhook_events_received ON whatsapp_webhook_events(received_at DESC);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Trigger: Update whatsapp_chats.updated_at on every update
CREATE TRIGGER update_whatsapp_chats_updated_at
    BEFORE UPDATE ON whatsapp_chats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Update whatsapp_templates.updated_at on every update
CREATE TRIGGER update_whatsapp_templates_updated_at
    BEFORE UPDATE ON whatsapp_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Function: Automatically update chat metadata when new message arrives
CREATE OR REPLACE FUNCTION update_chat_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE whatsapp_chats
    SET 
        last_message_at = NEW.created_at,
        last_message_preview = SUBSTRING(NEW.content, 1, 100),
        total_messages = total_messages + 1,
        unread_count = CASE 
            WHEN NEW.direction = 'inbound' THEN unread_count + 1
            ELSE unread_count
        END,
        -- Update service window for inbound messages (24 hours from last customer message)
        customer_service_window_expires_at = CASE
            WHEN NEW.direction = 'inbound' THEN NOW() + INTERVAL '24 hours'
            ELSE customer_service_window_expires_at
        END,
        updated_at = NOW()
    WHERE id = NEW.chat_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update chat when message is inserted
CREATE TRIGGER update_chat_on_message_insert
    AFTER INSERT ON whatsapp_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_on_new_message();

-- Function: Detect and link order numbers in messages
CREATE OR REPLACE FUNCTION auto_link_order_from_message()
RETURNS TRIGGER AS $$
DECLARE
    order_number TEXT;
    order_record RECORD;
BEGIN
    -- Only process inbound text messages
    IF NEW.direction = 'inbound' AND NEW.message_type = 'text' AND NEW.content IS NOT NULL THEN
        -- Extract order number patterns: JM-12345, #12345, or just 12345
        order_number := (regexp_matches(NEW.content, '(?:JM-|#|order\s*)?(\d{4,})', 'i'))[1];
        
        IF order_number IS NOT NULL THEN
            -- Try to find matching order
            SELECT id INTO order_record
            FROM orders
            WHERE woocommerce_order_id = order_number
               OR woocommerce_order_id = 'JM-' || order_number
               OR woocommerce_order_id LIKE '%' || order_number
            LIMIT 1;
            
            -- Link order to chat if found
            IF order_record.id IS NOT NULL THEN
                UPDATE whatsapp_chats
                SET 
                    linked_order_id = order_record.id,
                    metadata = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{auto_linked_at}',
                        to_jsonb(NOW())
                    )
                WHERE id = NEW.chat_id
                  AND linked_order_id IS NULL; -- Only link if not already linked
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-link orders when messages mention order numbers
CREATE TRIGGER auto_link_order_on_message
    AFTER INSERT ON whatsapp_messages
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_order_from_message();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all WhatsApp tables
ALTER TABLE whatsapp_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: All authenticated users can view chats (spec says all roles should see chat)
CREATE POLICY "All users can view chats" ON whatsapp_chats
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- RLS Policy: Admin and agent can update chats (assign, close, etc.)
CREATE POLICY "Admin and agent can update chats" ON whatsapp_chats
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'agent')
        )
    );

-- RLS Policy: All users can view messages
CREATE POLICY "All users can view messages" ON whatsapp_messages
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- RLS Policy: Admin and agent can insert messages (send replies)
CREATE POLICY "Admin and agent can insert messages" ON whatsapp_messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'agent')
        )
    );

-- RLS Policy: All users can view templates
CREATE POLICY "All users can view templates" ON whatsapp_templates
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- RLS Policy: Only admin can manage templates
CREATE POLICY "Admin can manage templates" ON whatsapp_templates
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() 
            AND role = 'admin'
        )
    );

-- RLS Policy: All users can view webhook events (for debugging)
CREATE POLICY "All users can view webhook events" ON whatsapp_webhook_events
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- ============================================================
-- VIEWS
-- ============================================================

-- View: WhatsApp Chat Summary (for inbox list)
CREATE OR REPLACE VIEW whatsapp_chat_summary AS
SELECT 
    c.id,
    c.customer_phone,
    c.customer_name,
    c.customer_profile_pic_url,
    c.status,
    c.assigned_staff_id,
    u.full_name as assigned_staff_name,
    c.linked_order_id,
    o.woocommerce_order_id,
    o.overall_status as order_status,
    c.last_message_at,
    c.last_message_preview,
    c.unread_count,
    c.total_messages,
    c.customer_service_window_expires_at,
    CASE 
        WHEN c.customer_service_window_expires_at > NOW() THEN true
        ELSE false
    END as within_service_window,
    c.created_at,
    c.updated_at,
    c.closed_at
FROM whatsapp_chats c
LEFT JOIN users u ON c.assigned_staff_id = u.id
LEFT JOIN orders o ON c.linked_order_id = o.id;

-- ============================================================
-- INITIAL DATA
-- ============================================================

-- Insert default templates (to be approved by Meta)
INSERT INTO whatsapp_templates (name, category, language, template_content) VALUES
('order_status_update', 'UTILITY', 'en', 'Hello {{1}}, your order {{2}} status has been updated to: {{3}}. Thank you for shopping with JulineMart!'),
('order_tracking_info', 'UTILITY', 'en', 'Hi {{1}}, your order {{2}} is now with {{3}}. Tracking number: {{4}}. Track at: {{5}}'),
('delivery_scheduled', 'UTILITY', 'en', 'Hello {{1}}, your order {{2}} is scheduled for delivery on {{3}}. Our rider will contact you shortly.'),
('support_response', 'UTILITY', 'en', 'Hello {{1}}, thank you for contacting JulineMart support. {{2}}')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- GRANTS
-- ============================================================

-- Grant permissions to authenticated users
GRANT SELECT ON whatsapp_chats TO authenticated;
GRANT SELECT ON whatsapp_messages TO authenticated;
GRANT SELECT ON whatsapp_templates TO authenticated;
GRANT SELECT ON whatsapp_webhook_events TO authenticated;

-- Grant insert on messages for sending replies
GRANT INSERT ON whatsapp_messages TO authenticated;

-- Grant update on chats for assignments and status changes
GRANT UPDATE ON whatsapp_chats TO authenticated;

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE '✅ WhatsApp Support System tables created successfully!';
    RAISE NOTICE '📊 Tables created:';
    RAISE NOTICE '   - whatsapp_chats';
    RAISE NOTICE '   - whatsapp_messages';
    RAISE NOTICE '   - whatsapp_templates';
    RAISE NOTICE '   - whatsapp_webhook_events';
    RAISE NOTICE '🔒 RLS policies enabled for all users';
    RAISE NOTICE '🎯 Auto-linking enabled for order mentions';
    RAISE NOTICE '⏰ 24-hour service window tracking active';
END $$;

-- Verify table creation
SELECT 
    'WhatsApp Tables' as category,
    COUNT(*) as count
FROM information_schema.tables
WHERE table_schema = 'public' 
AND table_name LIKE 'whatsapp_%';
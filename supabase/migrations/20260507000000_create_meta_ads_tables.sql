-- ─────────────────────────────────────────────────────────────────────────────
-- Meta Ads module tables
-- Powers the JLO Social & Ads Manager: campaign cache, drafts, AI content,
-- and action audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Campaign cache (synced from Meta Marketing API) ───────────────────────

CREATE TABLE IF NOT EXISTS meta_campaigns_cache (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_campaign_id    VARCHAR(64)   NOT NULL UNIQUE,
  name                VARCHAR(255)  NOT NULL,
  status              VARCHAR(32)   NOT NULL,  -- ACTIVE, PAUSED, ARCHIVED, DELETED
  objective           VARCHAR(64),
  daily_budget        DECIMAL(12,2),
  lifetime_budget     DECIMAL(12,2),
  spend_cap           DECIMAL(12,2),
  start_time          TIMESTAMP,
  stop_time           TIMESTAMP,
  -- Latest insights snapshot (refreshed on sync)
  impressions         BIGINT        NOT NULL DEFAULT 0,
  reach               BIGINT        NOT NULL DEFAULT 0,
  clicks              BIGINT        NOT NULL DEFAULT 0,
  spend               DECIMAL(12,2) NOT NULL DEFAULT 0,
  ctr                 DECIMAL(8,4)  NOT NULL DEFAULT 0,
  cpc                 DECIMAL(10,4) NOT NULL DEFAULT 0,
  cpm                 DECIMAL(10,4) NOT NULL DEFAULT 0,
  -- Meta account this belongs to
  ad_account_id       VARCHAR(64)   NOT NULL,
  synced_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_status    ON meta_campaigns_cache(status);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_synced_at ON meta_campaigns_cache(synced_at DESC);

-- ── 2. Ad drafts (AI-generated or manually created, awaiting approval) ────────

CREATE TABLE IF NOT EXISTS meta_ad_drafts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(255)  NOT NULL,
  headline        VARCHAR(255),
  body_text       TEXT          NOT NULL,
  call_to_action  VARCHAR(64)   NOT NULL DEFAULT 'SHOP_NOW',
  image_url       TEXT,
  destination_url TEXT,
  -- JulineMart data context used to generate this draft
  source_products JSONB,  -- array of product ids/names used for context
  source_context  JSONB,  -- other context: top region, promo code, etc.
  -- Targeting suggestions
  target_audience JSONB,
  suggested_budget DECIMAL(10,2),
  -- Workflow
  status          VARCHAR(32)   NOT NULL DEFAULT 'draft',  -- draft, approved, rejected, published
  ai_generated    BOOLEAN       NOT NULL DEFAULT false,
  created_by      UUID          REFERENCES users(id),
  approved_by     UUID          REFERENCES users(id),
  approved_at     TIMESTAMP,
  rejection_note  TEXT,
  published_at    TIMESTAMP,
  meta_ad_id      VARCHAR(64),  -- set after publishing to Meta
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_drafts_status     ON meta_ad_drafts(status);
CREATE INDEX IF NOT EXISTS idx_meta_drafts_created_by ON meta_ad_drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_meta_drafts_created_at ON meta_ad_drafts(created_at DESC);

-- ── 3. AI recommendations ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_ai_recommendations (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  type            VARCHAR(64)   NOT NULL,  -- budget_increase, pause_campaign, promote_product, etc.
  priority        VARCHAR(16)   NOT NULL DEFAULT 'medium',  -- high, medium, low
  title           VARCHAR(255)  NOT NULL,
  description     TEXT          NOT NULL,
  action_data     JSONB,        -- structured payload for the recommended action
  source_data     JSONB,        -- data snapshot that triggered the recommendation
  campaign_id     VARCHAR(64),  -- related meta campaign id if applicable
  status          VARCHAR(32)   NOT NULL DEFAULT 'pending',  -- pending, actioned, dismissed
  actioned_by     UUID          REFERENCES users(id),
  actioned_at     TIMESTAMP,
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_recs_status     ON meta_ai_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_meta_recs_priority   ON meta_ai_recommendations(priority);
CREATE INDEX IF NOT EXISTS idx_meta_recs_created_at ON meta_ai_recommendations(created_at DESC);

-- ── 4. Action audit log ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_action_logs (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          REFERENCES users(id),
  action      VARCHAR(64)   NOT NULL,  -- sync_campaigns, create_draft, approve_draft, generate_content, etc.
  resource    VARCHAR(64),             -- campaign, draft, recommendation
  resource_id VARCHAR(64),
  details     JSONB,
  status      VARCHAR(16)   NOT NULL DEFAULT 'success',  -- success, failed
  error_msg   TEXT,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_logs_user_id    ON meta_action_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_meta_logs_action     ON meta_action_logs(action);
CREATE INDEX IF NOT EXISTS idx_meta_logs_created_at ON meta_action_logs(created_at DESC);

-- ── 5. RLS policies ───────────────────────────────────────────────────────────

ALTER TABLE meta_campaigns_cache      ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ad_drafts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ai_recommendations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_action_logs          ENABLE ROW LEVEL SECURITY;

-- Admin/manager: full access
CREATE POLICY "meta_campaigns_admin" ON meta_campaigns_cache
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "meta_drafts_admin" ON meta_ad_drafts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "meta_recs_admin" ON meta_ai_recommendations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "meta_logs_admin" ON meta_action_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

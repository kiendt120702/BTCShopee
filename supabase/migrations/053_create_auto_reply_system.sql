-- Migration: Create auto-reply system for Shopee reviews
-- Chức năng: Tự động trả lời đánh giá dựa vào rating star
-- Features:
-- - Cấu hình 3 câu trả lời mặc định cho mỗi mức sao (1-5 sao)
-- - Hệ thống tự động random câu trả lời
-- - Cho phép set thời gian tự động trả lời (cron schedule)

-- =====================================================
-- 1. Bảng cấu hình auto-reply cho mỗi shop
-- =====================================================
CREATE TABLE IF NOT EXISTS apishopee_auto_reply_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Shop info
  shop_id BIGINT NOT NULL UNIQUE,

  -- Cấu hình auto-reply
  enabled BOOLEAN DEFAULT false,

  -- Cấu hình 3 câu trả lời cho mỗi mức sao (5 sao, 4 sao, 3 sao, 2 sao, 1 sao)
  -- Mỗi mức sao có array 3 câu trả lời, hệ thống sẽ random chọn 1 câu
  reply_templates JSONB DEFAULT '{
    "5": [],
    "4": [],
    "3": [],
    "2": [],
    "1": []
  }'::jsonb,

  -- Cấu hình thời gian tự động reply
  -- Format: cron expression (e.g., "*/30 * * * *" = mỗi 30 phút)
  auto_reply_schedule TEXT DEFAULT '*/30 * * * *',

  -- Delay time (phút) - chờ bao lâu sau khi nhận review mới reply
  -- Ví dụ: 60 = chờ 1 giờ sau khi có review mới thì mới reply
  reply_delay_minutes INT DEFAULT 60,

  -- Chỉ reply cho reviews chưa có reply
  only_reply_unreplied BOOLEAN DEFAULT true,

  -- Chỉ reply cho rating >= X sao (null = reply tất cả)
  min_rating_to_reply INT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Index
CREATE INDEX idx_auto_reply_shop_id ON apishopee_auto_reply_config(shop_id);
CREATE INDEX idx_auto_reply_enabled ON apishopee_auto_reply_config(enabled) WHERE enabled = true;

-- =====================================================
-- 2. Bảng log lịch sử auto-reply
-- =====================================================
CREATE TABLE IF NOT EXISTS apishopee_auto_reply_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Shop & Review info
  shop_id BIGINT NOT NULL,
  comment_id BIGINT NOT NULL,
  rating_star INT NOT NULL,

  -- Reply info
  reply_text TEXT NOT NULL,
  template_index INT, -- Index của template được chọn (0, 1, hoặc 2)

  -- Status
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  error_message TEXT,

  -- API response
  api_response JSONB,

  -- Timestamps
  replied_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique: mỗi comment chỉ log 1 lần auto-reply thành công
  UNIQUE(shop_id, comment_id, status)
    DEFERRABLE INITIALLY DEFERRED
);

-- Index
CREATE INDEX idx_auto_reply_logs_shop_id ON apishopee_auto_reply_logs(shop_id);
CREATE INDEX idx_auto_reply_logs_status ON apishopee_auto_reply_logs(status);
CREATE INDEX idx_auto_reply_logs_created_at ON apishopee_auto_reply_logs(created_at DESC);
CREATE INDEX idx_auto_reply_logs_comment_id ON apishopee_auto_reply_logs(comment_id);

-- =====================================================
-- 3. Bảng theo dõi trạng thái auto-reply job
-- =====================================================
CREATE TABLE IF NOT EXISTS apishopee_auto_reply_job_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  shop_id BIGINT NOT NULL UNIQUE,

  -- Job status
  is_running BOOLEAN DEFAULT false,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,

  -- Statistics
  total_replied INT DEFAULT 0,
  last_batch_replied INT DEFAULT 0,
  last_batch_failed INT DEFAULT 0,
  last_batch_skipped INT DEFAULT 0,

  -- Error tracking
  last_error TEXT,
  error_count INT DEFAULT 0,
  consecutive_errors INT DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_auto_reply_job_shop_id ON apishopee_auto_reply_job_status(shop_id);

-- =====================================================
-- 4. Enable RLS
-- =====================================================
ALTER TABLE apishopee_auto_reply_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_auto_reply_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_auto_reply_job_status ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage auto-reply config of their shops
CREATE POLICY "Users can view auto-reply config of their shops" ON apishopee_auto_reply_config
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_auto_reply_config.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "Users can update auto-reply config of their shops" ON apishopee_auto_reply_config
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      JOIN apishopee_roles r ON r.id = sm.role_id
      WHERE s.shop_id = apishopee_auto_reply_config.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
      AND r.name = 'admin'
    )
  );

CREATE POLICY "Users can insert auto-reply config for their shops" ON apishopee_auto_reply_config
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      JOIN apishopee_roles r ON r.id = sm.role_id
      WHERE s.shop_id = apishopee_auto_reply_config.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
      AND r.name = 'admin'
    )
  );

-- Service role full access
CREATE POLICY "Service role has full access to auto-reply config" ON apishopee_auto_reply_config
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to auto-reply logs" ON apishopee_auto_reply_logs
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to auto-reply job status" ON apishopee_auto_reply_job_status
  FOR ALL
  USING (auth.role() = 'service_role');

-- Users can view logs of their shops
CREATE POLICY "Users can view auto-reply logs of their shops" ON apishopee_auto_reply_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_auto_reply_logs.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- Users can view job status of their shops
CREATE POLICY "Users can view auto-reply job status of their shops" ON apishopee_auto_reply_job_status
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_auto_reply_job_status.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- =====================================================
-- 5. Trigger update updated_at
-- =====================================================
CREATE TRIGGER trigger_auto_reply_config_updated_at
  BEFORE UPDATE ON apishopee_auto_reply_config
  FOR EACH ROW
  EXECUTE FUNCTION update_reviews_updated_at();

CREATE TRIGGER trigger_auto_reply_job_status_updated_at
  BEFORE UPDATE ON apishopee_auto_reply_job_status
  FOR EACH ROW
  EXECUTE FUNCTION update_reviews_updated_at();

-- =====================================================
-- 6. Function helper: Get random reply template
-- =====================================================
CREATE OR REPLACE FUNCTION get_random_reply_template(
  p_shop_id BIGINT,
  p_rating_star INT
)
RETURNS TEXT AS $$
DECLARE
  v_templates JSONB;
  v_templates_array TEXT[];
  v_random_index INT;
  v_reply_text TEXT;
BEGIN
  -- Lấy templates cho rating star
  SELECT reply_templates->p_rating_star::TEXT
  INTO v_templates
  FROM apishopee_auto_reply_config
  WHERE shop_id = p_shop_id
  AND enabled = true;

  -- Nếu không có config hoặc không enabled
  IF v_templates IS NULL THEN
    RETURN NULL;
  END IF;

  -- Convert JSONB array to TEXT array
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_templates))
  INTO v_templates_array;

  -- Nếu không có template nào
  IF array_length(v_templates_array, 1) IS NULL OR array_length(v_templates_array, 1) = 0 THEN
    RETURN NULL;
  END IF;

  -- Random chọn 1 template (index from 1 to length)
  v_random_index := floor(random() * array_length(v_templates_array, 1) + 1)::INT;
  v_reply_text := v_templates_array[v_random_index];

  RETURN v_reply_text;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. Function: Get unreplied reviews cần auto-reply
-- =====================================================
CREATE OR REPLACE FUNCTION get_reviews_need_auto_reply(
  p_shop_id BIGINT,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  comment_id BIGINT,
  rating_star INT,
  create_time BIGINT,
  comment TEXT
) AS $$
DECLARE
  v_config RECORD;
  v_cutoff_time BIGINT;
BEGIN
  -- Lấy config
  SELECT
    enabled,
    only_reply_unreplied,
    min_rating_to_reply,
    reply_delay_minutes
  INTO v_config
  FROM apishopee_auto_reply_config
  WHERE shop_id = p_shop_id;

  -- Nếu không enabled hoặc không có config
  IF v_config IS NULL OR v_config.enabled = false THEN
    RETURN;
  END IF;

  -- Tính cutoff time (Unix timestamp)
  -- Chỉ reply các review cũ hơn reply_delay_minutes phút
  v_cutoff_time := EXTRACT(EPOCH FROM NOW() - INTERVAL '1 minute' * v_config.reply_delay_minutes)::BIGINT;

  -- Query reviews cần reply
  RETURN QUERY
  SELECT
    r.comment_id,
    r.rating_star,
    r.create_time,
    r.comment
  FROM apishopee_reviews r
  WHERE r.shop_id = p_shop_id
    -- Chỉ lấy reviews chưa có reply (nếu config bật)
    AND (
      v_config.only_reply_unreplied = false
      OR r.reply_text IS NULL
    )
    -- Chỉ lấy reviews >= min_rating (nếu có set)
    AND (
      v_config.min_rating_to_reply IS NULL
      OR r.rating_star >= v_config.min_rating_to_reply
    )
    -- Chỉ lấy reviews đã đủ thời gian delay
    AND r.create_time <= v_cutoff_time
    -- Chưa được auto-reply trước đó (check log)
    AND NOT EXISTS (
      SELECT 1 FROM apishopee_auto_reply_logs l
      WHERE l.shop_id = r.shop_id
        AND l.comment_id = r.comment_id
        AND l.status = 'success'
    )
  ORDER BY r.create_time ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. Thêm cột reply_hidden vào apishopee_reviews (nếu chưa có)
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'apishopee_reviews'
    AND column_name = 'reply_hidden'
  ) THEN
    ALTER TABLE apishopee_reviews
    ADD COLUMN reply_hidden BOOLEAN DEFAULT false;
  END IF;
END $$;

-- =====================================================
-- 9. Comments
-- =====================================================
COMMENT ON TABLE apishopee_auto_reply_config IS 'Cấu hình tự động trả lời đánh giá cho mỗi shop';
COMMENT ON TABLE apishopee_auto_reply_logs IS 'Lịch sử tự động trả lời đánh giá';
COMMENT ON TABLE apishopee_auto_reply_job_status IS 'Trạng thái job tự động trả lời';
COMMENT ON COLUMN apishopee_auto_reply_config.reply_templates IS 'Template câu trả lời cho mỗi mức sao (1-5), mỗi mức có array 3 câu';
COMMENT ON COLUMN apishopee_auto_reply_config.auto_reply_schedule IS 'Cron expression để schedule auto-reply job';
COMMENT ON COLUMN apishopee_auto_reply_config.reply_delay_minutes IS 'Số phút chờ sau khi có review mới thì mới auto-reply';
COMMENT ON FUNCTION get_random_reply_template IS 'Random chọn 1 template reply dựa vào rating star';
COMMENT ON FUNCTION get_reviews_need_auto_reply IS 'Lấy danh sách reviews cần auto-reply theo config';

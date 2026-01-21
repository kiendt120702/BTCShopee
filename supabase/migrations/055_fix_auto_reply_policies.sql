-- Migration: Fix auto-reply policies to prevent 406 errors
-- Issue: RLS policies too strict, causing 406 when no data exists

-- =====================================================
-- 1. Drop existing SELECT policies
-- =====================================================
DROP POLICY IF EXISTS "Users can view auto-reply config of their shops" ON apishopee_auto_reply_config;
DROP POLICY IF EXISTS "Users can view auto-reply logs of their shops" ON apishopee_auto_reply_logs;
DROP POLICY IF EXISTS "Users can view auto-reply job status of their shops" ON apishopee_auto_reply_job_status;

-- =====================================================
-- 2. Recreate SELECT policies with better logic
-- =====================================================

-- Config: Allow users to view config for shops they have access to
CREATE POLICY "Users can view auto-reply config of their shops" ON apishopee_auto_reply_config
  FOR SELECT
  TO public
  USING (
    -- Service role has full access
    auth.role() = 'service_role'
    OR
    -- User is member of the shop
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_auto_reply_config.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- Logs: Allow users to view logs for shops they have access to
CREATE POLICY "Users can view auto-reply logs of their shops" ON apishopee_auto_reply_logs
  FOR SELECT
  TO public
  USING (
    -- Service role has full access
    auth.role() = 'service_role'
    OR
    -- User is member of the shop
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_auto_reply_logs.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- Job Status: Allow users to view job status for shops they have access to
CREATE POLICY "Users can view auto-reply job status of their shops" ON apishopee_auto_reply_job_status
  FOR SELECT
  TO public
  USING (
    -- Service role has full access
    auth.role() = 'service_role'
    OR
    -- User is member of the shop
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_auto_reply_job_status.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- =====================================================
-- 3. Comments
-- =====================================================
COMMENT ON POLICY "Users can view auto-reply config of their shops" ON apishopee_auto_reply_config
  IS 'Allow users to view auto-reply config for shops they are members of. Returns empty if no config exists.';

COMMENT ON POLICY "Users can view auto-reply logs of their shops" ON apishopee_auto_reply_logs
  IS 'Allow users to view auto-reply logs for shops they are members of.';

COMMENT ON POLICY "Users can view auto-reply job status of their shops" ON apishopee_auto_reply_job_status
  IS 'Allow users to view job status for shops they are members of.';

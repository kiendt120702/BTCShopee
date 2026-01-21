-- =============================================
-- Migration: Fix Ads Sync Stuck Prevention
-- Description: Thêm cơ chế tự động reset is_syncing flag và skip shops đang sync
-- =============================================

-- 1. Update sync_all_shops_ads() để skip shops đang syncing và auto-reset stuck syncs
CREATE OR REPLACE FUNCTION sync_all_shops_ads()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shop_record RECORD;
  result JSONB;
  stuck_timeout INTERVAL := INTERVAL '20 minutes'; -- Timeout threshold
BEGIN
  -- Auto-reset stuck syncs (is_syncing = true nhưng last_sync_at > 20 phút)
  UPDATE apishopee_ads_sync_status
  SET
    is_syncing = false,
    last_sync_error = 'Auto-reset: sync stuck for more than 20 minutes',
    sync_progress = jsonb_build_object('step', 'auto_reset', 'reason', 'timeout')
  WHERE is_syncing = true
    AND last_sync_at < NOW() - stuck_timeout;

  -- Sync chỉ những shops không đang trong quá trình sync
  FOR shop_record IN
    SELECT s.shop_id
    FROM apishopee_shops s
    LEFT JOIN apishopee_ads_sync_status st ON s.shop_id = st.shop_id
    WHERE s.access_token IS NOT NULL
      AND s.access_token != ''
      AND (st.is_syncing IS NULL OR st.is_syncing = false)
  LOOP
    BEGIN
      SELECT net.http_post(
        url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object('action', 'sync', 'shop_id', shop_record.shop_id)
      ) INTO result;
      RAISE NOTICE 'Synced ads for shop %', shop_record.shop_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to sync ads for shop %: %', shop_record.shop_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- 2. Update backfill function với cùng logic
CREATE OR REPLACE FUNCTION backfill_all_shops_ads_day(days_ago INTEGER DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shop_record RECORD;
  result JSONB;
  stuck_timeout INTERVAL := INTERVAL '20 minutes';
BEGIN
  RAISE NOTICE 'Starting incremental backfill for day % ago', days_ago;

  -- Auto-reset stuck syncs
  UPDATE apishopee_ads_sync_status
  SET
    is_syncing = false,
    last_sync_error = 'Auto-reset: backfill stuck for more than 20 minutes',
    sync_progress = jsonb_build_object('step', 'auto_reset', 'reason', 'timeout')
  WHERE is_syncing = true
    AND last_sync_at < NOW() - stuck_timeout;

  -- Backfill chỉ những shops không đang sync
  FOR shop_record IN
    SELECT s.shop_id
    FROM apishopee_shops s
    LEFT JOIN apishopee_ads_sync_status st ON s.shop_id = st.shop_id
    WHERE s.access_token IS NOT NULL
      AND s.access_token != ''
      AND (st.is_syncing IS NULL OR st.is_syncing = false)
  LOOP
    BEGIN
      SELECT net.http_post(
        url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'action', 'sync_day',
          'shop_id', shop_record.shop_id,
          'days_ago', days_ago,
          'use_all_campaigns', true
        )
      ) INTO result;
      RAISE NOTICE 'Backfilled day % for shop %', days_ago, shop_record.shop_id;
      PERFORM pg_sleep(1);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to backfill day % for shop %: %', days_ago, shop_record.shop_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- 3. Comments
COMMENT ON FUNCTION sync_all_shops_ads() IS 'Realtime sync với auto-reset stuck syncs (>20 min) và skip shops đang sync';
COMMENT ON FUNCTION backfill_all_shops_ads_day(INTEGER) IS 'Incremental backfill với auto-reset stuck syncs và skip shops đang sync';

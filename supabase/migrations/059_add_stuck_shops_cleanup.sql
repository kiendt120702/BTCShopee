-- =============================================
-- Migration: Ads Sync Stuck Shops Cleanup
-- Description: Tự động reset stuck shops mỗi 10 phút
-- =============================================

-- 1. Function để cleanup stuck shops
CREATE OR REPLACE FUNCTION cleanup_stuck_ads_sync()
RETURNS TABLE(
  reset_count INTEGER,
  shop_ids BIGINT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stuck_shops BIGINT[];
  reset_count_var INTEGER;
BEGIN
  -- Lấy danh sách shops bị stuck
  SELECT ARRAY_AGG(shop_id) INTO stuck_shops
  FROM apishopee_ads_sync_status
  WHERE is_syncing = true
    AND last_sync_at < NOW() - INTERVAL '30 minutes';

  -- Reset shops stuck quá 30 phút
  UPDATE apishopee_ads_sync_status
  SET is_syncing = false,
      sync_progress = jsonb_build_object(
        'step', 'timeout_reset',
        'reset_at', NOW()::TEXT,
        'reason', 'Auto-reset: Sync stuck for >30 minutes'
      ),
      last_sync_error = 'Auto-reset: Sync stuck for >30 minutes'
  WHERE is_syncing = true
    AND last_sync_at < NOW() - INTERVAL '30 minutes';

  GET DIAGNOSTICS reset_count_var = ROW_COUNT;

  IF reset_count_var > 0 THEN
    RAISE NOTICE 'Reset % stuck shops: %', reset_count_var, stuck_shops;
  END IF;

  RETURN QUERY SELECT reset_count_var, COALESCE(stuck_shops, ARRAY[]::BIGINT[]);
END;
$$;

-- 2. Function để cleanup failed queue jobs (quá 7 ngày)
-- Đã có trong migration 058, đảm bảo nó chạy
CREATE OR REPLACE FUNCTION cleanup_old_sync_queue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM apishopee_ads_sync_queue
  WHERE status IN ('completed', 'failed')
    AND completed_at < NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Cleaned up % old sync queue records', deleted_count;
  RETURN deleted_count;
END;
$$;

-- 3. Tạo cronjob cleanup stuck shops (mỗi 10 phút)
SELECT cron.schedule(
  'ads-sync-stuck-cleanup',
  '*/10 * * * *', -- Chạy mỗi 10 phút
  $$SELECT cleanup_stuck_ads_sync();$$
);

-- 4. Đảm bảo cronjob cleanup old queue vẫn chạy (1 lần/ngày lúc 2AM)
-- Unschedule nếu đã tồn tại
DO $$
BEGIN
  PERFORM cron.unschedule('ads-sync-queue-cleanup');
EXCEPTION WHEN OTHERS THEN
  -- Ignore nếu job không tồn tại
  NULL;
END $$;

SELECT cron.schedule(
  'ads-sync-queue-cleanup',
  '0 2 * * *', -- Chạy lúc 2AM mỗi ngày
  $$SELECT cleanup_old_sync_queue();$$
);

-- 5. View để monitor stuck shops
CREATE OR REPLACE VIEW v_stuck_ads_sync AS
SELECT
  s.shop_id,
  s.shop_name,
  ss.is_syncing,
  ss.last_sync_at,
  EXTRACT(EPOCH FROM (NOW() - ss.last_sync_at))/60 AS stuck_minutes,
  ss.total_campaigns,
  ss.ongoing_campaigns,
  ss.sync_progress,
  ss.last_sync_error
FROM apishopee_ads_sync_status ss
JOIN apishopee_shops s ON s.shop_id = ss.shop_id
WHERE ss.is_syncing = true
  AND ss.last_sync_at < NOW() - INTERVAL '15 minutes'
ORDER BY stuck_minutes DESC;

-- 6. View để monitor queue health
CREATE OR REPLACE VIEW v_ads_sync_queue_health AS
SELECT
  status,
  COUNT(*) as count,
  AVG(retry_count) as avg_retries,
  MAX(retry_count) as max_retries,
  COUNT(CASE WHEN retry_count >= max_retries THEN 1 END) as failed_permanently
FROM apishopee_ads_sync_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY
  CASE status
    WHEN 'processing' THEN 1
    WHEN 'pending' THEN 2
    WHEN 'completed' THEN 3
    WHEN 'failed' THEN 4
  END;

-- 7. Comments
COMMENT ON FUNCTION cleanup_stuck_ads_sync() IS 'Tự động reset shops bị stuck >30 phút trong quá trình sync';
COMMENT ON FUNCTION cleanup_old_sync_queue() IS 'Cleanup các queue jobs cũ >7 ngày';
COMMENT ON VIEW v_stuck_ads_sync IS 'Monitor các shops đang bị stuck trong sync process';
COMMENT ON VIEW v_ads_sync_queue_health IS 'Monitor tình trạng queue trong 24h qua';

-- 8. Grant permissions cho monitoring views
GRANT SELECT ON v_stuck_ads_sync TO authenticated;
GRANT SELECT ON v_ads_sync_queue_health TO authenticated;

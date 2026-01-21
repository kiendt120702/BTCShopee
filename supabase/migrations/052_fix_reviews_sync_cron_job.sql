-- Migration: Fix reviews sync cron job
-- Fixes:
-- 1. Thêm check để tránh sync khi đang sync
-- 2. Tăng timeout lên 5 phút
-- 3. Proper error handling
-- 4. Dynamic URL configuration

-- =====================================================
-- 1. Update function để sync reviews cho tất cả shops
-- =====================================================
CREATE OR REPLACE FUNCTION sync_all_shops_reviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shop_record RECORD;
  result JSONB;
  function_url TEXT;
  anon_key TEXT;
BEGIN
  -- Lấy URL và anon key từ vault hoặc environment
  -- Sử dụng current_setting để lấy từ environment variables
  BEGIN
    function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/apishopee-reviews-sync';
    anon_key := current_setting('app.settings.supabase_anon_key', true);
  EXCEPTION WHEN OTHERS THEN
    -- Fallback nếu không có settings
    function_url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-reviews-sync';
    anon_key := '';
  END;

  -- Lấy tất cả shops đang active và chưa đang sync
  FOR shop_record IN
    SELECT s.shop_id
    FROM apishopee_shops s
    LEFT JOIN apishopee_reviews_sync_status rs ON s.shop_id = rs.shop_id
    WHERE s.access_token IS NOT NULL
      AND s.status = 'active'
      AND (rs.is_syncing IS NULL OR rs.is_syncing = false)
  LOOP
    BEGIN
      -- Gọi Edge Function để sync reviews cho từng shop
      SELECT net.http_post(
        url := function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(anon_key, '')
        ),
        body := jsonb_build_object(
          'action', 'sync',
          'shop_id', shop_record.shop_id
        ),
        timeout_milliseconds := 300000  -- 5 phút timeout cho mỗi shop
      ) INTO result;

      RAISE NOTICE 'Synced reviews for shop %: %', shop_record.shop_id, result;

      -- Đợi 3 giây giữa các shop để tránh rate limit
      PERFORM pg_sleep(3);

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to sync reviews for shop %: %', shop_record.shop_id, SQLERRM;
      -- Continue với shop tiếp theo
    END;
  END LOOP;
END;
$$;

-- =====================================================
-- 2. Comments
-- =====================================================
COMMENT ON FUNCTION sync_all_shops_reviews() IS 'Sync reviews từ Shopee API cho tất cả shops active (with proper error handling)';

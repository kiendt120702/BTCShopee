-- Migration: Create cron job for orders sync
-- Tự động sync đơn hàng từ Shopee mỗi 20 phút
-- Chỉ sync các shop đã hoàn thành initial sync

-- =====================================================
-- 1. Tạo function để sync orders cho tất cả shops
-- =====================================================
CREATE OR REPLACE FUNCTION sync_all_shops_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shop_record RECORD;
  shop_count INTEGER := 0;
  success_count INTEGER := 0;
  function_url TEXT := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-orders-sync';
  service_role_key TEXT;
BEGIN
  -- Lấy service role key từ vault
  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  -- Lấy tất cả shops:
  -- 1. Đang active với token hợp lệ
  -- 2. Đã hoàn thành initial sync (is_initial_sync_done = true)
  -- 3. Không đang sync (is_syncing = false)
  -- 4. Không bị stuck (nếu is_syncing = true quá 10 phút thì reset)
  FOR shop_record IN
    SELECT s.shop_id, os.is_syncing, os.updated_at
    FROM apishopee_shops s
    INNER JOIN apishopee_orders_sync_status os ON s.shop_id = os.shop_id
    WHERE s.access_token IS NOT NULL
      AND s.status = 'active'
      AND os.is_initial_sync_done = true  -- Chỉ sync shop đã initial xong
      AND (
        os.is_syncing = false
        OR (os.is_syncing = true AND os.updated_at < NOW() - INTERVAL '10 minutes')  -- Reset stuck syncs
      )
    ORDER BY os.last_sync_at ASC NULLS FIRST  -- Ưu tiên shop lâu chưa sync
  LOOP
    shop_count := shop_count + 1;

    BEGIN
      -- Reset stuck sync status nếu cần
      IF shop_record.is_syncing = true THEN
        UPDATE apishopee_orders_sync_status
        SET is_syncing = false,
            last_error = 'Reset: stuck sync detected',
            updated_at = NOW()
        WHERE shop_id = shop_record.shop_id;

        RAISE NOTICE 'Reset stuck sync for shop %', shop_record.shop_id;
      END IF;

      -- Gọi Edge Function để sync orders (fire-and-forget với pg_net)
      PERFORM net.http_post(
        url := function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := jsonb_build_object(
          'action', 'sync',
          'shop_id', shop_record.shop_id
        ),
        timeout_milliseconds := 60000  -- 60s timeout cho HTTP request (không phải sync time)
      );

      success_count := success_count + 1;
      RAISE NOTICE 'Triggered orders sync for shop % (%/%)', shop_record.shop_id, success_count, shop_count;

      -- Stagger requests: đợi 5 giây giữa các shop để tránh rate limit
      -- Edge function sẽ chạy async, không block ở đây
      IF shop_count < 100 THEN  -- Giới hạn tối đa 100 shops mỗi lần chạy cron
        PERFORM pg_sleep(5);
      ELSE
        RAISE NOTICE 'Reached max 100 shops per cron run, stopping';
        EXIT;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to trigger sync for shop %: %', shop_record.shop_id, SQLERRM;
      -- Continue với shop tiếp theo
    END;
  END LOOP;

  RAISE NOTICE 'Orders sync cron completed: triggered %/% shops', success_count, shop_count;
END;
$$;

-- =====================================================
-- 2. Xóa cron job cũ nếu tồn tại
-- =====================================================
DO $$
BEGIN
  PERFORM cron.unschedule('orders-sync-job');
EXCEPTION WHEN OTHERS THEN
  -- Job không tồn tại, bỏ qua
  NULL;
END $$;

-- =====================================================
-- 3. Tạo cron job sync orders mỗi 20 phút
-- =====================================================
SELECT cron.schedule(
  'orders-sync-job',
  '*/20 * * * *',  -- Mỗi 20 phút: 0, 20, 40 mỗi giờ
  'SELECT sync_all_shops_orders();'
);

-- =====================================================
-- 4. Comments
-- =====================================================
COMMENT ON FUNCTION sync_all_shops_orders() IS
'Sync orders từ Shopee API cho tất cả shops đã initial sync xong.
- Chạy mỗi 20 phút qua cron
- Chỉ sync shop đã hoàn thành initial sync
- Tự động reset stuck syncs (>10 phút)
- Stagger 5s giữa các shop để tránh rate limit
- Giới hạn 100 shops mỗi lần chạy';

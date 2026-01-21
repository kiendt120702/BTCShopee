-- Migration: Create cron job for auto-reply system
-- Tự động chạy auto-reply theo schedule đã cấu hình

-- =====================================================
-- 1. Function để process auto-reply cho tất cả shops có enabled = true
-- =====================================================
CREATE OR REPLACE FUNCTION process_all_auto_reply_jobs()
RETURNS void AS $$
DECLARE
  v_shop RECORD;
  v_result JSONB;
BEGIN
  -- Lấy tất cả shops có auto-reply enabled
  FOR v_shop IN
    SELECT shop_id
    FROM apishopee_auto_reply_config
    WHERE enabled = true
  LOOP
    BEGIN
      -- Call edge function để process auto-reply cho shop này
      -- Sử dụng pg_net extension để gọi edge function
      SELECT
        net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/apishopee-auto-reply',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_key')
          ),
          body := jsonb_build_object(
            'action', 'process',
            'shop_id', v_shop.shop_id
          )
        ) INTO v_result;

      -- Log kết quả
      RAISE NOTICE 'Auto-reply processed for shop %: %', v_shop.shop_id, v_result;

    EXCEPTION WHEN OTHERS THEN
      -- Log error nhưng không dừng vòng lặp
      RAISE WARNING 'Error processing auto-reply for shop %: %', v_shop.shop_id, SQLERRM;

      -- Update job status với error
      INSERT INTO apishopee_auto_reply_job_status (
        shop_id,
        is_running,
        last_error,
        error_count,
        consecutive_errors,
        updated_at
      )
      VALUES (
        v_shop.shop_id,
        false,
        SQLERRM,
        COALESCE((SELECT error_count FROM apishopee_auto_reply_job_status WHERE shop_id = v_shop.shop_id), 0) + 1,
        COALESCE((SELECT consecutive_errors FROM apishopee_auto_reply_job_status WHERE shop_id = v_shop.shop_id), 0) + 1,
        NOW()
      )
      ON CONFLICT (shop_id)
      DO UPDATE SET
        is_running = false,
        last_error = EXCLUDED.last_error,
        error_count = EXCLUDED.error_count,
        consecutive_errors = EXCLUDED.consecutive_errors,
        updated_at = NOW();
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 2. Tạo cron job chạy mỗi 30 phút
-- =====================================================
-- Lưu ý: Cron job này sẽ chạy cho TẤT CẢ shops có auto-reply enabled
-- Mỗi shop có thể có schedule riêng được lưu trong config (để mở rộng sau)

SELECT cron.schedule(
  'auto-reply-reviews-job',           -- job name
  '*/30 * * * *',                      -- cron expression: mỗi 30 phút
  $$
  SELECT process_all_auto_reply_jobs();
  $$
);

-- =====================================================
-- 3. Comments
-- =====================================================
COMMENT ON FUNCTION process_all_auto_reply_jobs IS 'Process auto-reply cho tất cả shops có auto-reply enabled';

-- =====================================================
-- 4. Grant permissions
-- =====================================================
-- Cho phép service role execute function
GRANT EXECUTE ON FUNCTION process_all_auto_reply_jobs() TO service_role;

-- =====================================================
-- 5. Note về cách sử dụng pg_net
-- =====================================================
-- pg_net extension cần được enable:
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Và cần set config cho Supabase URL và Service Key:
-- ALTER DATABASE postgres SET app.settings.supabase_url = 'https://your-project.supabase.co';
-- ALTER DATABASE postgres SET app.settings.supabase_service_key = 'your-service-key';

-- Hoặc có thể hardcode trực tiếp trong function (không khuyến khích vì security)

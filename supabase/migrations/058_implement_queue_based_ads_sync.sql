-- =============================================
-- Migration: Queue-based Ads Sync System
-- Description: Chuyển từ parallel sync sang queue-based sync để tránh timeout
-- =============================================

-- 1. Tạo bảng sync queue để quản lý thứ tự sync
CREATE TABLE IF NOT EXISTS apishopee_ads_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  priority INTEGER DEFAULT 0, -- Priority cao hơn sẽ chạy trước (0=low, 1=normal, 2=high, 3=critical)
  sync_type TEXT NOT NULL CHECK (sync_type IN ('realtime', 'backfill_day', 'backfill_full')),
  sync_params JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index để query nhanh
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_priority
ON apishopee_ads_sync_queue(status, priority DESC, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS idx_sync_queue_shop_id
ON apishopee_ads_sync_queue(shop_id, status);

-- 2. Function để enqueue sync job cho tất cả shops
CREATE OR REPLACE FUNCTION enqueue_all_shops_sync(
  p_sync_type TEXT DEFAULT 'realtime',
  p_priority INTEGER DEFAULT 1
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shop_record RECORD;
  enqueued_count INTEGER := 0;
BEGIN
  -- Enqueue sync job cho từng shop
  FOR shop_record IN
    SELECT shop_id
    FROM apishopee_shops
    WHERE access_token IS NOT NULL
      AND access_token != ''
  LOOP
    -- Chỉ thêm vào queue nếu chưa có pending/processing job cho shop này
    INSERT INTO apishopee_ads_sync_queue (shop_id, sync_type, priority)
    SELECT shop_record.shop_id, p_sync_type, p_priority
    WHERE NOT EXISTS (
      SELECT 1 FROM apishopee_ads_sync_queue
      WHERE shop_id = shop_record.shop_id
        AND status IN ('pending', 'processing')
        AND sync_type = p_sync_type
    );

    IF FOUND THEN
      enqueued_count := enqueued_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Enqueued % shops for % sync', enqueued_count, p_sync_type;
  RETURN enqueued_count;
END;
$$;

-- 3. Function để process 1 job từ queue (chạy tuần tự)
CREATE OR REPLACE FUNCTION process_next_sync_job()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_record RECORD;
  result JSONB;
  request_body JSONB;
BEGIN
  -- Lấy job có priority cao nhất, scheduled sớm nhất
  SELECT * INTO job_record
  FROM apishopee_ads_sync_queue
  WHERE status = 'pending'
  ORDER BY priority DESC, scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED; -- Tránh race condition

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'No pending jobs in queue'
    );
  END IF;

  -- Update status = processing
  UPDATE apishopee_ads_sync_queue
  SET status = 'processing',
      started_at = NOW()
  WHERE id = job_record.id;

  -- Build request body dựa vào sync_type
  CASE job_record.sync_type
    WHEN 'realtime' THEN
      request_body := jsonb_build_object(
        'action', 'sync',
        'shop_id', job_record.shop_id
      );
    WHEN 'backfill_day' THEN
      request_body := jsonb_build_object(
        'action', 'sync_day',
        'shop_id', job_record.shop_id,
        'days_ago', COALESCE((job_record.sync_params->>'days_ago')::INTEGER, 0),
        'use_all_campaigns', true
      );
    WHEN 'backfill_full' THEN
      request_body := jsonb_build_object(
        'action', 'sync',
        'shop_id', job_record.shop_id,
        'use_all_campaigns', true
      );
  END CASE;

  -- Gọi edge function
  BEGIN
    SELECT net.http_post(
      url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := request_body
    ) INTO result;

    -- Mark as completed
    UPDATE apishopee_ads_sync_queue
    SET status = 'completed',
        completed_at = NOW()
    WHERE id = job_record.id;

    RAISE NOTICE 'Completed sync for shop % (job %)', job_record.shop_id, job_record.id;

    RETURN jsonb_build_object(
      'success', true,
      'job_id', job_record.id,
      'shop_id', job_record.shop_id,
      'sync_type', job_record.sync_type
    );

  EXCEPTION WHEN OTHERS THEN
    -- Retry logic
    IF job_record.retry_count < job_record.max_retries THEN
      UPDATE apishopee_ads_sync_queue
      SET status = 'pending',
          retry_count = retry_count + 1,
          error_message = SQLERRM,
          scheduled_at = NOW() + INTERVAL '5 minutes' -- Delay 5 phút trước khi retry
      WHERE id = job_record.id;

      RAISE WARNING 'Job % failed, retry %/%: %',
        job_record.id, job_record.retry_count + 1, job_record.max_retries, SQLERRM;
    ELSE
      -- Max retries reached, mark as failed
      UPDATE apishopee_ads_sync_queue
      SET status = 'failed',
          completed_at = NOW(),
          error_message = SQLERRM
      WHERE id = job_record.id;

      RAISE WARNING 'Job % failed after % retries: %',
        job_record.id, job_record.max_retries, SQLERRM;
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'job_id', job_record.id,
      'shop_id', job_record.shop_id,
      'error', SQLERRM,
      'retry_count', job_record.retry_count
    );
  END;
END;
$$;

-- 4. Function để process N jobs liên tiếp (worker function)
CREATE OR REPLACE FUNCTION process_sync_queue_batch(batch_size INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  i INTEGER := 0;
  job_result JSONB;
  results JSONB := '[]'::jsonb;
  success_count INTEGER := 0;
  error_count INTEGER := 0;
BEGIN
  WHILE i < batch_size LOOP
    -- Process next job
    SELECT process_next_sync_job() INTO job_result;

    -- Nếu không còn job, thoát
    IF (job_result->>'success')::boolean = false AND job_result->>'message' = 'No pending jobs in queue' THEN
      EXIT;
    END IF;

    -- Track kết quả
    results := results || jsonb_build_array(job_result);

    IF (job_result->>'success')::boolean THEN
      success_count := success_count + 1;
    ELSE
      error_count := error_count + 1;
    END IF;

    i := i + 1;

    -- Delay nhỏ giữa các jobs để tránh rate limit
    PERFORM pg_sleep(0.5);
  END LOOP;

  RETURN jsonb_build_object(
    'processed', i,
    'success', success_count,
    'errors', error_count,
    'details', results
  );
END;
$$;

-- 5. Update sync_all_shops_ads() để dùng queue
CREATE OR REPLACE FUNCTION sync_all_shops_ads()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  enqueued INTEGER;
BEGIN
  -- Enqueue tất cả shops vào queue
  SELECT enqueue_all_shops_sync('realtime', 1) INTO enqueued;

  -- Process một batch nhỏ ngay (5 shops)
  -- Các shops còn lại sẽ được process bởi cronjob tiếp theo
  PERFORM process_sync_queue_batch(5);

  RAISE NOTICE 'Sync triggered: enqueued % shops, processed first batch', enqueued;
END;
$$;

-- 6. Tạo function để cleanup old completed/failed jobs (>7 days)
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

-- 7. Update backfill functions
CREATE OR REPLACE FUNCTION backfill_all_shops_ads_day(days_ago INTEGER DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shop_record RECORD;
BEGIN
  RAISE NOTICE 'Enqueuing incremental backfill for day % ago', days_ago;

  -- Enqueue backfill jobs cho tất cả shops
  FOR shop_record IN
    SELECT shop_id
    FROM apishopee_shops
    WHERE access_token IS NOT NULL
      AND access_token != ''
  LOOP
    INSERT INTO apishopee_ads_sync_queue (shop_id, sync_type, priority, sync_params)
    VALUES (
      shop_record.shop_id,
      'backfill_day',
      2, -- Higher priority cho backfill
      jsonb_build_object('days_ago', days_ago)
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Process một batch nhỏ
  PERFORM process_sync_queue_batch(3);
END;
$$;

-- 8. Tạo cronjob mới để process queue liên tục
SELECT cron.schedule(
  'ads-sync-queue-processor',
  '*/5 * * * *', -- Chạy mỗi 5 phút
  $$
  -- Process 10 jobs mỗi lần
  SELECT process_sync_queue_batch(10);
  $$
);

-- 9. Update cronjob hiện tại để chỉ enqueue
SELECT cron.unschedule('ads-sync-job');
SELECT cron.schedule(
  'ads-sync-job',
  '*/15 * * * *',
  $$SELECT enqueue_all_shops_sync('realtime', 1);$$
);

-- 10. Tạo cronjob cleanup
SELECT cron.schedule(
  'ads-sync-queue-cleanup',
  '0 2 * * *', -- Chạy lúc 2AM mỗi ngày
  $$SELECT cleanup_old_sync_queue();$$
);

-- 11. Comments
COMMENT ON TABLE apishopee_ads_sync_queue IS 'Queue để quản lý sync jobs, chạy tuần tự tránh timeout';
COMMENT ON FUNCTION enqueue_all_shops_sync(TEXT, INTEGER) IS 'Thêm sync jobs vào queue cho tất cả shops';
COMMENT ON FUNCTION process_next_sync_job() IS 'Xử lý 1 job tiếp theo trong queue (FIFO với priority)';
COMMENT ON FUNCTION process_sync_queue_batch(INTEGER) IS 'Xử lý N jobs liên tiếp, dùng cho cronjob worker';
COMMENT ON FUNCTION cleanup_old_sync_queue() IS 'Cleanup các jobs cũ >7 ngày';

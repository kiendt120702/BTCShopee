-- =============================================
-- Migration: Optimize Queue Processor with Better Timeout Handling
-- Description: Cải thiện queue processor để xử lý timeout tốt hơn
-- =============================================

-- 1. Update process_next_sync_job() với timeout handling tốt hơn
CREATE OR REPLACE FUNCTION process_next_sync_job()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_record RECORD;
  result JSONB;
  request_body JSONB;
  shop_record RECORD;
  http_response RECORD;
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

  -- Lấy thông tin shop để check campaigns count
  SELECT total_campaigns INTO shop_record
  FROM apishopee_ads_sync_status
  WHERE shop_id = job_record.shop_id;

  -- Update status = processing
  UPDATE apishopee_ads_sync_queue
  SET status = 'processing',
      started_at = NOW()
  WHERE id = job_record.id;

  -- OPTIMIZED: Nếu shop có nhiều campaigns (>500), chia nhỏ thành 2 requests
  -- Request 1: Sync campaigns only (nhanh)
  -- Request 2: Sync performance only (chậm hơn nhưng ổn định)
  IF shop_record.total_campaigns > 500 THEN
    RAISE NOTICE 'Shop % has % campaigns - using split sync strategy',
      job_record.shop_id, shop_record.total_campaigns;

    -- Step 1: Sync campaigns only
    BEGIN
      SELECT net.http_post(
        url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'action', 'sync_campaigns_only',
          'shop_id', job_record.shop_id
        ),
        timeout_milliseconds := 30000  -- 30 giây cho campaigns
      ) INTO http_response;

      RAISE NOTICE 'Step 1 (campaigns) completed for shop %', job_record.shop_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Step 1 (campaigns) failed for shop %: %', job_record.shop_id, SQLERRM;
      -- Không throw error, tiếp tục với performance sync
    END;

    -- Delay nhỏ giữa 2 requests
    PERFORM pg_sleep(1);

    -- Step 2: Sync performance only
    BEGIN
      SELECT net.http_post(
        url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'action', 'sync_performance_only',
          'shop_id', job_record.shop_id
        ),
        timeout_milliseconds := 60000  -- 60 giây cho performance
      ) INTO http_response;

      RAISE NOTICE 'Step 2 (performance) completed for shop %', job_record.shop_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Step 2 (performance) failed for shop %: %', job_record.shop_id, SQLERRM;
    END;

  ELSE
    -- Shop nhỏ (<= 500 campaigns): Sync full như cũ
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

    -- Gọi edge function với timeout 50 giây
    BEGIN
      SELECT net.http_post(
        url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := request_body,
        timeout_milliseconds := 50000  -- 50 giây
      ) INTO http_response;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Sync failed for shop %: %', job_record.shop_id, SQLERRM;
    END;
  END IF;

  -- Mark as completed (thành công hoặc có lỗi nhưng đã xử lý xong)
  UPDATE apishopee_ads_sync_queue
  SET status = 'completed',
      completed_at = NOW()
  WHERE id = job_record.id;

  -- Reset is_syncing flag nếu shop vẫn stuck
  UPDATE apishopee_ads_sync_status
  SET is_syncing = false
  WHERE shop_id = job_record.shop_id
    AND is_syncing = true
    AND last_sync_at < NOW() - INTERVAL '5 minutes';

  RAISE NOTICE 'Completed job % for shop %', job_record.id, job_record.shop_id;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', job_record.id,
    'shop_id', job_record.shop_id,
    'sync_type', job_record.sync_type,
    'split_sync', shop_record.total_campaigns > 500
  );

EXCEPTION WHEN OTHERS THEN
  -- Retry logic cho errors không mong muốn
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

    -- Reset is_syncing flag
    UPDATE apishopee_ads_sync_status
    SET is_syncing = false,
        last_sync_error = 'Queue job failed after max retries: ' || SQLERRM
    WHERE shop_id = job_record.shop_id;

    RAISE WARNING 'Job % failed permanently after % retries: %',
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
$$;

-- 2. Update process_sync_queue_batch() với better error handling
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
  start_time TIMESTAMPTZ;
  elapsed_seconds NUMERIC;
BEGIN
  start_time := NOW();

  RAISE NOTICE 'Starting batch processing: max % jobs', batch_size;

  WHILE i < batch_size LOOP
    -- Process next job
    SELECT process_next_sync_job() INTO job_result;

    -- Nếu không còn job, thoát
    IF (job_result->>'success')::boolean = false AND job_result->>'message' = 'No pending jobs in queue' THEN
      RAISE NOTICE 'No more pending jobs, processed % jobs', i;
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

    -- Delay nhỏ giữa các jobs để tránh rate limit (0.5s)
    PERFORM pg_sleep(0.5);

    -- Break nếu đã chạy quá 4 phút (tránh cronjob timeout)
    elapsed_seconds := EXTRACT(EPOCH FROM (NOW() - start_time));
    IF elapsed_seconds > 240 THEN
      RAISE NOTICE 'Batch timeout after % seconds, processed % jobs', elapsed_seconds, i;
      EXIT;
    END IF;
  END LOOP;

  elapsed_seconds := EXTRACT(EPOCH FROM (NOW() - start_time));

  RAISE NOTICE 'Batch completed: % jobs in %.2f seconds (% success, % errors)',
    i, elapsed_seconds, success_count, error_count;

  RETURN jsonb_build_object(
    'processed', i,
    'success', success_count,
    'errors', error_count,
    'elapsed_seconds', elapsed_seconds,
    'details', results
  );
END;
$$;

-- 3. Comments
COMMENT ON FUNCTION process_next_sync_job() IS 'Process 1 job - với split sync strategy cho shops >500 campaigns';
COMMENT ON FUNCTION process_sync_queue_batch(INTEGER) IS 'Process N jobs với timeout protection (max 4 phút)';

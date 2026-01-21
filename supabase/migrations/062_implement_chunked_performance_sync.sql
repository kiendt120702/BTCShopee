-- =============================================
-- Migration 062: Implement Chunked Performance Sync
-- =============================================
-- Purpose: Extend chunked sync to performance data
-- Strategy: After campaign chunks complete, create performance chunk jobs
-- Date: 2026-01-20

-- =============================================
-- 1. ADD PERFORMANCE CHUNK COLUMNS
-- =============================================

-- Add columns to track performance chunks separately
ALTER TABLE apishopee_ads_sync_progress
  ADD COLUMN IF NOT EXISTS performance_chunk_index INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS performance_total_chunks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS performance_stage TEXT DEFAULT 'pending'
    CHECK (performance_stage IN ('pending', 'syncing', 'completed', 'failed'));

-- Add sync_type to distinguish campaign vs performance chunks
ALTER TABLE apishopee_ads_sync_queue
  ADD COLUMN IF NOT EXISTS chunk_type TEXT DEFAULT 'campaign'
    CHECK (chunk_type IN ('campaign', 'performance'));

-- Index for performance chunk queries
CREATE INDEX IF NOT EXISTS idx_ads_sync_queue_perf_chunks
  ON apishopee_ads_sync_queue(shop_id, chunk_type, chunk_index)
  WHERE is_chunk = TRUE AND chunk_type = 'performance';

-- =============================================
-- 2. FUNCTION: Create Performance Chunk Jobs
-- =============================================

CREATE OR REPLACE FUNCTION create_performance_chunk_jobs(
  p_shop_id BIGINT,
  p_chunk_size INTEGER DEFAULT 50  -- Performance is heavier, use smaller chunks
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_campaigns INTEGER[];
  v_total_campaigns INTEGER;
  v_total_chunks INTEGER;
  v_chunk_index INTEGER;
  v_start_idx INTEGER;
  v_end_idx INTEGER;
  v_campaign_ids INTEGER[];
BEGIN
  -- Get all campaign IDs for this shop
  SELECT ARRAY_AGG(campaign_id) INTO v_campaigns
  FROM apishopee_ads_campaigns
  WHERE shop_id = p_shop_id;

  v_total_campaigns := COALESCE(ARRAY_LENGTH(v_campaigns, 1), 0);

  IF v_total_campaigns = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'No campaigns to sync performance for',
      'total_chunks', 0
    );
  END IF;

  -- Calculate total chunks needed
  v_total_chunks := CEIL(v_total_campaigns::NUMERIC / p_chunk_size);

  -- Update progress to show we're starting performance sync
  UPDATE apishopee_ads_sync_progress
  SET
    sync_stage = 'syncing_performance',
    performance_chunk_index = 0,
    performance_total_chunks = v_total_chunks,
    performance_stage = 'syncing',
    updated_at = NOW()
  WHERE shop_id = p_shop_id;

  -- Create performance chunk jobs
  FOR v_chunk_index IN 0..(v_total_chunks - 1) LOOP
    v_start_idx := v_chunk_index * p_chunk_size + 1;
    v_end_idx := LEAST((v_chunk_index + 1) * p_chunk_size, v_total_campaigns);

    -- Get campaign IDs for this chunk
    v_campaign_ids := v_campaigns[v_start_idx:v_end_idx];

    INSERT INTO apishopee_ads_sync_queue (
      shop_id,
      priority,
      sync_type,
      sync_params,
      status,
      chunk_index,
      chunk_size,
      is_chunk,
      chunk_type
    ) VALUES (
      p_shop_id,
      10, -- High priority for performance chunks
      'performance',
      jsonb_build_object(
        'campaign_ids', v_campaign_ids,
        'chunk_index', v_chunk_index,
        'total_chunks', v_total_chunks
      ),
      'pending',
      v_chunk_index,
      p_chunk_size,
      TRUE,
      'performance'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'total_campaigns', v_total_campaigns,
    'total_chunks', v_total_chunks,
    'chunk_size', p_chunk_size
  );
END;
$$;

-- =============================================
-- 3. FUNCTION: Check If All Campaign Chunks Complete
-- =============================================

CREATE OR REPLACE FUNCTION check_campaign_chunks_complete(p_shop_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending_chunks INTEGER;
  v_processing_chunks INTEGER;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'processing')
  INTO v_pending_chunks, v_processing_chunks
  FROM apishopee_ads_sync_queue
  WHERE shop_id = p_shop_id
    AND is_chunk = TRUE
    AND chunk_type = 'campaign';

  RETURN v_pending_chunks = 0 AND v_processing_chunks = 0;
END;
$$;

-- =============================================
-- 4. ENHANCED QUEUE PROCESSOR WITH PERFORMANCE CHUNKS
-- =============================================

CREATE OR REPLACE FUNCTION process_sync_queue_with_chunks(batch_size INTEGER DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job RECORD;
  result JSONB;
  processed_count INTEGER := 0;
  success_count INTEGER := 0;
  error_count INTEGER := 0;
  details JSONB[] := ARRAY[]::JSONB[];
  v_total_campaigns INTEGER;
  v_chunk_size INTEGER := 100;
  v_total_chunks INTEGER;
  v_chunk_index INTEGER;
  v_should_chunk BOOLEAN;
  v_campaigns_complete BOOLEAN;
  v_edge_url TEXT := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync';
BEGIN
  -- Process pending jobs
  FOR job IN
    SELECT * FROM apishopee_ads_sync_queue
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    processed_count := processed_count + 1;

    -- Update status to processing
    UPDATE apishopee_ads_sync_queue
    SET status = 'processing', started_at = NOW()
    WHERE id = job.id;

    -- HANDLE DIFFERENT JOB TYPES
    IF job.is_chunk AND job.chunk_type = 'performance' THEN
      -- ============================================
      -- PERFORMANCE CHUNK: Call sync_performance_chunk
      -- ============================================
      BEGIN
        SELECT net.http_post(
          url := v_edge_url,
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := jsonb_build_object(
            'shop_id', job.shop_id,
            'action', 'sync_performance_chunk',
            'params', job.sync_params
          )
        ) INTO result;

        -- Mark as completed
        UPDATE apishopee_ads_sync_queue
        SET status = 'completed', completed_at = NOW()
        WHERE id = job.id;

        -- Update performance progress
        UPDATE apishopee_ads_sync_progress
        SET
          performance_chunk_index = (job.sync_params->>'chunk_index')::INTEGER,
          updated_at = NOW()
        WHERE shop_id = job.shop_id;

        -- Check if this was the last performance chunk
        IF (job.sync_params->>'chunk_index')::INTEGER >= (job.sync_params->>'total_chunks')::INTEGER - 1 THEN
          UPDATE apishopee_ads_sync_progress
          SET
            sync_stage = 'completed',
            performance_stage = 'completed',
            is_complete = TRUE,
            completed_at = NOW(),
            updated_at = NOW()
          WHERE shop_id = job.shop_id;
        END IF;

        success_count := success_count + 1;
        details := array_append(details, jsonb_build_object(
          'job_id', job.id,
          'shop_id', job.shop_id,
          'type', 'performance_chunk',
          'chunk_index', job.chunk_index,
          'success', true
        ));

      EXCEPTION WHEN OTHERS THEN
        UPDATE apishopee_ads_sync_queue
        SET status = 'failed', retry_count = retry_count + 1,
            error_message = SQLERRM, completed_at = NOW()
        WHERE id = job.id;
        error_count := error_count + 1;
        details := array_append(details, jsonb_build_object(
          'job_id', job.id,
          'shop_id', job.shop_id,
          'error', SQLERRM,
          'success', false
        ));
      END;

    ELSIF job.is_chunk AND job.chunk_type = 'campaign' THEN
      -- ============================================
      -- CAMPAIGN CHUNK: Call sync_campaigns_chunk
      -- ============================================
      BEGIN
        SELECT net.http_post(
          url := v_edge_url,
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := jsonb_build_object(
            'shop_id', job.shop_id,
            'action', 'sync_campaigns_chunk',
            'params', job.sync_params
          )
        ) INTO result;

        -- Mark as completed
        UPDATE apishopee_ads_sync_queue
        SET status = 'completed', completed_at = NOW()
        WHERE id = job.id;

        -- Update chunk progress
        PERFORM update_chunk_progress(
          job.shop_id,
          (job.sync_params->>'chunk_index')::INTEGER,
          job.chunk_size
        );

        -- Check if all campaign chunks are complete
        v_campaigns_complete := check_campaign_chunks_complete(job.shop_id);

        IF v_campaigns_complete THEN
          -- Create performance chunk jobs
          PERFORM create_performance_chunk_jobs(job.shop_id, 50);
        END IF;

        success_count := success_count + 1;
        details := array_append(details, jsonb_build_object(
          'job_id', job.id,
          'shop_id', job.shop_id,
          'type', 'campaign_chunk',
          'chunk_index', job.chunk_index,
          'campaigns_complete', v_campaigns_complete,
          'success', true
        ));

      EXCEPTION WHEN OTHERS THEN
        UPDATE apishopee_ads_sync_queue
        SET status = 'failed', retry_count = retry_count + 1,
            error_message = SQLERRM, completed_at = NOW()
        WHERE id = job.id;
        error_count := error_count + 1;
        details := array_append(details, jsonb_build_object(
          'job_id', job.id,
          'shop_id', job.shop_id,
          'error', SQLERRM,
          'success', false
        ));
      END;

    ELSE
      -- ============================================
      -- REGULAR JOB: Check if needs chunking
      -- ============================================

      -- Get campaign count for this shop
      SELECT total_campaigns INTO v_total_campaigns
      FROM apishopee_ads_sync_status
      WHERE shop_id = job.shop_id;

      v_should_chunk := COALESCE(v_total_campaigns, 0) > 200;

      IF v_should_chunk THEN
        -- CHUNKING STRATEGY: Create multiple chunk jobs
        SELECT total_chunks INTO v_total_chunks
        FROM init_ads_sync_progress(job.shop_id, v_total_campaigns);

        -- Create campaign chunk jobs
        FOR v_chunk_index IN 0..(v_total_chunks - 1) LOOP
          INSERT INTO apishopee_ads_sync_queue (
            shop_id, priority, sync_type, sync_params, status,
            chunk_index, chunk_size, is_chunk, chunk_type
          ) VALUES (
            job.shop_id, job.priority, job.sync_type,
            jsonb_build_object(
              'offset', v_chunk_index * v_chunk_size,
              'limit', v_chunk_size,
              'chunk_index', v_chunk_index,
              'total_chunks', v_total_chunks
            ),
            'pending', v_chunk_index, v_chunk_size, TRUE, 'campaign'
          );
        END LOOP;

        -- Mark original job as completed (spawned chunks)
        UPDATE apishopee_ads_sync_queue
        SET status = 'completed', completed_at = NOW(),
            error_message = format('Split into %s campaign chunks', v_total_chunks)
        WHERE id = job.id;

        success_count := success_count + 1;
        details := array_append(details, jsonb_build_object(
          'job_id', job.id,
          'shop_id', job.shop_id,
          'action', 'chunked',
          'total_chunks', v_total_chunks,
          'success', true
        ));

      ELSE
        -- SMALL SHOP: Direct sync
        BEGIN
          SELECT net.http_post(
            url := v_edge_url,
            headers := '{"Content-Type": "application/json"}'::jsonb,
            body := jsonb_build_object('shop_id', job.shop_id, 'action', 'sync')
          ) INTO result;

          UPDATE apishopee_ads_sync_queue
          SET status = 'completed', completed_at = NOW()
          WHERE id = job.id;

          success_count := success_count + 1;
          details := array_append(details, jsonb_build_object(
            'job_id', job.id,
            'shop_id', job.shop_id,
            'type', 'direct_sync',
            'success', true
          ));

        EXCEPTION WHEN OTHERS THEN
          UPDATE apishopee_ads_sync_queue
          SET status = 'failed', retry_count = retry_count + 1,
              error_message = SQLERRM, completed_at = NOW()
          WHERE id = job.id;
          error_count := error_count + 1;
          details := array_append(details, jsonb_build_object(
            'job_id', job.id,
            'shop_id', job.shop_id,
            'error', SQLERRM,
            'success', false
          ));
        END;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', processed_count,
    'success', success_count,
    'errors', error_count,
    'details', details
  );
END;
$$;

-- =============================================
-- 5. FUNCTION: Manually Trigger Performance Sync for Shop
-- =============================================

CREATE OR REPLACE FUNCTION trigger_performance_sync(p_shop_id BIGINT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Clear any existing performance chunks
  DELETE FROM apishopee_ads_sync_queue
  WHERE shop_id = p_shop_id
    AND chunk_type = 'performance'
    AND status IN ('pending', 'processing');

  -- Create new performance chunk jobs
  SELECT create_performance_chunk_jobs(p_shop_id, 50) INTO v_result;

  RETURN v_result;
END;
$$;

-- =============================================
-- 6. UPDATED MONITORING VIEW
-- =============================================

CREATE OR REPLACE VIEW v_ads_sync_progress_status AS
SELECT
  p.shop_id,
  s.shop_name,
  p.sync_stage,
  -- Campaign progress
  p.current_chunk as campaign_chunk,
  p.total_chunks as campaign_total_chunks,
  ROUND(100.0 * p.synced_campaigns / NULLIF(p.total_campaigns, 0), 2) as campaign_progress_percent,
  -- Performance progress
  p.performance_chunk_index as perf_chunk,
  p.performance_total_chunks as perf_total_chunks,
  CASE
    WHEN p.performance_total_chunks > 0
    THEN ROUND(100.0 * (p.performance_chunk_index + 1) / p.performance_total_chunks, 2)
    ELSE 0
  END as perf_progress_percent,
  p.performance_stage,
  -- Overall status
  p.synced_campaigns,
  p.total_campaigns,
  p.started_at,
  p.last_chunk_at,
  EXTRACT(EPOCH FROM (NOW() - p.last_chunk_at)) / 60 as minutes_since_last_chunk,
  p.is_complete,
  ARRAY_LENGTH(p.failed_chunks, 1) as failed_chunk_count,
  p.error_message,
  -- Queue status
  (SELECT COUNT(*) FROM apishopee_ads_sync_queue q
   WHERE q.shop_id = p.shop_id AND q.status = 'pending' AND q.chunk_type = 'campaign') as pending_campaign_chunks,
  (SELECT COUNT(*) FROM apishopee_ads_sync_queue q
   WHERE q.shop_id = p.shop_id AND q.status = 'pending' AND q.chunk_type = 'performance') as pending_perf_chunks
FROM apishopee_ads_sync_progress p
JOIN apishopee_shops s ON s.shop_id = p.shop_id
ORDER BY p.started_at DESC;

-- =============================================
-- 7. GRANT PERMISSIONS
-- =============================================

GRANT EXECUTE ON FUNCTION create_performance_chunk_jobs(BIGINT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION check_campaign_chunks_complete(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_performance_sync(BIGINT) TO authenticated;

-- =============================================
-- SUMMARY
-- =============================================

-- Migration 062 implements:
-- 1. ✅ Performance chunk columns in progress table
-- 2. ✅ chunk_type column in queue table
-- 3. ✅ create_performance_chunk_jobs() function
-- 4. ✅ check_campaign_chunks_complete() function
-- 5. ✅ Enhanced queue processor handles performance chunks
-- 6. ✅ trigger_performance_sync() for manual triggers
-- 7. ✅ Updated monitoring view with performance progress

-- Flow:
-- 1. Regular job arrives → splits into campaign chunks
-- 2. Campaign chunks execute → sync_campaigns_chunk
-- 3. Last campaign chunk completes → creates performance chunks
-- 4. Performance chunks execute → sync_performance_chunk
-- 5. Last performance chunk → marks sync complete, updates UI

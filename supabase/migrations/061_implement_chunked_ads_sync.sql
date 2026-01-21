-- =============================================
-- Migration 061: Implement Chunked Ads Sync
-- =============================================
-- Purpose: Fix timeout issues for shops with >500 campaigns
-- Strategy: Split large syncs into smaller chunks
-- Date: 2026-01-20

-- =============================================
-- 1. CREATE PROGRESS TRACKING TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS apishopee_ads_sync_progress (
  shop_id BIGINT PRIMARY KEY REFERENCES apishopee_shops(shop_id) ON DELETE CASCADE,

  -- Progress tracking
  total_campaigns INTEGER NOT NULL DEFAULT 0,
  synced_campaigns INTEGER NOT NULL DEFAULT 0,
  current_chunk INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,

  -- Status
  sync_stage TEXT NOT NULL DEFAULT 'idle' CHECK (sync_stage IN ('idle', 'syncing_campaigns', 'syncing_performance', 'completed', 'failed')),
  is_complete BOOLEAN NOT NULL DEFAULT FALSE,

  -- Timestamps
  started_at TIMESTAMPTZ,
  last_chunk_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error handling
  error_message TEXT,
  failed_chunks INTEGER[] DEFAULT ARRAY[]::INTEGER[],

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying active syncs
CREATE INDEX IF NOT EXISTS idx_ads_sync_progress_stage ON apishopee_ads_sync_progress(sync_stage) WHERE sync_stage != 'idle';
CREATE INDEX IF NOT EXISTS idx_ads_sync_progress_incomplete ON apishopee_ads_sync_progress(is_complete) WHERE is_complete = FALSE;

-- Enable RLS
ALTER TABLE apishopee_ads_sync_progress ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users
CREATE POLICY "Allow authenticated users full access to sync progress"
  ON apishopee_ads_sync_progress
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 2. UPDATE QUEUE TABLE TO SUPPORT CHUNKS
-- =============================================

-- Add chunk parameters to existing queue table
ALTER TABLE apishopee_ads_sync_queue
  ADD COLUMN IF NOT EXISTS chunk_index INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS chunk_size INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_chunk BOOLEAN DEFAULT FALSE;

-- Index for chunk queries
CREATE INDEX IF NOT EXISTS idx_ads_sync_queue_chunks
  ON apishopee_ads_sync_queue(shop_id, chunk_index)
  WHERE is_chunk = TRUE;

-- =============================================
-- 3. FUNCTION: Initialize Sync Progress
-- =============================================

CREATE OR REPLACE FUNCTION init_ads_sync_progress(
  p_shop_id BIGINT,
  p_total_campaigns INTEGER
)
RETURNS TABLE(
  shop_id BIGINT,
  total_chunks INTEGER,
  chunk_size INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_chunk_size INTEGER := 100; -- Campaigns per chunk
  v_total_chunks INTEGER;
BEGIN
  -- Calculate total chunks needed
  v_total_chunks := CEIL(p_total_campaigns::NUMERIC / v_chunk_size);

  -- Insert or update progress
  INSERT INTO apishopee_ads_sync_progress (
    shop_id,
    total_campaigns,
    synced_campaigns,
    current_chunk,
    total_chunks,
    sync_stage,
    is_complete,
    started_at,
    last_chunk_at
  ) VALUES (
    p_shop_id,
    p_total_campaigns,
    0,
    0,
    v_total_chunks,
    'syncing_campaigns',
    FALSE,
    NOW(),
    NOW()
  )
  ON CONFLICT (shop_id) DO UPDATE SET
    total_campaigns = EXCLUDED.total_campaigns,
    synced_campaigns = 0,
    current_chunk = 0,
    total_chunks = EXCLUDED.total_chunks,
    sync_stage = 'syncing_campaigns',
    is_complete = FALSE,
    started_at = NOW(),
    last_chunk_at = NOW(),
    error_message = NULL,
    failed_chunks = ARRAY[]::INTEGER[],
    updated_at = NOW();

  RETURN QUERY SELECT p_shop_id, v_total_chunks, v_chunk_size;
END;
$$;

-- =============================================
-- 4. FUNCTION: Update Chunk Progress
-- =============================================

CREATE OR REPLACE FUNCTION update_chunk_progress(
  p_shop_id BIGINT,
  p_chunk_index INTEGER,
  p_synced_count INTEGER,
  p_success BOOLEAN DEFAULT TRUE,
  p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_success THEN
    -- Update successful chunk
    UPDATE apishopee_ads_sync_progress
    SET
      current_chunk = p_chunk_index,
      synced_campaigns = synced_campaigns + p_synced_count,
      last_chunk_at = NOW(),
      updated_at = NOW()
    WHERE shop_id = p_shop_id;
  ELSE
    -- Record failed chunk
    UPDATE apishopee_ads_sync_progress
    SET
      failed_chunks = array_append(failed_chunks, p_chunk_index),
      error_message = p_error_message,
      sync_stage = 'failed',
      updated_at = NOW()
    WHERE shop_id = p_shop_id;
  END IF;
END;
$$;

-- =============================================
-- 5. FUNCTION: Complete Sync Progress
-- =============================================

CREATE OR REPLACE FUNCTION complete_sync_progress(
  p_shop_id BIGINT,
  p_stage TEXT DEFAULT 'completed'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE apishopee_ads_sync_progress
  SET
    sync_stage = p_stage,
    is_complete = CASE WHEN p_stage = 'completed' THEN TRUE ELSE FALSE END,
    completed_at = CASE WHEN p_stage = 'completed' THEN NOW() ELSE NULL END,
    updated_at = NOW()
  WHERE shop_id = p_shop_id;

  -- Also update main sync status
  IF p_stage = 'completed' THEN
    UPDATE apishopee_ads_sync_status
    SET
      is_syncing = FALSE,
      last_sync_at = NOW(),
      last_sync_error = NULL
    WHERE shop_id = p_shop_id;
  END IF;
END;
$$;

-- =============================================
-- 6. FUNCTION: Enhanced Queue Processor with Chunking
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

    -- Get campaign count for this shop
    SELECT total_campaigns INTO v_total_campaigns
    FROM apishopee_ads_sync_status
    WHERE shop_id = job.shop_id;

    -- Determine if chunking is needed (>200 campaigns)
    v_should_chunk := v_total_campaigns > 200;

    IF v_should_chunk AND job.is_chunk = FALSE THEN
      -- CHUNKING STRATEGY: Create multiple chunk jobs

      -- Initialize progress tracking
      SELECT total_chunks INTO v_total_chunks
      FROM init_ads_sync_progress(job.shop_id, v_total_campaigns);

      -- Create chunk jobs
      FOR v_chunk_index IN 0..(v_total_chunks - 1) LOOP
        INSERT INTO apishopee_ads_sync_queue (
          shop_id,
          priority,
          sync_type,
          sync_params,
          status,
          chunk_index,
          chunk_size,
          is_chunk
        ) VALUES (
          job.shop_id,
          job.priority,
          job.sync_type,
          jsonb_build_object(
            'offset', v_chunk_index * v_chunk_size,
            'limit', v_chunk_size,
            'chunk_index', v_chunk_index,
            'total_chunks', v_total_chunks
          ),
          'pending',
          v_chunk_index,
          v_chunk_size,
          TRUE
        );
      END LOOP;

      -- Mark original job as completed (spawned chunks)
      UPDATE apishopee_ads_sync_queue
      SET
        status = 'completed',
        completed_at = NOW(),
        error_message = format('Split into %s chunks', v_total_chunks)
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
      -- DIRECT SYNC: Call Edge Function

      BEGIN
        -- Call Edge Function via HTTP
        SELECT net.http_post(
          url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := jsonb_build_object(
            'shop_id', job.shop_id,
            'action', CASE
              WHEN job.is_chunk THEN 'sync_campaigns_chunk'
              ELSE 'sync'
            END,
            'params', CASE
              WHEN job.is_chunk THEN job.sync_params
              ELSE '{}'::jsonb
            END
          )
        ) INTO result;

        -- Mark as completed
        UPDATE apishopee_ads_sync_queue
        SET
          status = 'completed',
          completed_at = NOW()
        WHERE id = job.id;

        success_count := success_count + 1;
        details := array_append(details, jsonb_build_object(
          'job_id', job.id,
          'shop_id', job.shop_id,
          'sync_type', job.sync_type,
          'is_chunk', job.is_chunk,
          'chunk_index', job.chunk_index,
          'success', true
        ));

      EXCEPTION WHEN OTHERS THEN
        -- Handle errors
        UPDATE apishopee_ads_sync_queue
        SET
          status = 'failed',
          retry_count = retry_count + 1,
          error_message = SQLERRM,
          completed_at = NOW()
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
-- 7. MONITORING VIEW: Sync Progress
-- =============================================

CREATE OR REPLACE VIEW v_ads_sync_progress_status AS
SELECT
  p.shop_id,
  s.shop_name,
  p.sync_stage,
  p.current_chunk,
  p.total_chunks,
  ROUND(100.0 * p.synced_campaigns / NULLIF(p.total_campaigns, 0), 2) as progress_percent,
  p.synced_campaigns,
  p.total_campaigns,
  p.started_at,
  p.last_chunk_at,
  EXTRACT(EPOCH FROM (NOW() - p.last_chunk_at)) / 60 as minutes_since_last_chunk,
  p.is_complete,
  ARRAY_LENGTH(p.failed_chunks, 1) as failed_chunk_count,
  p.error_message
FROM apishopee_ads_sync_progress p
JOIN apishopee_shops s ON s.shop_id = p.shop_id
WHERE p.sync_stage != 'idle'
ORDER BY p.started_at DESC;

-- =============================================
-- 8. UPDATE CRONJOB TO USE NEW PROCESSOR
-- =============================================

-- Unschedule old processor
DO $$
BEGIN
  PERFORM cron.unschedule('ads-sync-queue-processor');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule new chunked processor
SELECT cron.schedule(
  'ads-sync-queue-processor-chunked',
  '*/5 * * * *',
  $$SELECT process_sync_queue_with_chunks(5);$$
);

-- =============================================
-- 9. RE-ENABLE CLEANUP (with chunking support)
-- =============================================

-- Re-enable stuck cleanup (now safe with chunking)
SELECT cron.schedule(
  'ads-sync-stuck-cleanup',
  '*/10 * * * *',
  $$SELECT cleanup_stuck_ads_sync();$$
);

-- =============================================
-- 10. GRANT PERMISSIONS
-- =============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON apishopee_ads_sync_progress TO authenticated;
GRANT SELECT ON v_ads_sync_progress_status TO authenticated;

-- =============================================
-- SUMMARY
-- =============================================

-- Migration 061 implements:
-- 1. ✅ Progress tracking table for chunked syncs
-- 2. ✅ Chunk parameters in queue table
-- 3. ✅ Functions to manage sync progress
-- 4. ✅ Enhanced queue processor with auto-chunking
-- 5. ✅ Monitoring view for sync progress
-- 6. ✅ Updated cronjobs

-- Next steps:
-- 1. Update Edge Function to handle chunk actions
-- 2. Test with small shop first (335 campaigns)
-- 3. Test with large shop (917 campaigns)
-- 4. Monitor via v_ads_sync_progress_status

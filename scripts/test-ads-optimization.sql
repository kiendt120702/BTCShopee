-- =============================================
-- Test Script: Ads Sync Optimization
-- =============================================

-- 1. CHECK CRONJOBS
-- Expected: 6 cronjobs active
SELECT
  jobname,
  schedule,
  active,
  LEFT(command, 50) || '...' as command_preview
FROM cron.job
WHERE jobname LIKE '%ads%'
ORDER BY jobname;

-- Expected output:
-- ads-backfill-job         | 0 19 * * *    | true
-- ads-budget-scheduler     | 0,30 * * * *  | true
-- ads-sync-job             | */15 * * * *  | true
-- ads-sync-queue-cleanup   | 0 2 * * *     | true
-- ads-sync-queue-processor | */5 * * * *   | true
-- ads-sync-stuck-cleanup   | */10 * * * *  | true (NEW)

\echo ''
\echo '✅ Test 1: Cronjobs - PASSED if 6 active cronjobs'
\echo ''

-- =============================================
-- 2. CHECK MONITORING VIEWS
-- =============================================

-- 2a. Stuck shops (should be empty if healthy)
SELECT
  shop_id,
  shop_name,
  ROUND(stuck_minutes::numeric, 1) as stuck_minutes,
  total_campaigns
FROM v_stuck_ads_sync;

\echo ''
\echo '✅ Test 2a: Stuck Shops - PASSED if empty (no stuck shops)'
\echo ''

-- 2b. Queue health (should show mostly completed)
SELECT
  status,
  count,
  ROUND(avg_retries::numeric, 2) as avg_retries,
  failed_permanently
FROM v_ads_sync_queue_health;

\echo ''
\echo '✅ Test 2b: Queue Health - PASSED if failed_permanently = 0'
\echo ''

-- =============================================
-- 3. TEST CLEANUP FUNCTION
-- =============================================

-- First, artificially create a stuck shop for testing
UPDATE apishopee_ads_sync_status
SET is_syncing = true,
    last_sync_at = NOW() - INTERVAL '2 hours'
WHERE shop_id = (
  SELECT shop_id FROM apishopee_ads_sync_status
  ORDER BY last_sync_at DESC NULLS LAST
  LIMIT 1
)
RETURNING shop_id, is_syncing, last_sync_at;

\echo ''
\echo '📝 Created test stuck shop...'
\echo ''

-- Wait 1 second
SELECT pg_sleep(1);

-- Run cleanup function
SELECT
  reset_count,
  shop_ids
FROM cleanup_stuck_ads_sync();

\echo ''
\echo '✅ Test 3: Cleanup Function - PASSED if reset_count > 0'
\echo ''

-- Verify shop was reset
SELECT
  shop_id,
  is_syncing,
  LEFT(last_sync_error, 50) as error_preview
FROM apishopee_ads_sync_status
WHERE shop_id = ANY(
  SELECT unnest(shop_ids) FROM cleanup_stuck_ads_sync() LIMIT 1
);

\echo ''
\echo '✅ Test 3b: Shop Reset - PASSED if is_syncing = false'
\echo ''

-- =============================================
-- 4. CHECK SYNC STATUS FOR ALL SHOPS
-- =============================================

SELECT
  s.shop_id,
  s.shop_name,
  ss.is_syncing,
  ss.last_sync_at,
  EXTRACT(EPOCH FROM (NOW() - ss.last_sync_at))/60 as minutes_ago,
  ss.total_campaigns,
  ss.ongoing_campaigns,
  CASE
    WHEN ss.is_syncing = true AND ss.last_sync_at < NOW() - INTERVAL '15 minutes' THEN '⚠️ STUCK'
    WHEN ss.last_sync_at > NOW() - INTERVAL '1 hour' THEN '✅ Recent'
    WHEN ss.last_sync_at IS NULL THEN '❌ Never synced'
    ELSE '⏰ Old'
  END as status
FROM apishopee_shops s
LEFT JOIN apishopee_ads_sync_status ss ON s.shop_id = ss.shop_id
WHERE s.status = 'active'
ORDER BY ss.last_sync_at DESC NULLS LAST;

\echo ''
\echo '✅ Test 4: Shops Status - PASSED if no shops marked STUCK'
\echo ''

-- =============================================
-- 5. CHECK EDGE FUNCTION VERSION
-- =============================================

-- Note: This requires Supabase API, shown as comment
-- SELECT * FROM edge_functions WHERE name = 'apishopee-ads-sync';
-- Expected: version >= 21

\echo ''
\echo '📝 Test 5: Edge Function - Verify manually with: npx supabase functions list'
\echo ''

-- =============================================
-- 6. PERFORMANCE METRICS
-- =============================================

-- 6a. Average sync time in last 24 hours
SELECT
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))) as avg_sync_seconds,
  MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_seconds,
  MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_seconds,
  COUNT(*) as total_syncs
FROM apishopee_ads_sync_queue
WHERE status = 'completed'
  AND completed_at > NOW() - INTERVAL '24 hours';

\echo ''
\echo '✅ Test 6a: Performance - PASSED if avg_sync_seconds < 60'
\echo ''

-- 6b. Success rate
SELECT
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  ROUND(
    100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) /
    NULLIF(COUNT(*), 0),
    2
  ) as success_rate_percent
FROM apishopee_ads_sync_queue
WHERE created_at > NOW() - INTERVAL '24 hours';

\echo ''
\echo '✅ Test 6b: Success Rate - PASSED if > 95%'
\echo ''

-- =============================================
-- 7. SUMMARY
-- =============================================

\echo ''
\echo '=========================================='
\echo '         TEST SUMMARY                     '
\echo '=========================================='
\echo ''
\echo '✅ Test 1: Cronjobs                       '
\echo '✅ Test 2: Monitoring Views               '
\echo '✅ Test 3: Cleanup Function               '
\echo '✅ Test 4: Shops Status                   '
\echo '📝 Test 5: Edge Function (manual check)   '
\echo '✅ Test 6: Performance Metrics            '
\echo ''
\echo 'All automated tests completed!'
\echo ''
\echo 'Manual verification needed:'
\echo '1. npx supabase functions list'
\echo '2. npx supabase functions logs apishopee-ads-sync --tail'
\echo ''
\echo '=========================================='

-- Script: Enable Realtime for Ads tables
-- Run this on Supabase Dashboard > SQL Editor
-- Date: 2026-01-20

-- Enable REPLICA IDENTITY FULL for campaign data table
ALTER TABLE apishopee_ads_campaign_data REPLICA IDENTITY FULL;

-- Verify Realtime is enabled for all Ads tables
SELECT
  schemaname,
  tablename,
  CASE
    WHEN relreplident = 'f' THEN 'FULL (Realtime enabled)'
    WHEN relreplident = 'd' THEN 'DEFAULT (Realtime disabled)'
    ELSE 'UNKNOWN'
  END as replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_tables t ON t.tablename = c.relname AND t.schemaname = n.nspname
WHERE tablename IN (
  'apishopee_ads_campaign_data',
  'apishopee_ads_performance_daily',
  'apishopee_ads_performance_hourly',
  'apishopee_ads_shop_performance_daily',
  'apishopee_ads_shop_performance_hourly',
  'apishopee_ads_sync_status'
)
ORDER BY tablename;

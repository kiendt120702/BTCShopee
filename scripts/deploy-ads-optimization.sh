#!/bin/bash

# =============================================
# Deploy Ads Sync Optimization
# =============================================

set -e  # Exit on error

echo "🚀 Deploying Ads Sync Optimization..."
echo ""

# 1. Apply migrations
echo "📦 Step 1: Applying database migrations..."
echo "  - Migration 059: Stuck shops cleanup & monitoring views"
echo "  - Migration 060: Optimized queue processor"
echo ""

npx supabase db push

echo "✅ Migrations applied successfully!"
echo ""

# 2. Deploy Edge Function
echo "🔧 Step 2: Deploying Edge Function..."
echo "  - Function: apishopee-ads-sync"
echo "  - New features:"
echo "    • Dynamic batch size (30-50 based on campaigns)"
echo "    • New actions: sync_campaigns_only, sync_performance_only"
echo ""

npx supabase functions deploy apishopee-ads-sync

echo "✅ Edge Function deployed successfully!"
echo ""

# 3. Verify cronjobs
echo "🔍 Step 3: Verifying cronjobs..."
echo ""
echo "Run this SQL to verify cronjobs:"
echo ""
echo "SELECT jobname, schedule, active, command"
echo "FROM cron.job"
echo "WHERE jobname LIKE '%ads%';"
echo ""

# 4. Check monitoring views
echo "📊 Step 4: Checking monitoring views..."
echo ""
echo "Run these queries to test monitoring:"
echo ""
echo "-- Check stuck shops"
echo "SELECT * FROM v_stuck_ads_sync;"
echo ""
echo "-- Check queue health"
echo "SELECT * FROM v_ads_sync_queue_health;"
echo ""

echo "🎉 Deployment completed!"
echo ""
echo "⚠️  IMPORTANT NEXT STEPS:"
echo "  1. Monitor v_stuck_ads_sync view for any stuck shops"
echo "  2. Watch edge function logs for errors"
echo "  3. Test with 1-2 shops first before full rollout"
echo ""
echo "📝 New features available:"
echo "  - Auto cleanup stuck shops every 10 minutes"
echo "  - Split sync strategy for shops with >500 campaigns"
echo "  - Monitoring views for stuck detection"
echo "  - Better timeout handling in queue processor"
echo ""

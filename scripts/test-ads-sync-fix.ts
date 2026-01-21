/**
 * Script test để so sánh kết quả sync tự động vs sync thủ công
 * Chạy: npx ts-node scripts/test-ads-sync-fix.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ohlwhhxhgpotlwfgqhhu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testAdsSyncFix() {
  console.log('=== TEST ADS SYNC FIX ===\n');

  // Get shop ID (giả sử shop_id đầu tiên)
  const { data: shops } = await supabase
    .from('apishopee_shops')
    .select('shop_id')
    .limit(1);

  if (!shops || shops.length === 0) {
    console.error('❌ Không tìm thấy shop nào');
    return;
  }

  const shopId = shops[0].shop_id;
  console.log(`📍 Testing with shop_id: ${shopId}\n`);

  // Step 1: Lấy dữ liệu TRƯỚC khi sync
  console.log('📊 Lấy dữ liệu shop-level TRƯỚC khi sync...');
  const today = new Date().toISOString().split('T')[0];

  const { data: beforeShopDaily } = await supabase
    .from('apishopee_ads_shop_performance_daily')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', today)
    .maybeSingle();

  const { data: beforeShopHourly } = await supabase
    .from('apishopee_ads_shop_performance_hourly')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', today);

  console.log('TRƯỚC sync (shop-level daily):');
  if (beforeShopDaily) {
    console.log(`  - Clicks: ${beforeShopDaily.clicks}`);
    console.log(`  - Impression: ${beforeShopDaily.impression}`);
    console.log(`  - GMV: ${beforeShopDaily.broad_gmv}`);
    console.log(`  - Expense: ${beforeShopDaily.expense}`);
    console.log(`  - Broad Item Sold: ${beforeShopDaily.broad_item_sold}`);
    console.log(`  - ROAS: ${beforeShopDaily.roas}`);
  } else {
    console.log('  ⚠️  Chưa có dữ liệu');
  }

  console.log('TRƯỚC sync (shop-level hourly):');
  if (beforeShopHourly && beforeShopHourly.length > 0) {
    const totalHours = beforeShopHourly.length;
    const totalClicks = beforeShopHourly.reduce((sum, h) => sum + (h.clicks || 0), 0);
    const totalGmv = beforeShopHourly.reduce((sum, h) => sum + (h.broad_gmv || 0), 0);
    const totalItemSold = beforeShopHourly.reduce((sum, h) => sum + (h.broad_item_sold || 0), 0);
    console.log(`  - Total hours: ${totalHours}`);
    console.log(`  - Total clicks: ${totalClicks}`);
    console.log(`  - Total GMV: ${totalGmv}`);
    console.log(`  - Total broad_item_sold: ${totalItemSold}`);
  } else {
    console.log('  ⚠️  Chưa có dữ liệu');
  }

  // Step 2: Gọi sync tự động (cron job endpoint)
  console.log('\n🔄 Chạy AUTO SYNC (giống cron job)...');
  const autoSyncStart = Date.now();

  const { data: autoSyncResult, error: autoSyncError } = await supabase.functions.invoke(
    'apishopee-ads-sync',
    {
      body: { action: 'sync', shop_id: shopId }
    }
  );

  const autoSyncTime = Date.now() - autoSyncStart;

  if (autoSyncError) {
    console.error('❌ Auto sync error:', autoSyncError);
  } else {
    console.log('✅ Auto sync completed in', autoSyncTime, 'ms');
    console.log('   Result:', JSON.stringify(autoSyncResult, null, 2));
  }

  // Wait 2 seconds for DB to update
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 3: Lấy dữ liệu SAU auto sync
  console.log('\n📊 Lấy dữ liệu SAU auto sync...');

  const { data: afterAutoShopDaily } = await supabase
    .from('apishopee_ads_shop_performance_daily')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', today)
    .maybeSingle();

  const { data: afterAutoShopHourly } = await supabase
    .from('apishopee_ads_shop_performance_hourly')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', today);

  console.log('SAU auto sync (shop-level daily):');
  if (afterAutoShopDaily) {
    console.log(`  - Clicks: ${afterAutoShopDaily.clicks}`);
    console.log(`  - Impression: ${afterAutoShopDaily.impression}`);
    console.log(`  - GMV: ${afterAutoShopDaily.broad_gmv}`);
    console.log(`  - Expense: ${afterAutoShopDaily.expense}`);
    console.log(`  - Broad Item Sold: ${afterAutoShopDaily.broad_item_sold} ${afterAutoShopDaily.broad_item_sold > 0 ? '✅' : '❌'}`);
    console.log(`  - ROAS: ${afterAutoShopDaily.roas}`);
  } else {
    console.log('  ⚠️  Không có dữ liệu');
  }

  console.log('SAU auto sync (shop-level hourly):');
  if (afterAutoShopHourly && afterAutoShopHourly.length > 0) {
    const totalHours = afterAutoShopHourly.length;
    const totalClicks = afterAutoShopHourly.reduce((sum, h) => sum + (h.clicks || 0), 0);
    const totalGmv = afterAutoShopHourly.reduce((sum, h) => sum + (h.broad_gmv || 0), 0);
    const totalItemSold = afterAutoShopHourly.reduce((sum, h) => sum + (h.broad_item_sold || 0), 0);
    console.log(`  - Total hours: ${totalHours}`);
    console.log(`  - Total clicks: ${totalClicks}`);
    console.log(`  - Total GMV: ${totalGmv}`);
    console.log(`  - Total broad_item_sold: ${totalItemSold} ${totalItemSold > 0 ? '✅' : '❌'}`);
  } else {
    console.log('  ⚠️  Không có dữ liệu');
  }

  // Step 4: So sánh với campaign-level data
  console.log('\n📊 So sánh với campaign-level data...');

  const { data: campaignDaily } = await supabase
    .from('apishopee_ads_performance_daily')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', today);

  const { data: campaignHourly } = await supabase
    .from('apishopee_ads_performance_hourly')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', today);

  console.log('Campaign-level daily data:');
  if (campaignDaily && campaignDaily.length > 0) {
    const totalCampaigns = campaignDaily.length;
    const totalClicks = campaignDaily.reduce((sum, c) => sum + (c.clicks || 0), 0);
    const totalGmv = campaignDaily.reduce((sum, c) => sum + (c.broad_gmv || 0), 0);
    const totalItemSold = campaignDaily.reduce((sum, c) => sum + (c.broad_item_sold || 0), 0);
    console.log(`  - Total campaigns: ${totalCampaigns}`);
    console.log(`  - Total clicks: ${totalClicks}`);
    console.log(`  - Total GMV: ${totalGmv}`);
    console.log(`  - Total broad_item_sold: ${totalItemSold}`);
  }

  console.log('Campaign-level hourly data:');
  if (campaignHourly && campaignHourly.length > 0) {
    const totalRecords = campaignHourly.length;
    const totalClicks = campaignHourly.reduce((sum, h) => sum + (h.clicks || 0), 0);
    const totalGmv = campaignHourly.reduce((sum, h) => sum + (h.broad_gmv || 0), 0);
    const totalItemSold = campaignHourly.reduce((sum, h) => sum + (h.broad_item_sold || 0), 0);
    console.log(`  - Total records: ${totalRecords}`);
    console.log(`  - Total clicks: ${totalClicks}`);
    console.log(`  - Total GMV: ${totalGmv}`);
    console.log(`  - Total broad_item_sold: ${totalItemSold}`);
  }

  // Final verdict
  console.log('\n=== KẾT LUẬN ===');

  const shopItemSold = afterAutoShopDaily?.broad_item_sold || 0;
  const campaignTotalItemSold = campaignDaily?.reduce((sum, c) => sum + (c.broad_item_sold || 0), 0) || 0;

  if (shopItemSold > 0 && Math.abs(shopItemSold - campaignTotalItemSold) < 1) {
    console.log('✅ AUTO SYNC HOẠT ĐỘNG ĐÚNG!');
    console.log(`   - Shop-level broad_item_sold: ${shopItemSold}`);
    console.log(`   - Campaign-level total: ${campaignTotalItemSold}`);
    console.log('   - Sai số: < 1 (chấp nhận được)');
  } else {
    console.log('❌ AUTO SYNC VẪN BỊ LỖI!');
    console.log(`   - Shop-level broad_item_sold: ${shopItemSold}`);
    console.log(`   - Campaign-level total: ${campaignTotalItemSold}`);
    console.log(`   - Chênh lệch: ${Math.abs(shopItemSold - campaignTotalItemSold)}`);
  }

  console.log('\n=== END TEST ===');
}

// Run test
testAdsSyncFix().catch(console.error);

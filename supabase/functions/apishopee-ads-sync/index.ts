/**
 * Supabase Edge Function: Shopee Ads Sync Worker
 * Background sync worker để đồng bộ Ads data từ Shopee
 * 
 * Mô hình Realtime:
 * 1. Worker gọi Shopee API định kỳ (15 phút/lần)
 * 2. Lưu/Cập nhật dữ liệu vào DB (upsert để tránh trùng lặp)
 * 3. Supabase Realtime tự động bắn tín hiệu UPDATE/INSERT xuống Frontend
 * 4. Frontend tự cập nhật giao diện mà không cần F5
 * 
 * Actions:
 * - sync: Sync toàn bộ campaigns và performance data
 * - status: Lấy trạng thái sync hiện tại
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOPEE_HOST = 'https://partner.shopeemobile.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ==================== TYPES ====================

interface ShopCredentials {
  access_token: string;
  refresh_token: string;
  partner_id: number;
  partner_key: string;
}

interface CampaignInfo {
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  name?: string;
  status?: string;
  campaign_budget?: number;
  campaign_placement?: string;
  bidding_method?: string;
  roas_target?: number | null;
  start_time?: number;
  end_time?: number;
  item_count?: number;
}

interface PerformanceMetrics {
  impression: number;
  clicks: number;
  ctr: number;
  expense: number;
  direct_order: number;
  direct_gmv: number;
  broad_order: number;
  broad_gmv: number;
  direct_item_sold: number;
  broad_item_sold: number;
}

// ==================== HELPER FUNCTIONS ====================

async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getShopCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<ShopCredentials> {
  const { data: shop, error } = await supabase
    .from('apishopee_shops')
    .select('access_token, refresh_token, partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (error || !shop) {
    throw new Error('Shop not found');
  }

  if (!shop.access_token || !shop.partner_id || !shop.partner_key) {
    throw new Error('Shop credentials incomplete');
  }

  return shop as ShopCredentials;
}

async function callShopeeAPI(
  credentials: ShopCredentials,
  shopId: number,
  apiPath: string,
  method: 'GET' | 'POST',
  params?: Record<string, string | number>,
  body?: Record<string, unknown>
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${credentials.partner_id}${apiPath}${timestamp}${credentials.access_token}${shopId}`;
  const sign = await hmacSha256(credentials.partner_key, baseString);

  const queryParams = new URLSearchParams();
  queryParams.set('partner_id', credentials.partner_id.toString());
  queryParams.set('timestamp', timestamp.toString());
  queryParams.set('access_token', credentials.access_token);
  queryParams.set('shop_id', shopId.toString());
  queryParams.set('sign', sign);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }
  }

  const url = `${SHOPEE_HOST}${apiPath}?${queryParams.toString()}`;
  console.log(`[ADS-SYNC] ${method} ${apiPath}`);

  const fetchOptions: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body && method === 'POST') {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
  return await response.json();
}

// Get current date in Vietnam timezone (GMT+7)
function getVietnamDate(): Date {
  const now = new Date();
  // Convert UTC to Vietnam time (UTC+7)
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vnTime;
}

// Format date to DD-MM-YYYY for Shopee API (using Vietnam timezone)
function formatDateForShopee(date: Date): string {
  // Use UTC methods since we already converted to VN time
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

// Format date to YYYY-MM-DD for database (using Vietnam timezone)
function formatDateForDB(date: Date): string {
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${year}-${month}-${day}`;
}

// ==================== SYNC FUNCTIONS ====================

/**
 * Sync campaigns từ Shopee API
 * Sử dụng UPSERT để tránh trùng lặp
 * 
 * QUAN TRỌNG: Trả về TẤT CẢ campaigns để sync performance data đầy đủ
 * (không chỉ campaigns đang chạy)
 */
async function syncCampaigns(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number
): Promise<{ total: number; ongoing: number; allCampaigns: CampaignInfo[]; ongoingCampaigns: CampaignInfo[] }> {
  console.log('[ADS-SYNC] Syncing campaigns...');

  // Step 1: Lấy danh sách campaign IDs
  const idListResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_product_level_campaign_id_list',
    'GET',
    { ad_type: 'all', offset: 0, limit: 5000 }
  );

  if (idListResult.error) {
    throw new Error(`Failed to get campaign list: ${idListResult.message || idListResult.error}`);
  }

  const campaignList = idListResult.response?.campaign_list || [];
  if (campaignList.length === 0) {
    console.log('[ADS-SYNC] No campaigns found');
    return { total: 0, ongoing: 0, allCampaigns: [], ongoingCampaigns: [] };
  }

  console.log(`[ADS-SYNC] Found ${campaignList.length} campaigns`);

  // Step 2: Lấy chi tiết từng batch 100 campaigns
  const allCampaigns: CampaignInfo[] = [];
  const batchSize = 100;

  for (let i = 0; i < campaignList.length; i += batchSize) {
    const batch = campaignList.slice(i, i + batchSize);
    const campaignIds = batch.map((c: { campaign_id: number }) => c.campaign_id).join(',');

    console.log(`[ADS-SYNC] Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(campaignList.length / batchSize)} - Campaigns: ${batch.length}`);

    const detailResult = await callShopeeAPI(
      credentials,
      shopId,
      '/api/v2/ads/get_product_level_campaign_setting_info',
      'GET',
      { campaign_id_list: campaignIds, info_type_list: '1,3' }
    );

    console.log(`[ADS-SYNC] Batch ${Math.floor(i / batchSize) + 1} response:`, JSON.stringify(detailResult).substring(0, 500));

    if (detailResult.response?.campaign_list) {
      console.log(`[ADS-SYNC] Batch ${Math.floor(i / batchSize) + 1} - Processing ${detailResult.response.campaign_list.length} campaigns`);

      for (const detail of detailResult.response.campaign_list) {
        const original = batch.find((c: { campaign_id: number }) => c.campaign_id === detail.campaign_id);
        const campaignInfo: CampaignInfo = {
          campaign_id: detail.campaign_id,
          ad_type: original?.ad_type || detail.common_info?.ad_type || 'auto',
          name: detail.common_info?.ad_name,
          status: detail.common_info?.campaign_status,
          campaign_budget: detail.common_info?.campaign_budget,
          campaign_placement: detail.common_info?.campaign_placement,
          bidding_method: detail.common_info?.bidding_method,
          roas_target: detail.auto_bidding_info?.roas_target || null,
          start_time: detail.common_info?.campaign_duration?.start_time,
          end_time: detail.common_info?.campaign_duration?.end_time,
          item_count: detail.common_info?.item_id_list?.length || 0,
        };

        allCampaigns.push(campaignInfo);

        // In ra thông tin chi tiết từng campaign
        console.log(`[ADS-SYNC] Campaign detail - ID: ${campaignInfo.campaign_id}, Name: ${campaignInfo.name}, Status: ${campaignInfo.status}, Type: ${campaignInfo.ad_type}, Budget: ${campaignInfo.campaign_budget}, ROAS Target: ${campaignInfo.roas_target}, Items: ${campaignInfo.item_count}`);
      }
    } else {
      console.warn(`[ADS-SYNC] Batch ${Math.floor(i / batchSize) + 1} - No campaigns returned`);
    }
  }

  console.log(`[ADS-SYNC] Total campaigns collected: ${allCampaigns.length}`);

  // Step 3: UPSERT vào database (tránh trùng lặp)
  const now = new Date().toISOString();
  const upsertData = allCampaigns.map(c => ({
    shop_id: shopId,
    campaign_id: c.campaign_id,
    ad_type: c.ad_type,
    name: c.name || null,
    status: c.status || null,
    campaign_placement: c.campaign_placement || null,
    bidding_method: c.bidding_method || null,
    campaign_budget: c.campaign_budget || 0,
    start_time: c.start_time || null,
    end_time: c.end_time || null,
    item_count: c.item_count || 0,
    roas_target: c.roas_target,
    synced_at: now,
    cached_at: now,
  }));

  const { error: upsertError } = await supabase
    .from('apishopee_ads_campaign_data')
    .upsert(upsertData, { onConflict: 'shop_id,campaign_id' });

  if (upsertError) {
    console.error('[ADS-SYNC] Upsert campaigns error:', upsertError);
    throw new Error(`Failed to save campaigns: ${upsertError.message}`);
  }

  const ongoingCampaigns = allCampaigns.filter(c => c.status === 'ongoing');
  console.log(`[ADS-SYNC] Synced ${allCampaigns.length} campaigns (${ongoingCampaigns.length} ongoing)`);

  // Trả về CẢ allCampaigns và ongoingCampaigns
  return {
    total: allCampaigns.length,
    ongoing: ongoingCampaigns.length,
    allCampaigns: allCampaigns,        // TẤT CẢ campaigns để sync performance
    ongoingCampaigns: ongoingCampaigns, // Chỉ ongoing để hiển thị
  };
}

/**
 * Sync daily performance cho CHỈ 1 NGÀY cụ thể
 * Chia campaigns thành batches nhỏ để tránh URL quá dài
 * 
 * QUAN TRỌNG: Chỉ sync 1 ngày mỗi lần để tránh timeout
 */
async function syncDailyPerformanceForDate(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number,
  campaigns: CampaignInfo[],
  targetDate: Date
): Promise<number> {
  if (campaigns.length === 0) return 0;

  const dateStr = formatDateForShopee(targetDate);
  const dbDate = formatDateForDB(targetDate);

  console.log(`[ADS-SYNC] Syncing daily performance for date: ${dateStr} (${campaigns.length} campaigns)`);

  // BATCH SIZE ĐỘNG: Shops nhiều campaigns → Batch nhỏ hơn để tránh timeout
  const BATCH_SIZE = campaigns.length > 500 ? 30 : campaigns.length > 200 ? 40 : 50;
  console.log(`[ADS-SYNC] Dynamic batch size for daily perf: ${BATCH_SIZE} (total campaigns: ${campaigns.length})`);
  const now = new Date().toISOString();
  const allUpsertData: Array<{
    shop_id: number;
    campaign_id: number;
    performance_date: string;
    impression: number;
    clicks: number;
    ctr: number;
    expense: number;
    direct_order: number;
    direct_gmv: number;
    broad_order: number;
    broad_gmv: number;
    direct_item_sold: number;
    broad_item_sold: number;
    roas: number;
    acos: number;
    synced_at: string;
  }> = [];

  for (let i = 0; i < campaigns.length; i += BATCH_SIZE) {
    const batch = campaigns.slice(i, i + BATCH_SIZE);
    const campaignIds = batch.map(c => c.campaign_id).join(',');

    const perfResult = await callShopeeAPI(
      credentials,
      shopId,
      '/api/v2/ads/get_product_campaign_daily_performance',
      'GET',
      { start_date: dateStr, end_date: dateStr, campaign_id_list: campaignIds }
    );

    if (perfResult.error) {
      console.error(`[ADS-SYNC] Daily perf error batch ${Math.floor(i / BATCH_SIZE) + 1}:`, perfResult.message || perfResult.error);
      continue;
    }

    const campaignPerfList = perfResult.response?.campaign_list || [];
    console.log(`[ADS-SYNC] Daily perf batch ${Math.floor(i / BATCH_SIZE) + 1} - Found ${campaignPerfList.length} campaigns with data`);

    for (const campPerf of campaignPerfList) {
      const metricsList = campPerf.metrics_list || campPerf.performance_list || [];
      console.log(`[ADS-SYNC] Campaign ${campPerf.campaign_id} - ${metricsList.length} day(s) of metrics`);

      for (const dayMetrics of metricsList) {
        const expense = dayMetrics.expense || 0;
        const broadGmv = dayMetrics.broad_gmv || 0;
        const roas = expense > 0 ? broadGmv / expense : 0;
        const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

        const perfData = {
          shop_id: shopId,
          campaign_id: campPerf.campaign_id,
          performance_date: dbDate,
          impression: dayMetrics.impression || 0,
          clicks: dayMetrics.clicks || 0,
          ctr: dayMetrics.ctr || 0,
          expense,
          direct_order: dayMetrics.direct_order || 0,
          direct_gmv: dayMetrics.direct_gmv || 0,
          broad_order: dayMetrics.broad_order || 0,
          broad_gmv: broadGmv,
          direct_item_sold: dayMetrics.direct_item_sold || 0,
          broad_item_sold: dayMetrics.broad_item_sold || 0,
          roas,
          acos,
          synced_at: now,
        };

        allUpsertData.push(perfData);

        // In ra metrics chi tiết
        console.log(`[ADS-SYNC] Daily metrics for campaign ${campPerf.campaign_id} on ${dbDate}:`);
        console.log(`  - Impressions: ${perfData.impression}, Clicks: ${perfData.clicks}, CTR: ${perfData.ctr.toFixed(2)}%`);
        console.log(`  - Expense: ${perfData.expense}, Broad GMV: ${perfData.broad_gmv}, ROAS: ${perfData.roas.toFixed(2)}`);
        console.log(`  - Broad Orders: ${perfData.broad_order}, Broad Items Sold: ${perfData.broad_item_sold}`);
      }
    }

    // Delay nhỏ giữa các batch
    if (i + BATCH_SIZE < campaigns.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  if (allUpsertData.length === 0) {
    return 0;
  }

  // UPSERT để tránh trùng lặp
  const { error: upsertError } = await supabase
    .from('apishopee_ads_performance_daily')
    .upsert(allUpsertData, { onConflict: 'shop_id,campaign_id,performance_date' });

  if (upsertError) {
    console.error(`[ADS-SYNC] Upsert daily error for ${dateStr}:`, upsertError);
  }

  return allUpsertData.length;
}

/**
 * Sync daily performance cho ngày hôm nay
 * Wrapper function cho realtime sync
 */
async function syncDailyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number,
  campaigns: CampaignInfo[]
): Promise<number> {
  if (campaigns.length === 0) return 0;

  console.log(`[ADS-SYNC] Syncing daily performance for today only (${campaigns.length} campaigns)...`);

  const today = getVietnamDate();
  const count = await syncDailyPerformanceForDate(supabase, credentials, shopId, campaigns, today);

  console.log(`[ADS-SYNC] Synced ${count} daily performance records for today`);
  return count;
}

/**
 * Sync hourly performance cho 1 ngày cụ thể - TẤT CẢ campaigns
 * 
 * QUAN TRỌNG: 
 * - Sync cho tất cả campaigns để dữ liệu tổng hợp khớp với shop-level
 * - Chia nhỏ campaigns thành batches để tránh URL quá dài (Shopee giới hạn ~2000 ký tự)
 */
async function syncHourlyPerformanceForDate(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number,
  campaigns: CampaignInfo[],
  targetDate: Date
): Promise<number> {
  if (campaigns.length === 0) return 0;

  const dateStr = formatDateForShopee(targetDate);
  const dbDate = formatDateForDB(targetDate);

  console.log(`[ADS-SYNC] Syncing hourly performance for date: ${dateStr}`);

  // BATCH SIZE ĐỘNG: Shops nhiều campaigns → Batch nhỏ hơn để tránh timeout
  // < 200 campaigns: batch 50
  // 200-500 campaigns: batch 40
  // > 500 campaigns: batch 30
  const BATCH_SIZE = campaigns.length > 500 ? 30 : campaigns.length > 200 ? 40 : 50;
  console.log(`[ADS-SYNC] Dynamic batch size: ${BATCH_SIZE} (total campaigns: ${campaigns.length})`);
  const now = new Date().toISOString();
  const allUpsertData: Array<{
    shop_id: number;
    campaign_id: number;
    performance_date: string;
    hour: number;
    impression: number;
    clicks: number;
    ctr: number;
    expense: number;
    direct_order: number;
    direct_gmv: number;
    broad_order: number;
    broad_gmv: number;
    direct_item_sold: number;
    broad_item_sold: number;
    roas: number;
    acos: number;
    synced_at: string;
  }> = [];

  // Chia campaigns thành batches
  for (let i = 0; i < campaigns.length; i += BATCH_SIZE) {
    const batch = campaigns.slice(i, i + BATCH_SIZE);
    const campaignIds = batch.map(c => c.campaign_id).join(',');

    const perfResult = await callShopeeAPI(
      credentials,
      shopId,
      '/api/v2/ads/get_product_campaign_hourly_performance',
      'GET',
      { performance_date: dateStr, campaign_id_list: campaignIds }
    );

    if (perfResult.error) {
      console.error(`[ADS-SYNC] Hourly performance error for ${dateStr} batch ${Math.floor(i / BATCH_SIZE) + 1}:`, perfResult.message || perfResult.error);
      // Tiếp tục với batch tiếp theo
      continue;
    }

    const campaignPerfList = perfResult.response?.campaign_list || [];
    console.log(`[ADS-SYNC] Hourly perf batch ${Math.floor(i / BATCH_SIZE) + 1} - Found ${campaignPerfList.length} campaigns with data`);

    for (const campPerf of campaignPerfList) {
      const metricsList = campPerf.metrics_list || [];
      console.log(`[ADS-SYNC] Campaign ${campPerf.campaign_id} - ${metricsList.length} hour(s) of metrics`);

      for (const hourMetrics of metricsList) {
        const expense = hourMetrics.expense || 0;
        const broadGmv = hourMetrics.broad_gmv || 0;
        const roas = expense > 0 ? broadGmv / expense : 0;
        const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

        const hourlyData = {
          shop_id: shopId,
          campaign_id: campPerf.campaign_id,
          performance_date: dbDate,
          hour: hourMetrics.hour,
          impression: hourMetrics.impression || 0,
          clicks: hourMetrics.clicks || 0,
          ctr: hourMetrics.ctr || 0,
          expense,
          direct_order: hourMetrics.direct_order || 0,
          direct_gmv: hourMetrics.direct_gmv || 0,
          broad_order: hourMetrics.broad_order || 0,
          broad_gmv: broadGmv,
          direct_item_sold: hourMetrics.direct_item_sold || 0,
          broad_item_sold: hourMetrics.broad_item_sold || 0,
          roas,
          acos,
          synced_at: now,
        };

        allUpsertData.push(hourlyData);

        // In ra metrics chi tiết (chỉ in các giờ có dữ liệu)
        if (hourlyData.impression > 0 || hourlyData.clicks > 0 || hourlyData.expense > 0) {
          console.log(`[ADS-SYNC] Hourly metrics for campaign ${campPerf.campaign_id} on ${dbDate} at ${hourlyData.hour}:00:`);
          console.log(`  - Impressions: ${hourlyData.impression}, Clicks: ${hourlyData.clicks}, CTR: ${hourlyData.ctr.toFixed(2)}%`);
          console.log(`  - Expense: ${hourlyData.expense}, Broad GMV: ${hourlyData.broad_gmv}, ROAS: ${hourlyData.roas.toFixed(2)}`);
          console.log(`  - Orders: ${hourlyData.broad_order}, Items Sold: ${hourlyData.broad_item_sold}`);
        }
      }
    }

    // Delay nhỏ giữa các batch để tránh rate limit
    if (i + BATCH_SIZE < campaigns.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  if (allUpsertData.length === 0) {
    return 0;
  }

  // UPSERT để tránh trùng lặp - ghi đè dữ liệu cũ với GMV mới nhất
  const { error: upsertError } = await supabase
    .from('apishopee_ads_performance_hourly')
    .upsert(allUpsertData, { onConflict: 'shop_id,campaign_id,performance_date,hour' });

  if (upsertError) {
    console.error(`[ADS-SYNC] Upsert hourly performance error for ${dateStr}:`, upsertError);
    throw new Error(`Failed to save hourly performance: ${upsertError.message}`);
  }

  return allUpsertData.length;
}

/**
 * Sync hourly performance cho ngày hôm nay - TẤT CẢ campaigns
 * Wrapper function cho realtime sync (chỉ hôm nay)
 */
async function syncHourlyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number,
  campaigns: CampaignInfo[]
): Promise<number> {
  if (campaigns.length === 0) return 0;

  console.log(`[ADS-SYNC] Syncing hourly performance for ALL ${campaigns.length} campaigns (today only)...`);

  const today = getVietnamDate();
  const count = await syncHourlyPerformanceForDate(supabase, credentials, shopId, campaigns, today);

  console.log(`[ADS-SYNC] Synced ${count} hourly performance records for today`);
  return count;
}

/**
 * BACKFILL: Sync hourly performance cho 7 ngày gần nhất
 * 
 * LÝ DO CẦN BACKFILL:
 * Shopee Ads có "7-day attribution window" - đơn hàng hôm nay có thể được gán
 * cho click từ 3-7 ngày trước. Nếu chỉ sync hôm nay, GMV của các ngày cũ sẽ
 * không được cập nhật → dữ liệu không khớp với Shopee Seller Center.
 * 
 * GIẢI PHÁP:
 * - Realtime sync (15 phút/lần): Chỉ sync hôm nay → nhanh
 * - Backfill sync (1 lần/ngày, 2AM): Sync 7 ngày → cập nhật GMV attribution
 */
async function syncHourlyPerformanceBackfill(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number,
  campaigns: CampaignInfo[],
  daysBack: number = 7
): Promise<number> {
  if (campaigns.length === 0) return 0;

  console.log(`[ADS-SYNC] === BACKFILL: Syncing hourly performance for past ${daysBack} days ===`);
  console.log(`[ADS-SYNC] Reason: Shopee has 7-day attribution window - GMV from past days may change`);

  const today = getVietnamDate();
  let totalRecords = 0;

  // Loop từ hôm nay về quá khứ (daysBack ngày)
  for (let i = 0; i < daysBack; i++) {
    const targetDate = new Date(today.getTime());
    targetDate.setUTCDate(today.getUTCDate() - i);

    const dateStr = formatDateForShopee(targetDate);
    console.log(`[ADS-SYNC] Backfill day ${i + 1}/${daysBack}: ${dateStr}`);

    try {
      const count = await syncHourlyPerformanceForDate(supabase, credentials, shopId, campaigns, targetDate);
      totalRecords += count;

      // Delay nhỏ giữa các request để tránh rate limit
      if (i < daysBack - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(`[ADS-SYNC] Backfill error for ${dateStr}:`, error);
      // Tiếp tục với ngày tiếp theo
    }
  }

  console.log(`[ADS-SYNC] === BACKFILL COMPLETE: ${totalRecords} total hourly records ===`);
  return totalRecords;
}

/**
 * Sync shop-level daily performance (tổng hợp tất cả ads)
 * Sử dụng API get_all_cpc_ads_daily_performance - giống như Response button
 * LƯU VÀO BẢNG RIÊNG để hiển thị chính xác
 * 
 * Nếu API trả về rỗng → fallback tính tổng từ campaign-level
 */
async function syncShopLevelDailyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number
): Promise<{ impression: number; clicks: number; orders: number; gmv: number; expense: number }> {
  console.log('[ADS-SYNC] Syncing shop-level daily performance...');

  // Sử dụng Vietnam timezone - lấy 7 ngày gần nhất
  const today = getVietnamDate();
  const sevenDaysAgo = new Date(today.getTime());
  sevenDaysAgo.setUTCDate(today.getUTCDate() - 6);

  const startDate = formatDateForShopee(sevenDaysAgo);
  const endDate = formatDateForShopee(today);
  const dbStartDate = formatDateForDB(sevenDaysAgo);
  const dbEndDate = formatDateForDB(today);

  console.log(`[ADS-SYNC] Shop-level date range: ${startDate} to ${endDate} (VN timezone)`);

  // QUAN TRỌNG: Luôn lấy item_sold từ campaign-level vì API shop-level KHÔNG trả về field này
  // Tính tổng item_sold theo ngày từ bảng campaign performance
  const { data: campaignItemSoldData } = await supabase
    .from('apishopee_ads_performance_daily')
    .select('performance_date, direct_item_sold, broad_item_sold')
    .eq('shop_id', shopId)
    .gte('performance_date', dbStartDate)
    .lte('performance_date', dbEndDate);

  // Group item_sold by date
  const itemSoldByDate: Record<string, { direct_item_sold: number; broad_item_sold: number }> = {};
  if (campaignItemSoldData) {
    for (const row of campaignItemSoldData) {
      const date = row.performance_date;
      if (!itemSoldByDate[date]) {
        itemSoldByDate[date] = { direct_item_sold: 0, broad_item_sold: 0 };
      }
      itemSoldByDate[date].direct_item_sold += Number(row.direct_item_sold) || 0;
      itemSoldByDate[date].broad_item_sold += Number(row.broad_item_sold) || 0;
    }
  }
  console.log(`[ADS-SYNC] Calculated item_sold from campaign data for ${Object.keys(itemSoldByDate).length} dates`);

  const perfResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_all_cpc_ads_daily_performance',
    'GET',
    { start_date: startDate, end_date: endDate }
  );

  console.log('[ADS-SYNC] Shop-level daily response:', JSON.stringify(perfResult, null, 2).substring(0, 2000));
  console.log('[ADS-SYNC] Full shop-level daily API response:', JSON.stringify(perfResult));

  let hasShopLevelData = false;

  if (!perfResult.error) {
    // Parse response - API trả về response là array trực tiếp
    // {"response": [{"date": "08-01-2026", ...}, ...], ...}
    const metricsList = Array.isArray(perfResult.response)
      ? perfResult.response
      : (perfResult.response?.metrics_list || perfResult.response?.performance_list || []);

    if (metricsList.length > 0) {
      hasShopLevelData = true;
      const now = new Date().toISOString();

      // Lưu từng ngày vào DB
      for (const dayMetrics of metricsList) {
        // Parse date from DD-MM-YYYY to YYYY-MM-DD
        const dateParts = dayMetrics.date?.split('-') || [];
        let perfDate: string;
        if (dateParts.length === 3) {
          perfDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        } else {
          continue;
        }

        const expense = dayMetrics.expense || 0;
        const broadGmv = dayMetrics.broad_gmv || 0;
        const impression = dayMetrics.impression || 0;
        const clicks = dayMetrics.clicks || 0;

        // Sử dụng giá trị từ API nếu có, nếu không thì tính
        const ctr = dayMetrics.ctr || (impression > 0 ? (clicks / impression) : 0);
        const roas = dayMetrics.broad_roas || (expense > 0 ? broadGmv / expense : 0);
        const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

        // QUAN TRỌNG: Không overwrite item_sold với 0 nếu đã có dữ liệu cũ
        // 1. Lấy dữ liệu hiện tại từ DB để so sánh
        const { data: existingData } = await supabase
          .from('apishopee_ads_shop_performance_daily')
          .select('direct_item_sold, broad_item_sold')
          .eq('shop_id', shopId)
          .eq('performance_date', perfDate)
          .maybeSingle();

        const apiDirectItemSold = dayMetrics.direct_item_sold || 0;
        const apiBroadItemSold = dayMetrics.broad_item_sold || 0;
        const calcItemSold = itemSoldByDate[perfDate] || { direct_item_sold: 0, broad_item_sold: 0 };
        const existingItemSold = existingData || { direct_item_sold: 0, broad_item_sold: 0 };

        // Logic ưu tiên: API > Campaign-level > Existing DB > 0
        // KHÔNG bao giờ overwrite giá trị > 0 bằng 0
        let directItemSold = apiDirectItemSold;
        if (directItemSold === 0 && calcItemSold.direct_item_sold > 0) {
          directItemSold = calcItemSold.direct_item_sold;
        }
        if (directItemSold === 0 && existingItemSold.direct_item_sold > 0) {
          directItemSold = existingItemSold.direct_item_sold;
        }

        let broadItemSold = apiBroadItemSold;
        if (broadItemSold === 0 && calcItemSold.broad_item_sold > 0) {
          broadItemSold = calcItemSold.broad_item_sold;
        }
        if (broadItemSold === 0 && existingItemSold.broad_item_sold > 0) {
          broadItemSold = existingItemSold.broad_item_sold;
        }

        console.log(`[ADS-SYNC] item_sold for ${perfDate}: API=${apiDirectItemSold}/${apiBroadItemSold}, Calc=${calcItemSold.direct_item_sold}/${calcItemSold.broad_item_sold}, Existing=${existingItemSold.direct_item_sold}/${existingItemSold.broad_item_sold}, Final=${directItemSold}/${broadItemSold}`);

        const { error: upsertError } = await supabase
          .from('apishopee_ads_shop_performance_daily')
          .upsert({
            shop_id: shopId,
            performance_date: perfDate,
            impression,
            clicks,
            ctr,
            expense,
            direct_order: dayMetrics.direct_order || 0,
            direct_gmv: dayMetrics.direct_gmv || 0,
            broad_order: dayMetrics.broad_order || 0,
            broad_gmv: broadGmv,
            direct_item_sold: directItemSold,
            broad_item_sold: broadItemSold,
            roas,
            acos,
            synced_at: now,
          }, { onConflict: 'shop_id,performance_date' });

        if (upsertError) {
          console.error(`[ADS-SYNC] Upsert shop-level daily error for ${perfDate}:`, upsertError);
        }
      }

      console.log(`[ADS-SYNC] Saved ${metricsList.length} shop-level daily records from API (with item_sold from campaign-level)`);
    }
  }

  // Fallback: Nếu API shop-level không có dữ liệu, tính tổng từ campaign-level
  if (!hasShopLevelData) {
    console.log('[ADS-SYNC] Shop-level API returned empty, calculating from campaign-level data...');

    const { data: campaignData, error: queryError } = await supabase
      .from('apishopee_ads_performance_daily')
      .select('performance_date, impression, clicks, expense, direct_order, direct_gmv, broad_order, broad_gmv, direct_item_sold, broad_item_sold')
      .eq('shop_id', shopId)
      .gte('performance_date', dbStartDate)
      .lte('performance_date', dbEndDate);

    if (queryError) {
      console.error('[ADS-SYNC] Error querying campaign-level data:', queryError);
      return { impression: 0, clicks: 0, orders: 0, gmv: 0, expense: 0 };
    }

    if (!campaignData || campaignData.length === 0) {
      console.log('[ADS-SYNC] No campaign-level data to aggregate');
      return { impression: 0, clicks: 0, orders: 0, gmv: 0, expense: 0 };
    }

    // Group by date và tính tổng
    const dailyTotals: Record<string, {
      impression: number;
      clicks: number;
      expense: number;
      direct_order: number;
      direct_gmv: number;
      broad_order: number;
      broad_gmv: number;
      direct_item_sold: number;
      broad_item_sold: number;
    }> = {};

    for (const row of campaignData) {
      const date = row.performance_date;
      if (!dailyTotals[date]) {
        dailyTotals[date] = {
          impression: 0, clicks: 0, expense: 0,
          direct_order: 0, direct_gmv: 0,
          broad_order: 0, broad_gmv: 0,
          direct_item_sold: 0, broad_item_sold: 0,
        };
      }
      dailyTotals[date].impression += Number(row.impression) || 0;
      dailyTotals[date].clicks += Number(row.clicks) || 0;
      dailyTotals[date].expense += Number(row.expense) || 0;
      dailyTotals[date].direct_order += Number(row.direct_order) || 0;
      dailyTotals[date].direct_gmv += Number(row.direct_gmv) || 0;
      dailyTotals[date].broad_order += Number(row.broad_order) || 0;
      dailyTotals[date].broad_gmv += Number(row.broad_gmv) || 0;
      dailyTotals[date].direct_item_sold += Number(row.direct_item_sold) || 0;
      dailyTotals[date].broad_item_sold += Number(row.broad_item_sold) || 0;
    }

    // Lưu vào bảng shop-level
    const now = new Date().toISOString();
    for (const [date, totals] of Object.entries(dailyTotals)) {
      const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
      const roas = totals.expense > 0 ? totals.broad_gmv / totals.expense : 0;
      const acos = totals.broad_gmv > 0 ? (totals.expense / totals.broad_gmv) * 100 : 0;

      const { error: upsertError } = await supabase
        .from('apishopee_ads_shop_performance_daily')
        .upsert({
          shop_id: shopId,
          performance_date: date,
          impression: totals.impression,
          clicks: totals.clicks,
          ctr,
          expense: totals.expense,
          direct_order: totals.direct_order,
          direct_gmv: totals.direct_gmv,
          broad_order: totals.broad_order,
          broad_gmv: totals.broad_gmv,
          direct_item_sold: totals.direct_item_sold,
          broad_item_sold: totals.broad_item_sold,
          roas,
          acos,
          synced_at: now,
        }, { onConflict: 'shop_id,performance_date' });

      if (upsertError) {
        console.error(`[ADS-SYNC] Upsert aggregated shop-level error for ${date}:`, upsertError);
      }
    }

    console.log(`[ADS-SYNC] Saved ${Object.keys(dailyTotals).length} aggregated shop-level daily records`);
  }

  // Trả về tổng của ngày hôm nay
  const todayDate = formatDateForDB(today);
  const { data: todayData } = await supabase
    .from('apishopee_ads_shop_performance_daily')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', todayDate)
    .maybeSingle();

  if (todayData) {
    return {
      impression: todayData.impression || 0,
      clicks: todayData.clicks || 0,
      orders: todayData.broad_order || 0,
      gmv: todayData.broad_gmv || 0,
      expense: todayData.expense || 0,
    };
  }

  return { impression: 0, clicks: 0, orders: 0, gmv: 0, expense: 0 };
}

/**
 * Sync shop-level hourly performance (tổng hợp tất cả ads theo giờ)
 * Sử dụng API get_all_cpc_ads_hourly_performance - giống như Response button
 * LƯU VÀO BẢNG RIÊNG để hiển thị chính xác
 * 
 * Nếu API trả về rỗng → fallback tính tổng từ campaign-level
 */
async function syncShopLevelHourlyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number
): Promise<number> {
  console.log('[ADS-SYNC] Syncing shop-level hourly performance...');

  // Sử dụng Vietnam timezone
  const today = getVietnamDate();
  const dateStr = formatDateForShopee(today);
  const dbDate = formatDateForDB(today);

  console.log(`[ADS-SYNC] Shop-level hourly date: ${dateStr} (VN timezone)`);

  // QUAN TRỌNG: Luôn lấy item_sold từ campaign-level vì API shop-level KHÔNG trả về field này
  // Tính tổng item_sold theo giờ từ bảng campaign hourly performance
  const { data: campaignItemSoldData } = await supabase
    .from('apishopee_ads_performance_hourly')
    .select('hour, direct_item_sold, broad_item_sold')
    .eq('shop_id', shopId)
    .eq('performance_date', dbDate);

  // Group item_sold by hour
  const itemSoldByHour: Record<number, { direct_item_sold: number; broad_item_sold: number }> = {};
  if (campaignItemSoldData) {
    for (const row of campaignItemSoldData) {
      const hour = row.hour;
      if (!itemSoldByHour[hour]) {
        itemSoldByHour[hour] = { direct_item_sold: 0, broad_item_sold: 0 };
      }
      itemSoldByHour[hour].direct_item_sold += Number(row.direct_item_sold) || 0;
      itemSoldByHour[hour].broad_item_sold += Number(row.broad_item_sold) || 0;
    }
  }
  console.log(`[ADS-SYNC] Calculated hourly item_sold from campaign data for ${Object.keys(itemSoldByHour).length} hours`);

  const perfResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_all_cpc_ads_hourly_performance',
    'GET',
    { performance_date: dateStr }
  );

  console.log('[ADS-SYNC] Shop-level hourly response:', JSON.stringify(perfResult, null, 2).substring(0, 2000));
  console.log('[ADS-SYNC] Full shop-level hourly API response:', JSON.stringify(perfResult));

  let savedCount = 0;
  let hasShopLevelData = false;

  if (!perfResult.error) {
    // Parse response - API trả về response là array trực tiếp
    // {"response": [{"hour": 0, ...}, ...], ...}
    const metricsList = Array.isArray(perfResult.response)
      ? perfResult.response
      : (perfResult.response?.metrics_list || []);

    if (metricsList.length > 0) {
      hasShopLevelData = true;

      // Fetch existing data to prevent overwriting item_sold with 0
      const { data: existingHourlyData } = await supabase
        .from('apishopee_ads_shop_performance_hourly')
        .select('hour, direct_item_sold, broad_item_sold')
        .eq('shop_id', shopId)
        .eq('performance_date', dbDate);

      // Create map for existing item_sold by hour
      const existingByHour: Record<number, { direct_item_sold: number; broad_item_sold: number }> = {};
      if (existingHourlyData) {
        for (const row of existingHourlyData) {
          existingByHour[row.hour] = {
            direct_item_sold: Number(row.direct_item_sold) || 0,
            broad_item_sold: Number(row.broad_item_sold) || 0,
          };
        }
      }

      // Prepare upsert data
      const now = new Date().toISOString();
      const upsertData = metricsList.map((hourMetrics: any) => {
        const expense = hourMetrics.expense || 0;
        const broadGmv = hourMetrics.broad_gmv || 0;
        const impression = hourMetrics.impression || 0;
        const clicks = hourMetrics.clicks || 0;

        const ctr = impression > 0 ? (clicks / impression) * 100 : 0;
        const roas = expense > 0 ? broadGmv / expense : 0;
        const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

        // QUAN TRỌNG: Không overwrite item_sold với 0 nếu đã có dữ liệu cũ
        const apiDirectItemSold = hourMetrics.direct_item_sold || 0;
        const apiBroadItemSold = hourMetrics.broad_item_sold || 0;
        const calcItemSold = itemSoldByHour[hourMetrics.hour] || { direct_item_sold: 0, broad_item_sold: 0 };
        const existingItemSold = existingByHour[hourMetrics.hour] || { direct_item_sold: 0, broad_item_sold: 0 };

        // Logic ưu tiên: API > Campaign-level > Existing DB > 0
        let directItemSold = apiDirectItemSold;
        if (directItemSold === 0 && calcItemSold.direct_item_sold > 0) {
          directItemSold = calcItemSold.direct_item_sold;
        }
        if (directItemSold === 0 && existingItemSold.direct_item_sold > 0) {
          directItemSold = existingItemSold.direct_item_sold;
        }

        let broadItemSold = apiBroadItemSold;
        if (broadItemSold === 0 && calcItemSold.broad_item_sold > 0) {
          broadItemSold = calcItemSold.broad_item_sold;
        }
        if (broadItemSold === 0 && existingItemSold.broad_item_sold > 0) {
          broadItemSold = existingItemSold.broad_item_sold;
        }

        return {
          shop_id: shopId,
          performance_date: dbDate,
          hour: hourMetrics.hour,
          impression,
          clicks,
          ctr,
          expense,
          direct_order: hourMetrics.direct_order || 0,
          direct_gmv: hourMetrics.direct_gmv || 0,
          broad_order: hourMetrics.broad_order || 0,
          broad_gmv: broadGmv,
          direct_item_sold: directItemSold,
          broad_item_sold: broadItemSold,
          roas,
          acos,
          synced_at: now,
        };
      });

      // UPSERT vào bảng shop-level hourly
      const { error: upsertError } = await supabase
        .from('apishopee_ads_shop_performance_hourly')
        .upsert(upsertData, { onConflict: 'shop_id,performance_date,hour' });

      if (upsertError) {
        console.error('[ADS-SYNC] Upsert shop-level hourly error:', upsertError);
      } else {
        savedCount = upsertData.length;
        console.log(`[ADS-SYNC] Saved ${savedCount} shop-level hourly records from API (preserving existing item_sold)`);
      }
    }
  }

  // Fallback: Nếu API shop-level không có dữ liệu, tính tổng từ campaign-level
  if (!hasShopLevelData) {
    console.log('[ADS-SYNC] Shop-level hourly API returned empty, calculating from campaign-level data...');

    const { data: campaignData, error: queryError } = await supabase
      .from('apishopee_ads_performance_hourly')
      .select('hour, impression, clicks, expense, direct_order, direct_gmv, broad_order, broad_gmv, direct_item_sold, broad_item_sold')
      .eq('shop_id', shopId)
      .eq('performance_date', dbDate);

    if (queryError) {
      console.error('[ADS-SYNC] Error querying campaign-level hourly data:', queryError);
      return 0;
    }

    if (!campaignData || campaignData.length === 0) {
      console.log('[ADS-SYNC] No campaign-level hourly data to aggregate');
      return 0;
    }

    // Group by hour và tính tổng
    const hourlyTotals: Record<number, {
      impression: number;
      clicks: number;
      expense: number;
      direct_order: number;
      direct_gmv: number;
      broad_order: number;
      broad_gmv: number;
      direct_item_sold: number;
      broad_item_sold: number;
    }> = {};

    for (const row of campaignData) {
      const hour = row.hour;
      if (!hourlyTotals[hour]) {
        hourlyTotals[hour] = {
          impression: 0, clicks: 0, expense: 0,
          direct_order: 0, direct_gmv: 0,
          broad_order: 0, broad_gmv: 0,
          direct_item_sold: 0, broad_item_sold: 0,
        };
      }
      hourlyTotals[hour].impression += Number(row.impression) || 0;
      hourlyTotals[hour].clicks += Number(row.clicks) || 0;
      hourlyTotals[hour].expense += Number(row.expense) || 0;
      hourlyTotals[hour].direct_order += Number(row.direct_order) || 0;
      hourlyTotals[hour].direct_gmv += Number(row.direct_gmv) || 0;
      hourlyTotals[hour].broad_order += Number(row.broad_order) || 0;
      hourlyTotals[hour].broad_gmv += Number(row.broad_gmv) || 0;
      hourlyTotals[hour].direct_item_sold += Number(row.direct_item_sold) || 0;
      hourlyTotals[hour].broad_item_sold += Number(row.broad_item_sold) || 0;
    }

    // Lưu vào bảng shop-level hourly
    const now = new Date().toISOString();
    const upsertData = Object.entries(hourlyTotals).map(([hourStr, totals]) => {
      const hour = parseInt(hourStr);
      const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
      const roas = totals.expense > 0 ? totals.broad_gmv / totals.expense : 0;
      const acos = totals.broad_gmv > 0 ? (totals.expense / totals.broad_gmv) * 100 : 0;

      return {
        shop_id: shopId,
        performance_date: dbDate,
        hour,
        impression: totals.impression,
        clicks: totals.clicks,
        ctr,
        expense: totals.expense,
        direct_order: totals.direct_order,
        direct_gmv: totals.direct_gmv,
        broad_order: totals.broad_order,
        broad_gmv: totals.broad_gmv,
        direct_item_sold: totals.direct_item_sold,
        broad_item_sold: totals.broad_item_sold,
        roas,
        acos,
        synced_at: now,
      };
    });

    const { error: upsertError } = await supabase
      .from('apishopee_ads_shop_performance_hourly')
      .upsert(upsertData, { onConflict: 'shop_id,performance_date,hour' });

    if (upsertError) {
      console.error('[ADS-SYNC] Upsert aggregated shop-level hourly error:', upsertError);
    } else {
      savedCount = upsertData.length;
      console.log(`[ADS-SYNC] Saved ${savedCount} aggregated shop-level hourly records`);
    }
  }

  return savedCount;
}

/**
 * Aggregate shop-level performance from campaign data
 * This ensures shop-level data matches the sum of all campaigns
 * Used after chunked performance sync completes
 */
async function aggregateShopLevelFromCampaigns(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<void> {
  console.log(`[ADS-SYNC] Aggregating shop-level data from campaigns for shop ${shopId}`);

  const today = getVietnamDate();
  const sevenDaysAgo = new Date(today.getTime());
  sevenDaysAgo.setUTCDate(today.getUTCDate() - 6);
  const dbStartDate = formatDateForDB(sevenDaysAgo);
  const dbEndDate = formatDateForDB(today);

  // Aggregate DAILY performance
  const { data: dailyData, error: dailyError } = await supabase
    .from('apishopee_ads_performance_daily')
    .select('performance_date, impression, clicks, expense, direct_order, direct_gmv, broad_order, broad_gmv, direct_item_sold, broad_item_sold')
    .eq('shop_id', shopId)
    .gte('performance_date', dbStartDate)
    .lte('performance_date', dbEndDate);

  if (dailyError) {
    console.error('[ADS-SYNC] Error fetching campaign daily data:', dailyError);
    return;
  }

  // Group by date
  const dailyTotals: Record<string, {
    impression: number; clicks: number; expense: number;
    direct_order: number; direct_gmv: number;
    broad_order: number; broad_gmv: number;
    direct_item_sold: number; broad_item_sold: number;
  }> = {};

  for (const row of dailyData || []) {
    const date = row.performance_date;
    if (!dailyTotals[date]) {
      dailyTotals[date] = {
        impression: 0, clicks: 0, expense: 0,
        direct_order: 0, direct_gmv: 0,
        broad_order: 0, broad_gmv: 0,
        direct_item_sold: 0, broad_item_sold: 0,
      };
    }
    dailyTotals[date].impression += Number(row.impression) || 0;
    dailyTotals[date].clicks += Number(row.clicks) || 0;
    dailyTotals[date].expense += Number(row.expense) || 0;
    dailyTotals[date].direct_order += Number(row.direct_order) || 0;
    dailyTotals[date].direct_gmv += Number(row.direct_gmv) || 0;
    dailyTotals[date].broad_order += Number(row.broad_order) || 0;
    dailyTotals[date].broad_gmv += Number(row.broad_gmv) || 0;
    dailyTotals[date].direct_item_sold += Number(row.direct_item_sold) || 0;
    dailyTotals[date].broad_item_sold += Number(row.broad_item_sold) || 0;
  }

  // Upsert daily shop-level data
  const now = new Date().toISOString();
  for (const [date, totals] of Object.entries(dailyTotals)) {
    const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
    const roas = totals.expense > 0 ? totals.broad_gmv / totals.expense : 0;
    const acos = totals.broad_gmv > 0 ? (totals.expense / totals.broad_gmv) * 100 : 0;

    await supabase
      .from('apishopee_ads_shop_performance_daily')
      .upsert({
        shop_id: shopId,
        performance_date: date,
        impression: totals.impression,
        clicks: totals.clicks,
        ctr,
        expense: totals.expense,
        direct_order: totals.direct_order,
        direct_gmv: totals.direct_gmv,
        broad_order: totals.broad_order,
        broad_gmv: totals.broad_gmv,
        direct_item_sold: totals.direct_item_sold,
        broad_item_sold: totals.broad_item_sold,
        roas,
        acos,
        synced_at: now,
      }, { onConflict: 'shop_id,performance_date' });
  }

  console.log(`[ADS-SYNC] Aggregated ${Object.keys(dailyTotals).length} days of daily data`);

  // Aggregate HOURLY performance for today only
  const todayDate = formatDateForDB(today);
  const { data: hourlyData, error: hourlyError } = await supabase
    .from('apishopee_ads_performance_hourly')
    .select('hour, impression, clicks, expense, direct_order, direct_gmv, broad_order, broad_gmv, direct_item_sold, broad_item_sold')
    .eq('shop_id', shopId)
    .eq('performance_date', todayDate);

  if (hourlyError) {
    console.error('[ADS-SYNC] Error fetching campaign hourly data:', hourlyError);
    return;
  }

  // Group by hour
  const hourlyTotals: Record<number, {
    impression: number; clicks: number; expense: number;
    direct_order: number; direct_gmv: number;
    broad_order: number; broad_gmv: number;
    direct_item_sold: number; broad_item_sold: number;
  }> = {};

  for (const row of hourlyData || []) {
    const hour = row.hour;
    if (!hourlyTotals[hour]) {
      hourlyTotals[hour] = {
        impression: 0, clicks: 0, expense: 0,
        direct_order: 0, direct_gmv: 0,
        broad_order: 0, broad_gmv: 0,
        direct_item_sold: 0, broad_item_sold: 0,
      };
    }
    hourlyTotals[hour].impression += Number(row.impression) || 0;
    hourlyTotals[hour].clicks += Number(row.clicks) || 0;
    hourlyTotals[hour].expense += Number(row.expense) || 0;
    hourlyTotals[hour].direct_order += Number(row.direct_order) || 0;
    hourlyTotals[hour].direct_gmv += Number(row.direct_gmv) || 0;
    hourlyTotals[hour].broad_order += Number(row.broad_order) || 0;
    hourlyTotals[hour].broad_gmv += Number(row.broad_gmv) || 0;
    hourlyTotals[hour].direct_item_sold += Number(row.direct_item_sold) || 0;
    hourlyTotals[hour].broad_item_sold += Number(row.broad_item_sold) || 0;
  }

  // Upsert hourly shop-level data
  for (const [hourStr, totals] of Object.entries(hourlyTotals)) {
    const hour = parseInt(hourStr);
    const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
    const roas = totals.expense > 0 ? totals.broad_gmv / totals.expense : 0;
    const acos = totals.broad_gmv > 0 ? (totals.expense / totals.broad_gmv) * 100 : 0;

    await supabase
      .from('apishopee_ads_shop_performance_hourly')
      .upsert({
        shop_id: shopId,
        performance_date: todayDate,
        hour,
        impression: totals.impression,
        clicks: totals.clicks,
        ctr,
        expense: totals.expense,
        direct_order: totals.direct_order,
        direct_gmv: totals.direct_gmv,
        broad_order: totals.broad_order,
        broad_gmv: totals.broad_gmv,
        direct_item_sold: totals.direct_item_sold,
        broad_item_sold: totals.broad_item_sold,
        roas,
        acos,
        synced_at: now,
      }, { onConflict: 'shop_id,performance_date,hour' });
  }

  console.log(`[ADS-SYNC] Aggregated ${Object.keys(hourlyTotals).length} hours of hourly data`);
}

/**
 * Update sync status
 */
async function updateSyncStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  updates: {
    is_syncing?: boolean;
    last_sync_at?: string;
    last_sync_error?: string | null;
    sync_progress?: Record<string, unknown>;
    total_campaigns?: number;
    ongoing_campaigns?: number;
  }
) {
  const { error } = await supabase
    .from('apishopee_ads_sync_status')
    .upsert(
      {
        shop_id: shopId,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' }
    );

  if (error) {
    console.error('[ADS-SYNC] Failed to update sync status:', error);
  }
}

/**
 * Main sync function - REALTIME mode (15 phút/lần)
 * CHỈ sync ongoing campaigns để nhanh, tránh timeout
 */
async function syncAdsData(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<{
  success: boolean;
  campaigns_synced: number;
  daily_records: number;
  hourly_records: number;
  error?: string;
}> {
  try {
    // Update status: syncing
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_sync_error: null,
      sync_progress: { step: 'starting', progress: 0 },
    });

    // Get credentials
    const credentials = await getShopCredentials(supabase, shopId);

    // Step 1: Sync campaigns (lấy danh sách)
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'syncing_campaigns', progress: 20 },
    });
    const { total, ongoing, allCampaigns } = await syncCampaigns(supabase, credentials, shopId);

    // Step 2: Sync daily performance - TẤT CẢ CAMPAIGNS (giống sync thủ công)
    // QUAN TRỌNG: Phải sync campaign-level TRƯỚC shop-level để có item_sold data
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'syncing_daily_performance', progress: 40 },
    });
    const dailyRecords = await syncDailyPerformance(supabase, credentials, shopId, allCampaigns);

    // Step 3: Sync hourly performance - TẤT CẢ CAMPAIGNS (giống sync thủ công)
    // QUAN TRỌNG: Phải sync campaign-level TRƯỚC shop-level để có item_sold data
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'syncing_hourly_performance', progress: 60 },
    });
    const hourlyRecords = await syncHourlyPerformance(supabase, credentials, shopId, allCampaigns);

    // Step 4: Sync shop-level performance (sau khi có campaign data để tính item_sold)
    // QUAN TRỌNG: Shop-level phụ thuộc vào campaign-level data cho item_sold field
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'syncing_shop_level', progress: 80 },
    });
    console.log('[ADS-SYNC] === SHOP-LEVEL PERFORMANCE (after campaign data) ===');
    await syncShopLevelDailyPerformance(supabase, credentials, shopId);
    await syncShopLevelHourlyPerformance(supabase, credentials, shopId);
    console.log('[ADS-SYNC] === END SHOP-LEVEL ===');

    // Update status: completed
    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      sync_progress: { step: 'completed', progress: 100 },
      total_campaigns: total,
      ongoing_campaigns: ongoing,
    });

    console.log(`[ADS-SYNC] === SYNC COMPLETED SUCCESSFULLY ===`);
    console.log(`[ADS-SYNC] Shop ID: ${shopId}`);
    console.log(`[ADS-SYNC] Total Campaigns: ${total}`);
    console.log(`[ADS-SYNC] Ongoing Campaigns: ${ongoing}`);
    console.log(`[ADS-SYNC] Daily Performance Records: ${dailyRecords}`);
    console.log(`[ADS-SYNC] Hourly Performance Records: ${hourlyRecords}`);
    console.log(`[ADS-SYNC] Sync Time: ${new Date().toISOString()}`);
    console.log(`[ADS-SYNC] === END ===`);

    return {
      success: true,
      campaigns_synced: total,
      daily_records: dailyRecords,
      hourly_records: hourlyRecords,
      total_campaigns: total,
      ongoing_campaigns: ongoing,
      sync_time: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`[ADS-SYNC] Sync failed for shop ${shopId}:`, errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_error: errorMessage,
      sync_progress: { step: 'failed', error: errorMessage },
    });

    return {
      success: false,
      campaigns_synced: 0,
      daily_records: 0,
      hourly_records: 0,
      error: errorMessage,
    };
  }
}

/**
 * BACKFILL sync function - Chạy 1 lần/ngày (2AM)
 * Sync 7 ngày để cập nhật GMV attribution
 * 
 * LÝ DO: Shopee Ads có 7-day attribution window
 * - Đơn hàng hôm nay có thể được gán cho click từ 3-7 ngày trước
 * - Nếu chỉ sync hôm nay, GMV của các ngày cũ sẽ không được cập nhật
 * - Backfill giúp dữ liệu khớp với Shopee Seller Center
 */
async function syncAdsDataBackfill(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  daysBack: number = 7
): Promise<{
  success: boolean;
  campaigns_synced: number;
  daily_records: number;
  hourly_records: number;
  error?: string;
}> {
  try {
    console.log(`[ADS-SYNC] === BACKFILL MODE: ${daysBack} days ===`);

    // Update status: syncing
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_sync_error: null,
      sync_progress: { step: 'backfill_starting', progress: 0, days_back: daysBack },
    });

    // Get credentials
    const credentials = await getShopCredentials(supabase, shopId);

    // Step 1: Sync campaigns
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'backfill_campaigns', progress: 10 },
    });
    const { total, ongoing, allCampaigns } = await syncCampaigns(supabase, credentials, shopId);

    // QUAN TRỌNG: Lọc bỏ campaigns đã ended/closed - chúng không có data mới
    const activeCampaigns = allCampaigns.filter(c =>
      c.status !== 'ended' && c.status !== 'closed'
    );
    console.log(`[ADS-SYNC] Backfill: ${allCampaigns.length} total -> ${activeCampaigns.length} active campaigns`);

    // Step 2: Sync daily performance (7 ngày - đã có sẵn trong function)
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'backfill_daily_performance', progress: 30 },
    });
    const dailyRecords = await syncDailyPerformance(supabase, credentials, shopId, activeCampaigns);

    // Step 3: BACKFILL hourly performance (7 ngày)
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'backfill_hourly_performance', progress: 50 },
    });
    const hourlyRecords = await syncHourlyPerformanceBackfill(supabase, credentials, shopId, activeCampaigns, daysBack);

    // Step 4: Sync shop-level performance
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'backfill_shop_level', progress: 90 },
    });
    await syncShopLevelDailyPerformance(supabase, credentials, shopId);
    await syncShopLevelHourlyPerformance(supabase, credentials, shopId);

    // Update status: completed
    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      sync_progress: { step: 'backfill_completed', progress: 100, days_back: daysBack },
      total_campaigns: total,
      ongoing_campaigns: ongoing,
    });

    console.log(`[ADS-SYNC] === BACKFILL COMPLETED for shop ${shopId} ===`);
    return {
      success: true,
      campaigns_synced: total,
      daily_records: dailyRecords,
      hourly_records: hourlyRecords,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`[ADS-SYNC] Backfill failed for shop ${shopId}:`, errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_error: errorMessage,
      sync_progress: { step: 'backfill_failed', error: errorMessage },
    });

    return {
      success: false,
      campaigns_synced: 0,
      daily_records: 0,
      hourly_records: 0,
      error: errorMessage,
    };
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  console.log(`[ADS-SYNC] === REQUEST RECEIVED === Method: ${req.method}, URL: ${req.url}`);

  if (req.method === 'OPTIONS') {
    console.log('[ADS-SYNC] OPTIONS request handled');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('[ADS-SYNC] Request body:', JSON.stringify(body, null, 2));
    const { action, shop_id } = body;

    if (!shop_id) {
      return new Response(
        JSON.stringify({ error: 'shop_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    switch (action) {
      case 'sync': {
        // REALTIME mode: Sync nhanh, chỉ hôm nay (15 phút/lần)
        const result = await syncAdsData(supabase, shop_id);
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'sync_day': {
        // INCREMENTAL BACKFILL: Sync 1 ngày cụ thể
        // Dùng cho cron job gọi nhiều lần, mỗi lần 1 ngày để tránh timeout
        // days_ago: 0 = hôm nay, 1 = hôm qua, 2 = 2 ngày trước, ...
        // use_all_campaigns: true = sync campaigns có khả năng có data (loại bỏ ended/closed)
        const daysAgo = body.days_ago || 0;
        const useAllCampaigns = body.use_all_campaigns || false;

        console.log(`[ADS-SYNC] === SYNC_DAY: ${daysAgo} days ago, all_campaigns=${useAllCampaigns} ===`);

        const credentials = await getShopCredentials(supabase, shop_id);
        const { allCampaigns, ongoingCampaigns } = await syncCampaigns(supabase, credentials, shop_id);

        // Chọn campaigns để sync
        // QUAN TRỌNG: Khi use_all_campaigns=true, chỉ sync campaigns KHÔNG phải ended/closed
        // vì campaigns đã kết thúc sẽ không có data mới
        let campaignsToSync: CampaignInfo[];
        if (useAllCampaigns) {
          // Lọc bỏ campaigns đã ended hoặc closed - chúng không có data mới
          const activeCampaigns = allCampaigns.filter(c =>
            c.status !== 'ended' && c.status !== 'closed'
          );
          console.log(`[ADS-SYNC] Filtered: ${allCampaigns.length} total -> ${activeCampaigns.length} active (excluded ${allCampaigns.length - activeCampaigns.length} ended/closed)`);
          campaignsToSync = activeCampaigns;
        } else {
          campaignsToSync = ongoingCampaigns;
        }
        console.log(`[ADS-SYNC] Syncing ${campaignsToSync.length} campaigns`);

        const today = getVietnamDate();
        const targetDate = new Date(today.getTime());
        targetDate.setUTCDate(today.getUTCDate() - daysAgo);

        const dailyRecords = await syncDailyPerformanceForDate(supabase, credentials, shop_id, campaignsToSync, targetDate);
        const hourlyRecords = await syncHourlyPerformanceForDate(supabase, credentials, shop_id, campaignsToSync, targetDate);

        // Cập nhật shop-level cho ngày đó
        await syncShopLevelDailyPerformance(supabase, credentials, shop_id);
        if (daysAgo === 0) {
          await syncShopLevelHourlyPerformance(supabase, credentials, shop_id);
        }

        return new Response(
          JSON.stringify({
            success: true,
            days_ago: daysAgo,
            date: formatDateForDB(targetDate),
            campaigns_synced: campaignsToSync.length,
            daily_records: dailyRecords,
            hourly_records: hourlyRecords,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'backfill': {
        // BACKFILL mode: Sync 7 ngày để cập nhật GMV attribution (1 lần/ngày, 2AM)
        // Lý do: Shopee có 7-day attribution window - đơn hàng hôm nay có thể
        // được gán cho click từ 3-7 ngày trước
        const daysBack = body.days_back || 7;
        const result = await syncAdsDataBackfill(supabase, shop_id, daysBack);
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'sync_campaigns_only': {
        // OPTIMIZED: Chỉ sync campaigns (nhanh nhất, ~5-15s)
        console.log(`[ADS-SYNC] === SYNC CAMPAIGNS ONLY ===`);

        await updateSyncStatus(supabase, shop_id, {
          is_syncing: true,
          sync_progress: { step: 'syncing_campaigns', progress: 50 },
        });

        try {
          const credentials = await getShopCredentials(supabase, shop_id);
          const { total, ongoing, allCampaigns } = await syncCampaigns(supabase, credentials, shop_id);

          await updateSyncStatus(supabase, shop_id, {
            is_syncing: false,
            last_sync_at: new Date().toISOString(),
            sync_progress: { step: 'completed', progress: 100 },
            total_campaigns: total,
            ongoing_campaigns: ongoing,
          });

          return new Response(
            JSON.stringify({
              success: true,
              campaigns_synced: total,
              ongoing_campaigns: ongoing,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          await updateSyncStatus(supabase, shop_id, {
            is_syncing: false,
            last_sync_error: (error as Error).message,
          });
          throw error;
        }
      }

      case 'sync_performance_only': {
        // OPTIMIZED: Chỉ sync performance (không sync campaigns, ~10-30s)
        console.log(`[ADS-SYNC] === SYNC PERFORMANCE ONLY ===`);

        await updateSyncStatus(supabase, shop_id, {
          is_syncing: true,
          sync_progress: { step: 'syncing_performance', progress: 20 },
        });

        try {
          const credentials = await getShopCredentials(supabase, shop_id);

          // Lấy campaigns từ DB thay vì gọi API
          const { data: campaigns } = await supabase
            .from('apishopee_ads_campaign_data')
            .select('campaign_id, ad_type, status')
            .eq('shop_id', shop_id);

          if (!campaigns || campaigns.length === 0) {
            throw new Error('No campaigns found. Please sync campaigns first.');
          }

          const campaignInfos: CampaignInfo[] = campaigns.map(c => ({
            campaign_id: c.campaign_id,
            ad_type: c.ad_type,
            status: c.status,
          } as CampaignInfo));

          // Sync daily performance
          await updateSyncStatus(supabase, shop_id, {
            sync_progress: { step: 'syncing_daily_performance', progress: 40 },
          });
          const dailyRecords = await syncDailyPerformance(supabase, credentials, shop_id, campaignInfos);

          // Sync hourly performance
          await updateSyncStatus(supabase, shop_id, {
            sync_progress: { step: 'syncing_hourly_performance', progress: 60 },
          });
          const hourlyRecords = await syncHourlyPerformance(supabase, credentials, shop_id, campaignInfos);

          // Sync shop-level
          await updateSyncStatus(supabase, shop_id, {
            sync_progress: { step: 'syncing_shop_level', progress: 80 },
          });
          await syncShopLevelDailyPerformance(supabase, credentials, shop_id);
          await syncShopLevelHourlyPerformance(supabase, credentials, shop_id);

          await updateSyncStatus(supabase, shop_id, {
            is_syncing: false,
            last_sync_at: new Date().toISOString(),
            sync_progress: { step: 'completed', progress: 100 },
          });

          return new Response(
            JSON.stringify({
              success: true,
              daily_records: dailyRecords,
              hourly_records: hourlyRecords,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          await updateSyncStatus(supabase, shop_id, {
            is_syncing: false,
            last_sync_error: (error as Error).message,
          });
          throw error;
        }
      }

      case 'sync_campaigns_chunk': {
        // CHUNKED SYNC: Sync 1 chunk campaigns (for large shops >200 campaigns)
        // params: { offset, limit, chunk_index, total_chunks }
        const params = body.params || {};
        const offset = params.offset || 0;
        const limit = params.limit || 100;
        const chunk_index = params.chunk_index ?? 0;
        const total_chunks = params.total_chunks ?? 1;

        console.log(`[ADS-SYNC] === SYNC CAMPAIGNS CHUNK ${chunk_index + 1}/${total_chunks} ===`);
        console.log(`[ADS-SYNC] Offset: ${offset}, Limit: ${limit}`);

        try {
          const credentials = await getShopCredentials(supabase, shop_id);

          // Step 1: Get ALL campaign IDs (we need total count)
          const idListResult = await callShopeeAPI(
            credentials,
            shop_id,
            '/api/v2/ads/get_product_level_campaign_id_list',
            'GET',
            { ad_type: 'all', offset: 0, limit: 5000 }
          );

          if (idListResult.error) {
            throw new Error(`Failed to get campaign list: ${idListResult.message || idListResult.error}`);
          }

          const allCampaignIds = idListResult.response?.campaign_list || [];
          console.log(`[ADS-SYNC] Total campaigns: ${allCampaignIds.length}`);

          // Step 2: Slice to get THIS chunk only
          const chunk = allCampaignIds.slice(offset, offset + limit);
          console.log(`[ADS-SYNC] Chunk ${chunk_index + 1}: Processing ${chunk.length} campaigns (${offset} to ${offset + chunk.length - 1})`);

          if (chunk.length === 0) {
            // Update progress - this chunk is done
            await supabase.rpc('update_chunk_progress', {
              p_shop_id: shop_id,
              p_chunk_index: chunk_index,
              p_synced_count: 0,
              p_success: true
            });

            return new Response(
              JSON.stringify({
                success: true,
                chunk_index,
                total_chunks,
                campaigns_synced: 0,
                message: 'No campaigns in this chunk'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Step 3: Get details for this chunk (batch 100)
          const allCampaigns: CampaignInfo[] = [];
          const detailBatchSize = 100;

          for (let i = 0; i < chunk.length; i += detailBatchSize) {
            const batch = chunk.slice(i, i + detailBatchSize);
            const campaignIds = batch.map((c: { campaign_id: number }) => c.campaign_id).join(',');

            const detailResult = await callShopeeAPI(
              credentials,
              shop_id,
              '/api/v2/ads/get_product_level_campaign_setting_info',
              'GET',
              { campaign_id_list: campaignIds, info_type_list: '1,3' }
            );

            if (detailResult.response?.campaign_list) {
              for (const detail of detailResult.response.campaign_list) {
                const original = batch.find((c: { campaign_id: number }) => c.campaign_id === detail.campaign_id);
                const campaignInfo: CampaignInfo = {
                  campaign_id: detail.campaign_id,
                  ad_type: original?.ad_type || detail.common_info?.ad_type || 'auto',
                  name: detail.common_info?.ad_name,
                  status: detail.common_info?.campaign_status,
                  campaign_budget: detail.common_info?.campaign_budget,
                  campaign_placement: detail.common_info?.campaign_placement,
                  bidding_method: detail.common_info?.bidding_method,
                  roas_target: detail.auto_bidding_info?.roas_target || null,
                  start_time: detail.common_info?.campaign_duration?.start_time,
                  end_time: detail.common_info?.campaign_duration?.end_time,
                  item_count: detail.common_info?.item_id_list?.length || 0,
                };

                allCampaigns.push(campaignInfo);
              }
            }
          }

          // Step 4: Upsert to database
          const now = new Date().toISOString();
          const upsertData = allCampaigns.map(c => ({
            shop_id: shop_id,
            campaign_id: c.campaign_id,
            ad_type: c.ad_type,
            name: c.name || null,
            status: c.status || null,
            campaign_placement: c.campaign_placement || null,
            bidding_method: c.bidding_method || null,
            campaign_budget: c.campaign_budget || 0,
            start_time: c.start_time || null,
            end_time: c.end_time || null,
            item_count: c.item_count || 0,
            roas_target: c.roas_target,
            synced_at: now,
            cached_at: now,
          }));

          const { error: upsertError } = await supabase
            .from('apishopee_ads_campaign_data')
            .upsert(upsertData, { onConflict: 'shop_id,campaign_id' });

          if (upsertError) {
            console.error('[ADS-SYNC] Upsert chunk campaigns error:', upsertError);

            // Update progress - failed
            await supabase.rpc('update_chunk_progress', {
              p_shop_id: shop_id,
              p_chunk_index: chunk_index,
              p_synced_count: 0,
              p_success: false,
              p_error_message: upsertError.message
            });

            throw new Error(`Failed to save campaigns: ${upsertError.message}`);
          }

          // Step 5: Update progress
          await supabase.rpc('update_chunk_progress', {
            p_shop_id: shop_id,
            p_chunk_index: chunk_index,
            p_synced_count: allCampaigns.length,
            p_success: true
          });

          console.log(`[ADS-SYNC] Chunk ${chunk_index + 1}/${total_chunks} completed: ${allCampaigns.length} campaigns synced`);

          // Step 6: Check if ALL chunks are done
          const { data: progressData } = await supabase
            .from('apishopee_ads_sync_progress')
            .select('current_chunk, total_chunks, synced_campaigns, total_campaigns')
            .eq('shop_id', shop_id)
            .single();

          const isLastChunk = progressData && (progressData.current_chunk >= progressData.total_chunks - 1);

          if (isLastChunk) {
            console.log('[ADS-SYNC] All chunks completed! Moving to performance sync stage');

            // Mark campaigns stage complete, prepare for performance stage
            await supabase.rpc('complete_sync_progress', {
              p_shop_id: shop_id,
              p_stage: 'syncing_performance'
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              chunk_index,
              total_chunks,
              campaigns_synced: allCampaigns.length,
              progress: progressData,
              is_last_chunk: isLastChunk
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          console.error(`[ADS-SYNC] Chunk ${chunk_index + 1} failed:`, error);

          // Update progress - failed
          await supabase.rpc('update_chunk_progress', {
            p_shop_id: shop_id,
            p_chunk_index: chunk_index,
            p_synced_count: 0,
            p_success: false,
            p_error_message: (error as Error).message
          });

          throw error;
        }
      }

      case 'sync_performance_chunk': {
        // CHUNKED PERFORMANCE SYNC: Sync performance for a subset of campaigns
        // params: { campaign_ids, chunk_index, total_chunks }
        const params = body.params || {};
        const campaignIds: number[] = params.campaign_ids || [];
        const chunk_index = params.chunk_index ?? 0;
        const total_chunks = params.total_chunks ?? 1;

        console.log(`[ADS-SYNC] === SYNC PERFORMANCE CHUNK ${chunk_index + 1}/${total_chunks} ===`);
        console.log(`[ADS-SYNC] Campaigns in chunk: ${campaignIds.length}`);

        if (campaignIds.length === 0) {
          return new Response(
            JSON.stringify({
              success: true,
              chunk_index,
              total_chunks,
              daily_records: 0,
              hourly_records: 0,
              message: 'No campaigns in this chunk'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          const credentials = await getShopCredentials(supabase, shop_id);

          // Fetch campaign details from database to get correct ad_type
          const { data: campaignData, error: campaignError } = await supabase
            .from('apishopee_ads_campaign_data')
            .select('campaign_id, ad_type')
            .eq('shop_id', shop_id)
            .in('campaign_id', campaignIds);

          if (campaignError) {
            console.error('[ADS-SYNC] Error fetching campaign details:', campaignError);
            throw campaignError;
          }

          // Map campaign ad_type
          const typeMap: Record<number, 'auto' | 'manual'> = {};
          for (const c of campaignData || []) {
            typeMap[c.campaign_id] = c.ad_type === 'manual' ? 'manual' : 'auto';
          }

          // Build campaign info array with correct ad_type
          const campaignInfos: CampaignInfo[] = campaignIds.map(id => ({
            campaign_id: id,
            ad_type: typeMap[id] || 'auto',
          }));

          console.log(`[ADS-SYNC] Campaign types: auto=${campaignInfos.filter(c => c.ad_type === 'auto').length}, manual=${campaignInfos.filter(c => c.ad_type === 'manual').length}`);

          const today = getVietnamDate();

          // Sync daily performance for this chunk
          const dailyRecords = await syncDailyPerformanceForDate(
            supabase, credentials, shop_id, campaignInfos, today
          );

          // Sync hourly performance for this chunk
          const hourlyRecords = await syncHourlyPerformanceForDate(
            supabase, credentials, shop_id, campaignInfos, today
          );

          console.log(`[ADS-SYNC] Performance chunk ${chunk_index + 1}/${total_chunks} completed`);
          console.log(`[ADS-SYNC] Daily records: ${dailyRecords}, Hourly records: ${hourlyRecords}`);

          // If last chunk, update shop-level aggregates and sync status
          const isLastChunk = chunk_index >= total_chunks - 1;

          if (isLastChunk) {
            console.log('[ADS-SYNC] Last performance chunk - syncing shop-level data from Shopee API');

            // IMPORTANT: Call Shop-Level API to get item_sold data
            // Campaign-level API does NOT return item_sold, only Shop-Level API does
            // This ensures shop-level data includes correct item_sold values
            await syncShopLevelDailyPerformance(supabase, credentials, shop_id);
            await syncShopLevelHourlyPerformance(supabase, credentials, shop_id);

            // Update sync status
            await updateSyncStatus(supabase, shop_id, {
              is_syncing: false,
              last_sync_at: new Date().toISOString(),
              last_sync_error: null,
              sync_progress: { step: 'completed', progress: 100 },
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              chunk_index,
              total_chunks,
              campaigns_processed: campaignIds.length,
              daily_records: dailyRecords,
              hourly_records: hourlyRecords,
              is_last_chunk: isLastChunk
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          console.error(`[ADS-SYNC] Performance chunk ${chunk_index + 1} failed:`, error);
          throw error;
        }
      }

      case 'status': {
        const { data, error } = await supabase
          .from('apishopee_ads_sync_status')
          .select('*')
          .eq('shop_id', shop_id)
          .maybeSingle();

        if (error) {
          throw error;
        }

        return new Response(
          JSON.stringify({
            success: true,
            status: data || {
              is_syncing: false,
              last_sync_at: null,
              last_sync_error: null,
              total_campaigns: 0,
              ongoing_campaigns: 0,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: 'Invalid action',
            available_actions: [
              'sync - Full sync (campaigns + performance)',
              'sync_campaigns_only - Only sync campaigns (fast)',
              'sync_performance_only - Only sync performance data',
              'sync_campaigns_chunk - Sync 1 chunk of campaigns (for large shops)',
              'sync_performance_chunk - Sync 1 chunk of performance data (for large shops)',
              'sync_day - Sync specific day',
              'backfill - Backfill 7 days',
              'status - Get sync status'
            ]
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[ADS-SYNC] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, success: false }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

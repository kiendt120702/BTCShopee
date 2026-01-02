/**
 * Supabase Edge Function: Shopee Account Health
 * Quản lý Account Health API với Auto-Refresh Token
 * Hỗ trợ multi-partner: lấy credentials từ database
 * 
 * Endpoints:
 * - get_shop_performance: Lấy thông tin hiệu suất shop
 * - get_metric_source_detail: Lấy chi tiết nguồn metric
 * - get_penalty_point_history: Lấy lịch sử điểm phạt
 * - get_punishment_history: Lấy lịch sử hình phạt
 * - get_listings_with_issues: Lấy danh sách sản phẩm có vấn đề
 * - get_late_orders: Lấy danh sách đơn hàng trễ
 * - get_shop_penalty: Lấy thông tin phạt shop
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shopee API config (fallback)
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';

// Supabase config
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Interface cho partner credentials
interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

/**
 * Lấy partner credentials từ database hoặc fallback env
 */
async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<PartnerCredentials> {
  const { data, error } = await supabase
    .from('apishopee_shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (data?.partner_id && data?.partner_key && !error) {
    console.log('[PARTNER] Using partner from shop:', data.partner_id);
    return {
      partnerId: data.partner_id,
      partnerKey: data.partner_key,
    };
  }

  console.log('[PARTNER] Using default partner from env:', DEFAULT_PARTNER_ID);
  return {
    partnerId: DEFAULT_PARTNER_ID,
    partnerKey: DEFAULT_PARTNER_KEY,
  };
}

/**
 * Helper function để gọi API qua proxy hoặc trực tiếp
 */
async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    console.log('[PROXY] Calling via proxy:', PROXY_URL);
    return await fetch(proxyUrl, options);
  }
  return await fetch(targetUrl, options);
}

function createSignature(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken = '',
  shopId = 0
): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;

  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

async function refreshAccessToken(
  credentials: PartnerCredentials,
  refreshToken: string,
  shopId: number
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp);

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${credentials.partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      partner_id: credentials.partnerId,
      shop_id: shopId,
    }),
  });

  return await response.json();
}

async function saveToken(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  token: Record<string, unknown>
) {
  const { error } = await supabase.from('apishopee_shops').upsert(
    {
      shop_id: shopId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expire_in: token.expire_in,
      expired_at: Date.now() + (token.expire_in as number) * 1000,
      token_updated_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id' }
  );

  if (error) {
    console.error('Failed to save token:', error);
    throw error;
  }
}

async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  const { data: shopData, error: shopError } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at, merchant_id')
    .eq('shop_id', shopId)
    .single();

  if (!shopError && shopData?.access_token) {
    return shopData;
  }

  throw new Error('Token not found. Please authenticate first.');
}

/**
 * Lấy shop UUID từ shop_id số
 */
async function getShopUuid(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<string | null> {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('id')
    .eq('shop_id', shopId)
    .single();
  return data?.id || null;
}

/**
 * Lưu dữ liệu Account Health vào database
 */
async function saveAccountHealthData(
  supabase: ReturnType<typeof createClient>,
  shopUuid: string,
  performanceData: Record<string, unknown> | null,
  penaltyData: Record<string, unknown> | null
) {
  const upsertData: Record<string, unknown> = {
    shop_id: shopUuid,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (performanceData?.response) {
    const perf = performanceData.response as Record<string, unknown>;
    const overall = perf.overall_performance as Record<string, unknown> | undefined;
    upsertData.overall_score = overall?.score;
    upsertData.overall_level = overall?.level;
    upsertData.metrics = perf.metrics || [];
    upsertData.raw_performance_response = performanceData;
  }

  if (penaltyData?.response) {
    const penalty = penaltyData.response as Record<string, unknown>;
    upsertData.penalty_points = penalty.penalty_points || 0;
    upsertData.ongoing_punishments = penalty.ongoing_punishment || [];
    upsertData.raw_penalty_response = penaltyData;
  }

  await supabase
    .from('apishopee_account_health_data')
    .upsert(upsertData, { onConflict: 'shop_id' });
}

/**
 * Lưu lịch sử điểm phạt
 */
async function savePenaltyHistory(
  supabase: ReturnType<typeof createClient>,
  shopUuid: string,
  historyList: Record<string, unknown>[]
) {
  if (!historyList?.length) return;

  const records = historyList.map(item => ({
    shop_id: shopUuid,
    penalty_point: item.penalty_point,
    reason: item.reason,
    order_sn: item.order_sn,
    created_time: item.created_time,
    raw_data: item,
    synced_at: new Date().toISOString(),
  }));

  // Xóa dữ liệu cũ và insert mới
  await supabase.from('apishopee_penalty_point_history').delete().eq('shop_id', shopUuid);
  await supabase.from('apishopee_penalty_point_history').insert(records);
}

/**
 * Lưu lịch sử hình phạt
 */
async function savePunishmentHistory(
  supabase: ReturnType<typeof createClient>,
  shopUuid: string,
  historyList: Record<string, unknown>[]
) {
  if (!historyList?.length) return;

  const records = historyList.map(item => ({
    shop_id: shopUuid,
    punishment_type: item.punishment_type,
    reason: item.reason,
    start_time: item.start_time,
    end_time: item.end_time,
    status: item.status,
    raw_data: item,
    synced_at: new Date().toISOString(),
  }));

  await supabase.from('apishopee_punishment_history').delete().eq('shop_id', shopUuid);
  await supabase.from('apishopee_punishment_history').insert(records);
}

/**
 * Lưu sản phẩm có vấn đề
 */
async function saveListingsWithIssues(
  supabase: ReturnType<typeof createClient>,
  shopUuid: string,
  listingList: Record<string, unknown>[]
) {
  if (!listingList?.length) return;

  const records = listingList.map(item => ({
    shop_id: shopUuid,
    item_id: item.item_id,
    item_name: item.item_name,
    issue_type: item.issue_type,
    issue_detail: item.issue_detail,
    issue_created_time: item.created_time,
    raw_data: item,
    synced_at: new Date().toISOString(),
  }));

  // Upsert để tránh duplicate
  await supabase
    .from('apishopee_listings_with_issues')
    .upsert(records, { onConflict: 'shop_id,item_id,issue_type' });
}

/**
 * Lưu đơn hàng trễ
 */
async function saveLateOrders(
  supabase: ReturnType<typeof createClient>,
  shopUuid: string,
  orderList: Record<string, unknown>[]
) {
  if (!orderList?.length) return;

  const records = orderList.map(item => ({
    shop_id: shopUuid,
    order_sn: item.order_sn,
    late_ship_days: item.late_ship_days,
    ship_by_date: item.ship_by_date,
    actual_ship_date: item.actual_ship_date,
    raw_data: item,
    synced_at: new Date().toISOString(),
  }));

  await supabase
    .from('apishopee_late_orders')
    .upsert(records, { onConflict: 'shop_id,order_sn' });
}

async function callShopeeAPIWithRetry(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  path: string,
  method: 'GET' | 'POST',
  shopId: number,
  token: { access_token: string; refresh_token: string },
  body?: Record<string, unknown>,
  extraParams?: Record<string, string | number | boolean>
): Promise<unknown> {
  const makeRequest = async (accessToken: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp, accessToken, shopId);

    const params = new URLSearchParams({
      partner_id: credentials.partnerId.toString(),
      timestamp: timestamp.toString(),
      access_token: accessToken,
      shop_id: shopId.toString(),
      sign: sign,
    });

    if (extraParams) {
      Object.entries(extraParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
    console.log('Calling Shopee Account Health API:', path);

    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (method === 'POST' && body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetchWithProxy(url, options);
    return await response.json();
  };

  let result = await makeRequest(token.access_token);

  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[AUTO-RETRY] Invalid token detected, refreshing...');

    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);

    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      
      await supabase.from('apishopee_shops').upsert({
        shop_id: shopId,
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        expired_at: Date.now() + newToken.expire_in * 1000,
        token_updated_at: new Date().toISOString(),
      }, { onConflict: 'shop_id' });
      
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, ...params } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const credentials = await getPartnerCredentials(supabase, shop_id);
    const token = await getTokenWithAutoRefresh(supabase, shop_id);
    const shopUuid = await getShopUuid(supabase, shop_id);

    let result;

    switch (action) {
      case 'get-shop-performance': {
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/account_health/get_shop_performance',
          'GET',
          shop_id,
          token
        );
        
        // Lưu vào database
        if (shopUuid && result && !(result as Record<string, unknown>).error) {
          await saveAccountHealthData(supabase, shopUuid, result as Record<string, unknown>, null);
        }
        break;
      }

      case 'get-metric-source-detail': {
        // metric_type: required - loại metric cần lấy chi tiết
        // page_no: optional - số trang (default 1)
        // page_size: optional - số item mỗi trang (default 20)
        if (!params.metric_type) {
          return new Response(JSON.stringify({ error: 'metric_type is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const extraParams: Record<string, string | number> = {
          metric_type: params.metric_type,
        };
        if (params.page_no !== undefined) extraParams.page_no = params.page_no;
        if (params.page_size !== undefined) extraParams.page_size = params.page_size;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/account_health/get_metric_source_detail',
          'GET',
          shop_id,
          token,
          undefined,
          extraParams
        );
        break;
      }

      case 'get-penalty-point-history': {
        // page_no: optional - số trang (default 1)
        // page_size: optional - số item mỗi trang (default 20)
        const penaltyParams: Record<string, number> = {};
        if (params.page_no !== undefined) penaltyParams.page_no = params.page_no;
        if (params.page_size !== undefined) penaltyParams.page_size = params.page_size;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/account_health/get_penalty_point_history',
          'GET',
          shop_id,
          token,
          undefined,
          penaltyParams
        );
        
        // Lưu vào database
        const penaltyResult = result as Record<string, unknown>;
        if (shopUuid && penaltyResult?.response) {
          const resp = penaltyResult.response as Record<string, unknown>;
          await savePenaltyHistory(supabase, shopUuid, resp.penalty_point_list as Record<string, unknown>[] || []);
        }
        break;
      }

      case 'get-punishment-history': {
        // page_no: optional - số trang (default 1)
        // page_size: optional - số item mỗi trang (default 20)
        const punishmentParams: Record<string, number> = {};
        if (params.page_no !== undefined) punishmentParams.page_no = params.page_no;
        if (params.page_size !== undefined) punishmentParams.page_size = params.page_size;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/account_health/get_punishment_history',
          'GET',
          shop_id,
          token,
          undefined,
          punishmentParams
        );
        
        // Lưu vào database
        const punishmentResult = result as Record<string, unknown>;
        if (shopUuid && punishmentResult?.response) {
          const resp = punishmentResult.response as Record<string, unknown>;
          await savePunishmentHistory(supabase, shopUuid, resp.punishment_list as Record<string, unknown>[] || []);
        }
        break;
      }

      case 'get-listings-with-issues': {
        // issue_type: optional - loại vấn đề
        // page_no: optional - số trang (default 1)
        // page_size: optional - số item mỗi trang (default 20)
        const listingsParams: Record<string, string | number> = {};
        if (params.issue_type !== undefined) listingsParams.issue_type = params.issue_type;
        if (params.page_no !== undefined) listingsParams.page_no = params.page_no;
        if (params.page_size !== undefined) listingsParams.page_size = params.page_size;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/account_health/get_listings_with_issues',
          'GET',
          shop_id,
          token,
          undefined,
          listingsParams
        );
        
        // Lưu vào database
        const listingsResult = result as Record<string, unknown>;
        if (shopUuid && listingsResult?.response) {
          const resp = listingsResult.response as Record<string, unknown>;
          await saveListingsWithIssues(supabase, shopUuid, resp.listing_list as Record<string, unknown>[] || []);
        }
        break;
      }

      case 'get-late-orders': {
        // page_no: optional - số trang (default 1)
        // page_size: optional - số item mỗi trang (default 20)
        const lateOrdersParams: Record<string, number> = {};
        if (params.page_no !== undefined) lateOrdersParams.page_no = params.page_no;
        if (params.page_size !== undefined) lateOrdersParams.page_size = params.page_size;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/account_health/get_late_orders',
          'GET',
          shop_id,
          token,
          undefined,
          lateOrdersParams
        );
        
        // Lưu vào database
        const lateOrdersResult = result as Record<string, unknown>;
        if (shopUuid && lateOrdersResult?.response) {
          const resp = lateOrdersResult.response as Record<string, unknown>;
          await saveLateOrders(supabase, shopUuid, resp.order_list as Record<string, unknown>[] || []);
        }
        break;
      }

      case 'get-shop-penalty': {
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/account_health/shop_penalty',
          'GET',
          shop_id,
          token
        );
        
        // Lưu vào database
        if (shopUuid && result && !(result as Record<string, unknown>).error) {
          await saveAccountHealthData(supabase, shopUuid, null, result as Record<string, unknown>);
        }
        break;
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

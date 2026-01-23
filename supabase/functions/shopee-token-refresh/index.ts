/**
 * Supabase Edge Function: Shopee Token Auto Refresh
 * Tự động refresh token cho tất cả shops sắp hết hạn
 * 
 * Chạy định kỳ qua pg_cron hoặc external cron service
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';
import { logActivity, type ActionCategory, type ActionStatus, type ActionSource } from '../_shared/activity-logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Config
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';

// Token sẽ được refresh nếu còn dưới X giờ
const REFRESH_THRESHOLD_HOURS = 3; // Refresh nếu còn dưới 3 giờ

interface ShopToken {
  id: string;
  shop_id: number;
  shop_name: string | null;
  access_token: string;
  refresh_token: string;
  expired_at: number; // timestamp milliseconds
  expire_in: number;
  partner_id: number;
  partner_key: string;
  merchant_id?: number;
}

/**
 * Helper function để gọi API qua proxy hoặc trực tiếp
 */
async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    return await fetch(proxyUrl, options);
  }
  return await fetch(targetUrl, options);
}

/**
 * Tạo signature cho Shopee API
 */
function createSignature(
  partnerId: number,
  partnerKey: string,
  path: string,
  timestamp: number
): string {
  const baseString = `${partnerId}${path}${timestamp}`;
  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

/**
 * Refresh access token từ Shopee API
 */
async function refreshAccessToken(
  partnerId: number,
  partnerKey: string,
  refreshToken: string,
  shopId: number,
  merchantId?: number
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = '/api/v2/auth/access_token/get';
    const sign = createSignature(partnerId, partnerKey, path, timestamp);

    const body: Record<string, unknown> = {
      refresh_token: refreshToken,
      partner_id: partnerId,
      shop_id: shopId,
    };

    if (merchantId) {
      body.merchant_id = merchantId;
    }

    const url = `${SHOPEE_BASE_URL}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

    const response = await fetchWithProxy(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (result.error) {
      return { success: false, error: result.message || result.error };
    }

    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Lấy danh sách shops cần refresh token
 */
async function getShopsNeedingRefresh(
  supabase: ReturnType<typeof createClient>
): Promise<ShopToken[]> {
  const now = Date.now();
  const thresholdMs = REFRESH_THRESHOLD_HOURS * 60 * 60 * 1000;
  const thresholdTime = now + thresholdMs;

  // Lấy shops có token sắp hết hạn (trong vòng REFRESH_THRESHOLD_HOURS giờ tới)
  // hoặc đã hết hạn nhưng vẫn còn refresh_token
  const { data, error } = await supabase
    .from('apishopee_shops')
    .select('id, shop_id, shop_name, access_token, refresh_token, expired_at, expire_in, partner_id, partner_key, merchant_id')
    .not('refresh_token', 'is', null)
    .not('partner_id', 'is', null)
    .not('partner_key', 'is', null)
    .or(`expired_at.lt.${thresholdTime},expired_at.is.null`);

  if (error) {
    console.error('[TOKEN-REFRESH] Error fetching shops:', error);
    return [];
  }

  console.log(`[TOKEN-REFRESH] Found ${data?.length || 0} shops needing refresh`);
  return (data || []) as ShopToken[];
}

/**
 * Log kết quả refresh token
 */
async function logRefreshResult(
  supabase: ReturnType<typeof createClient>,
  shopId: string,
  shopeeShopId: number,
  shopName: string | null,
  success: boolean,
  errorMessage?: string,
  oldExpiredAt?: number,
  newExpiredAt?: number,
  source: 'auto' | 'manual' = 'auto'
) {
  try {
    // Log vào bảng cũ
    await supabase.from('apishopee_token_refresh_logs').insert({
      shop_id: shopId,
      shopee_shop_id: shopeeShopId,
      success,
      error_message: errorMessage,
      old_token_expired_at: oldExpiredAt,
      new_token_expired_at: newExpiredAt,
      refresh_source: source,
    });

    // Log vào system_activity_logs
    await logActivity(supabase, {
      shopId: shopeeShopId,
      shopName: shopName || undefined,
      actionType: 'token_refresh',
      actionCategory: 'auth' as ActionCategory,
      actionDescription: success
        ? `Làm mới token thành công${newExpiredAt ? `, hết hạn lúc ${new Date(newExpiredAt * 1000).toLocaleString('vi-VN')}` : ''}`
        : `Làm mới token thất bại: ${errorMessage || 'Unknown error'}`,
      targetType: 'shop',
      targetId: shopeeShopId.toString(),
      targetName: shopName || `Shop ${shopeeShopId}`,
      requestData: {
        old_expired_at: oldExpiredAt,
      },
      responseData: success ? {
        new_expired_at: newExpiredAt,
      } : undefined,
      status: (success ? 'success' : 'failed') as ActionStatus,
      errorMessage: errorMessage,
      source: (source === 'auto' ? 'scheduled' : 'manual') as ActionSource,
    });
  } catch (error) {
    console.error('[TOKEN-REFRESH] Error logging result:', error);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Parse request body (optional - có thể chỉ định shop_id cụ thể)
    let specificShopId: number | undefined;
    try {
      const body = await req.json();
      specificShopId = body.shop_id ? Number(body.shop_id) : undefined;
    } catch {
      // No body or invalid JSON - process all shops
    }

    let shopsToRefresh: ShopToken[];

    if (specificShopId) {
      // Refresh specific shop
      const { data, error } = await supabase
        .from('apishopee_shops')
        .select('id, shop_id, shop_name, access_token, refresh_token, expired_at, expire_in, partner_id, partner_key, merchant_id')
        .eq('shop_id', specificShopId)
        .single();

      if (error || !data) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Shop not found',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      shopsToRefresh = [data as ShopToken];
    } else {
      // Get all shops needing refresh
      shopsToRefresh = await getShopsNeedingRefresh(supabase);
    }

    if (shopsToRefresh.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No shops need token refresh',
        processed: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{
      shop_id: number;
      shop_name: string | null;
      status: 'success' | 'failed' | 'skipped';
      error?: string;
      old_expiry?: string;
      new_expiry?: string;
    }> = [];

    for (const shop of shopsToRefresh) {
      try {
        // Skip if missing required fields
        if (!shop.refresh_token || !shop.partner_id || !shop.partner_key) {
          console.log(`[TOKEN-REFRESH] Skipping shop ${shop.shop_id} - missing credentials`);
          results.push({
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            status: 'skipped',
            error: 'Missing refresh_token or partner credentials',
          });
          continue;
        }

        console.log(`[TOKEN-REFRESH] Refreshing token for shop ${shop.shop_id} (${shop.shop_name})`);

        const refreshResult = await refreshAccessToken(
          shop.partner_id,
          shop.partner_key,
          shop.refresh_token,
          shop.shop_id,
          shop.merchant_id
        );

        if (!refreshResult.success || !refreshResult.data) {
          console.error(`[TOKEN-REFRESH] Failed for shop ${shop.shop_id}:`, refreshResult.error);

          await logRefreshResult(
            supabase,
            shop.id,
            shop.shop_id,
            shop.shop_name,
            false,
            refreshResult.error,
            shop.expired_at
          );

          results.push({
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            status: 'failed',
            error: refreshResult.error,
          });
          continue;
        }

        const newToken = refreshResult.data;
        const now = Date.now();
        const newExpiredAt = now + (newToken.expire_in as number) * 1000;

        // Update token in database
        const { error: updateError } = await supabase
          .from('apishopee_shops')
          .update({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            expire_in: newToken.expire_in,
            expired_at: newExpiredAt,
            access_token_expired_at: newExpiredAt,
            token_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', shop.id);

        if (updateError) {
          console.error(`[TOKEN-REFRESH] Failed to update shop ${shop.shop_id}:`, updateError);

          await logRefreshResult(
            supabase,
            shop.id,
            shop.shop_id,
            shop.shop_name,
            false,
            `Database update failed: ${updateError.message}`,
            shop.expired_at
          );

          results.push({
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            status: 'failed',
            error: `Database update failed: ${updateError.message}`,
          });
          continue;
        }

        // Log success
        await logRefreshResult(
          supabase,
          shop.id,
          shop.shop_id,
          shop.shop_name,
          true,
          undefined,
          shop.expired_at,
          newExpiredAt
        );

        console.log(`[TOKEN-REFRESH] Success for shop ${shop.shop_id}, new expiry: ${new Date(newExpiredAt).toISOString()}`);

        results.push({
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          status: 'success',
          old_expiry: shop.expired_at ? new Date(shop.expired_at).toISOString() : undefined,
          new_expiry: new Date(newExpiredAt).toISOString(),
        });

        // Delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`[TOKEN-REFRESH] Error processing shop ${shop.shop_id}:`, error);

        await logRefreshResult(
          supabase,
          shop.id,
          shop.shop_id,
          shop.shop_name,
          false,
          (error as Error).message,
          shop.expired_at
        );

        results.push({
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          status: 'failed',
          error: (error as Error).message,
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${results.length} shops: ${successCount} success, ${failedCount} failed, ${skippedCount} skipped`,
      processed: results.length,
      success_count: successCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[TOKEN-REFRESH] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

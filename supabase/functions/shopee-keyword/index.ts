/**
 * Supabase Edge Function: Shopee Keyword
 * Quản lý Keyword API - Tra cứu, theo dõi từ khóa
 * 
 * Actions:
 * - get-recommended-keyword-list: Lấy từ khóa đề xuất cho sản phẩm
 * - get-keyword-history: Lấy lịch sử tra cứu
 * - delete-keyword-history: Xóa lịch sử
 * - add-tracking: Thêm từ khóa vào tracking
 * - remove-tracking: Xóa từ khóa khỏi tracking
 * - get-tracking-list: Lấy danh sách từ khóa đang theo dõi
 * - refresh-tracking-volume: Cập nhật volume cho từ khóa tracking
 * - get-volume-history: Lấy lịch sử volume của từ khóa
 * - sync-products: Đồng bộ sản phẩm vào cache
 * - get-cached-products: Lấy sản phẩm từ cache
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

interface KeywordData {
  keyword: string;
  search_volume?: number;
  quality_score?: number;
  suggested_bid?: number;
}

async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<PartnerCredentials> {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (data?.partner_id && data?.partner_key) {
    return { partnerId: data.partner_id, partnerKey: data.partner_key };
  }
  return { partnerId: DEFAULT_PARTNER_ID, partnerKey: DEFAULT_PARTNER_KEY };
}

async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
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
  await supabase.from('apishopee_shops').upsert({
    shop_id: shopId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expire_in: token.expire_in,
    expired_at: Date.now() + (token.expire_in as number) * 1000,
    token_updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_id' });
}

async function getToken(supabase: ReturnType<typeof createClient>, shopId: number) {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at')
    .eq('shop_id', shopId)
    .single();

  if (data?.access_token) return data;
  throw new Error('Token not found. Please authenticate first.');
}

async function callShopeeAPI(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  path: string,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  extraParams?: Record<string, string | number>
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
    console.log('[KEYWORD] Calling Shopee API:', path);

    const response = await fetchWithProxy(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return await response.json();
  };

  let result = await makeRequest(token.access_token);

  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[KEYWORD] Token expired, refreshing...');
    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);
    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

async function getShopUuid(supabase: ReturnType<typeof createClient>, shopId: number): Promise<string | null> {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('id')
    .eq('shop_id', shopId)
    .single();
  return data?.id || null;
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
    const shopUuid = await getShopUuid(supabase, shop_id);
    
    if (!shopUuid) {
      return new Response(JSON.stringify({ error: 'Shop not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let result;

    switch (action) {
      // ==================== KEYWORD SEARCH ====================
      case 'get-recommended-keyword-list': {
        if (!params.item_id) {
          return new Response(JSON.stringify({ error: 'item_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getToken(supabase, shop_id);

        const apiParams: Record<string, string | number> = {
          item_id: params.item_id,
        };
        if (params.input_keyword) {
          apiParams.input_keyword = params.input_keyword;
        }

        result = await callShopeeAPI(
          supabase,
          credentials,
          '/api/v2/ads/get_recommended_keyword_list',
          shop_id,
          token,
          apiParams
        );

        // Lưu lịch sử tra cứu
        if (params.save_history && result && !(result as Record<string, unknown>).error) {
          const keywords = (result as Record<string, unknown>).response?.suggested_keyword_list || [];
          await supabase.from('apishopee_keyword_history').insert({
            shop_id: shopUuid,
            item_id: params.item_id,
            item_name: params.item_name || null,
            input_keyword: params.input_keyword || null,
            keywords: keywords,
            keyword_count: Array.isArray(keywords) ? keywords.length : 0,
            searched_at: new Date().toISOString(),
          });
        }
        break;
      }

      // ==================== HISTORY ====================
      case 'get-keyword-history': {
        const { data: history } = await supabase
          .from('apishopee_keyword_history')
          .select('*')
          .eq('shop_id', shopUuid)
          .order('searched_at', { ascending: false })
          .limit(params.limit || 20);

        result = { response: history || [] };
        break;
      }

      case 'delete-keyword-history': {
        if (!params.history_id) {
          return new Response(JSON.stringify({ error: 'history_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        await supabase
          .from('apishopee_keyword_history')
          .delete()
          .eq('id', params.history_id);

        result = { response: { success: true } };
        break;
      }

      // ==================== TRACKING ====================
      case 'add-tracking': {
        // Thêm từ khóa vào tracking
        // Required: keyword
        // Optional: item_id, item_name, quality_score, suggested_bid, search_volume
        if (!params.keyword) {
          return new Response(JSON.stringify({ error: 'keyword is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const today = new Date().toISOString().split('T')[0];
        
        // Upsert tracking record - 1 keyword per shop (không phân biệt item_id)
        const { data: tracking, error: trackingError } = await supabase
          .from('apishopee_keyword_tracking')
          .upsert({
            shop_id: shopUuid,
            keyword: params.keyword,
            item_id: params.item_id || null,
            item_name: params.item_name || null,
            quality_score: params.quality_score || null,
            suggested_bid: params.suggested_bid || null,
            latest_volume: params.search_volume || null,
            latest_volume_date: params.search_volume ? today : null,
            is_active: true,
          }, { 
            onConflict: 'shop_id,keyword',
            ignoreDuplicates: false 
          })
          .select()
          .single();

        if (trackingError) throw trackingError;

        // Lưu volume history nếu có
        if (params.search_volume && tracking) {
          await supabase
            .from('apishopee_keyword_volume_history')
            .upsert({
              tracking_id: tracking.id,
              shop_id: shopUuid,
              keyword: params.keyword,
              volume_date: today,
              search_volume: params.search_volume,
              quality_score: params.quality_score || null,
              suggested_bid: params.suggested_bid || null,
            }, { onConflict: 'tracking_id,volume_date' });
        }

        result = { response: { success: true, tracking } };
        break;
      }

      case 'remove-tracking': {
        if (!params.tracking_id) {
          return new Response(JSON.stringify({ error: 'tracking_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Soft delete - chỉ set is_active = false
        await supabase
          .from('apishopee_keyword_tracking')
          .update({ is_active: false })
          .eq('id', params.tracking_id);

        result = { response: { success: true } };
        break;
      }

      case 'get-tracking-list': {
        // Lấy danh sách tracking
        const { data: trackingList } = await supabase
          .from('apishopee_keyword_tracking')
          .select('*')
          .eq('shop_id', shopUuid)
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (!trackingList || trackingList.length === 0) {
          result = { response: [] };
          break;
        }

        // Lấy TẤT CẢ lịch sử volume cho tất cả tracking (không giới hạn ngày)
        const trackingIds = trackingList.map(t => t.id);

        const { data: volumeHistory } = await supabase
          .from('apishopee_keyword_volume_history')
          .select('tracking_id, volume_date, search_volume')
          .in('tracking_id', trackingIds)
          .order('volume_date', { ascending: false });

        // Group volume history by tracking_id
        const volumeByTracking = new Map<string, Array<{ date: string; volume: number }>>();
        for (const v of (volumeHistory || [])) {
          const list = volumeByTracking.get(v.tracking_id) || [];
          list.push({ date: v.volume_date, volume: v.search_volume });
          volumeByTracking.set(v.tracking_id, list);
        }

        // Merge volume history vào tracking list
        const enrichedList = trackingList.map(t => ({
          ...t,
          volume_history: volumeByTracking.get(t.id) || [],
        }));

        result = { response: enrichedList };
        break;
      }

      case 'refresh-tracking-volume': {
        // Cập nhật volume cho tất cả từ khóa đang tracking
        // Gọi API Shopee để lấy volume mới nhất
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getToken(supabase, shop_id);

        // Lấy danh sách tracking có item_id
        const { data: trackingList } = await supabase
          .from('apishopee_keyword_tracking')
          .select('*')
          .eq('shop_id', shopUuid)
          .eq('is_active', true)
          .not('item_id', 'is', null);

        if (!trackingList || trackingList.length === 0) {
          result = { response: { updated: 0, message: 'No keywords to refresh' } };
          break;
        }

        const today = new Date().toISOString().split('T')[0];
        let updatedCount = 0;

        // Group by item_id để gọi API hiệu quả hơn
        const itemGroups = new Map<number, typeof trackingList>();
        for (const t of trackingList) {
          if (!t.item_id) continue;
          const group = itemGroups.get(t.item_id) || [];
          group.push(t);
          itemGroups.set(t.item_id, group);
        }

        for (const [itemId, keywords] of itemGroups) {
          try {
            const apiResult = await callShopeeAPI(
              supabase,
              credentials,
              '/api/v2/ads/get_recommended_keyword_list',
              shop_id,
              token,
              { item_id: itemId }
            ) as { response?: { suggested_keyword_list?: KeywordData[] } };

            const suggestedKeywords = apiResult?.response?.suggested_keyword_list || [];
            
            for (const tracking of keywords) {
              const found = suggestedKeywords.find(
                (k: KeywordData) => k.keyword.toLowerCase() === tracking.keyword.toLowerCase()
              );

              if (found) {
                // Update tracking record
                await supabase
                  .from('apishopee_keyword_tracking')
                  .update({
                    latest_volume: found.search_volume || 0,
                    latest_volume_date: today,
                    quality_score: found.quality_score,
                    suggested_bid: found.suggested_bid,
                  })
                  .eq('id', tracking.id);

                // Insert volume history
                await supabase
                  .from('apishopee_keyword_volume_history')
                  .upsert({
                    tracking_id: tracking.id,
                    shop_id: shopUuid,
                    keyword: tracking.keyword,
                    volume_date: today,
                    search_volume: found.search_volume || 0,
                    quality_score: found.quality_score,
                    suggested_bid: found.suggested_bid,
                  }, { onConflict: 'tracking_id,volume_date' });

                updatedCount++;
              }
            }
          } catch (e) {
            console.error(`[KEYWORD] Error refreshing item ${itemId}:`, e);
          }
        }

        result = { response: { updated: updatedCount, total: trackingList.length } };
        break;
      }

      case 'get-volume-history': {
        // Lấy lịch sử volume của một từ khóa
        // Required: tracking_id hoặc keyword
        // Optional: days (default 30)
        const days = params.days || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        let query = supabase
          .from('apishopee_keyword_volume_history')
          .select('*')
          .eq('shop_id', shopUuid)
          .gte('volume_date', startDate.toISOString().split('T')[0])
          .order('volume_date', { ascending: true });

        if (params.tracking_id) {
          query = query.eq('tracking_id', params.tracking_id);
        } else if (params.keyword) {
          query = query.eq('keyword', params.keyword);
        } else {
          return new Response(JSON.stringify({ error: 'tracking_id or keyword is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: history } = await query;
        result = { response: history || [] };
        break;
      }

      // ==================== PRODUCTS CACHE ====================
      case 'sync-products': {
        // Đồng bộ sản phẩm từ Shopee API vào cache
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getToken(supabase, shop_id);

        // Lấy danh sách item_id
        let allItemIds: number[] = [];
        let offset = 0;
        let hasNextPage = true;

        while (hasNextPage && offset < 500) {
          const listResult = await callShopeeAPI(
            supabase,
            credentials,
            '/api/v2/product/get_item_list',
            shop_id,
            token,
            { 
              offset, 
              page_size: 100, 
              item_status: 'NORMAL' 
            }
          ) as { response?: { item?: { item_id: number }[]; has_next_page?: boolean; next_offset?: number } };

          const items = listResult?.response?.item || [];
          allItemIds = [...allItemIds, ...items.map((i: { item_id: number }) => i.item_id)];
          hasNextPage = listResult?.response?.has_next_page || false;
          offset = listResult?.response?.next_offset || offset + 100;
        }

        if (allItemIds.length === 0) {
          result = { response: { synced: 0 } };
          break;
        }

        // Lấy thông tin chi tiết và lưu vào cache
        let syncedCount = 0;
        for (let i = 0; i < allItemIds.length; i += 50) {
          const batchIds = allItemIds.slice(i, i + 50);
          
          const infoResult = await callShopeeAPI(
            supabase,
            credentials,
            '/api/v2/product/get_item_base_info',
            shop_id,
            token,
            { item_id_list: batchIds.join(',') }
          ) as { response?: { item_list?: Array<{
            item_id: number;
            item_name: string;
            item_sku?: string;
            item_status?: string;
            category_id?: number;
            price_info?: Array<{ current_price?: number }>;
            stock_info_v2?: { summary_info?: { total_available_stock?: number } };
            image?: { image_url_list?: string[] };
          }> } };

          const itemList = infoResult?.response?.item_list || [];
          
          for (const item of itemList) {
            await supabase
              .from('apishopee_products')
              .upsert({
                shop_id: shopUuid,
                item_id: item.item_id,
                item_name: item.item_name,
                item_sku: item.item_sku || null,
                item_status: item.item_status || 'NORMAL',
                category_id: item.category_id || null,
                price: item.price_info?.[0]?.current_price || null,
                stock: item.stock_info_v2?.summary_info?.total_available_stock || 0,
                image_url: item.image?.image_url_list?.[0] || null,
                images: item.image?.image_url_list || [],
                synced_at: new Date().toISOString(),
              }, { onConflict: 'shop_id,item_id' });
            
            syncedCount++;
          }
        }

        result = { response: { synced: syncedCount, total: allItemIds.length } };
        break;
      }

      case 'get-cached-products': {
        // Lấy sản phẩm từ cache
        const { data: products } = await supabase
          .from('apishopee_products')
          .select('*')
          .eq('shop_id', shopUuid)
          .eq('item_status', params.status || 'NORMAL')
          .order('item_name', { ascending: true })
          .limit(params.limit || 500);

        result = { response: products || [] };
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
    console.error('[KEYWORD] Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

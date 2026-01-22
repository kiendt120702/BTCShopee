/**
 * Supabase Edge Function: Lazada Orders
 * Sync và quản lý đơn hàng từ Lazada Open Platform API
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supabase config
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Lazada API endpoints by region
const LAZADA_API_URLS: Record<string, string> = {
  VN: 'https://api.lazada.vn/rest',
  TH: 'https://api.lazada.co.th/rest',
  MY: 'https://api.lazada.com.my/rest',
  SG: 'https://api.lazada.sg/rest',
  PH: 'https://api.lazada.com.ph/rest',
  ID: 'https://api.lazada.co.id/rest',
};

/**
 * Tạo signature cho Lazada API
 */
function createSignature(
  appSecret: string,
  apiPath: string,
  params: Record<string, string>
): string {
  const sortedKeys = Object.keys(params).sort();
  let signString = apiPath;
  for (const key of sortedKeys) {
    signString += key + params[key];
  }
  const hmac = createHmac('sha256', appSecret);
  hmac.update(signString);
  return hmac.digest('hex').toUpperCase();
}

/**
 * Gọi Lazada API
 */
async function callLazadaAPI(
  apiPath: string,
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  extraParams: Record<string, string> = {}
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const timestamp = Date.now().toString();

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    ...extraParams,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);
  params.sign = sign;

  const queryString = new URLSearchParams(params).toString();
  const url = `${apiBaseUrl}${apiPath}?${queryString}`;

  console.log('[LAZADA-ORDERS] Calling API:', apiPath);

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  return await response.json();
}

/**
 * Lấy danh sách đơn hàng từ Lazada
 */
async function getOrders(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  params: {
    created_after?: string;
    created_before?: string;
    update_after?: string;
    update_before?: string;
    status?: string;
    offset?: number;
    limit?: number;
    sort_by?: string;
    sort_direction?: string;
  }
) {
  const apiParams: Record<string, string> = {};

  if (params.created_after) apiParams.created_after = params.created_after;
  if (params.created_before) apiParams.created_before = params.created_before;
  if (params.update_after) apiParams.update_after = params.update_after;
  if (params.update_before) apiParams.update_before = params.update_before;
  if (params.status) apiParams.status = params.status;
  if (params.offset !== undefined) apiParams.offset = params.offset.toString();
  if (params.limit !== undefined) apiParams.limit = params.limit.toString();
  if (params.sort_by) apiParams.sort_by = params.sort_by;
  if (params.sort_direction) apiParams.sort_direction = params.sort_direction;

  return await callLazadaAPI('/orders/get', shop, apiParams);
}

/**
 * Lấy chi tiết một đơn hàng
 */
async function getOrder(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  orderId: string
) {
  return await callLazadaAPI('/order/get', shop, { order_id: orderId });
}

/**
 * Lấy items của một đơn hàng
 */
async function getOrderItems(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  orderId: string
) {
  return await callLazadaAPI('/order/items/get', shop, { order_id: orderId });
}

/**
 * Sync orders to database
 */
async function syncOrders(
  supabase: ReturnType<typeof createClient>,
  shop: {
    seller_id: number;
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  options: {
    days?: number;
    status?: string;
  } = {}
) {
  const results = {
    total: 0,
    synced: 0,
    errors: [] as string[],
  };

  // Calculate date range (default: last 7 days)
  const days = options.days || 7;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Format dates for Lazada API (ISO 8601)
  const createdAfter = startDate.toISOString();
  const createdBefore = endDate.toISOString();

  console.log('[LAZADA-ORDERS] Syncing orders from', createdAfter, 'to', createdBefore);

  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await getOrders(shop, {
        created_after: createdAfter,
        created_before: createdBefore,
        status: options.status,
        offset,
        limit,
        sort_by: 'created_at',
        sort_direction: 'DESC',
      });

      if (response.code !== '0') {
        results.errors.push(`API Error: ${response.code} - ${response.message}`);
        break;
      }

      const orders = response.data?.orders || [];
      results.total += orders.length;

      if (orders.length === 0) {
        hasMore = false;
        break;
      }

      // Process each order
      for (const order of orders) {
        try {
          // Get order items
          const itemsResponse = await getOrderItems(shop, order.order_id.toString());
          const items = itemsResponse.data || [];

          // Upsert order to database
          const orderData = {
            seller_id: shop.seller_id,
            order_id: order.order_id,
            order_number: order.order_number,
            status: order.statuses?.[0] || order.status,
            statuses: order.statuses,
            price: order.price,
            payment_method: order.payment_method,
            paid_price: order.paid_price,
            shipping_fee: order.shipping_fee,
            shipping_fee_discount_platform: order.shipping_fee_discount_platform,
            shipping_fee_discount_seller: order.shipping_fee_discount_seller,
            voucher_platform: order.voucher_platform,
            voucher_seller: order.voucher_seller,
            voucher_code: order.voucher_code,
            customer_first_name: order.customer_first_name,
            customer_last_name: order.customer_last_name,
            address_shipping: order.address_shipping,
            address_billing: order.address_billing,
            created_at_lazada: order.created_at,
            updated_at_lazada: order.updated_at,
            promised_shipping_times: order.promised_shipping_times,
            items: items,
            items_count: items.length,
            shipment_provider: order.shipment_provider,
            tracking_code: order.tracking_code,
            delivery_info: order.delivery_info,
            gift_option: order.gift_option,
            gift_message: order.gift_message,
            remarks: order.remarks,
            raw_response: order,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          const { error: orderError } = await supabase
            .from('apilazada_orders')
            .upsert(orderData, { onConflict: 'seller_id,order_id' });

          if (orderError) {
            console.error('[LAZADA-ORDERS] Error saving order:', orderError);
            results.errors.push(`Order ${order.order_id}: ${orderError.message}`);
          } else {
            results.synced++;
          }

          // Save order items
          for (const item of items) {
            const itemData = {
              seller_id: shop.seller_id,
              order_id: order.order_id,
              order_item_id: item.order_item_id,
              shop_id: item.shop_id,
              shop_sku: item.shop_sku,
              sku_id: item.sku_id,
              name: item.name,
              variation: item.variation,
              item_price: item.item_price,
              paid_price: item.paid_price,
              tax_amount: item.tax_amount,
              shipping_fee_discount_platform: item.shipping_fee_discount_platform,
              shipping_fee_discount_seller: item.shipping_fee_discount_seller,
              voucher_platform: item.voucher_platform,
              voucher_seller: item.voucher_seller,
              status: item.status,
              shipment_provider: item.shipment_provider,
              tracking_code: item.tracking_code,
              tracking_code_pre: item.tracking_code_pre,
              shipped_at: item.shipped_time,
              created_at_lazada: item.created_at,
              updated_at_lazada: item.updated_at,
              reason: item.reason,
              reason_detail: item.reason_detail,
              cancel_return_initiator: item.cancel_return_initiator,
              product_main_image: item.product_main_image,
              product_detail_url: item.product_detail_url,
              is_digital: item.is_digital === '1',
              is_fbl: item.is_fbl === '1',
              warehouse_code: item.warehouse_code,
              raw_response: item,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            await supabase
              .from('apilazada_order_items')
              .upsert(itemData, { onConflict: 'seller_id,order_item_id' });
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (orderError) {
          console.error('[LAZADA-ORDERS] Error processing order:', orderError);
          results.errors.push(`Order ${order.order_id}: ${(orderError as Error).message}`);
        }
      }

      // Check if there are more orders
      if (orders.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    } catch (error) {
      console.error('[LAZADA-ORDERS] Error fetching orders:', error);
      results.errors.push(`Fetch error: ${(error as Error).message}`);
      break;
    }
  }

  // Update sync status
  await supabase.from('apilazada_sync_status').upsert({
    seller_id: shop.seller_id,
    orders_synced_at: new Date().toISOString(),
    orders_is_syncing: false,
    orders_total_synced: results.synced,
    orders_last_error: results.errors.length > 0 ? results.errors.join('; ') : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'seller_id' });

  return results;
}

// Main handler
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action;
    const sellerId = body.seller_id;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get shop credentials
    const { data: shop, error: shopError } = await supabase
      .from('apilazada_shops')
      .select('*')
      .eq('seller_id', sellerId)
      .single();

    if (shopError || !shop) {
      return new Response(JSON.stringify({
        error: 'Shop not found',
        success: false
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!shop.access_token) {
      return new Response(JSON.stringify({
        error: 'Shop not authenticated',
        success: false
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const shopCredentials = {
      seller_id: shop.seller_id,
      app_key: shop.app_key || Deno.env.get('LAZADA_APP_KEY') || '',
      app_secret: shop.app_secret || Deno.env.get('LAZADA_APP_SECRET') || '',
      access_token: shop.access_token,
      region: shop.region || 'VN',
    };

    switch (action) {
      case 'get-orders': {
        const response = await getOrders(shopCredentials, {
          created_after: body.created_after,
          created_before: body.created_before,
          update_after: body.update_after,
          update_before: body.update_before,
          status: body.status,
          offset: body.offset,
          limit: body.limit || 50,
        });

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-order': {
        const response = await getOrder(shopCredentials, body.order_id);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-order-items': {
        const response = await getOrderItems(shopCredentials, body.order_id);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'sync': {
        // Mark as syncing
        await supabase.from('apilazada_sync_status').upsert({
          seller_id: shop.seller_id,
          orders_is_syncing: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'seller_id' });

        const results = await syncOrders(supabase, shopCredentials, {
          days: body.days || 7,
          status: body.status,
        });

        return new Response(JSON.stringify({
          success: true,
          ...results,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({
          error: 'Invalid action',
          success: false
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('[LAZADA-ORDERS] Error:', error);
    return new Response(JSON.stringify({
      error: (error as Error).message,
      success: false
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

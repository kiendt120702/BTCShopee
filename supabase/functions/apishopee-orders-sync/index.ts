/**
 * Supabase Edge Function: Shopee Orders Sync
 * Đồng bộ đơn hàng từ Shopee API
 *
 * Logic nghiệp vụ:
 * A. Month Sync: Lấy đơn hàng theo tháng cụ thể (chunked để tránh timeout)
 * B. Periodic Sync: Kiểm tra đơn hàng mới hoặc có cập nhật (7 ngày gần nhất)
 * C. Quick Sync: Lấy nhanh đơn hàng 7 ngày gần nhất (cho initial load)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Config
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Constants
const PAGE_SIZE = 100; // Max per Shopee API
const CHUNK_SIZE_DAYS = 7; // Mỗi chunk chỉ xử lý 7 ngày để tránh timeout
const CHUNK_SIZE_SECONDS = CHUNK_SIZE_DAYS * 24 * 60 * 60;
const PERIODIC_DAYS = 7; // Kiểm tra 7 ngày gần nhất cho periodic sync
const MAX_ORDERS_PER_CHUNK = 200; // Giới hạn số đơn hàng mỗi chunk

// Full optional fields for get_order_detail
const FULL_OPTIONAL_FIELDS = [
  'buyer_user_id', 'buyer_username', 'estimated_shipping_fee',
  'recipient_address', 'actual_shipping_fee', 'goods_to_declare',
  'note', 'note_update_time', 'item_list', 'pay_time',
  'dropshipper', 'dropshipper_phone', 'split_up',
  'buyer_cancel_reason', 'cancel_by', 'cancel_reason',
  'actual_shipping_fee_confirmed', 'buyer_cpf_id',
  'fulfillment_flag', 'pickup_done_time', 'package_list',
  'shipping_carrier', 'payment_method', 'total_amount',
  'invoice_data', 'order_chargeable_weight_gram',
  'return_request_due_date', 'edt', 'payment_info'
].join(',');

// ==================== INTERFACES ====================

interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

interface OrderListItem {
  order_sn: string;
  order_status?: string;
}

interface ShopeeOrder {
  order_sn: string;
  booking_sn?: string;
  order_status: string;
  pending_terms?: string[];
  pending_description?: string[];
  currency: string;
  cod: boolean;
  total_amount: number;
  estimated_shipping_fee?: number;
  actual_shipping_fee?: number;
  actual_shipping_fee_confirmed?: boolean;
  reverse_shipping_fee?: number;
  order_chargeable_weight_gram?: number;
  create_time: number;
  update_time: number;
  pay_time?: number;
  ship_by_date?: number;
  pickup_done_time?: number;
  buyer_user_id?: number;
  buyer_username?: string;
  buyer_cpf_id?: string;
  region: string;
  recipient_address?: Record<string, unknown>;
  shipping_carrier?: string;
  checkout_shipping_carrier?: string;
  days_to_ship?: number;
  fulfillment_flag?: string;
  goods_to_declare?: boolean;
  split_up?: boolean;
  payment_method?: string;
  payment_info?: unknown[];
  item_list?: unknown[];
  package_list?: unknown[];
  cancel_by?: string;
  cancel_reason?: string;
  buyer_cancel_reason?: string;
  message_to_seller?: string;
  note?: string;
  note_update_time?: number;
  invoice_data?: Record<string, unknown>;
  dropshipper?: string;
  dropshipper_phone?: string;
  return_request_due_date?: number;
  edt_from?: number;
  edt_to?: number;
  advance_package?: boolean;
  is_buyer_shop_collection?: boolean;
  buyer_proof_of_collection?: string[];
  hot_listing_order?: boolean;
  prescription_images?: string[];
  prescription_check_status?: number;
  pharmacist_name?: string;
  prescription_approval_time?: number;
  prescription_rejection_time?: number;
}

interface SyncStatus {
  shop_id: number;
  is_syncing: boolean;
  is_initial_sync_done: boolean;
  last_sync_at: string | null;
  last_sync_update_time: number | null;
  total_synced: number;
  new_orders?: number;
  updated_orders?: number;
  // Chunked sync state
  current_sync_month?: string; // "2026-01" format
  current_chunk_end?: number; // timestamp
  synced_months?: string[]; // List of completed months
}

interface ChunkSyncResult {
  success: boolean;
  synced_count: number;
  has_more: boolean;
  next_chunk_end?: number;
  month_completed?: boolean;
  error?: string;
}

// ==================== HELPER FUNCTIONS ====================

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
  await supabase.from('apishopee_shops').upsert(
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
}

async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  const { data, error } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at')
    .eq('shop_id', shopId)
    .single();

  if (!error && data?.access_token) {
    return data;
  }
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
    console.log('[ORDERS-SYNC] Calling:', path);

    const response = await fetchWithProxy(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    return await response.json();
  };

  let result = await makeRequest(token.access_token);

  // Auto-retry khi token hết hạn
  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[ORDERS-SYNC] Token expired, refreshing...');
    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);

    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

// ==================== SYNC STATUS FUNCTIONS ====================

async function getSyncStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<SyncStatus | null> {
  const { data } = await supabase
    .from('apishopee_orders_sync_status')
    .select('*')
    .eq('shop_id', shopId)
    .single();

  return data;
}

async function updateSyncStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  updates: Partial<SyncStatus> & { last_error?: string | null }
) {
  await supabase
    .from('apishopee_orders_sync_status')
    .upsert(
      {
        shop_id: shopId,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' }
    );
}

// ==================== ORDERS SYNC FUNCTIONS ====================

interface OrderListResponse {
  error?: string;
  message?: string;
  response?: {
    order_list?: OrderListItem[];
    more?: boolean;
    next_cursor?: string;
  };
}

interface OrderDetailResponse {
  error?: string;
  message?: string;
  response?: {
    order_list?: ShopeeOrder[];
  };
}

/**
 * Fetch order list from Shopee API
 */
async function fetchOrderList(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  timeFrom: number,
  timeTo: number,
  cursor: string = ''
): Promise<{ orders: OrderListItem[]; more: boolean; nextCursor: string }> {
  const params: Record<string, string | number> = {
    time_range_field: 'update_time',
    time_from: timeFrom,
    time_to: timeTo,
    page_size: PAGE_SIZE,
    response_optional_fields: 'order_status',
    request_order_status_pending: 'true',
  };
  if (cursor) params.cursor = cursor;

  const result = await callShopeeAPI(
    supabase, credentials, '/api/v2/order/get_order_list', shopId, token, params
  ) as OrderListResponse;

  if (result.error) {
    console.error('[ORDERS-SYNC] get_order_list error:', result.message);
    throw new Error(result.message || result.error);
  }

  return {
    orders: result.response?.order_list || [],
    more: result.response?.more || false,
    nextCursor: result.response?.next_cursor || '',
  };
}

/**
 * Fetch order details from Shopee API
 */
async function fetchOrderDetails(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  orderSns: string[]
): Promise<ShopeeOrder[]> {
  if (orderSns.length === 0) return [];

  const params: Record<string, string | number> = {
    order_sn_list: orderSns.join(','),
    response_optional_fields: FULL_OPTIONAL_FIELDS,
    request_order_status_pending: 'true',
  };

  const result = await callShopeeAPI(
    supabase, credentials, '/api/v2/order/get_order_detail', shopId, token, params
  ) as OrderDetailResponse;

  if (result.error) {
    console.error('[ORDERS-SYNC] get_order_detail error:', result.message);
    throw new Error(result.message || result.error);
  }

  return result.response?.order_list || [];
}

/**
 * Upsert orders vào database
 */
async function upsertOrders(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  orders: ShopeeOrder[]
): Promise<{ inserted: number; updated: number }> {
  if (orders.length === 0) return { inserted: 0, updated: 0 };

  // Check existing orders
  const orderSns = orders.map(o => o.order_sn);
  const { data: existingOrders } = await supabase
    .from('apishopee_orders')
    .select('order_sn, update_time')
    .eq('shop_id', shopId)
    .in('order_sn', orderSns);

  const existingMap = new Map(
    existingOrders?.map(o => [o.order_sn, o.update_time]) || []
  );

  // Prepare records
  const records = orders.map(o => ({
    shop_id: shopId,
    order_sn: o.order_sn,
    booking_sn: o.booking_sn,
    order_status: o.order_status,
    pending_terms: o.pending_terms || [],
    pending_description: o.pending_description || [],
    currency: o.currency,
    cod: o.cod,
    total_amount: o.total_amount,
    estimated_shipping_fee: o.estimated_shipping_fee,
    actual_shipping_fee: o.actual_shipping_fee,
    actual_shipping_fee_confirmed: o.actual_shipping_fee_confirmed,
    reverse_shipping_fee: o.reverse_shipping_fee,
    order_chargeable_weight_gram: o.order_chargeable_weight_gram,
    create_time: o.create_time,
    update_time: o.update_time,
    pay_time: o.pay_time,
    ship_by_date: o.ship_by_date,
    pickup_done_time: o.pickup_done_time,
    buyer_user_id: o.buyer_user_id,
    buyer_username: o.buyer_username,
    buyer_cpf_id: o.buyer_cpf_id,
    region: o.region,
    recipient_address: o.recipient_address,
    shipping_carrier: o.shipping_carrier,
    checkout_shipping_carrier: o.checkout_shipping_carrier,
    days_to_ship: o.days_to_ship,
    fulfillment_flag: o.fulfillment_flag,
    goods_to_declare: o.goods_to_declare,
    split_up: o.split_up,
    payment_method: o.payment_method,
    payment_info: o.payment_info || [],
    item_list: o.item_list || [],
    package_list: o.package_list || [],
    cancel_by: o.cancel_by,
    cancel_reason: o.cancel_reason,
    buyer_cancel_reason: o.buyer_cancel_reason,
    message_to_seller: o.message_to_seller,
    note: o.note,
    note_update_time: o.note_update_time,
    invoice_data: o.invoice_data,
    dropshipper: o.dropshipper,
    dropshipper_phone: o.dropshipper_phone,
    return_request_due_date: o.return_request_due_date,
    edt_from: o.edt_from,
    edt_to: o.edt_to,
    advance_package: o.advance_package,
    is_buyer_shop_collection: o.is_buyer_shop_collection,
    buyer_proof_of_collection: o.buyer_proof_of_collection || [],
    hot_listing_order: o.hot_listing_order,
    prescription_images: o.prescription_images || [],
    prescription_check_status: o.prescription_check_status,
    pharmacist_name: o.pharmacist_name,
    prescription_approval_time: o.prescription_approval_time,
    prescription_rejection_time: o.prescription_rejection_time,
    raw_response: o,
    synced_at: new Date().toISOString(),
  }));

  // Upsert in batches of 100 to avoid payload size limits
  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('apishopee_orders')
      .upsert(batch, { onConflict: 'shop_id,order_sn' });

    if (error) {
      console.error('[ORDERS-SYNC] Upsert error:', error);
      throw error;
    }
  }

  // Count new vs updated
  let inserted = 0;
  let updated = 0;
  orders.forEach(o => {
    if (existingMap.has(o.order_sn)) {
      updated++;
    } else {
      inserted++;
    }
  });

  return { inserted, updated };
}

/**
 * Get month boundaries (start/end timestamps)
 */
function getMonthBoundaries(monthStr: string): { start: number; end: number } {
  const [year, month] = monthStr.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // Last day of month

  return {
    start: Math.floor(startDate.getTime() / 1000),
    end: Math.floor(endDate.getTime() / 1000),
  };
}

/**
 * Get current month string
 */
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Sync orders for a specific chunk within a month
 * Returns quickly (< 30s) to avoid timeout
 */
async function syncMonthChunk(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  monthStr: string,
  chunkEnd?: number
): Promise<ChunkSyncResult> {
  console.log(`[ORDERS-SYNC] Syncing month ${monthStr} for shop ${shopId}`);

  const { start: monthStart, end: monthEnd } = getMonthBoundaries(monthStr);

  // Determine chunk boundaries
  // If no chunkEnd provided, start from end of month and work backwards
  const currentChunkEnd = chunkEnd || monthEnd;
  const currentChunkStart = Math.max(currentChunkEnd - CHUNK_SIZE_SECONDS, monthStart);

  console.log(`[ORDERS-SYNC] Chunk: ${new Date(currentChunkStart * 1000).toISOString()} -> ${new Date(currentChunkEnd * 1000).toISOString()}`);

  try {
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      current_sync_month: monthStr,
      current_chunk_end: currentChunkEnd,
      last_error: null,
    });

    // Fetch orders in this chunk (with pagination)
    let cursor = '';
    let more = true;
    const allOrders: ShopeeOrder[] = [];
    let pageCount = 0;

    while (more && allOrders.length < MAX_ORDERS_PER_CHUNK) {
      pageCount++;
      const { orders: orderList, more: hasMore, nextCursor } = await fetchOrderList(
        supabase, credentials, shopId, token, currentChunkStart, currentChunkEnd, cursor
      );

      console.log(`[ORDERS-SYNC] Page ${pageCount}: ${orderList.length} orders`);

      if (orderList.length === 0) break;

      // Fetch order details in batches of 50
      for (let i = 0; i < orderList.length && allOrders.length < MAX_ORDERS_PER_CHUNK; i += 50) {
        const batch = orderList.slice(i, Math.min(i + 50, orderList.length));
        const sns = batch.map(o => o.order_sn);
        const details = await fetchOrderDetails(supabase, credentials, shopId, token, sns);
        allOrders.push(...details);

        // Rate limiting
        if (i + 50 < orderList.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      cursor = nextCursor;
      more = hasMore && allOrders.length < MAX_ORDERS_PER_CHUNK;

      if (more) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Upsert to database
    let inserted = 0;
    let updated = 0;
    if (allOrders.length > 0) {
      const result = await upsertOrders(supabase, shopId, allOrders);
      inserted = result.inserted;
      updated = result.updated;
    }

    console.log(`[ORDERS-SYNC] Chunk completed: ${inserted} new, ${updated} updated`);

    // Check if we need to continue to next chunk
    const nextChunkEnd = currentChunkStart;
    const hasMoreChunks = nextChunkEnd > monthStart;
    const monthCompleted = !hasMoreChunks;

    // Update sync status
    const syncStatus = await getSyncStatus(supabase, shopId);
    const syncedMonths = syncStatus?.synced_months || [];

    if (monthCompleted && !syncedMonths.includes(monthStr)) {
      syncedMonths.push(monthStr);
    }

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      is_initial_sync_done: true, // Mark as done after first successful sync
      last_sync_at: new Date().toISOString(),
      total_synced: (syncStatus?.total_synced || 0) + inserted + updated,
      current_sync_month: monthCompleted ? null : monthStr,
      current_chunk_end: monthCompleted ? null : nextChunkEnd,
      synced_months: syncedMonths,
      last_error: null,
    });

    return {
      success: true,
      synced_count: inserted + updated,
      has_more: hasMoreChunks,
      next_chunk_end: hasMoreChunks ? nextChunkEnd : undefined,
      month_completed: monthCompleted,
    };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[ORDERS-SYNC] Chunk sync failed:', errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_error: errorMessage,
    });

    return {
      success: false,
      synced_count: 0,
      has_more: false,
      error: errorMessage,
    };
  }
}

/**
 * Quick sync - lấy nhanh 7 ngày gần nhất
 * Dùng cho initial load hoặc periodic sync
 */
async function quickSync(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string }
): Promise<{ success: boolean; synced_count: number; error?: string }> {
  console.log(`[ORDERS-SYNC] Quick sync for shop ${shopId}`);

  const now = Math.floor(Date.now() / 1000);
  const timeFrom = now - (PERIODIC_DAYS * 24 * 60 * 60);

  try {
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_error: null,
    });

    // Fetch orders
    let cursor = '';
    let more = true;
    const allOrders: ShopeeOrder[] = [];

    while (more) {
      const { orders: orderList, more: hasMore, nextCursor } = await fetchOrderList(
        supabase, credentials, shopId, token, timeFrom, now, cursor
      );

      if (orderList.length === 0) break;

      // Fetch order details in batches of 50
      for (let i = 0; i < orderList.length; i += 50) {
        const batch = orderList.slice(i, i + 50);
        const sns = batch.map(o => o.order_sn);
        const details = await fetchOrderDetails(supabase, credentials, shopId, token, sns);
        allOrders.push(...details);

        if (i + 50 < orderList.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      cursor = nextCursor;
      more = hasMore;

      if (more) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Upsert to database
    let syncedCount = 0;
    if (allOrders.length > 0) {
      const { inserted, updated } = await upsertOrders(supabase, shopId, allOrders);
      syncedCount = inserted + updated;
    }

    // Find latest update_time
    const latestUpdateTime = allOrders.length > 0
      ? Math.max(...allOrders.map(o => o.update_time))
      : now;

    // Update sync status
    const syncStatus = await getSyncStatus(supabase, shopId);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      is_initial_sync_done: true,
      last_sync_at: new Date().toISOString(),
      last_sync_update_time: latestUpdateTime,
      total_synced: (syncStatus?.total_synced || 0) + syncedCount,
      last_error: null,
    });

    console.log(`[ORDERS-SYNC] Quick sync completed: ${syncedCount} orders`);

    return { success: true, synced_count: syncedCount };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[ORDERS-SYNC] Quick sync failed:', errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_error: errorMessage,
    });

    return { success: false, synced_count: 0, error: errorMessage };
  }
}

/**
 * Periodic sync - kiểm tra đơn hàng mới/cập nhật
 */
async function periodicSync(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  lastSyncUpdateTime: number
): Promise<{ success: boolean; new_orders: number; updated_orders: number; error?: string }> {
  console.log('[ORDERS-SYNC] Starting Periodic Sync for shop:', shopId);

  const now = Math.floor(Date.now() / 1000);
  // Lấy từ last_sync_update_time - 1 giờ (buffer để không bỏ sót)
  const timeFrom = Math.max(lastSyncUpdateTime - 3600, now - (PERIODIC_DAYS * 24 * 60 * 60));

  let cursor = '';
  let more = true;
  let newOrders = 0;
  let updatedOrders = 0;
  let latestUpdateTime = lastSyncUpdateTime;

  try {
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_error: null,
    });

    while (more) {
      const { orders: orderList, more: hasMore, nextCursor } = await fetchOrderList(
        supabase, credentials, shopId, token, timeFrom, now, cursor
      );

      console.log(`[ORDERS-SYNC] Fetched ${orderList.length} orders`);

      if (orderList.length === 0) break;

      // Fetch order details in batches of 50
      const allDetails: ShopeeOrder[] = [];
      for (let i = 0; i < orderList.length; i += 50) {
        const batch = orderList.slice(i, i + 50);
        const sns = batch.map(o => o.order_sn);
        const details = await fetchOrderDetails(supabase, credentials, shopId, token, sns);
        allDetails.push(...details);

        if (i + 50 < orderList.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Upsert to database
      if (allDetails.length > 0) {
        const { inserted, updated } = await upsertOrders(supabase, shopId, allDetails);
        newOrders += inserted;
        updatedOrders += updated;

        // Track latest update_time
        const maxUpdateTime = Math.max(...allDetails.map(o => o.update_time));
        if (maxUpdateTime > latestUpdateTime) {
          latestUpdateTime = maxUpdateTime;
        }
      }

      cursor = nextCursor;
      more = hasMore;

      if (more) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Complete
    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_at: new Date().toISOString(),
      last_sync_update_time: latestUpdateTime,
      new_orders: newOrders,
      updated_orders: updatedOrders,
      last_error: null,
    });

    console.log(`[ORDERS-SYNC] Periodic Sync completed. New: ${newOrders}, Updated: ${updatedOrders}`);
    return { success: true, new_orders: newOrders, updated_orders: updatedOrders };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[ORDERS-SYNC] Periodic Sync failed:', errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_error: errorMessage,
    });

    return { success: false, new_orders: newOrders, updated_orders: updatedOrders, error: errorMessage };
  }
}

/**
 * Get list of available months to sync (last 12 months)
 */
function getAvailableMonths(): string[] {
  const months: string[] = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months.push(monthStr);
  }

  return months;
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result;

    switch (action) {
      case 'sync': {
        // Main sync action - auto-detect mode
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        const syncStatus = await getSyncStatus(supabase, shop_id);

        // Check if already syncing
        if (syncStatus?.is_syncing) {
          result = {
            success: false,
            error: 'Sync is already in progress',
          };
          break;
        }

        // If not initial sync done, do quick sync first
        if (!syncStatus?.is_initial_sync_done) {
          const quickResult = await quickSync(supabase, credentials, shop_id, token);
          result = {
            success: quickResult.success,
            mode: 'quick',
            synced_count: quickResult.synced_count,
            error: quickResult.error,
          };
        } else {
          // Do periodic sync
          const lastSyncUpdateTime = syncStatus?.last_sync_update_time || Math.floor(Date.now() / 1000);
          const periodicResult = await periodicSync(supabase, credentials, shop_id, token, lastSyncUpdateTime);
          result = {
            success: periodicResult.success,
            mode: 'periodic',
            new_orders: periodicResult.new_orders,
            updated_orders: periodicResult.updated_orders,
            error: periodicResult.error,
          };
        }
        break;
      }

      case 'sync-month': {
        // Sync a specific month (chunked)
        const { month, chunk_end } = body;

        if (!month) {
          result = { success: false, error: 'month is required (format: YYYY-MM)' };
          break;
        }

        // Validate month format
        if (!/^\d{4}-\d{2}$/.test(month)) {
          result = { success: false, error: 'Invalid month format. Use YYYY-MM' };
          break;
        }

        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        const syncStatus = await getSyncStatus(supabase, shop_id);

        // Check if already syncing
        if (syncStatus?.is_syncing) {
          result = {
            success: false,
            error: 'Sync is already in progress',
          };
          break;
        }

        result = await syncMonthChunk(supabase, credentials, shop_id, token, month, chunk_end);
        break;
      }

      case 'continue-month-sync': {
        // Continue syncing current month (for chunked sync)
        const syncStatus = await getSyncStatus(supabase, shop_id);

        if (!syncStatus?.current_sync_month) {
          result = { success: false, error: 'No month sync in progress' };
          break;
        }

        if (syncStatus.is_syncing) {
          result = { success: false, error: 'Sync is already in progress' };
          break;
        }

        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);

        result = await syncMonthChunk(
          supabase, credentials, shop_id, token,
          syncStatus.current_sync_month,
          syncStatus.current_chunk_end || undefined
        );
        break;
      }

      case 'status': {
        const status = await getSyncStatus(supabase, shop_id);
        const availableMonths = getAvailableMonths();
        result = {
          success: true,
          status,
          available_months: availableMonths,
        };
        break;
      }

      case 'get-orders': {
        // Get orders from database with filters
        const { status: orderStatus, limit = 100, offset = 0, search } = body;

        let query = supabase
          .from('apishopee_orders')
          .select('*')
          .eq('shop_id', shop_id)
          .order('create_time', { ascending: false })
          .range(offset, offset + limit - 1);

        if (orderStatus && orderStatus !== 'ALL') {
          query = query.eq('order_status', orderStatus);
        }

        if (search) {
          query = query.or(`order_sn.ilike.%${search}%,buyer_username.ilike.%${search}%`);
        }

        const { data, error, count } = await query;

        if (error) throw error;
        result = { success: true, orders: data, count };
        break;
      }

      case 'get-stats': {
        // Get order statistics
        const { data: orders } = await supabase
          .from('apishopee_orders')
          .select('order_status, total_amount')
          .eq('shop_id', shop_id);

        if (!orders || orders.length === 0) {
          result = {
            success: true,
            stats: {
              total: 0,
              total_revenue: 0,
              status_counts: {},
            },
          };
        } else {
          const total = orders.length;
          const totalRevenue = orders
            .filter(o => o.order_status === 'COMPLETED')
            .reduce((acc, o) => acc + (o.total_amount || 0), 0);
          const statusCounts: Record<string, number> = {};
          orders.forEach(o => {
            statusCounts[o.order_status] = (statusCounts[o.order_status] || 0) + 1;
          });

          result = {
            success: true,
            stats: {
              total,
              total_revenue: totalRevenue,
              status_counts: statusCounts,
            },
          };
        }
        break;
      }

      default:
        return new Response(JSON.stringify({
          error: 'Invalid action. Use: sync, sync-month, continue-month-sync, status, get-orders, get-stats'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ORDERS-SYNC] Error:', error);
    return new Response(JSON.stringify({
      error: (error as Error).message,
      success: false,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

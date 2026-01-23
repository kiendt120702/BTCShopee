/**
 * Supabase Edge Function: Shopee Orders Sync
 * Đồng bộ đơn hàng từ Shopee API - "Nguồn sự thật"
 *
 * Logic nghiệp vụ:
 * A. Month Sync: Lấy đơn hàng theo tháng cụ thể (chunked 15 ngày để tránh timeout)
 * B. Date Range Sync: Lấy đơn hàng theo khoảng thời gian (start_date -> end_date)
 * C. Periodic Sync: Kiểm tra đơn hàng có cập nhật (dùng update_time)
 * D. Quick Sync: Lấy nhanh đơn hàng 7 ngày gần nhất (cho initial load)
 *
 * QUAN TRỌNG - Time Logic:
 * - Month/Date Range Sync: Dùng time_range_field = "create_time" (lấy đơn theo ngày tạo)
 * - Periodic Sync: Dùng time_range_field = "update_time" (bắt thay đổi trạng thái)
 * - Tự động cắt khoảng thời gian thành các chunk 15 ngày (giới hạn cứng của Shopee)
 * - Pagination với cursor khi response.more == true
 *
 * Finance Sync (Dòng tiền - "Tiền thực nhận"):
 * - Endpoint: /api/v2/payment/get_escrow_detail
 * - Sync escrow cho TẤT CẢ đơn hàng (kể cả ước tính)
 * - Dữ liệu quan trọng hơn doanh số ảo (GMV)
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
const CHUNK_SIZE_DAYS = 7; // Giảm từ 15 xuống 7 ngày để tránh timeout
const CHUNK_SIZE_SECONDS = CHUNK_SIZE_DAYS * 24 * 60 * 60;
const PERIODIC_DAYS = 7; // Kiểm tra 7 ngày gần nhất cho periodic sync
const MAX_ORDERS_PER_CHUNK = 500; // Giới hạn tối đa đơn hàng mỗi chunk để tránh timeout
const MAX_EXECUTION_TIME_MS = 45000; // 45 giây - dừng sớm trước khi timeout (60s)

// Time range field - BẮT BUỘC dùng create_time theo yêu cầu Shopee
const TIME_RANGE_FIELD = 'create_time'; // KHÔNG dùng update_time

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

// Escrow interfaces
interface EscrowItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_id: number;
  model_name?: string;
  model_sku?: string;
  original_price: number;
  selling_price: number;
  discounted_price: number;
  seller_discount: number;
  shopee_discount: number;
  discount_from_coin: number;
  discount_from_voucher_shopee: number;
  discount_from_voucher_seller: number;
  quantity_purchased: number;
  activity_type?: string;
  activity_id?: number;
  is_main_item?: boolean;
  is_b2c_shop_item?: boolean;
  ams_commission_fee?: number;
  promotion_list?: { promotion_type: string; promotion_id: number }[];
}

interface OrderAdjustment {
  amount: number;
  date: number;
  currency: string;
  adjustment_reason?: string;
}

interface OrderIncome {
  escrow_amount: number;
  escrow_amount_after_adjustment?: number;
  buyer_total_amount: number;
  original_price?: number;
  order_original_price?: number;
  order_discounted_price?: number;
  order_selling_price?: number;
  order_seller_discount?: number;
  seller_discount?: number;
  shopee_discount?: number;
  original_shopee_discount?: number;
  voucher_from_seller?: number;
  voucher_from_shopee?: number;
  coins?: number;
  buyer_paid_shipping_fee?: number;
  buyer_transaction_fee?: number;
  estimated_shipping_fee?: number;
  final_shipping_fee?: number;
  actual_shipping_fee?: number;
  shopee_shipping_rebate?: number;
  shipping_fee_discount_from_3pl?: number;
  seller_shipping_discount?: number;
  reverse_shipping_fee?: number;
  shipping_fee_sst?: number;
  reverse_shipping_fee_sst?: number;
  commission_fee?: number;
  service_fee?: number;
  seller_transaction_fee?: number;
  campaign_fee?: number;
  order_ams_commission_fee?: number;
  credit_card_promotion?: number;
  credit_card_transaction_fee?: number;
  payment_promotion?: number;
  net_commission_fee?: number;
  net_service_fee?: number;
  seller_order_processing_fee?: number;
  fbs_fee?: number;
  escrow_tax?: number;
  final_product_vat_tax?: number;
  final_shipping_vat_tax?: number;
  final_escrow_product_gst?: number;
  final_escrow_shipping_gst?: number;
  withholding_tax?: number;
  withholding_vat_tax?: number;
  withholding_pit_tax?: number;
  cross_border_tax?: number;
  sales_tax_on_lvg?: number;
  vat_on_imported_goods?: number;
  seller_lost_compensation?: number;
  seller_coin_cash_back?: number;
  seller_return_refund?: number;
  drc_adjustable_refund?: number;
  cost_of_goods_sold?: number;
  original_cost_of_goods_sold?: number;
  final_product_protection?: number;
  rsf_seller_protection_fee_claim_amount?: number;
  shipping_seller_protection_fee_amount?: number;
  delivery_seller_protection_fee_premium_amount?: number;
  overseas_return_service_fee?: number;
  total_adjustment_amount?: number;
  order_adjustment?: OrderAdjustment[];
  buyer_payment_method?: string;
  instalment_plan?: string;
  seller_voucher_code?: string[];
  items?: EscrowItem[];
}

interface BuyerPaymentInfo {
  buyer_payment_method?: string;
  buyer_total_amount?: number;
  merchant_subtotal?: number;
  shipping_fee?: number;
  seller_voucher?: number;
  shopee_voucher?: number;
  shopee_coins_redeemed?: number;
  credit_card_promotion?: number;
  insurance_premium?: number;
  buyer_service_fee?: number;
  buyer_tax_amount?: number;
  is_paid_by_credit_card?: boolean;
}

interface EscrowData {
  order_sn: string;
  buyer_user_name?: string;
  return_order_sn_list?: string[];
  order_income: OrderIncome;
  buyer_payment_info?: BuyerPaymentInfo;
}

interface EscrowDetailResponse {
  error?: string;
  message?: string;
  response?: EscrowData;
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
  cursor: string = '',
  timeRangeField: string = TIME_RANGE_FIELD // Mặc định dùng create_time
): Promise<{ orders: OrderListItem[]; more: boolean; nextCursor: string }> {
  const params: Record<string, string | number> = {
    time_range_field: timeRangeField, // BẮT BUỘC dùng create_time
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
 * Fetch escrow detail for a single order from Shopee API
 */
async function fetchEscrowDetail(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  orderSn: string
): Promise<EscrowData | null> {
  try {
    const result = await callShopeeAPI(
      supabase, credentials, '/api/v2/payment/get_escrow_detail', shopId, token,
      { order_sn: orderSn }
    ) as EscrowDetailResponse;

    if (result.error) {
      console.log(`[ORDERS-SYNC] get_escrow_detail error for ${orderSn}:`, result.message);
      return null;
    }

    return result.response || null;
  } catch (err) {
    console.log(`[ORDERS-SYNC] get_escrow_detail failed for ${orderSn}:`, (err as Error).message);
    return null;
  }
}

/**
 * Upsert escrow data vào database
 */
async function upsertEscrowData(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  escrowDataList: EscrowData[]
): Promise<number> {
  if (escrowDataList.length === 0) return 0;

  const records = escrowDataList.map(e => {
    const income = e.order_income;
    const buyerInfo = e.buyer_payment_info;

    return {
      shop_id: shopId,
      order_sn: e.order_sn,
      buyer_user_name: e.buyer_user_name,
      return_order_sn_list: e.return_order_sn_list || [],

      // Order Income fields
      escrow_amount: income.escrow_amount,
      escrow_amount_after_adjustment: income.escrow_amount_after_adjustment,
      buyer_total_amount: income.buyer_total_amount,
      original_price: income.original_price,
      order_original_price: income.order_original_price,
      order_discounted_price: income.order_discounted_price,
      order_selling_price: income.order_selling_price,
      order_seller_discount: income.order_seller_discount,
      seller_discount: income.seller_discount,
      shopee_discount: income.shopee_discount,
      original_shopee_discount: income.original_shopee_discount,
      voucher_from_seller: income.voucher_from_seller,
      voucher_from_shopee: income.voucher_from_shopee,
      coins: income.coins,

      // Shipping fees
      buyer_paid_shipping_fee: income.buyer_paid_shipping_fee,
      buyer_transaction_fee: income.buyer_transaction_fee,
      estimated_shipping_fee: income.estimated_shipping_fee,
      final_shipping_fee: income.final_shipping_fee,
      actual_shipping_fee: income.actual_shipping_fee,
      shopee_shipping_rebate: income.shopee_shipping_rebate,
      shipping_fee_discount_from_3pl: income.shipping_fee_discount_from_3pl,
      seller_shipping_discount: income.seller_shipping_discount,
      reverse_shipping_fee: income.reverse_shipping_fee,
      shipping_fee_sst: income.shipping_fee_sst,
      reverse_shipping_fee_sst: income.reverse_shipping_fee_sst,

      // Service fees & commissions
      commission_fee: income.commission_fee,
      service_fee: income.service_fee,
      seller_transaction_fee: income.seller_transaction_fee,
      campaign_fee: income.campaign_fee,
      order_ams_commission_fee: income.order_ams_commission_fee,
      credit_card_promotion: income.credit_card_promotion,
      credit_card_transaction_fee: income.credit_card_transaction_fee,
      payment_promotion: income.payment_promotion,
      net_commission_fee: income.net_commission_fee,
      net_service_fee: income.net_service_fee,
      seller_order_processing_fee: income.seller_order_processing_fee,
      fbs_fee: income.fbs_fee,

      // Taxes
      escrow_tax: income.escrow_tax,
      final_product_vat_tax: income.final_product_vat_tax,
      final_shipping_vat_tax: income.final_shipping_vat_tax,
      final_escrow_product_gst: income.final_escrow_product_gst,
      final_escrow_shipping_gst: income.final_escrow_shipping_gst,
      withholding_tax: income.withholding_tax,
      withholding_vat_tax: income.withholding_vat_tax,
      withholding_pit_tax: income.withholding_pit_tax,
      cross_border_tax: income.cross_border_tax,
      sales_tax_on_lvg: income.sales_tax_on_lvg,
      vat_on_imported_goods: income.vat_on_imported_goods,

      // Compensation & refunds
      seller_lost_compensation: income.seller_lost_compensation,
      seller_coin_cash_back: income.seller_coin_cash_back,
      seller_return_refund: income.seller_return_refund,
      drc_adjustable_refund: income.drc_adjustable_refund,
      cost_of_goods_sold: income.cost_of_goods_sold,
      original_cost_of_goods_sold: income.original_cost_of_goods_sold,
      final_product_protection: income.final_product_protection,

      // Insurance & additional fees
      rsf_seller_protection_fee_claim_amount: income.rsf_seller_protection_fee_claim_amount,
      shipping_seller_protection_fee_amount: income.shipping_seller_protection_fee_amount,
      delivery_seller_protection_fee_premium_amount: income.delivery_seller_protection_fee_premium_amount,
      overseas_return_service_fee: income.overseas_return_service_fee,

      // Adjustments
      total_adjustment_amount: income.total_adjustment_amount,
      order_adjustment: income.order_adjustment || [],

      // Payment info from order_income
      buyer_payment_method: income.buyer_payment_method,
      instalment_plan: income.instalment_plan,
      seller_voucher_code: income.seller_voucher_code || [],

      // Items
      items: income.items || [],

      // Buyer payment info
      buyer_payment_info_method: buyerInfo?.buyer_payment_method,
      buyer_payment_info_total_amount: buyerInfo?.buyer_total_amount,
      merchant_subtotal: buyerInfo?.merchant_subtotal,
      buyer_shipping_fee: buyerInfo?.shipping_fee,
      buyer_seller_voucher: buyerInfo?.seller_voucher,
      buyer_shopee_voucher: buyerInfo?.shopee_voucher,
      shopee_coins_redeemed: buyerInfo?.shopee_coins_redeemed,
      buyer_credit_card_promotion: buyerInfo?.credit_card_promotion,
      insurance_premium: buyerInfo?.insurance_premium,
      buyer_service_fee: buyerInfo?.buyer_service_fee,
      buyer_tax_amount: buyerInfo?.buyer_tax_amount,
      is_paid_by_credit_card: buyerInfo?.is_paid_by_credit_card || false,

      // Raw response for debugging
      raw_response: e,

      synced_at: new Date().toISOString(),
    };
  });

  // Upsert in batches of 50
  const BATCH_SIZE = 50;
  let totalUpserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('apishopee_order_escrow')
      .upsert(batch, { onConflict: 'shop_id,order_sn' });

    if (error) {
      console.error('[ORDERS-SYNC] Escrow upsert error:', error);
    } else {
      totalUpserted += batch.length;
    }
  }

  return totalUpserted;
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

  // Check existing orders (including current status for escrow flag logic)
  const orderSns = orders.map(o => o.order_sn);
  const { data: existingOrders } = await supabase
    .from('apishopee_orders')
    .select('order_sn, update_time, order_status')
    .eq('shop_id', shopId)
    .in('order_sn', orderSns);

  const existingMap = new Map(
    existingOrders?.map(o => [o.order_sn, { update_time: o.update_time, order_status: o.order_status }]) || []
  );

  // Prepare records with is_escrow_fetched flag logic:
  // - New orders: is_escrow_fetched = false
  // - Status changed to COMPLETED: is_escrow_fetched = false (reset to re-fetch)
  // - Other updates: keep existing is_escrow_fetched value (don't include in record)
  const records = orders.map(o => {
    const existing = existingMap.get(o.order_sn) as { update_time: number; order_status: string } | undefined;
    const isNewOrder = !existing;
    const statusChangedToCompleted = existing && existing.order_status !== 'COMPLETED' && o.order_status === 'COMPLETED';

    // Only set is_escrow_fetched = false for new orders or when status changes to COMPLETED
    const shouldResetEscrowFlag = isNewOrder || statusChangedToCompleted;

    const record: Record<string, unknown> = {
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
    };

    // Only set is_escrow_fetched when needed (new order or status changed to COMPLETED)
    if (shouldResetEscrowFlag) {
      record.is_escrow_fetched = false;
    }

    return record;
  });

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
 * Returns quickly (< 45s) to avoid timeout
 * CHỈ fetch đơn hàng MỚI hoặc có thay đổi (so sánh update_time)
 */
async function syncMonthChunk(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  monthStr: string,
  chunkEnd?: number
): Promise<ChunkSyncResult> {
  const startTime = Date.now();
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

    // Fetch orders in this chunk using pagination
    let cursor = '';
    let more = true;
    const allOrders: ShopeeOrder[] = [];
    let pageCount = 0;
    let stoppedEarly = false;
    let skippedCount = 0; // Đơn đã có trong DB và không thay đổi

    // Pagination loop - với giới hạn số đơn và thời gian
    while (more) {
      // Kiểm tra timeout - dừng sớm nếu gần đến giới hạn
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME_MS) {
        console.log(`[ORDERS-SYNC] Approaching timeout (${elapsed}ms), stopping early with ${allOrders.length} orders`);
        stoppedEarly = true;
        break;
      }

      // Kiểm tra số đơn đã lấy
      if (allOrders.length >= MAX_ORDERS_PER_CHUNK) {
        console.log(`[ORDERS-SYNC] Reached max orders limit (${MAX_ORDERS_PER_CHUNK}), stopping early`);
        stoppedEarly = true;
        break;
      }

      pageCount++;
      const { orders: orderList, more: hasMore, nextCursor } = await fetchOrderList(
        supabase, credentials, shopId, token, currentChunkStart, currentChunkEnd, cursor,
        TIME_RANGE_FIELD // BẮT BUỘC dùng create_time
      );

      console.log(`[ORDERS-SYNC] Page ${pageCount}: ${orderList.length} orders (cursor: ${cursor ? 'yes' : 'start'})`);

      if (orderList.length === 0) break;

      // LẤY DANH SÁCH ĐƠN ĐÃ CÓ TRONG DB để so sánh
      const orderSns = orderList.map(o => o.order_sn);
      const { data: existingOrders } = await supabase
        .from('apishopee_orders')
        .select('order_sn, update_time, order_status')
        .eq('shop_id', shopId)
        .in('order_sn', orderSns);

      const existingMap = new Map(
        existingOrders?.map(o => [o.order_sn, { update_time: o.update_time, order_status: o.order_status }]) || []
      );

      // LỌC CHỈ LẤY ĐƠN MỚI HOẶC CÓ THAY ĐỔI STATUS
      // So sánh order_status từ API với DB (order_status từ get_order_list)
      const ordersToFetch = orderList.filter(o => {
        const existing = existingMap.get(o.order_sn);
        if (!existing) return true; // Đơn mới
        // Đơn có status thay đổi
        if (o.order_status && existing.order_status !== o.order_status) return true;
        return false;
      });

      skippedCount += orderList.length - ordersToFetch.length;

      console.log(`[ORDERS-SYNC] Page ${pageCount}: ${ordersToFetch.length} need fetch, ${orderList.length - ordersToFetch.length} skipped (unchanged)`);

      // Fetch order details CHỈ CHO ĐƠN CẦN CẬP NHẬT
      if (ordersToFetch.length > 0) {
        for (let i = 0; i < ordersToFetch.length; i += 50) {
          // Kiểm tra timeout trước mỗi batch
          const batchElapsed = Date.now() - startTime;
          if (batchElapsed > MAX_EXECUTION_TIME_MS) {
            console.log(`[ORDERS-SYNC] Approaching timeout during detail fetch (${batchElapsed}ms)`);
            stoppedEarly = true;
            break;
          }

          const batch = ordersToFetch.slice(i, Math.min(i + 50, ordersToFetch.length));
          const sns = batch.map(o => o.order_sn);
          const details = await fetchOrderDetails(supabase, credentials, shopId, token, sns);
          allOrders.push(...details);

          // Rate limiting between detail batches
          if (i + 50 < ordersToFetch.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }

      if (stoppedEarly) break;

      // Lấy next_cursor để gọi trang tiếp theo
      cursor = nextCursor;
      more = hasMore; // Tiếp tục nếu response.more == true

      // Rate limiting between pages
      if (more) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    console.log(`[ORDERS-SYNC] Month chunk total: ${allOrders.length} orders fetched, ${skippedCount} skipped (stopped_early: ${stoppedEarly})`);

    // Upsert to database
    let inserted = 0;
    let updated = 0;
    if (allOrders.length > 0) {
      const result = await upsertOrders(supabase, shopId, allOrders);
      inserted = result.inserted;
      updated = result.updated;
      // NOTE: Escrow sync is handled by separate Finance Sync job (runs every hour)
      // Orders with status COMPLETED will have is_escrow_fetched = false
    }

    console.log(`[ORDERS-SYNC] Chunk completed: ${inserted} new, ${updated} updated, ${skippedCount} skipped`);

    // Check if we need to continue to next chunk
    // Nếu stopped early, vẫn cần tiếp tục chunk này
    const nextChunkEnd = stoppedEarly ? currentChunkEnd : currentChunkStart;
    const hasMoreChunks = stoppedEarly || nextChunkEnd > monthStart;
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

    const executionTime = Date.now() - startTime;
    console.log(`[ORDERS-SYNC] Execution time: ${executionTime}ms`);

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
        supabase, credentials, shopId, token, timeFrom, now, cursor,
        'update_time' // Quick sync dùng update_time để bắt cả đơn mới và thay đổi trạng thái
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
      // NOTE: Escrow sync is handled by separate Finance Sync job (runs every hour)
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
        supabase, credentials, shopId, token, timeFrom, now, cursor,
        'update_time' // Periodic sync dùng update_time để bắt thay đổi trạng thái
      );

      console.log(`[ORDERS-SYNC] Fetched ${orderList.length} orders (by update_time)`);

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
        // NOTE: Escrow sync is handled by separate Finance Sync job (runs every hour)

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

/**
 * Parse date string (DD/MM/YYYY or YYYY-MM-DD) to Unix timestamp
 */
function parseDateToTimestamp(dateStr: string, isEndOfDay: boolean = false): number {
  let date: Date;

  // Handle DD/MM/YYYY format
  if (dateStr.includes('/')) {
    const [day, month, year] = dateStr.split('/').map(Number);
    date = new Date(Date.UTC(year, month - 1, day, isEndOfDay ? 23 : 0, isEndOfDay ? 59 : 0, isEndOfDay ? 59 : 0));
  }
  // Handle YYYY-MM-DD format
  else if (dateStr.includes('-')) {
    const [year, month, day] = dateStr.split('-').map(Number);
    date = new Date(Date.UTC(year, month - 1, day, isEndOfDay ? 23 : 0, isEndOfDay ? 59 : 0, isEndOfDay ? 59 : 0));
  }
  else {
    throw new Error('Invalid date format. Use DD/MM/YYYY or YYYY-MM-DD');
  }

  return Math.floor(date.getTime() / 1000);
}

/**
 * Generate chunks from a date range
 * Sử dụng CHUNK_SIZE_DAYS (mặc định 7 ngày) để tránh timeout
 */
function generateDateRangeChunks(startTimestamp: number, endTimestamp: number): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = [];
  let currentStart = startTimestamp;

  while (currentStart < endTimestamp) {
    const currentEnd = Math.min(currentStart + CHUNK_SIZE_SECONDS, endTimestamp);
    chunks.push({ start: currentStart, end: currentEnd });
    currentStart = currentEnd + 1; // Bắt đầu chunk tiếp theo sau 1 giây
  }

  return chunks;
}

interface DateRangeSyncResult {
  success: boolean;
  total_orders_synced: number;
  chunks_processed: number;
  total_chunks: number;
  has_more: boolean;
  current_chunk_index?: number;
  error?: string;
}

/**
 * Sync orders for a specific date range with automatic 7-day chunking
 * Input: start_date và end_date (DD/MM/YYYY hoặc YYYY-MM-DD)
 */
async function syncDateRange(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  startDate: string,
  endDate: string,
  chunkIndex: number = 0
): Promise<DateRangeSyncResult> {
  const startTime = Date.now();
  console.log(`[ORDERS-SYNC] Syncing date range: ${startDate} -> ${endDate} for shop ${shopId}`);

  try {
    const startTimestamp = parseDateToTimestamp(startDate, false);
    const endTimestamp = parseDateToTimestamp(endDate, true);

    // Validate date range
    if (startTimestamp >= endTimestamp) {
      return { success: false, total_orders_synced: 0, chunks_processed: 0, total_chunks: 0, has_more: false, error: 'start_date must be before end_date' };
    }

    // Generate chunks (7 ngày mỗi chunk)
    const chunks = generateDateRangeChunks(startTimestamp, endTimestamp);
    console.log(`[ORDERS-SYNC] Generated ${chunks.length} chunks (${CHUNK_SIZE_DAYS}-day each)`);

    // Process current chunk
    if (chunkIndex >= chunks.length) {
      return { success: true, total_orders_synced: 0, chunks_processed: chunks.length, total_chunks: chunks.length, has_more: false };
    }

    const currentChunk = chunks[chunkIndex];
    console.log(`[ORDERS-SYNC] Processing chunk ${chunkIndex + 1}/${chunks.length}: ${new Date(currentChunk.start * 1000).toISOString()} -> ${new Date(currentChunk.end * 1000).toISOString()}`);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_error: null,
    });

    // Fetch orders in this chunk using pagination
    let cursor = '';
    let more = true;
    const allOrders: ShopeeOrder[] = [];
    let pageCount = 0;
    let stoppedEarly = false;
    let skippedCount = 0;

    // Pagination loop - với giới hạn số đơn và thời gian
    while (more) {
      // Kiểm tra timeout - dừng sớm nếu gần đến giới hạn
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME_MS) {
        console.log(`[ORDERS-SYNC] Approaching timeout (${elapsed}ms), stopping early with ${allOrders.length} orders`);
        stoppedEarly = true;
        break;
      }

      // Kiểm tra số đơn đã lấy
      if (allOrders.length >= MAX_ORDERS_PER_CHUNK) {
        console.log(`[ORDERS-SYNC] Reached max orders limit (${MAX_ORDERS_PER_CHUNK}), stopping early`);
        stoppedEarly = true;
        break;
      }

      pageCount++;
      const { orders: orderList, more: hasMore, nextCursor } = await fetchOrderList(
        supabase, credentials, shopId, token,
        currentChunk.start, currentChunk.end,
        cursor,
        TIME_RANGE_FIELD // BẮT BUỘC dùng create_time
      );

      console.log(`[ORDERS-SYNC] Page ${pageCount}: ${orderList.length} orders (cursor: ${cursor ? 'yes' : 'start'})`);

      if (orderList.length === 0) break;

      // LẤY DANH SÁCH ĐƠN ĐÃ CÓ TRONG DB để so sánh
      const orderSns = orderList.map(o => o.order_sn);
      const { data: existingOrders } = await supabase
        .from('apishopee_orders')
        .select('order_sn, update_time, order_status')
        .eq('shop_id', shopId)
        .in('order_sn', orderSns);

      const existingMap = new Map(
        existingOrders?.map(o => [o.order_sn, { update_time: o.update_time, order_status: o.order_status }]) || []
      );

      // LỌC CHỈ LẤY ĐƠN MỚI HOẶC CÓ THAY ĐỔI STATUS
      const ordersToFetch = orderList.filter(o => {
        const existing = existingMap.get(o.order_sn);
        if (!existing) return true; // Đơn mới
        if (o.order_status && existing.order_status !== o.order_status) return true;
        return false;
      });

      skippedCount += orderList.length - ordersToFetch.length;
      console.log(`[ORDERS-SYNC] Page ${pageCount}: ${ordersToFetch.length} need fetch, ${orderList.length - ordersToFetch.length} skipped`);

      // Fetch order details CHỈ CHO ĐƠN CẦN CẬP NHẬT
      if (ordersToFetch.length > 0) {
        for (let i = 0; i < ordersToFetch.length; i += 50) {
          // Kiểm tra timeout trước mỗi batch
          const batchElapsed = Date.now() - startTime;
          if (batchElapsed > MAX_EXECUTION_TIME_MS) {
            console.log(`[ORDERS-SYNC] Approaching timeout during detail fetch (${batchElapsed}ms)`);
            stoppedEarly = true;
            break;
          }

          const batch = ordersToFetch.slice(i, Math.min(i + 50, ordersToFetch.length));
          const sns = batch.map(o => o.order_sn);
          const details = await fetchOrderDetails(supabase, credentials, shopId, token, sns);
          allOrders.push(...details);

          // Rate limiting between detail batches
          if (i + 50 < ordersToFetch.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }

      if (stoppedEarly) break;

      // Lấy next_cursor để gọi trang tiếp theo
      cursor = nextCursor;
      more = hasMore; // Tiếp tục nếu response.more == true

      // Rate limiting between pages
      if (more) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    console.log(`[ORDERS-SYNC] Total fetched: ${allOrders.length} orders, ${skippedCount} skipped (stopped_early: ${stoppedEarly})`);

    // Upsert to database
    let totalSynced = 0;
    if (allOrders.length > 0) {
      const { inserted, updated } = await upsertOrders(supabase, shopId, allOrders);
      totalSynced = inserted + updated;
      console.log(`[ORDERS-SYNC] Chunk ${chunkIndex + 1}: ${inserted} new, ${updated} updated, ${skippedCount} skipped`);
      // NOTE: Escrow sync is handled by separate Finance Sync job (runs every hour)
    }

    // Update sync status
    // Nếu stopped early, vẫn cần tiếp tục chunk này (không tăng chunkIndex)
    const hasMoreChunks = stoppedEarly || (chunkIndex + 1 < chunks.length);
    const nextChunkIndex = stoppedEarly ? chunkIndex : chunkIndex + 1;

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      is_initial_sync_done: true,
      last_sync_at: new Date().toISOString(),
      last_error: null,
    });

    const executionTime = Date.now() - startTime;
    console.log(`[ORDERS-SYNC] Execution time: ${executionTime}ms`);

    return {
      success: true,
      total_orders_synced: totalSynced,
      chunks_processed: stoppedEarly ? chunkIndex : chunkIndex + 1,
      total_chunks: chunks.length,
      has_more: hasMoreChunks,
      current_chunk_index: nextChunkIndex,
    };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[ORDERS-SYNC] Date range sync failed:', errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_error: errorMessage,
    });

    return {
      success: false,
      total_orders_synced: 0,
      chunks_processed: 0,
      total_chunks: 0,
      has_more: false,
      error: errorMessage,
    };
  }
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

      case 'sync-date-range': {
        // Sync orders by date range with automatic 15-day chunking
        // Input: start_date và end_date (DD/MM/YYYY hoặc YYYY-MM-DD)
        // Ví dụ: { "start_date": "01/10/2025", "end_date": "31/10/2025" }
        const { start_date, end_date, chunk_index = 0 } = body;

        if (!start_date || !end_date) {
          result = {
            success: false,
            error: 'start_date and end_date are required (format: DD/MM/YYYY or YYYY-MM-DD)',
          };
          break;
        }

        const syncStatus = await getSyncStatus(supabase, shop_id);

        // Check if already syncing
        if (syncStatus?.is_syncing) {
          result = {
            success: false,
            error: 'Sync is already in progress',
          };
          break;
        }

        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);

        result = await syncDateRange(
          supabase, credentials, shop_id, token,
          start_date, end_date, chunk_index
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

      case 'sync-escrow': {
        // Sync escrow data for orders that don't have it yet
        // Optional params: order_sns (array of specific order_sn to sync), limit (default 50)
        const { order_sns, limit = 50, force = false } = body;

        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);

        let ordersToSync: { order_sn: string }[] = [];

        if (order_sns && Array.isArray(order_sns) && order_sns.length > 0) {
          // Sync specific orders
          ordersToSync = order_sns.map((sn: string) => ({ order_sn: sn }));
        } else {
          // Find orders without escrow data (only COMPLETED, SHIPPED, TO_CONFIRM_RECEIVE status)
          let query = supabase
            .from('apishopee_orders')
            .select('order_sn')
            .eq('shop_id', shop_id)
            .in('order_status', ['COMPLETED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'READY_TO_SHIP'])
            .order('update_time', { ascending: false })
            .limit(limit);

          if (!force) {
            // Only orders without escrow data
            const { data: existingEscrow } = await supabase
              .from('apishopee_order_escrow')
              .select('order_sn')
              .eq('shop_id', shop_id);

            const existingEscrowSns = new Set(existingEscrow?.map(e => e.order_sn) || []);

            const { data: allOrders } = await query;

            ordersToSync = (allOrders || []).filter(o => !existingEscrowSns.has(o.order_sn));
          } else {
            const { data } = await query;
            ordersToSync = data || [];
          }
        }

        console.log(`[ORDERS-SYNC] Syncing escrow for ${ordersToSync.length} orders`);

        const escrowDataList: EscrowData[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (const order of ordersToSync) {
          const escrowData = await fetchEscrowDetail(
            supabase, credentials, shop_id, token, order.order_sn
          );

          if (escrowData) {
            escrowDataList.push(escrowData);
            successCount++;
          } else {
            errorCount++;
          }

          // Rate limiting - 200ms between requests
          if (ordersToSync.indexOf(order) < ordersToSync.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }

        // Upsert escrow data
        let upsertedCount = 0;
        if (escrowDataList.length > 0) {
          upsertedCount = await upsertEscrowData(supabase, shop_id, escrowDataList);
        }

        result = {
          success: true,
          total_orders: ordersToSync.length,
          fetched: successCount,
          failed: errorCount,
          upserted: upsertedCount,
        };
        break;
      }

      case 'get-escrow': {
        // Get escrow data from database for a specific order
        const { order_sn } = body;

        if (!order_sn) {
          result = { success: false, error: 'order_sn is required' };
          break;
        }

        const { data, error } = await supabase
          .from('apishopee_order_escrow')
          .select('*')
          .eq('shop_id', shop_id)
          .eq('order_sn', order_sn)
          .single();

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        result = { success: true, escrow: data || null };
        break;
      }

      case 'sync-all-escrow': {
        // Batch sync escrow data for ALL orders in database
        // This action will sync escrow in batches to avoid timeout
        // Returns progress info so client can continue calling until done
        const { batch_size = 100, offset = 0, force = false } = body;

        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);

        // Get count of orders that need escrow sync
        let countQuery = supabase
          .from('apishopee_orders')
          .select('order_sn', { count: 'exact', head: true })
          .eq('shop_id', shop_id)
          .in('order_status', ['COMPLETED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'READY_TO_SHIP']);

        const { count: totalOrders } = await countQuery;

        // Get orders to sync (with or without existing escrow)
        let ordersQuery = supabase
          .from('apishopee_orders')
          .select('order_sn')
          .eq('shop_id', shop_id)
          .in('order_status', ['COMPLETED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'READY_TO_SHIP'])
          .order('update_time', { ascending: false })
          .range(offset, offset + batch_size - 1);

        const { data: ordersData } = await ordersQuery;
        const ordersFromDb = ordersData || [];

        let ordersToSync: { order_sn: string }[];

        if (!force) {
          // Filter out orders that already have escrow data
          const orderSns = ordersFromDb.map(o => o.order_sn);
          const { data: existingEscrow } = await supabase
            .from('apishopee_order_escrow')
            .select('order_sn')
            .eq('shop_id', shop_id)
            .in('order_sn', orderSns);

          const existingEscrowSns = new Set(existingEscrow?.map(e => e.order_sn) || []);
          ordersToSync = ordersFromDb.filter(o => !existingEscrowSns.has(o.order_sn));
        } else {
          ordersToSync = ordersFromDb;
        }

        console.log(`[ORDERS-SYNC] Batch sync escrow: offset=${offset}, batch_size=${batch_size}, orders_to_sync=${ordersToSync.length}`);

        const escrowDataList: EscrowData[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (const order of ordersToSync) {
          const escrowData = await fetchEscrowDetail(
            supabase, credentials, shop_id, token, order.order_sn
          );

          if (escrowData) {
            escrowDataList.push(escrowData);
            successCount++;
          } else {
            errorCount++;
          }

          // Rate limiting - 150ms between requests
          if (ordersToSync.indexOf(order) < ordersToSync.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        }

        // Upsert escrow data
        let upsertedCount = 0;
        if (escrowDataList.length > 0) {
          upsertedCount = await upsertEscrowData(supabase, shop_id, escrowDataList);
        }

        // Calculate progress
        const nextOffset = offset + batch_size;
        const hasMore = nextOffset < (totalOrders || 0);
        const progress = totalOrders ? Math.round((Math.min(nextOffset, totalOrders) / totalOrders) * 100) : 100;

        result = {
          success: true,
          total_orders: totalOrders || 0,
          processed_in_batch: ordersFromDb.length,
          synced: successCount,
          failed: errorCount,
          upserted: upsertedCount,
          offset: offset,
          next_offset: hasMore ? nextOffset : null,
          has_more: hasMore,
          progress: progress,
        };
        break;
      }

      case 'escrow-stats': {
        // Get stats about escrow data sync status
        const { count: totalOrders } = await supabase
          .from('apishopee_orders')
          .select('order_sn', { count: 'exact', head: true })
          .eq('shop_id', shop_id)
          .in('order_status', ['COMPLETED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'READY_TO_SHIP']);

        const { count: ordersWithEscrow } = await supabase
          .from('apishopee_order_escrow')
          .select('order_sn', { count: 'exact', head: true })
          .eq('shop_id', shop_id);

        const missingEscrow = (totalOrders || 0) - (ordersWithEscrow || 0);

        result = {
          success: true,
          total_eligible_orders: totalOrders || 0,
          orders_with_escrow: ordersWithEscrow || 0,
          missing_escrow: missingEscrow > 0 ? missingEscrow : 0,
          sync_percentage: totalOrders ? Math.round(((ordersWithEscrow || 0) / totalOrders) * 100) : 100,
        };
        break;
      }

      case 'sync-finance-month': {
        // MODULE DÒNG TIỀN (FINANCE SYNC) - "Tiền thực nhận"
        // Sync escrow data for ALL orders in a specific month (kể cả ước tính)
        // Đây là dữ liệu quan trọng hơn doanh số ảo (GMV)
        // Input: month (YYYY-MM), batch_size, offset
        const { month, batch_size = 100, offset = 0 } = body;

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

        // Get month boundaries
        const { start: monthStart, end: monthEnd } = getMonthBoundaries(month);

        // Get ALL orders in this month (không filter theo status)
        const { count: totalOrdersInMonth } = await supabase
          .from('apishopee_orders')
          .select('order_sn', { count: 'exact', head: true })
          .eq('shop_id', shop_id)
          .gte('create_time', monthStart)
          .lte('create_time', monthEnd);

        // Get orders to sync with pagination
        const { data: ordersData } = await supabase
          .from('apishopee_orders')
          .select('order_sn, order_status, create_time')
          .eq('shop_id', shop_id)
          .gte('create_time', monthStart)
          .lte('create_time', monthEnd)
          .order('create_time', { ascending: false })
          .range(offset, offset + batch_size - 1);

        const ordersFromDb = ordersData || [];

        // Check which orders already have escrow data
        const orderSns = ordersFromDb.map(o => o.order_sn);
        const { data: existingEscrow } = await supabase
          .from('apishopee_order_escrow')
          .select('order_sn')
          .eq('shop_id', shop_id)
          .in('order_sn', orderSns);

        const existingEscrowSns = new Set(existingEscrow?.map(e => e.order_sn) || []);
        const ordersToSync = ordersFromDb.filter(o => !existingEscrowSns.has(o.order_sn));

        console.log(`[FINANCE-SYNC] Month ${month}: offset=${offset}, batch_size=${batch_size}, orders_to_sync=${ordersToSync.length}/${ordersFromDb.length}`);

        const escrowDataList: EscrowData[] = [];
        let successCount = 0;
        let errorCount = 0;
        const errors: Array<{ order_sn: string; error: string }> = [];

        for (const order of ordersToSync) {
          const escrowData = await fetchEscrowDetail(
            supabase, credentials, shop_id, token, order.order_sn
          );

          if (escrowData) {
            escrowDataList.push(escrowData);
            successCount++;
          } else {
            // Vẫn ghi nhận lỗi nhưng tiếp tục sync (có thể là ước tính chưa sẵn sàng)
            errorCount++;
            errors.push({ order_sn: order.order_sn, error: 'Escrow data not available yet' });
          }

          // Rate limiting - 150ms between requests
          if (ordersToSync.indexOf(order) < ordersToSync.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        }

        // Upsert escrow data
        let upsertedCount = 0;
        if (escrowDataList.length > 0) {
          upsertedCount = await upsertEscrowData(supabase, shop_id, escrowDataList);
        }

        // Calculate progress
        const nextOffset = offset + batch_size;
        const hasMore = nextOffset < (totalOrdersInMonth || 0);
        const progress = totalOrdersInMonth ? Math.round((Math.min(nextOffset, totalOrdersInMonth) / totalOrdersInMonth) * 100) : 100;

        // Get total escrow synced for this month
        const { count: monthEscrowCount } = await supabase
          .from('apishopee_order_escrow')
          .select('order_sn', { count: 'exact', head: true })
          .eq('shop_id', shop_id)
          .in('order_sn', (await supabase
            .from('apishopee_orders')
            .select('order_sn')
            .eq('shop_id', shop_id)
            .gte('create_time', monthStart)
            .lte('create_time', monthEnd)
          ).data?.map(o => o.order_sn) || []);

        result = {
          success: true,
          month: month,
          total_orders_in_month: totalOrdersInMonth || 0,
          processed_in_batch: ordersFromDb.length,
          already_synced_in_batch: ordersFromDb.length - ordersToSync.length,
          synced: successCount,
          failed: errorCount,
          upserted: upsertedCount,
          offset: offset,
          next_offset: hasMore ? nextOffset : null,
          has_more: hasMore,
          progress: progress,
          total_escrow_synced_for_month: monthEscrowCount || 0,
          errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Chỉ trả về 10 lỗi đầu tiên
        };
        break;
      }

      case 'finance-stats': {
        // Get finance/escrow statistics by month
        // Input: month (optional, default current month)
        const { month } = body;

        let monthStart: number;
        let monthEnd: number;
        let targetMonth: string;

        if (month && /^\d{4}-\d{2}$/.test(month)) {
          const boundaries = getMonthBoundaries(month);
          monthStart = boundaries.start;
          monthEnd = boundaries.end;
          targetMonth = month;
        } else {
          // Default to current month
          targetMonth = getCurrentMonth();
          const boundaries = getMonthBoundaries(targetMonth);
          monthStart = boundaries.start;
          monthEnd = boundaries.end;
        }

        // Get all orders in month
        const { count: totalOrders } = await supabase
          .from('apishopee_orders')
          .select('order_sn', { count: 'exact', head: true })
          .eq('shop_id', shop_id)
          .gte('create_time', monthStart)
          .lte('create_time', monthEnd);

        // Get order status breakdown
        const { data: ordersInMonth } = await supabase
          .from('apishopee_orders')
          .select('order_sn, order_status, total_amount')
          .eq('shop_id', shop_id)
          .gte('create_time', monthStart)
          .lte('create_time', monthEnd);

        const statusCounts: Record<string, number> = {};
        let gmvTotal = 0; // Gross Merchandise Value (Doanh số ảo)
        (ordersInMonth || []).forEach(o => {
          statusCounts[o.order_status] = (statusCounts[o.order_status] || 0) + 1;
          gmvTotal += o.total_amount || 0;
        });

        // Get escrow data for this month
        const orderSns = (ordersInMonth || []).map(o => o.order_sn);
        const { data: escrowData } = await supabase
          .from('apishopee_order_escrow')
          .select('order_sn, escrow_amount, escrow_amount_after_adjustment, buyer_total_amount')
          .eq('shop_id', shop_id)
          .in('order_sn', orderSns.length > 0 ? orderSns : ['']);

        // Calculate actual income (Tiền thực nhận)
        let escrowTotal = 0; // Tiền thực về ví
        let escrowAfterAdjustment = 0;
        (escrowData || []).forEach(e => {
          escrowTotal += e.escrow_amount || 0;
          escrowAfterAdjustment += e.escrow_amount_after_adjustment || e.escrow_amount || 0;
        });

        result = {
          success: true,
          month: targetMonth,
          total_orders: totalOrders || 0,
          status_breakdown: statusCounts,
          gmv_total: gmvTotal, // Doanh số ảo (GMV)
          escrow_total: escrowTotal, // Tiền escrow
          escrow_after_adjustment: escrowAfterAdjustment, // Tiền thực nhận sau điều chỉnh
          orders_with_escrow: escrowData?.length || 0,
          orders_missing_escrow: (totalOrders || 0) - (escrowData?.length || 0),
          escrow_sync_percentage: totalOrders ? Math.round(((escrowData?.length || 0) / totalOrders) * 100) : 100,
        };
        break;
      }

      default:
        return new Response(JSON.stringify({
          error: 'Invalid action. Use: sync, sync-month, sync-date-range, continue-month-sync, status, get-orders, get-stats, sync-escrow, sync-all-escrow, escrow-stats, get-escrow, sync-finance-month, finance-stats'
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

/**
 * Lazada API Client
 * Wrapper để gọi Lazada Edge Functions từ frontend
 */

import { supabase } from '../supabase';

const LAZADA_AUTH_FUNCTION = 'apilazada-auth';
const LAZADA_ORDERS_FUNCTION = 'apilazada-orders';
const LAZADA_PRODUCTS_FUNCTION = 'apilazada-products';

// Lazada API config
export const LAZADA_CONFIG = {
  APP_KEY: import.meta.env.VITE_LAZADA_APP_KEY || '136675',
  CALLBACK_URL: import.meta.env.VITE_LAZADA_CALLBACK_URL || 'https://beta.betacom.agency/lazada/callback',
  DEFAULT_REGION: 'VN',
};

// Types
export interface LazadaShop {
  id: string;
  seller_id: number;
  shop_name: string | null;
  shop_logo: string | null;
  region: string;
  country: string | null;
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  token_updated_at: string | null;
  app_key: string | null;
  email: string | null;
  short_code: string | null;
  seller_status: string | null;
  seller_type: string | null;
  status: string;
  is_main_shop: boolean;
  created_at: string;
  updated_at: string;
}

export interface LazadaAppInfo {
  app_key: string;
  app_secret: string;
  app_name?: string;
  app_created_by?: string;
}

export interface LazadaOrder {
  id: string;
  seller_id: number;
  order_id: number;
  order_number: string | null;
  status: string | null;
  statuses: string[] | null;
  price: number | null;
  payment_method: string | null;
  paid_price: number | null;
  shipping_fee: number | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  address_shipping: Record<string, unknown> | null;
  items: Record<string, unknown>[] | null;
  items_count: number;
  created_at_lazada: string | null;
  updated_at_lazada: string | null;
  synced_at: string | null;
}

export interface LazadaProduct {
  id: string;
  seller_id: number;
  item_id: number;
  shop_sku: string | null;
  seller_sku: string | null;
  name: string | null;
  description: string | null;
  brand: string | null;
  price: number | null;
  special_price: number | null;
  quantity: number;
  available: number;
  status: string | null;
  images: string[] | null;
  has_variation: boolean;
  skus: Record<string, unknown>[] | null;
  synced_at: string | null;
}

/**
 * Gọi Edge Function
 */
async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });

  if (error) {
    console.error(`[LAZADA] Edge function error:`, error);
    throw new Error(error.message || 'Edge function error');
  }

  return data as T;
}

// ==================== AUTH ====================

/**
 * Lấy URL xác thực OAuth
 */
export async function getAuthUrl(
  redirectUri: string = LAZADA_CONFIG.CALLBACK_URL,
  region: string = LAZADA_CONFIG.DEFAULT_REGION,
  appInfo?: LazadaAppInfo
): Promise<{ auth_url: string; app_key: string; region: string }> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'get-auth-url',
    redirect_uri: redirectUri,
    region,
    app_info: appInfo,
  });
}

/**
 * Đổi authorization code lấy access token
 */
export async function getAccessToken(
  code: string,
  region: string = LAZADA_CONFIG.DEFAULT_REGION,
  appInfo?: LazadaAppInfo
): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: number;
  expires_in: number;
  country: string;
  success: boolean;
  error?: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'get-token',
    code,
    region,
    app_info: appInfo,
  });
}

/**
 * Refresh access token
 */
export async function refreshToken(
  refreshTokenStr: string,
  sellerId: number,
  region: string = LAZADA_CONFIG.DEFAULT_REGION
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  success: boolean;
  error?: string;
}> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'refresh-token',
    refresh_token: refreshTokenStr,
    seller_id: sellerId,
    region,
  });
}

/**
 * Lấy token đã lưu từ database
 */
export async function getStoredToken(sellerId: number): Promise<LazadaShop | null> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'get-stored-token',
    seller_id: sellerId,
  });
}

/**
 * Lấy thông tin seller
 */
export async function getSellerInfo(sellerId: number): Promise<Record<string, unknown>> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'get-seller-info',
    seller_id: sellerId,
  });
}

/**
 * Lấy valid access token (auto-refresh nếu cần)
 */
export async function getValidAccessToken(sellerId: number): Promise<{
  access_token: string;
  success: boolean;
  error?: string;
  need_reauth?: boolean;
}> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'get-valid-token',
    seller_id: sellerId,
  });
}

/**
 * Kiểm tra trạng thái token của shops
 */
export async function checkTokenStatus(sellerIds?: number[]): Promise<{
  shops: Array<{
    seller_id: number;
    shop_name: string;
    access_token_expired: boolean;
    access_token_expiring_soon: boolean;
    refresh_token_expired: boolean;
    status: string;
  }>;
  success: boolean;
}> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'check-token-status',
    seller_ids: sellerIds,
  });
}

/**
 * Refresh tất cả tokens sắp hết hạn
 */
export async function refreshAllExpiringTokens(bufferHours: number = 24): Promise<{
  refreshed: number;
  failed: number;
  results: Array<{ seller_id: number; success: boolean; error?: string }>;
  success: boolean;
}> {
  return callEdgeFunction(LAZADA_AUTH_FUNCTION, {
    action: 'refresh-all-expiring',
    buffer_hours: bufferHours,
  });
}

// ==================== ORDERS ====================

/**
 * Lấy danh sách đơn hàng
 */
export async function getOrders(
  sellerId: number,
  params: {
    created_after?: string;
    created_before?: string;
    update_after?: string;
    status?: string;
    offset?: number;
    limit?: number;
  } = {}
): Promise<{ data: { orders: LazadaOrder[]; count: number }; code: string; message?: string }> {
  return callEdgeFunction(LAZADA_ORDERS_FUNCTION, {
    action: 'get-orders',
    seller_id: sellerId,
    ...params,
  });
}

/**
 * Lấy chi tiết một đơn hàng
 */
export async function getOrder(
  sellerId: number,
  orderId: string
): Promise<{ data: LazadaOrder; code: string }> {
  return callEdgeFunction(LAZADA_ORDERS_FUNCTION, {
    action: 'get-order',
    seller_id: sellerId,
    order_id: orderId,
  });
}

/**
 * Sync đơn hàng
 */
export async function syncOrders(
  sellerId: number,
  days: number = 7,
  status?: string
): Promise<{ success: boolean; total: number; synced: number; errors: string[] }> {
  return callEdgeFunction(LAZADA_ORDERS_FUNCTION, {
    action: 'sync',
    seller_id: sellerId,
    days,
    status,
  });
}

// ==================== PRODUCTS ====================

/**
 * Lấy danh sách sản phẩm
 */
export async function getProducts(
  sellerId: number,
  params: {
    filter?: string;
    offset?: number;
    limit?: number;
    update_after?: string;
  } = {}
): Promise<{
  data: { products: LazadaProduct[]; total_products: number };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-products',
    seller_id: sellerId,
    ...params,
  });
}

/**
 * Lấy chi tiết một sản phẩm
 */
export async function getProduct(
  sellerId: number,
  itemId: string
): Promise<{ data: LazadaProduct; code: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-product',
    seller_id: sellerId,
    item_id: itemId,
  });
}

/**
 * Sync sản phẩm
 */
export async function syncProducts(
  sellerId: number,
  filter: string = 'all'
): Promise<{
  success: boolean;
  total: number;
  synced: number;
  skus_synced: number;
  errors: string[];
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'sync',
    seller_id: sellerId,
    filter,
  });
}

/**
 * Cập nhật giá sản phẩm
 */
export async function updateProductPrice(
  sellerId: number,
  itemId: string,
  skuId: string,
  price: number,
  specialPrice?: number
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'update-price',
    seller_id: sellerId,
    item_id: itemId,
    sku_id: skuId,
    price,
    special_price: specialPrice,
  });
}

/**
 * Cập nhật tồn kho
 */
export async function updateProductStock(
  sellerId: number,
  itemId: string,
  skuId: string,
  quantity: number
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'update-stock',
    seller_id: sellerId,
    item_id: itemId,
    sku_id: skuId,
    quantity,
  });
}

// ==================== CATEGORY & BRAND APIs ====================

/**
 * Lấy danh sách thương hiệu theo trang
 */
export async function getBrandByPages(
  sellerId: number,
  params: { startRow?: number; pageSize?: number } = {}
): Promise<{
  data: { brands: Array<{ brand_id: number; name: string; global_identifier: string }> };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-brands',
    seller_id: sellerId,
    start_row: params.startRow,
    page_size: params.pageSize,
  });
}

/**
 * Lấy cây danh mục sản phẩm
 */
export async function getCategoryTree(
  sellerId: number,
  languageCode?: string
): Promise<{
  data: Array<{
    category_id: number;
    name: string;
    leaf: boolean;
    children?: Array<unknown>;
  }>;
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-category-tree',
    seller_id: sellerId,
    language_code: languageCode,
  });
}

/**
 * Lấy thuộc tính của danh mục
 */
export async function getCategoryAttributes(
  sellerId: number,
  primaryCategoryId: number,
  languageCode?: string
): Promise<{
  data: Array<{
    name: string;
    label: string;
    input_type: string;
    is_mandatory: boolean;
    options?: Array<{ name: string; id?: number }>;
  }>;
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-category-attributes',
    seller_id: sellerId,
    primary_category_id: primaryCategoryId,
    language_code: languageCode,
  });
}

/**
 * Gợi ý danh mục theo tên sản phẩm
 */
export async function getCategorySuggestion(
  sellerId: number,
  productName: string
): Promise<{
  data: {
    categorySuggestions: Array<{
      categoryId: number;
      categoryName: string;
      categoryPath: string;
    }>;
  };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-category-suggestion',
    seller_id: sellerId,
    product_name: productName,
  });
}

// ==================== IMAGE APIs ====================

/**
 * Upload ảnh lên Lazada server (từ base64)
 */
export async function uploadImage(
  sellerId: number,
  imageBase64: string
): Promise<{
  data: { image: { url: string } };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'upload-image',
    seller_id: sellerId,
    image_base64: imageBase64,
  });
}

/**
 * Migrate ảnh từ URL bên ngoài
 */
export async function migrateImage(
  sellerId: number,
  imageUrl: string
): Promise<{
  data: { image: { url: string } };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'migrate-image',
    seller_id: sellerId,
    image_url: imageUrl,
  });
}

/**
 * Migrate nhiều ảnh từ URLs bên ngoài (async)
 */
export async function migrateImages(
  sellerId: number,
  imageUrls: string[]
): Promise<{
  data: { batch_id: string };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'migrate-images',
    seller_id: sellerId,
    image_urls: imageUrls,
  });
}

/**
 * Lấy kết quả từ MigrateImages (async response)
 */
export async function getImageResponse(
  sellerId: number,
  batchId: string
): Promise<{
  data: {
    images: Array<{ url: string; status: string }>;
  };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-image-response',
    seller_id: sellerId,
    batch_id: batchId,
  });
}

/**
 * Set ảnh cho sản phẩm
 */
export async function setImages(
  sellerId: number,
  skuId: string,
  images: string[]
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'set-images',
    seller_id: sellerId,
    sku_id: skuId,
    images,
  });
}

// ==================== PRODUCT MANAGEMENT APIs ====================

/**
 * Tạo sản phẩm mới
 * @param payload - XML payload theo format Lazada
 */
export async function createProduct(
  sellerId: number,
  payload: string
): Promise<{
  data: { item_id: number; sku_list: Array<{ sku_id: number; seller_sku: string }> };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'create-product',
    seller_id: sellerId,
    payload,
  });
}

/**
 * Helper: Tạo XML payload cho CreateProduct
 */
export function buildCreateProductPayload(product: {
  primaryCategory: number;
  attributes: Record<string, string>;
  skus: Array<{
    sellerSku: string;
    price: number;
    quantity: number;
    specialPrice?: number;
    images?: string[];
    colorFamily?: string;
    size?: string;
    packageWeight?: number;
    packageLength?: number;
    packageWidth?: number;
    packageHeight?: number;
  }>;
}): string {
  const attributesXml = Object.entries(product.attributes)
    .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
    .join('');

  const skusXml = product.skus
    .map((sku) => {
      let skuContent = `<SellerSku>${sku.sellerSku}</SellerSku>`;
      skuContent += `<price>${sku.price}</price>`;
      skuContent += `<quantity>${sku.quantity}</quantity>`;
      if (sku.specialPrice) skuContent += `<special_price>${sku.specialPrice}</special_price>`;
      if (sku.colorFamily) skuContent += `<color_family>${sku.colorFamily}</color_family>`;
      if (sku.size) skuContent += `<size>${sku.size}</size>`;
      if (sku.packageWeight) skuContent += `<package_weight>${sku.packageWeight}</package_weight>`;
      if (sku.packageLength) skuContent += `<package_length>${sku.packageLength}</package_length>`;
      if (sku.packageWidth) skuContent += `<package_width>${sku.packageWidth}</package_width>`;
      if (sku.packageHeight) skuContent += `<package_height>${sku.packageHeight}</package_height>`;
      if (sku.images && sku.images.length > 0) {
        skuContent += `<Images>${sku.images.map((img) => `<Image>${img}</Image>`).join('')}</Images>`;
      }
      return `<Sku>${skuContent}</Sku>`;
    })
    .join('');

  return `<Request><Product><PrimaryCategory>${product.primaryCategory}</PrimaryCategory><Attributes>${attributesXml}</Attributes><Skus>${skusXml}</Skus></Product></Request>`;
}

/**
 * Cập nhật sản phẩm
 * @param payload - XML payload theo format Lazada
 */
export async function updateProduct(
  sellerId: number,
  payload: string
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'update-product',
    seller_id: sellerId,
    payload,
  });
}

/**
 * Helper: Tạo XML payload cho UpdateProduct
 */
export function buildUpdateProductPayload(product: {
  itemId: number;
  attributes?: Record<string, string>;
  skus?: Array<{
    skuId: number;
    sellerSku?: string;
    price?: number;
    quantity?: number;
    specialPrice?: number;
    status?: string;
  }>;
}): string {
  let productContent = `<ItemId>${product.itemId}</ItemId>`;

  if (product.attributes) {
    const attributesXml = Object.entries(product.attributes)
      .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
      .join('');
    productContent += `<Attributes>${attributesXml}</Attributes>`;
  }

  if (product.skus && product.skus.length > 0) {
    const skusXml = product.skus
      .map((sku) => {
        let skuContent = `<SkuId>${sku.skuId}</SkuId>`;
        if (sku.sellerSku) skuContent += `<SellerSku>${sku.sellerSku}</SellerSku>`;
        if (sku.price !== undefined) skuContent += `<price>${sku.price}</price>`;
        if (sku.quantity !== undefined) skuContent += `<quantity>${sku.quantity}</quantity>`;
        if (sku.specialPrice !== undefined) skuContent += `<special_price>${sku.specialPrice}</special_price>`;
        if (sku.status) skuContent += `<Status>${sku.status}</Status>`;
        return `<Sku>${skuContent}</Sku>`;
      })
      .join('');
    productContent += `<Skus>${skusXml}</Skus>`;
  }

  return `<Request><Product>${productContent}</Product></Request>`;
}

/**
 * Xóa sản phẩm
 */
export async function removeProduct(
  sellerId: number,
  sellerSkuList: string[]
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'remove-product',
    seller_id: sellerId,
    seller_sku_list: sellerSkuList,
  });
}

/**
 * Lấy trạng thái QC của sản phẩm
 */
export async function getQcStatus(
  sellerId: number,
  params: {
    offset?: number;
    limit?: number;
    skuSellerList?: string[];
  } = {}
): Promise<{
  data: {
    products: Array<{
      seller_sku: string;
      shop_sku: string;
      status: string;
      reason?: string;
    }>;
  };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-qc-status',
    seller_id: sellerId,
    offset: params.offset,
    limit: params.limit,
    sku_seller_list: params.skuSellerList,
  });
}

/**
 * Lấy giới hạn số lượng sản phẩm của seller
 */
export async function getSellerItemLimit(
  sellerId: number
): Promise<{
  data: {
    item_limit: number;
    current_item_count: number;
    item_limit_per_day?: number;
  };
  code: string;
  message?: string;
}> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'get-seller-item-limit',
    seller_id: sellerId,
  });
}

// ==================== INVENTORY APIs ====================

/**
 * Điều chỉnh số lượng bán được (tăng/giảm)
 */
export async function adjustSellableQuantity(
  sellerId: number,
  skus: Array<{
    seller_sku: string;
    adjust_quantity: number;
  }>
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'adjust-sellable-quantity',
    seller_id: sellerId,
    skus,
  });
}

/**
 * Cập nhật số lượng bán được (set giá trị tuyệt đối)
 */
export async function updateSellableQuantity(
  sellerId: number,
  skus: Array<{
    seller_sku: string;
    sellable_quantity: number;
  }>
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'update-sellable-quantity',
    seller_id: sellerId,
    skus,
  });
}

/**
 * Cập nhật giá và số lượng (batch)
 */
export async function updatePriceQuantity(
  sellerId: number,
  skus: Array<{
    item_id: string;
    sku_id: string;
    price?: number;
    special_price?: number;
    quantity?: number;
  }>
): Promise<{ code: string; message?: string }> {
  return callEdgeFunction(LAZADA_PRODUCTS_FUNCTION, {
    action: 'update-price-quantity',
    seller_id: sellerId,
    skus,
  });
}

// ==================== DATABASE QUERIES ====================

/**
 * Lấy danh sách shops của user
 */
export async function getUserShops(userId: string): Promise<LazadaShop[]> {
  const { data, error } = await supabase
    .from('apilazada_shop_members')
    .select(`
      shop:apilazada_shops(*)
    `)
    .eq('profile_id', userId)
    .eq('is_active', true);

  if (error) {
    console.error('[LAZADA] Error fetching user shops:', error);
    return [];
  }

  return (data || [])
    .filter((item) => item.shop)
    .map((item) => item.shop as unknown as LazadaShop);
}

/**
 * Lấy đơn hàng từ database (đã sync)
 */
export async function getOrdersFromDB(
  sellerId: number,
  params: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<LazadaOrder[]> {
  let query = supabase
    .from('apilazada_orders')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at_lazada', { ascending: false });

  if (params.status) {
    query = query.eq('status', params.status);
  }
  if (params.limit) {
    query = query.limit(params.limit);
  }
  if (params.offset) {
    query = query.range(params.offset, params.offset + (params.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[LAZADA] Error fetching orders from DB:', error);
    return [];
  }

  return data || [];
}

/**
 * Lấy sản phẩm từ database (đã sync)
 */
export async function getProductsFromDB(
  sellerId: number,
  params: {
    status?: string;
    limit?: number;
    offset?: number;
    search?: string;
  } = {}
): Promise<LazadaProduct[]> {
  let query = supabase
    .from('apilazada_products')
    .select('*')
    .eq('seller_id', sellerId)
    .order('updated_at', { ascending: false });

  if (params.status) {
    query = query.eq('status', params.status);
  }
  if (params.search) {
    query = query.or(`name.ilike.%${params.search}%,seller_sku.ilike.%${params.search}%`);
  }
  if (params.limit) {
    query = query.limit(params.limit);
  }
  if (params.offset) {
    query = query.range(params.offset, params.offset + (params.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[LAZADA] Error fetching products from DB:', error);
    return [];
  }

  return data || [];
}

/**
 * Lấy sync status
 */
export async function getSyncStatus(sellerId: number): Promise<{
  orders_synced_at: string | null;
  orders_is_syncing: boolean;
  orders_total_synced: number;
  products_synced_at: string | null;
  products_is_syncing: boolean;
  products_total_synced: number;
} | null> {
  const { data, error } = await supabase
    .from('apilazada_sync_status')
    .select('*')
    .eq('seller_id', sellerId)
    .single();

  if (error) {
    return null;
  }

  return data;
}

/**
 * Add shop member (sau khi OAuth thành công)
 */
export async function addShopMember(
  shopId: string,
  profileId: string,
  roleId?: string
): Promise<boolean> {
  const { error } = await supabase.from('apilazada_shop_members').upsert(
    {
      shop_id: shopId,
      profile_id: profileId,
      role_id: roleId,
      is_active: true,
    },
    { onConflict: 'shop_id,profile_id' }
  );

  if (error) {
    console.error('[LAZADA] Error adding shop member:', error);
    return false;
  }

  return true;
}

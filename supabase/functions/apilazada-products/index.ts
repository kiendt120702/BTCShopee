/**
 * Supabase Edge Function: Lazada Products
 * Sync và quản lý sản phẩm từ Lazada Open Platform API
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

  console.log('[LAZADA-PRODUCTS] Calling API:', apiPath);

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  return await response.json();
}

/**
 * Lấy danh sách sản phẩm từ Lazada
 */
async function getProducts(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  params: {
    filter?: string; // all, live, inactive, deleted
    offset?: number;
    limit?: number;
    sku_seller_list?: string; // JSON array of SKUs
    update_after?: string;
    update_before?: string;
    create_after?: string;
    create_before?: string;
  }
) {
  const apiParams: Record<string, string> = {};

  if (params.filter) apiParams.filter = params.filter;
  if (params.offset !== undefined) apiParams.offset = params.offset.toString();
  if (params.limit !== undefined) apiParams.limit = params.limit.toString();
  if (params.sku_seller_list) apiParams.sku_seller_list = params.sku_seller_list;
  if (params.update_after) apiParams.update_after = params.update_after;
  if (params.update_before) apiParams.update_before = params.update_before;
  if (params.create_after) apiParams.create_after = params.create_after;
  if (params.create_before) apiParams.create_before = params.create_before;

  return await callLazadaAPI('/products/get', shop, apiParams);
}

/**
 * Lấy chi tiết một sản phẩm
 */
async function getProduct(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  itemId: string
) {
  return await callLazadaAPI('/product/item/get', shop, { item_id: itemId });
}

/**
 * Safely parse images from Lazada SKU
 * Handles: JSON array string, URL string, array, empty string, null
 */
function parseImages(images: unknown): string[] {
  if (!images) return [];

  // Already an array
  if (Array.isArray(images)) {
    return images.filter((img): img is string => typeof img === 'string' && img.length > 0);
  }

  // String handling
  if (typeof images === 'string') {
    const trimmed = images.trim();
    if (!trimmed) return [];

    // Try JSON parse first
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((img): img is string => typeof img === 'string' && img.length > 0);
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    // Single URL string
    if (trimmed.startsWith('http')) {
      return [trimmed];
    }
  }

  return [];
}

/**
 * Convert Lazada timestamp (milliseconds or seconds) to ISO string
 */
function parseTimestamp(timestamp: unknown): string | null {
  if (!timestamp) return null;

  let ts: number;

  if (typeof timestamp === 'string') {
    ts = parseInt(timestamp, 10);
  } else if (typeof timestamp === 'number') {
    ts = timestamp;
  } else {
    return null;
  }

  if (isNaN(ts)) return null;

  // Lazada returns milliseconds (13 digits), convert to Date
  // If it's 10 digits, it's seconds
  if (ts > 9999999999999) {
    // Too large, probably already an error
    return null;
  } else if (ts > 9999999999) {
    // Milliseconds (13 digits)
    return new Date(ts).toISOString();
  } else {
    // Seconds (10 digits)
    return new Date(ts * 1000).toISOString();
  }
}

/**
 * Sync products to database
 */
async function syncProducts(
  supabase: ReturnType<typeof createClient>,
  shop: {
    seller_id: number;
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  options: {
    filter?: string;
    fullSync?: boolean;
  } = {}
) {
  const results = {
    total: 0,
    synced: 0,
    skus_synced: 0,
    errors: [] as string[],
  };

  let offset = 0;
  const limit = 50; // Lazada max is 50
  let hasMore = true;

  console.log('[LAZADA-PRODUCTS] Starting sync for seller:', shop.seller_id);

  while (hasMore) {
    try {
      const response = await getProducts(shop, {
        filter: options.filter || 'all',
        offset,
        limit,
      });

      if (response.code !== '0') {
        results.errors.push(`API Error: ${response.code} - ${response.message}`);
        break;
      }

      const products = response.data?.products || [];
      const totalProducts = response.data?.total_products || 0;
      results.total = totalProducts;

      if (products.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`[LAZADA-PRODUCTS] Processing ${products.length} products (offset: ${offset})`);

      // Process each product
      for (const product of products) {
        try {
          const skus = product.skus || [];
          const primarySku = skus[0] || {};
          const attributes = product.attributes || {};

          // Extract images from SKUs
          const allImages: string[] = [];
          for (const sku of skus) {
            const images = parseImages(sku.Images);
            allImages.push(...images);
          }
          const uniqueImages = [...new Set(allImages)];

          // Upsert product to database
          const productData = {
            seller_id: shop.seller_id,
            item_id: product.item_id,
            shop_sku: primarySku.ShopSku,
            seller_sku: primarySku.SellerSku,
            name: attributes.name || product.attributes?.name,
            description: attributes.description || attributes.short_description,
            brand: attributes.brand,
            model: attributes.model,
            primary_category: product.primary_category,
            category_name: product.category_name,
            price: primarySku.price,
            special_price: primarySku.special_price,
            special_from_date: primarySku.special_from_date,
            special_to_date: primarySku.special_to_date,
            quantity: primarySku.quantity,
            available: primarySku.Available,
            status: product.status,
            sub_status: product.sub_status,
            images: uniqueImages,
            attributes: attributes,
            has_variation: skus.length > 1,
            skus: skus,
            created_at_lazada: parseTimestamp(product.created_time),
            updated_at_lazada: parseTimestamp(product.updated_time),
            raw_response: product,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          const { error: productError } = await supabase
            .from('apilazada_products')
            .upsert(productData, { onConflict: 'seller_id,item_id' });

          if (productError) {
            console.error('[LAZADA-PRODUCTS] Error saving product:', productError);
            results.errors.push(`Product ${product.item_id}: ${productError.message}`);
          } else {
            results.synced++;
          }

          // Save SKUs
          for (const sku of skus) {
            const skuImages = parseImages(sku.Images);

            const skuData = {
              seller_id: shop.seller_id,
              item_id: product.item_id,
              sku_id: sku.SkuId,
              shop_sku: sku.ShopSku,
              seller_sku: sku.SellerSku,
              price: sku.price,
              special_price: sku.special_price,
              special_from_date: sku.special_from_date,
              special_to_date: sku.special_to_date,
              quantity: sku.quantity,
              available: sku.Available,
              status: sku.Status,
              color_family: sku.color_family,
              size: sku.size,
              variation_attributes: {
                color_family: sku.color_family,
                size: sku.size,
              },
              images: skuImages,
              package_weight: sku.package_weight,
              package_length: sku.package_length,
              package_width: sku.package_width,
              package_height: sku.package_height,
              package_content: sku.package_content,
              raw_response: sku,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            const { error: skuError } = await supabase
              .from('apilazada_product_skus')
              .upsert(skuData, { onConflict: 'seller_id,sku_id' });

            if (!skuError) {
              results.skus_synced++;
            }
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (productError) {
          console.error('[LAZADA-PRODUCTS] Error processing product:', productError);
          results.errors.push(`Product ${product.item_id}: ${(productError as Error).message}`);
        }
      }

      // Check if there are more products
      if (products.length < limit || offset + products.length >= totalProducts) {
        hasMore = false;
      } else {
        offset += limit;
      }
    } catch (error) {
      console.error('[LAZADA-PRODUCTS] Error fetching products:', error);
      results.errors.push(`Fetch error: ${(error as Error).message}`);
      break;
    }
  }

  // Update sync status
  await supabase.from('apilazada_sync_status').upsert({
    seller_id: shop.seller_id,
    products_synced_at: new Date().toISOString(),
    products_is_syncing: false,
    products_total_synced: results.synced,
    products_last_error: results.errors.length > 0 ? results.errors.join('; ') : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'seller_id' });

  console.log('[LAZADA-PRODUCTS] Sync completed:', results);

  return results;
}

/**
 * Cập nhật giá sản phẩm
 */
async function updatePrice(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  itemId: string,
  skuId: string,
  price: number,
  specialPrice?: number
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/product/price/update';
  const timestamp = Date.now().toString();

  // Build payload XML (Lazada uses XML for some endpoints)
  let skuPayload = `<Sku><ItemId>${itemId}</ItemId><SkuId>${skuId}</SkuId><Price>${price}</Price>`;
  if (specialPrice) {
    skuPayload += `<SalePrice>${specialPrice}</SalePrice>`;
  }
  skuPayload += '</Sku>';

  const payload = `<Request><Product><Skus>${skuPayload}</Skus></Product></Request>`;

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: payload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: payload,
  });

  return await response.json();
}

/**
 * Cập nhật tồn kho
 */
async function updateStock(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  itemId: string,
  skuId: string,
  quantity: number
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/product/stock/update';
  const timestamp = Date.now().toString();

  const payload = `<Request><Product><Skus><Sku><ItemId>${itemId}</ItemId><SkuId>${skuId}</SkuId><Quantity>${quantity}</Quantity></Sku></Skus></Product></Request>`;

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: payload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: payload,
  });

  return await response.json();
}

// ==================== CATEGORY & BRAND APIs ====================

/**
 * Lấy danh sách thương hiệu theo trang
 * API: GetBrandByPages
 */
async function getBrandByPages(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  params: {
    startRow?: number;
    pageSize?: number;
  } = {}
) {
  const apiParams: Record<string, string> = {};
  if (params.startRow !== undefined) apiParams.startRow = params.startRow.toString();
  if (params.pageSize !== undefined) apiParams.pageSize = params.pageSize.toString();

  return await callLazadaAPI('/brands/get', shop, apiParams);
}

/**
 * Lấy cây danh mục sản phẩm
 * API: GetCategoryTree
 */
async function getCategoryTree(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  languageCode?: string
) {
  const apiParams: Record<string, string> = {};
  if (languageCode) apiParams.language_code = languageCode;

  return await callLazadaAPI('/category/tree/get', shop, apiParams);
}

/**
 * Lấy thuộc tính của danh mục
 * API: GetCategoryAttributes
 */
async function getCategoryAttributes(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  primaryCategoryId: number,
  languageCode?: string
) {
  const apiParams: Record<string, string> = {
    primary_category_id: primaryCategoryId.toString(),
  };
  if (languageCode) apiParams.language_code = languageCode;

  return await callLazadaAPI('/category/attributes/get', shop, apiParams);
}

/**
 * Gợi ý danh mục theo tên sản phẩm
 * API: GetCategorySuggestion
 */
async function getCategorySuggestion(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  productName: string
) {
  return await callLazadaAPI('/product/category/suggestion/get', shop, {
    product_name: productName,
  });
}

// ==================== IMAGE APIs ====================

/**
 * Upload ảnh lên Lazada server (từ base64)
 * API: UploadImage
 */
async function uploadImage(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  imageBase64: string
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/image/upload';
  const timestamp = Date.now().toString();

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    image: imageBase64,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);
  params.sign = sign;

  const response = await fetch(`${apiBaseUrl}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  return await response.json();
}

/**
 * Migrate ảnh từ URL bên ngoài
 * API: MigrateImage
 */
async function migrateImage(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  imageUrl: string
) {
  return await callLazadaAPI('/image/migrate', shop, { url: imageUrl });
}

/**
 * Migrate nhiều ảnh từ URLs bên ngoài (async)
 * API: MigrateImages
 */
async function migrateImages(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  imageUrls: string[]
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/images/migrate';
  const timestamp = Date.now().toString();

  const payload = JSON.stringify({ images: imageUrls.map(url => ({ url })) });

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: payload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);
  params.sign = sign;

  const queryString = new URLSearchParams(params).toString();
  const url = `${apiBaseUrl}${apiPath}?${queryString}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });

  return await response.json();
}

/**
 * Lấy kết quả từ MigrateImages (async response)
 * API: GetResponse
 */
async function getImageResponse(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  batchId: string
) {
  return await callLazadaAPI('/images/response/get', shop, { batch_id: batchId });
}

/**
 * Set ảnh cho sản phẩm
 * API: SetImages
 */
async function setImages(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  skuId: string,
  images: string[]
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/images/set';
  const timestamp = Date.now().toString();

  // Build XML payload
  const imagesXml = images.map(url => `<Image><Url>${url}</Url></Image>`).join('');
  const payload = `<Request><Product><Skus><Sku><SkuId>${skuId}</SkuId><Images>${imagesXml}</Images></Sku></Skus></Product></Request>`;

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: payload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: payload,
  });

  return await response.json();
}

// ==================== PRODUCT MANAGEMENT APIs ====================

/**
 * Tạo sản phẩm mới
 * API: CreateProduct
 */
async function createProduct(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  productPayload: string // XML payload
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/product/create';
  const timestamp = Date.now().toString();

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: productPayload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: productPayload,
  });

  return await response.json();
}

/**
 * Cập nhật sản phẩm
 * API: UpdateProduct
 */
async function updateProduct(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  productPayload: string // XML payload
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/product/update';
  const timestamp = Date.now().toString();

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: productPayload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: productPayload,
  });

  return await response.json();
}

/**
 * Xóa sản phẩm
 * API: RemoveProduct
 */
async function removeProduct(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  sellerSkuList: string[]
) {
  return await callLazadaAPI('/product/remove', shop, {
    seller_sku_list: JSON.stringify(sellerSkuList),
  });
}

/**
 * Lấy trạng thái QC của sản phẩm
 * API: GetQcStatus
 */
async function getQcStatus(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  params: {
    offset?: number;
    limit?: number;
    sku_seller_list?: string[];
  } = {}
) {
  const apiParams: Record<string, string> = {};
  if (params.offset !== undefined) apiParams.offset = params.offset.toString();
  if (params.limit !== undefined) apiParams.limit = params.limit.toString();
  if (params.sku_seller_list) apiParams.sku_seller_list = JSON.stringify(params.sku_seller_list);

  return await callLazadaAPI('/product/qc/status/get', shop, apiParams);
}

/**
 * Lấy giới hạn số lượng sản phẩm của seller
 * API: GetSellerItemLimit
 */
async function getSellerItemLimit(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  }
) {
  return await callLazadaAPI('/product/seller/limit/get', shop, {});
}

// ==================== INVENTORY APIs ====================

/**
 * Điều chỉnh số lượng bán được (tăng/giảm)
 * API: AdjustSellableQuantity
 */
async function adjustSellableQuantity(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  skus: Array<{
    seller_sku: string;
    adjust_quantity: number; // Positive to increase, negative to decrease
  }>
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/product/stock/sellable/adjust';
  const timestamp = Date.now().toString();

  // Build XML payload
  const skusXml = skus.map(sku =>
    `<Sku><SellerSku>${sku.seller_sku}</SellerSku><AdjustQuantity>${sku.adjust_quantity}</AdjustQuantity></Sku>`
  ).join('');
  const payload = `<Request><Product><Skus>${skusXml}</Skus></Product></Request>`;

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: payload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: payload,
  });

  return await response.json();
}

/**
 * Cập nhật số lượng bán được (set giá trị tuyệt đối)
 * API: UpdateSellableQuantity
 */
async function updateSellableQuantity(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  skus: Array<{
    seller_sku: string;
    sellable_quantity: number;
  }>
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/product/stock/sellable/update';
  const timestamp = Date.now().toString();

  // Build XML payload
  const skusXml = skus.map(sku =>
    `<Sku><SellerSku>${sku.seller_sku}</SellerSku><SellableQuantity>${sku.sellable_quantity}</SellableQuantity></Sku>`
  ).join('');
  const payload = `<Request><Product><Skus>${skusXml}</Skus></Product></Request>`;

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: payload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: payload,
  });

  return await response.json();
}

/**
 * Cập nhật giá và số lượng (batch)
 * API: UpdatePriceQuantity
 */
async function updatePriceQuantity(
  shop: {
    app_key: string;
    app_secret: string;
    access_token: string;
    region: string;
  },
  skus: Array<{
    item_id: string;
    sku_id: string;
    price?: number;
    special_price?: number;
    quantity?: number;
  }>
) {
  const apiBaseUrl = LAZADA_API_URLS[shop.region] || LAZADA_API_URLS.VN;
  const apiPath = '/product/price_quantity/update';
  const timestamp = Date.now().toString();

  // Build XML payload
  const skusXml = skus.map(sku => {
    let skuXml = `<Sku><ItemId>${sku.item_id}</ItemId><SkuId>${sku.sku_id}</SkuId>`;
    if (sku.price !== undefined) skuXml += `<Price>${sku.price}</Price>`;
    if (sku.special_price !== undefined) skuXml += `<SalePrice>${sku.special_price}</SalePrice>`;
    if (sku.quantity !== undefined) skuXml += `<Quantity>${sku.quantity}</Quantity>`;
    skuXml += '</Sku>';
    return skuXml;
  }).join('');
  const payload = `<Request><Product><Skus>${skusXml}</Skus></Product></Request>`;

  const params: Record<string, string> = {
    app_key: shop.app_key,
    timestamp: timestamp,
    sign_method: 'sha256',
    access_token: shop.access_token,
    payload: payload,
  };

  const sign = createSignature(shop.app_secret, apiPath, params);

  const url = `${apiBaseUrl}${apiPath}?app_key=${shop.app_key}&timestamp=${timestamp}&sign_method=sha256&access_token=${shop.access_token}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: payload,
  });

  return await response.json();
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
      case 'get-products': {
        const response = await getProducts(shopCredentials, {
          filter: body.filter,
          offset: body.offset,
          limit: body.limit || 50,
          update_after: body.update_after,
          create_after: body.create_after,
        });

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-product': {
        const response = await getProduct(shopCredentials, body.item_id);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'sync': {
        // Mark as syncing
        await supabase.from('apilazada_sync_status').upsert({
          seller_id: shop.seller_id,
          products_is_syncing: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'seller_id' });

        const results = await syncProducts(supabase, shopCredentials, {
          filter: body.filter,
          fullSync: body.full_sync,
        });

        return new Response(JSON.stringify({
          success: true,
          ...results,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update-price': {
        const response = await updatePrice(
          shopCredentials,
          body.item_id,
          body.sku_id,
          body.price,
          body.special_price
        );

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update-stock': {
        const response = await updateStock(
          shopCredentials,
          body.item_id,
          body.sku_id,
          body.quantity
        );

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ==================== CATEGORY & BRAND ====================

      case 'get-brands': {
        const response = await getBrandByPages(shopCredentials, {
          startRow: body.start_row,
          pageSize: body.page_size,
        });

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-category-tree': {
        const response = await getCategoryTree(shopCredentials, body.language_code);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-category-attributes': {
        const response = await getCategoryAttributes(
          shopCredentials,
          body.primary_category_id,
          body.language_code
        );

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-category-suggestion': {
        const response = await getCategorySuggestion(shopCredentials, body.product_name);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ==================== IMAGES ====================

      case 'upload-image': {
        const response = await uploadImage(shopCredentials, body.image_base64);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'migrate-image': {
        const response = await migrateImage(shopCredentials, body.image_url);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'migrate-images': {
        const response = await migrateImages(shopCredentials, body.image_urls);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-image-response': {
        const response = await getImageResponse(shopCredentials, body.batch_id);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'set-images': {
        const response = await setImages(shopCredentials, body.sku_id, body.images);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ==================== PRODUCT MANAGEMENT ====================

      case 'create-product': {
        const response = await createProduct(shopCredentials, body.payload);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update-product': {
        const response = await updateProduct(shopCredentials, body.payload);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'remove-product': {
        const response = await removeProduct(shopCredentials, body.seller_sku_list);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-qc-status': {
        const response = await getQcStatus(shopCredentials, {
          offset: body.offset,
          limit: body.limit,
          sku_seller_list: body.sku_seller_list,
        });

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-seller-item-limit': {
        const response = await getSellerItemLimit(shopCredentials);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ==================== INVENTORY ====================

      case 'adjust-sellable-quantity': {
        const response = await adjustSellableQuantity(shopCredentials, body.skus);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update-sellable-quantity': {
        const response = await updateSellableQuantity(shopCredentials, body.skus);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update-price-quantity': {
        const response = await updatePriceQuantity(shopCredentials, body.skus);

        return new Response(JSON.stringify(response), {
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
    console.error('[LAZADA-PRODUCTS] Error:', error);
    return new Response(JSON.stringify({
      error: (error as Error).message,
      success: false
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

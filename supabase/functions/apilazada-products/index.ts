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
            if (sku.Images) {
              const images = JSON.parse(sku.Images || '[]');
              allImages.push(...images);
            }
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
            created_at_lazada: product.created_time,
            updated_at_lazada: product.updated_time,
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
            const skuImages = sku.Images ? JSON.parse(sku.Images) : [];

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

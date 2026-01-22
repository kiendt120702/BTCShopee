/**
 * useMultiPlatformProducts - Hook tổng hợp sản phẩm từ tất cả platforms (Shopee, Lazada)
 * Cung cấp danh sách sản phẩm thống nhất cho trang quản lý sản phẩm đa kênh
 */

import { useQuery } from '@tanstack/react-query';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { supabase } from '@/lib/supabase';

export type Platform = 'all' | 'shopee' | 'lazada';
export type ProductStatus = 'all' | 'active' | 'inactive' | 'out_of_stock' | 'low_stock' | 'banned';

export interface UnifiedVariant {
  id: string | number;
  sku: string;
  name: string;
  price: number;
  originalPrice: number | null;
  specialPrice: number | null;
  stock: number;
  image: string | null;
}

export interface UnifiedProduct {
  id: string;
  platform: 'shopee' | 'lazada';
  platformProductId: number;
  shopId: number | string;
  shopName: string;
  name: string;
  sku: string;
  image: string | null;
  images: string[];
  price: number;
  originalPrice: number | null;
  specialPrice: number | null;
  stock: number;
  status: 'active' | 'inactive' | 'deleted' | 'banned';
  hasVariants: boolean;
  variants: UnifiedVariant[];
  brandName: string | null;
  categoryName: string | null;
  createdAt: Date;
  updatedAt: Date;
  syncedAt: Date | null;
}

export interface PlatformCount {
  platform: Platform;
  count: number;
  label: string;
}

export interface StatusCount {
  status: ProductStatus;
  count: number;
  label: string;
}

interface ShopeeProduct {
  id: string;
  shop_id: number;
  item_id: number;
  item_name: string;
  item_sku: string;
  item_status: string;
  current_price: number;
  original_price: number;
  total_available_stock: number;
  image_url_list: string[];
  brand_name: string | null;
  has_model: boolean;
  create_time: number;
  update_time: number;
  synced_at: string;
}

interface ShopeeModel {
  id: string;
  item_id: number;
  model_id: number;
  model_sku: string;
  model_name: string;
  current_price: number;
  original_price: number;
  total_available_stock: number;
  image_url: string | null;
}

interface LazadaProduct {
  id: string;
  seller_id: number;
  item_id: number;
  name: string;
  seller_sku: string;
  status: string;
  price: number;
  special_price: number | null;
  available: number;
  images: string[];
  brand: string | null;
  category_name: string | null;
  has_variation: boolean;
  skus: LazadaSku[] | null;
  created_at_lazada: string;
  updated_at_lazada: string;
  synced_at: string;
}

interface LazadaSku {
  SkuId: number;
  ShopSku: string;
  SellerSku: string;
  price: number;
  special_price: number;
  quantity: number;
  package_width: string;
  package_height: string;
  package_length: string;
  package_weight: string;
  Images: string[];
  Status: string;
  // Variation properties
  color_family?: string;
  size?: string;
}

interface ShopInfo {
  shop_id: number;
  shop_name: string | null;
}

interface LazadaShopInfo {
  seller_id: number;
  shop_name: string | null;
}

/**
 * Map Shopee status to unified status
 */
function mapShopeeStatus(status: string, stock: number): 'active' | 'inactive' | 'deleted' | 'banned' {
  if (status === 'BANNED') return 'banned';
  if (status === 'UNLIST' || status === 'DELETED') return 'inactive';
  if (stock === 0) return 'inactive';
  return 'active';
}

/**
 * Map Lazada status to unified status
 */
function mapLazadaStatus(status: string, available: number): 'active' | 'inactive' | 'deleted' | 'banned' {
  const lowerStatus = status?.toLowerCase() || '';
  if (lowerStatus === 'deleted') return 'deleted';
  if (lowerStatus === 'inactive') return 'inactive';
  if (available === 0) return 'inactive';
  return 'active';
}

/**
 * Get stock status
 */
function getStockStatus(stock: number): ProductStatus {
  if (stock === 0) return 'out_of_stock';
  if (stock <= 10) return 'low_stock';
  return 'active';
}

/**
 * Check if product matches status filter
 */
function matchesStatusFilter(product: UnifiedProduct, statusFilter: ProductStatus): boolean {
  if (statusFilter === 'all') return true;

  const stockStatus = getStockStatus(product.stock);

  switch (statusFilter) {
    case 'active':
      return product.status === 'active' && product.stock > 10;
    case 'inactive':
      return product.status === 'inactive';
    case 'out_of_stock':
      return stockStatus === 'out_of_stock';
    case 'low_stock':
      return stockStatus === 'low_stock';
    case 'banned':
      return product.status === 'banned' || product.status === 'deleted';
    default:
      return true;
  }
}

/**
 * Transform Shopee product to unified format
 */
function transformShopeeProduct(
  product: ShopeeProduct,
  models: ShopeeModel[],
  shopName: string
): UnifiedProduct {
  const variants: UnifiedVariant[] = models.map(m => ({
    id: m.model_id,
    sku: m.model_sku || '',
    name: m.model_name || '',
    price: m.current_price || 0,
    originalPrice: m.original_price || null,
    specialPrice: null,
    stock: m.total_available_stock || 0,
    image: m.image_url || null,
  }));

  return {
    id: product.id,
    platform: 'shopee',
    platformProductId: product.item_id,
    shopId: product.shop_id,
    shopName,
    name: product.item_name || '',
    sku: product.item_sku || '',
    image: product.image_url_list?.[0] || null,
    images: product.image_url_list || [],
    price: product.current_price || 0,
    originalPrice: product.original_price || null,
    specialPrice: null,
    stock: product.total_available_stock || 0,
    status: mapShopeeStatus(product.item_status, product.total_available_stock),
    hasVariants: product.has_model && variants.length > 0,
    variants,
    brandName: product.brand_name || null,
    categoryName: null,
    createdAt: new Date(product.create_time * 1000),
    updatedAt: new Date(product.update_time * 1000),
    syncedAt: product.synced_at ? new Date(product.synced_at) : null,
  };
}

/**
 * Transform Lazada product to unified format
 */
function transformLazadaProduct(product: LazadaProduct, shopName: string): UnifiedProduct {
  const skus = product.skus || [];

  const variants: UnifiedVariant[] = skus.map(sku => ({
    id: sku.SkuId,
    sku: sku.SellerSku || sku.ShopSku || '',
    name: [sku.color_family, sku.size].filter(Boolean).join(' - ') || sku.SellerSku || '',
    price: sku.price || 0,
    originalPrice: sku.price || null,
    specialPrice: sku.special_price || null,
    stock: sku.quantity || 0,
    image: sku.Images?.[0] || null,
  }));

  return {
    id: product.id,
    platform: 'lazada',
    platformProductId: product.item_id,
    shopId: product.seller_id,
    shopName,
    name: product.name || '',
    sku: product.seller_sku || '',
    image: product.images?.[0] || null,
    images: product.images || [],
    price: product.price || 0,
    originalPrice: product.price || null,
    specialPrice: product.special_price || null,
    stock: product.available || 0,
    status: mapLazadaStatus(product.status, product.available),
    hasVariants: product.has_variation && variants.length > 0,
    variants,
    brandName: product.brand || null,
    categoryName: product.category_name || null,
    createdAt: product.created_at_lazada ? new Date(product.created_at_lazada) : new Date(),
    updatedAt: product.updated_at_lazada ? new Date(product.updated_at_lazada) : new Date(),
    syncedAt: product.synced_at ? new Date(product.synced_at) : null,
  };
}

/**
 * Main hook to get multi-platform products
 */
export function useMultiPlatformProducts(params: {
  platform?: Platform;
  shopId?: string;
  status?: ProductStatus;
  search?: string;
}) {
  const { platform = 'all', shopId, status = 'all', search = '' } = params;
  const { shops: shopeeShops } = useShopeeAuth();
  const { shops: lazadaShops } = useLazadaAuth();

  return useQuery({
    queryKey: ['multi-platform-products', platform, shopId, status, search, shopeeShops.length, lazadaShops.length],
    queryFn: async (): Promise<{
      products: UnifiedProduct[];
      platformCounts: PlatformCount[];
      statusCounts: StatusCount[];
    }> => {
      const allProducts: UnifiedProduct[] = [];

      // Build shop name maps
      const shopeeShopMap = new Map<number, string>();
      shopeeShops.forEach(s => {
        shopeeShopMap.set(s.shop_id, s.shop_name || `Shop ${s.shop_id}`);
      });

      const lazadaShopMap = new Map<number, string>();
      lazadaShops.forEach(s => {
        lazadaShopMap.set(s.seller_id, s.shop_name || `Seller ${s.seller_id}`);
      });

      // Fetch Shopee products
      if ((platform === 'all' || platform === 'shopee') && shopeeShops.length > 0) {
        const shopIds = shopeeShops.map(s => s.shop_id);

        // Filter by specific shop if selected
        const targetShopIds = shopId?.startsWith('shopee-')
          ? [parseInt(shopId.replace('shopee-', ''))]
          : shopIds;

        const { data: shopeeProducts, error: shopeeError } = await supabase
          .from('apishopee_products')
          .select('id, shop_id, item_id, item_name, item_sku, item_status, current_price, original_price, total_available_stock, image_url_list, brand_name, has_model, create_time, update_time, synced_at')
          .in('shop_id', targetShopIds)
          .order('update_time', { ascending: false });

        if (shopeeError) {
          console.error('[MultiPlatformProducts] Shopee query error:', shopeeError);
        }

        if (shopeeProducts && shopeeProducts.length > 0) {
          // Fetch models for products with has_model = true
          const itemIds = shopeeProducts.filter(p => p.has_model).map(p => p.item_id);

          let modelsMap: Record<number, ShopeeModel[]> = {};
          if (itemIds.length > 0) {
            const { data: models } = await supabase
              .from('apishopee_product_models')
              .select('id, item_id, model_id, model_sku, model_name, current_price, original_price, total_available_stock, image_url')
              .in('item_id', itemIds);

            if (models) {
              models.forEach(m => {
                if (!modelsMap[m.item_id]) modelsMap[m.item_id] = [];
                modelsMap[m.item_id].push(m);
              });
            }
          }

          // Transform products
          shopeeProducts.forEach(p => {
            const shopName = shopeeShopMap.get(p.shop_id) || `Shop ${p.shop_id}`;
            const models = modelsMap[p.item_id] || [];
            allProducts.push(transformShopeeProduct(p as ShopeeProduct, models, shopName));
          });
        }
      }

      // Fetch Lazada products
      if ((platform === 'all' || platform === 'lazada') && lazadaShops.length > 0) {
        const sellerIds = lazadaShops.map(s => s.seller_id);

        // Filter by specific shop if selected
        const targetSellerIds = shopId?.startsWith('lazada-')
          ? [parseInt(shopId.replace('lazada-', ''))]
          : sellerIds;

        const { data: lazadaProducts, error: lazadaError } = await supabase
          .from('apilazada_products')
          .select('id, seller_id, item_id, name, seller_sku, status, price, special_price, available, images, brand, category_name, has_variation, skus, created_at_lazada, updated_at_lazada, synced_at')
          .in('seller_id', targetSellerIds)
          .order('updated_at_lazada', { ascending: false });

        if (lazadaError) {
          console.error('[MultiPlatformProducts] Lazada query error:', lazadaError);
        }

        if (lazadaProducts) {
          lazadaProducts.forEach(p => {
            const shopName = lazadaShopMap.get(p.seller_id) || `Seller ${p.seller_id}`;
            allProducts.push(transformLazadaProduct(p as LazadaProduct, shopName));
          });
        }
      }

      // Calculate platform counts (before filtering)
      const shopeeCount = allProducts.filter(p => p.platform === 'shopee').length;
      const lazadaCount = allProducts.filter(p => p.platform === 'lazada').length;

      const platformCounts: PlatformCount[] = [
        { platform: 'all', count: allProducts.length, label: 'Tất cả' },
        { platform: 'shopee', count: shopeeCount, label: 'Shopee' },
        { platform: 'lazada', count: lazadaCount, label: 'Lazada' },
      ];

      // Calculate status counts (before filtering by status)
      const activeCount = allProducts.filter(p => matchesStatusFilter(p, 'active')).length;
      const lowStockCount = allProducts.filter(p => matchesStatusFilter(p, 'low_stock')).length;
      const outOfStockCount = allProducts.filter(p => matchesStatusFilter(p, 'out_of_stock')).length;
      const inactiveCount = allProducts.filter(p => matchesStatusFilter(p, 'inactive')).length;
      const bannedCount = allProducts.filter(p => matchesStatusFilter(p, 'banned')).length;

      const statusCounts: StatusCount[] = [
        { status: 'all', count: allProducts.length, label: 'Tất cả' },
        { status: 'active', count: activeCount, label: 'Đang hoạt động' },
        { status: 'low_stock', count: lowStockCount, label: 'Sắp hết hàng' },
        { status: 'out_of_stock', count: outOfStockCount, label: 'Hết hàng' },
        { status: 'inactive', count: inactiveCount, label: 'Đã ẩn' },
        { status: 'banned', count: bannedCount, label: 'Vi phạm' },
      ];

      // Apply status filter
      let filteredProducts = status === 'all'
        ? allProducts
        : allProducts.filter(p => matchesStatusFilter(p, status));

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        filteredProducts = filteredProducts.filter(p =>
          p.name.toLowerCase().includes(searchLower) ||
          p.sku.toLowerCase().includes(searchLower) ||
          p.platformProductId.toString().includes(searchLower)
        );
      }

      // Sort by updatedAt desc
      filteredProducts.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      return {
        products: filteredProducts,
        platformCounts,
        statusCounts,
      };
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    enabled: shopeeShops.length > 0 || lazadaShops.length > 0,
  });
}

/**
 * Get list of all shops for filter dropdown
 */
export function useAllShopsForProducts() {
  const { shops: shopeeShops } = useShopeeAuth();
  const { shops: lazadaShops } = useLazadaAuth();

  const allShops = [
    ...shopeeShops.map(s => ({
      id: `shopee-${s.shop_id}`,
      name: s.shop_name || `Shop ${s.shop_id}`,
      logo: s.shop_logo,
      channel: 'shopee' as const,
    })),
    ...lazadaShops.map(s => ({
      id: `lazada-${s.seller_id}`,
      name: s.shop_name || `Seller ${s.seller_id}`,
      logo: s.shop_logo,
      channel: 'lazada' as const,
    })),
  ];

  return allShops;
}

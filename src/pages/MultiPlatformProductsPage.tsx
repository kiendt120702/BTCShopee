/**
 * MultiPlatformProductsPage - Trang danh sách sản phẩm đa nền tảng
 * Hiển thị sản phẩm từ Shopee, Lazada trong một bảng tổng hợp
 */

import { useState, useMemo } from 'react';
import { RefreshCw, Search, Package, ChevronDown, ChevronUp, Store, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { ProductDetailDialog } from '@/components/products/ProductDetailDialog';
import {
  useMultiPlatformProducts,
  useAllShopsForProducts,
  type Platform,
  type ProductStatus,
  type UnifiedProduct,
} from '@/hooks/useMultiPlatformProducts';
import { cn } from '@/lib/utils';

// SVG Icons for platforms
function ShopeeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="currentColor">
      <path d="M24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20S35.046 4 24 4zm0 5c2.387 0 4.507 1.118 5.875 2.858C28.503 13.177 26.373 14 24 14s-4.503-.823-5.875-2.142C19.493 10.118 21.613 9 24 9zm-9 8.5c0-1.381 1.119-2.5 2.5-2.5s2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5-2.5-1.119-2.5-2.5zm12.5 17.125c-.828 0-1.5-.672-1.5-1.5v-4.75c0-.414-.336-.75-.75-.75h-2.5c-.414 0-.75.336-.75.75v4.75c0 .828-.672 1.5-1.5 1.5s-1.5-.672-1.5-1.5V24c0-.828.672-1.5 1.5-1.5h7c.828 0 1.5.672 1.5 1.5v9.125c0 .828-.672 1.5-1.5 1.5zm5-14.625c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z"/>
    </svg>
  );
}

function LazadaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="currentColor">
      <path d="M24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20S35.046 4 24 4zm8.5 28h-17c-.828 0-1.5-.672-1.5-1.5v-13c0-.828.672-1.5 1.5-1.5h17c.828 0 1.5.672 1.5 1.5v13c0 .828-.672 1.5-1.5 1.5zM24 14l-8 4v8l8 4 8-4v-8l-8-4z"/>
    </svg>
  );
}

function TiktokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="currentColor">
      <path d="M38.4 21.6c-3.6 0-7-1.5-9.4-4.1v14.1c0 7-5.7 12.6-12.6 12.6S3.8 38.6 3.8 31.6s5.7-12.6 12.6-12.6c.5 0 1 0 1.5.1v6.3c-.5-.1-1-.1-1.5-.1-3.5 0-6.3 2.8-6.3 6.3s2.8 6.3 6.3 6.3 6.3-2.8 6.3-6.3V3.8h6.3c0 6 4.9 10.9 10.9 10.9v6.9h.5z"/>
    </svg>
  );
}

// Format price
function formatPrice(price: number): string {
  return new Intl.NumberFormat('vi-VN').format(price) + ' đ';
}

// Format date
function formatDate(date: Date): string {
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Platform config
const platformConfig: Record<string, {
  icon: React.FC<{ className?: string }>;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  shopee: {
    icon: ShopeeIcon,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
  },
  lazada: {
    icon: LazadaIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  tiktok: {
    icon: TiktokIcon,
    color: 'text-slate-800',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
  },
};

export function MultiPlatformProductsPage() {
  // Filters state
  const [platform, setPlatform] = useState<Platform>('all');
  const [shopId, setShopId] = useState<string>('all');
  const [status, setStatus] = useState<ProductStatus>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // UI state
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<UnifiedProduct | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Data
  const allShops = useAllShopsForProducts();
  const { data, isLoading, refetch, isFetching } = useMultiPlatformProducts({
    platform,
    shopId: shopId === 'all' ? undefined : shopId,
    status,
    search: debouncedSearch,
  });

  const products = data?.products || [];
  const platformCounts = data?.platformCounts || [];
  const statusCounts = data?.statusCounts || [];

  // Debounce search
  useMemo(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Toggle expand product variants
  const toggleExpand = (productId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Handle product click
  const handleProductClick = (product: UnifiedProduct) => {
    setSelectedProduct(product);
    setDialogOpen(true);
  };

  // Filter shops by platform
  const filteredShops = useMemo(() => {
    if (platform === 'all') return allShops;
    return allShops.filter(s => s.channel === platform);
  }, [allShops, platform]);

  const DEFAULT_VISIBLE_VARIANTS = 3;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Danh sách sản phẩm sàn</h1>
          <p className="text-sm text-slate-500">Quản lý sản phẩm từ tất cả các nền tảng</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading || isFetching}
          className="cursor-pointer"
        >
          <RefreshCw className={cn('w-4 h-4 mr-2', (isLoading || isFetching) && 'animate-spin')} />
          Làm mới
        </Button>
      </div>

      {/* Platform Tabs */}
      <div className="flex flex-wrap gap-2">
        {platformCounts.map((p) => {
          const config = platformConfig[p.platform] || {
            icon: Package,
            color: 'text-slate-600',
            bgColor: 'bg-slate-50',
            borderColor: 'border-slate-200',
          };
          const Icon = p.platform === 'all' ? Package : config.icon;
          const isActive = platform === p.platform;

          return (
            <button
              key={p.platform}
              onClick={() => {
                setPlatform(p.platform);
                setShopId('all'); // Reset shop filter when platform changes
              }}
              className={cn(
                'flex flex-col items-center px-4 py-2 rounded-lg border-2 transition-all min-w-[100px] cursor-pointer',
                isActive
                  ? `${config.borderColor} ${config.bgColor}`
                  : 'border-transparent bg-slate-50 hover:bg-slate-100'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn('w-5 h-5', isActive ? config.color : 'text-slate-400')} />
                <span className={cn('text-sm font-medium', isActive ? config.color : 'text-slate-600')}>
                  {p.label}
                </span>
              </div>
              <span className={cn('text-lg font-bold', isActive ? config.color : 'text-slate-800')}>
                {p.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Tìm theo tên, SKU hoặc ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            {/* Shop filter */}
            <Select value={shopId} onValueChange={setShopId}>
              <SelectTrigger className="w-[180px]">
                <Store className="w-4 h-4 mr-2 text-slate-400" />
                <SelectValue placeholder="Chọn gian hàng" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả gian hàng</SelectItem>
                {filteredShops.map((shop) => (
                  <SelectItem key={shop.id} value={shop.id}>
                    <div className="flex items-center gap-2">
                      {shop.channel === 'shopee' ? (
                        <ShopeeIcon className="w-4 h-4 text-orange-500" />
                      ) : (
                        <LazadaIcon className="w-4 h-4 text-blue-500" />
                      )}
                      <span className="truncate max-w-[120px]">{shop.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Advanced filter button (placeholder) */}
            <Button variant="outline" size="sm" className="cursor-pointer">
              <Filter className="w-4 h-4 mr-2" />
              Lọc nâng cao
            </Button>
          </div>

          {/* Status tabs */}
          <div className="flex flex-wrap gap-1 mt-4 pt-4 border-t">
            {statusCounts.map((s) => (
              <button
                key={s.status}
                onClick={() => setStatus(s.status)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer',
                  status === s.status
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                {s.label}
                <span className="ml-1 text-xs opacity-70">({s.count})</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {/* Table Header - Desktop */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 bg-slate-50 border-b text-sm font-medium text-slate-600">
            <div className="col-span-4">Sản phẩm</div>
            <div className="col-span-5">
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-2">Hàng hóa</div>
                <div className="col-span-2 text-right">Giá niêm yết</div>
                <div className="col-span-1 text-center">Tồn kho</div>
              </div>
            </div>
            <div className="col-span-3">Thời gian</div>
          </div>

          {/* Loading */}
          {isLoading && products.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
              <span className="ml-2 text-slate-500">Đang tải dữ liệu...</span>
            </div>
          )}

          {/* Empty */}
          {!isLoading && products.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Package className="h-12 w-12 mb-3" />
              <p className="mb-2">Không có sản phẩm nào</p>
              <p className="text-sm">Thử thay đổi bộ lọc hoặc đồng bộ sản phẩm từ các nền tảng</p>
            </div>
          )}

          {/* Product List */}
          {products.map((product) => {
            const isExpanded = expandedItems.has(product.id);
            const visibleVariants = product.variants.slice(0, isExpanded ? undefined : DEFAULT_VISIBLE_VARIANTS);
            const hasMoreVariants = product.variants.length > DEFAULT_VISIBLE_VARIANTS;
            const remainingVariants = product.variants.length - DEFAULT_VISIBLE_VARIANTS;
            const platformCfg = platformConfig[product.platform];

            return (
              <div key={product.id} className="border-b last:border-b-0">
                {/* Desktop Layout */}
                <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-4 hover:bg-slate-50/50">
                  {/* Product Info */}
                  <div
                    className="col-span-4 flex gap-3 cursor-pointer"
                    onClick={() => handleProductClick(product)}
                  >
                    <div className="relative flex-shrink-0">
                      {product.image ? (
                        <ImageWithZoom
                          src={product.image}
                          alt={product.name}
                          className="w-16 h-16 object-cover rounded border"
                        />
                      ) : (
                        <div className="w-16 h-16 bg-slate-100 rounded border flex items-center justify-center">
                          <Package className="w-6 h-6 text-slate-400" />
                        </div>
                      )}
                      {/* Platform badge */}
                      <div className={cn(
                        'absolute -bottom-1 -right-1 p-0.5 rounded',
                        platformCfg.bgColor
                      )}>
                        <platformCfg.icon className={cn('w-3.5 h-3.5', platformCfg.color)} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-slate-800 line-clamp-2 mb-1 hover:text-orange-600 transition-colors">
                        {product.name}
                      </h3>
                      {product.brandName && product.brandName !== 'NoBrand' && (
                        <Badge variant="outline" className="text-xs mb-1">
                          {product.brandName}
                        </Badge>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          product.status === 'active' ? 'bg-green-100 text-green-600' :
                          product.status === 'banned' || product.status === 'deleted' ? 'bg-red-100 text-red-600' :
                          'bg-slate-100 text-slate-500'
                        )}>
                          {product.status === 'active' ? 'Hoạt động' :
                           product.status === 'inactive' ? 'Đã ẩn' :
                           product.status === 'banned' ? 'Vi phạm' : product.status}
                        </span>
                        <span className="text-xs text-slate-400">{product.shopName}</span>
                      </div>
                    </div>
                  </div>

                  {/* Variants + Price + Stock */}
                  <div className="col-span-5">
                    {product.hasVariants && product.variants.length > 0 ? (
                      <div className="space-y-0">
                        {visibleVariants.map((variant, idx) => (
                          <div
                            key={variant.id}
                            className={cn(
                              'grid grid-cols-5 gap-2 py-2',
                              idx !== visibleVariants.length - 1 && 'border-b border-slate-100'
                            )}
                          >
                            <div className="col-span-2 flex items-center gap-2">
                              <platformCfg.icon className={cn('w-3.5 h-3.5 flex-shrink-0', platformCfg.color)} />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-700 truncate">{variant.name || variant.sku}</div>
                                <div className="text-xs text-slate-400 truncate">{variant.sku}</div>
                              </div>
                            </div>
                            <div className="col-span-2 text-right">
                              <span className="text-sm font-medium text-orange-600">
                                {formatPrice(variant.specialPrice || variant.price)}
                              </span>
                              {variant.originalPrice && variant.originalPrice > (variant.specialPrice || variant.price) && (
                                <div className="text-xs text-slate-400 line-through">
                                  {formatPrice(variant.originalPrice)}
                                </div>
                              )}
                            </div>
                            <div className="col-span-1 text-center">
                              <span className={cn(
                                'text-sm font-medium',
                                variant.stock === 0 ? 'text-red-500' :
                                variant.stock <= 10 ? 'text-yellow-600' : 'text-slate-600'
                              )}>
                                {variant.stock}
                              </span>
                            </div>
                          </div>
                        ))}

                        {hasMoreVariants && (
                          <div className="py-2 border-t border-dashed border-slate-200">
                            <button
                              onClick={() => toggleExpand(product.id)}
                              className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 cursor-pointer"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-4 w-4" />
                                  Thu gọn
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-4 w-4" />
                                  Xem thêm {remainingVariants} SKU
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-5 gap-2 py-2">
                        <div className="col-span-2">
                          {product.sku && (
                            <div className="text-xs text-slate-400">SKU: {product.sku}</div>
                          )}
                        </div>
                        <div className="col-span-2 text-right">
                          <span className="text-sm font-medium text-orange-600">
                            {formatPrice(product.specialPrice || product.price)}
                          </span>
                          {product.originalPrice && product.originalPrice > (product.specialPrice || product.price) && (
                            <div className="text-xs text-slate-400 line-through">
                              {formatPrice(product.originalPrice)}
                            </div>
                          )}
                        </div>
                        <div className="col-span-1 text-center">
                          <span className={cn(
                            'text-sm font-medium',
                            product.stock === 0 ? 'text-red-500' :
                            product.stock <= 10 ? 'text-yellow-600' : 'text-slate-600'
                          )}>
                            {product.stock}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Time */}
                  <div className="col-span-3 text-xs text-slate-500">
                    <div>Thời gian tạo</div>
                    <div className="font-medium text-slate-700">{formatDate(product.createdAt)}</div>
                    <div className="mt-2">Cập nhật</div>
                    <div className="font-medium text-slate-700">{formatDate(product.updatedAt)}</div>
                  </div>
                </div>

                {/* Mobile Layout */}
                <div
                  className="md:hidden p-3 hover:bg-slate-50/50 cursor-pointer"
                  onClick={() => handleProductClick(product)}
                >
                  <div className="flex gap-3 mb-3">
                    <div className="relative flex-shrink-0">
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-14 h-14 object-cover rounded border"
                        />
                      ) : (
                        <div className="w-14 h-14 bg-slate-100 rounded border flex items-center justify-center">
                          <Package className="w-5 h-5 text-slate-400" />
                        </div>
                      )}
                      <div className={cn(
                        'absolute -bottom-1 -right-1 p-0.5 rounded',
                        platformCfg.bgColor
                      )}>
                        <platformCfg.icon className={cn('w-3 h-3', platformCfg.color)} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-slate-800 line-clamp-2">
                        {product.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded',
                          product.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'
                        )}>
                          {product.status === 'active' ? 'Hoạt động' : product.status}
                        </span>
                        <span className="text-[10px] text-slate-400">{product.shopName}</span>
                      </div>
                    </div>
                  </div>

                  {/* Price & Stock on Mobile */}
                  <div className="flex items-center justify-between py-2 px-2 bg-slate-50 rounded-lg">
                    <div className="text-right">
                      <span className="text-sm font-semibold text-orange-600">
                        {formatPrice(product.specialPrice || product.price)}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className={cn(
                        'text-sm font-medium',
                        product.stock === 0 ? 'text-red-500' :
                        product.stock <= 10 ? 'text-yellow-600' : 'text-slate-600'
                      )}>
                        {product.stock} tồn kho
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {product.hasVariants && `${product.variants.length} SKU`}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Footer */}
          {products.length > 0 && (
            <div className="px-4 py-3 border-t bg-slate-50/50 flex items-center justify-between">
              <div className="text-sm text-slate-500">
                Hiển thị {products.length} sản phẩm
              </div>
              {isFetching && (
                <span className="text-xs text-orange-500 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Đang cập nhật...
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Product Detail Dialog */}
      <ProductDetailDialog
        product={selectedProduct}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

export default MultiPlatformProductsPage;

/**
 * ProductDetailDialog - Dialog hiển thị chi tiết sản phẩm
 * Hiển thị thông tin sản phẩm từ nhiều nền tảng (Shopee, Lazada)
 */

import { ExternalLink, Package, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { cn } from '@/lib/utils';
import type { UnifiedProduct } from '@/hooks/useMultiPlatformProducts';

interface ProductDetailDialogProps {
  product: UnifiedProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('vi-VN').format(price) + ' đ';
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPlatformUrl(product: UnifiedProduct): string | null {
  if (product.platform === 'shopee') {
    // Shopee product URL format
    return `https://shopee.vn/product/${product.shopId}/${product.platformProductId}`;
  }
  if (product.platform === 'lazada') {
    // Lazada product URL format
    return `https://www.lazada.vn/-i${product.platformProductId}.html`;
  }
  return null;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Hoạt động</Badge>;
    case 'inactive':
      return <Badge variant="secondary">Đã ẩn</Badge>;
    case 'banned':
    case 'deleted':
      return <Badge variant="destructive">Vi phạm</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getStockBadge(stock: number) {
  if (stock === 0) {
    return <Badge variant="destructive">Hết hàng</Badge>;
  }
  if (stock <= 10) {
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Sắp hết ({stock})</Badge>;
  }
  return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{stock} có sẵn</Badge>;
}

function getPlatformIcon(platform: 'shopee' | 'lazada') {
  if (platform === 'shopee') {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2.4c5.302 0 9.6 4.298 9.6 9.6s-4.298 9.6-9.6 9.6S2.4 17.302 2.4 12 6.698 2.4 12 2.4zm-.002 3.6c-2.64 0-4.8 2.16-4.8 4.8 0 2.64 2.16 4.8 4.8 4.8 2.64 0 4.8-2.16 4.8-4.8 0-2.64-2.16-4.8-4.8-4.8zm0 2.4c1.32 0 2.4 1.08 2.4 2.4s-1.08 2.4-2.4 2.4-2.4-1.08-2.4-2.4 1.08-2.4 2.4-2.4z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0L1.5 6v12L12 24l10.5-6V6L12 0zm0 2.4l7.8 4.5v9l-7.8 4.5-7.8-4.5v-9L12 2.4z" />
    </svg>
  );
}

export function ProductDetailDialog({ product, open, onOpenChange }: ProductDetailDialogProps) {
  if (!product) return null;

  const platformUrl = getPlatformUrl(product);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className={cn(
                'p-1.5 rounded',
                product.platform === 'shopee' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
              )}>
                {getPlatformIcon(product.platform)}
              </span>
              <DialogTitle className="text-lg">Chi tiết sản phẩm</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-4">
            {/* Product Info */}
            <div className="flex gap-4">
              {/* Product Image */}
              <div className="flex-shrink-0">
                {product.image ? (
                  <ImageWithZoom
                    src={product.image}
                    alt={product.name}
                    className="w-32 h-32 object-cover rounded-lg border"
                    zoomSize={300}
                  />
                ) : (
                  <div className="w-32 h-32 bg-slate-100 rounded-lg border flex items-center justify-center">
                    <Package className="w-12 h-12 text-slate-400" />
                  </div>
                )}

                {/* Additional Images */}
                {product.images.length > 1 && (
                  <div className="flex gap-1 mt-2 flex-wrap max-w-[128px]">
                    {product.images.slice(1, 5).map((img, idx) => (
                      <ImageWithZoom
                        key={idx}
                        src={img}
                        alt={`${product.name} ${idx + 2}`}
                        className="w-7 h-7 object-cover rounded border"
                        zoomSize={150}
                      />
                    ))}
                    {product.images.length > 5 && (
                      <div className="w-7 h-7 bg-slate-100 rounded border flex items-center justify-center text-xs text-slate-500">
                        +{product.images.length - 5}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Product Details */}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-800 mb-2 line-clamp-2">
                  {product.name}
                </h3>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {getStatusBadge(product.status)}
                  {getStockBadge(product.stock)}
                  <Badge variant="outline" className="capitalize">
                    {product.platform}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <span className="text-slate-500">Shop:</span>
                    <span className="ml-2 font-medium">{product.shopName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">SKU:</span>
                    <span className="ml-2 font-mono text-xs">{product.sku || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Item ID:</span>
                    <span className="ml-2 font-mono text-xs">{product.platformProductId}</span>
                  </div>
                  {product.brandName && (
                    <div>
                      <span className="text-slate-500">Thương hiệu:</span>
                      <span className="ml-2 font-medium">{product.brandName}</span>
                    </div>
                  )}
                  {product.categoryName && (
                    <div className="col-span-2">
                      <span className="text-slate-500">Danh mục:</span>
                      <span className="ml-2">{product.categoryName}</span>
                    </div>
                  )}
                </div>

                {/* Price */}
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-orange-600">
                    {formatPrice(product.specialPrice || product.price)}
                  </span>
                  {product.originalPrice && product.originalPrice > (product.specialPrice || product.price) && (
                    <span className="text-sm text-slate-400 line-through">
                      {formatPrice(product.originalPrice)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Variants */}
            {product.hasVariants && product.variants.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-700 mb-3">
                  Hàng hóa ({product.variants.length} SKU)
                </h4>
                <div className="space-y-2">
                  {product.variants.map((variant, idx) => (
                    <div
                      key={variant.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors',
                        idx !== product.variants.length - 1 && 'mb-1'
                      )}
                    >
                      {variant.image ? (
                        <ImageWithZoom
                          src={variant.image}
                          alt={variant.name}
                          className="w-12 h-12 object-cover rounded border flex-shrink-0"
                          zoomSize={200}
                        />
                      ) : (
                        <div className="w-12 h-12 bg-slate-200 rounded border flex items-center justify-center flex-shrink-0">
                          <Package className="w-5 h-5 text-slate-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-700 truncate">
                          {variant.name || variant.sku}
                        </div>
                        <div className="text-xs text-slate-400 truncate">
                          SKU: {variant.sku}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-semibold text-orange-600">
                          {formatPrice(variant.specialPrice || variant.price)}
                        </div>
                        {variant.originalPrice && variant.originalPrice > (variant.specialPrice || variant.price) && (
                          <div className="text-xs text-slate-400 line-through">
                            {formatPrice(variant.originalPrice)}
                          </div>
                        )}
                      </div>
                      <div className="text-center flex-shrink-0 w-16">
                        <span className={cn(
                          'text-sm font-medium',
                          variant.stock === 0 ? 'text-red-500' :
                          variant.stock <= 10 ? 'text-yellow-600' : 'text-slate-600'
                        )}>
                          {variant.stock}
                        </span>
                        <div className="text-[10px] text-slate-400">tồn kho</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Time Info */}
            <div className="flex items-center gap-6 text-sm text-slate-500">
              <div>
                <span>Thời gian tạo: </span>
                <span className="font-medium text-slate-700">{formatDateTime(product.createdAt)}</span>
              </div>
              <div>
                <span>Cập nhật: </span>
                <span className="font-medium text-slate-700">{formatDateTime(product.updatedAt)}</span>
              </div>
              {product.syncedAt && (
                <div>
                  <span>Đồng bộ: </span>
                  <span className="font-medium text-slate-700">{formatDateTime(product.syncedAt)}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            {platformUrl && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(platformUrl, '_blank')}
                  className="cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Xem trên {product.platform === 'shopee' ? 'Shopee' : 'Lazada'}
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default ProductDetailDialog;

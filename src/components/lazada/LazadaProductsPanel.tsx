/**
 * Lazada Products Panel - Hiển thị và quản lý sản phẩm Lazada
 */

import { useState, useEffect } from 'react';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import {
  useLazadaProducts,
  useSyncLazadaProducts,
  useLazadaProductStats,
  useUpdateLazadaStock,
  useUpdateLazadaPrice,
} from '@/hooks/useLazadaData';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Package,
  RefreshCw,
  Search,
  Box,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Edit,
  Eye,
  DollarSign,
  Info,
  Image as ImageIcon,
} from 'lucide-react';
import { getSellerItemLimit, getProduct } from '@/lib/lazada/client';

const PRODUCT_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'live', label: 'Đang bán' },
  { value: 'inactive', label: 'Ngừng bán' },
  { value: 'deleted', label: 'Đã xóa' },
];

const getStatusBadge = (status: string | null) => {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'live':
      return (
        <Badge className="bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3 mr-1" />
          Đang bán
        </Badge>
      );
    case 'inactive':
      return (
        <Badge className="bg-yellow-100 text-yellow-800">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Ngừng bán
        </Badge>
      );
    case 'deleted':
      return (
        <Badge className="bg-red-100 text-red-800">
          <XCircle className="h-3 w-3 mr-1" />
          Đã xóa
        </Badge>
      );
    default:
      return <Badge variant="outline">{status || 'Unknown'}</Badge>;
  }
};

const formatCurrency = (value: number | null) => {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(value);
};

export function LazadaProductsPanel() {
  const { toast } = useToast();
  const { currentShop } = useLazadaAuth();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Edit stock dialog
  const [editStockOpen, setEditStockOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{
    item_id: number;
    name: string;
    skus: { SkuId: number; SellerSku: string; quantity: number; price?: number; special_price?: number }[];
  } | null>(null);
  const [newQuantity, setNewQuantity] = useState('');

  // Edit price dialog
  const [editPriceOpen, setEditPriceOpen] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [newSpecialPrice, setNewSpecialPrice] = useState('');

  // Product detail dialog
  const [detailOpen, setDetailOpen] = useState(false);
  const [productDetail, setProductDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Seller limit info
  const [sellerLimit, setSellerLimit] = useState<{
    item_limit: number;
    current_item_count: number;
  } | null>(null);

  const { data: products, isLoading, refetch } = useLazadaProducts({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    search: searchQuery || undefined,
    limit: 50,
  });

  const { data: stats } = useLazadaProductStats();
  const syncMutation = useSyncLazadaProducts();
  const updateStockMutation = useUpdateLazadaStock();
  const updatePriceMutation = useUpdateLazadaPrice();

  // Load seller item limit on mount
  useEffect(() => {
    if (currentShop?.seller_id) {
      getSellerItemLimit(currentShop.seller_id)
        .then((res) => {
          if (res.code === '0' && res.data) {
            setSellerLimit(res.data);
          }
        })
        .catch(console.error);
    }
  }, [currentShop?.seller_id]);

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync(statusFilter !== 'all' ? statusFilter : 'all');
      toast({
        title: 'Đồng bộ thành công',
        description: `Đã đồng bộ ${result.synced}/${result.total} sản phẩm`,
      });
    } catch (err) {
      toast({
        title: 'Lỗi đồng bộ',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleUpdateStock = async () => {
    if (!selectedProduct || !newQuantity) return;

    const sku = selectedProduct.skus?.[0];
    if (!sku) {
      toast({
        title: 'Lỗi',
        description: 'Không tìm thấy SKU',
        variant: 'destructive',
      });
      return;
    }

    try {
      await updateStockMutation.mutateAsync({
        itemId: selectedProduct.item_id.toString(),
        skuId: sku.SkuId.toString(),
        quantity: parseInt(newQuantity),
      });
      toast({
        title: 'Thành công',
        description: 'Đã cập nhật tồn kho',
      });
      setEditStockOpen(false);
      setSelectedProduct(null);
      setNewQuantity('');
      refetch();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleUpdatePrice = async () => {
    if (!selectedProduct || !newPrice) return;

    const sku = selectedProduct.skus?.[0];
    if (!sku) {
      toast({
        title: 'Lỗi',
        description: 'Không tìm thấy SKU',
        variant: 'destructive',
      });
      return;
    }

    try {
      await updatePriceMutation.mutateAsync({
        itemId: selectedProduct.item_id.toString(),
        skuId: sku.SkuId.toString(),
        price: parseFloat(newPrice),
        specialPrice: newSpecialPrice ? parseFloat(newSpecialPrice) : undefined,
      });
      toast({
        title: 'Thành công',
        description: 'Đã cập nhật giá sản phẩm',
      });
      setEditPriceOpen(false);
      setSelectedProduct(null);
      setNewPrice('');
      setNewSpecialPrice('');
      refetch();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleViewDetail = async (itemId: number) => {
    if (!currentShop?.seller_id) return;

    setLoadingDetail(true);
    setDetailOpen(true);

    try {
      const res = await getProduct(currentShop.seller_id, itemId.toString()) as { data: unknown; code: string; message?: string };
      if (res.code === '0' && res.data) {
        setProductDetail(res.data as Record<string, unknown>);
      } else {
        toast({
          title: 'Lỗi',
          description: res.message || 'Không thể lấy chi tiết sản phẩm',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tổng sản phẩm</p>
                <p className="text-2xl font-bold">{stats?.total || 0}</p>
              </div>
              <Box className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Đang bán</p>
                <p className="text-2xl font-bold text-green-600">{stats?.active || 0}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Hết hàng</p>
                <p className="text-2xl font-bold text-red-600">{stats?.out_of_stock || 0}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tổng tồn kho</p>
                <p className="text-2xl font-bold">{stats?.total_available?.toLocaleString() || 0}</p>
              </div>
              <Package className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Giới hạn SP</p>
                <p className="text-2xl font-bold">
                  {sellerLimit ? (
                    <span className={sellerLimit.current_item_count >= sellerLimit.item_limit ? 'text-red-600' : ''}>
                      {sellerLimit.current_item_count}/{sellerLimit.item_limit}
                    </span>
                  ) : (
                    '-'
                  )}
                </p>
              </div>
              <Info className="h-8 w-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Products Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>Sản phẩm Lazada</CardTitle>
              <CardDescription>
                Shop: {currentShop?.shop_name || currentShop?.seller_id}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm sản phẩm..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[200px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Làm mới
              </Button>
              <Button size="sm" onClick={handleSync} disabled={syncMutation.isPending}>
                {syncMutation.isPending ? (
                  <Spinner className="h-4 w-4 mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Đồng bộ
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
            </div>
          ) : !products || products.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Box className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Chưa có sản phẩm nào</p>
              <Button className="mt-4" onClick={handleSync} disabled={syncMutation.isPending}>
                {syncMutation.isPending ? (
                  <Spinner className="h-4 w-4 mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Đồng bộ sản phẩm
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Giá</TableHead>
                  <TableHead>Tồn kho</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {product.images && product.images[0] ? (
                          <img
                            src={product.images[0]}
                            alt={product.name || ''}
                            className="w-12 h-12 rounded object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center">
                            <Box className="h-6 w-6 text-gray-400" />
                          </div>
                        )}
                        <div className="max-w-[300px]">
                          <div className="font-medium truncate" title={product.name || ''}>
                            {product.name || `Item ${product.item_id}`}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            ID: {product.item_id}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                        {product.seller_sku || product.shop_sku || '-'}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div>
                        {product.special_price && product.special_price < (product.price || 0) ? (
                          <>
                            <div className="font-medium text-red-600">
                              {formatCurrency(product.special_price)}
                            </div>
                            <div className="text-sm text-muted-foreground line-through">
                              {formatCurrency(product.price)}
                            </div>
                          </>
                        ) : (
                          <div className="font-medium">{formatCurrency(product.price)}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div
                        className={
                          (product.available || 0) === 0 ? 'text-red-600 font-medium' : ''
                        }
                      >
                        {product.available?.toLocaleString() || 0}
                        {product.has_variation && (
                          <span className="text-muted-foreground ml-1">
                            ({(product.skus as unknown[])?.length || 0} SKUs)
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(product.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Xem chi tiết"
                          onClick={() => handleViewDetail(product.item_id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Sửa giá"
                          onClick={() => {
                            const skus = (product.skus as { SkuId: number; SellerSku: string; quantity: number; price?: number; special_price?: number }[]) || [];
                            setSelectedProduct({
                              item_id: product.item_id,
                              name: product.name || '',
                              skus,
                            });
                            setNewPrice(product.price?.toString() || '0');
                            setNewSpecialPrice(product.special_price?.toString() || '');
                            setEditPriceOpen(true);
                          }}
                        >
                          <DollarSign className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Sửa tồn kho"
                          onClick={() => {
                            setSelectedProduct({
                              item_id: product.item_id,
                              name: product.name || '',
                              skus: (product.skus as { SkuId: number; SellerSku: string; quantity: number }[]) || [],
                            });
                            setNewQuantity(product.available?.toString() || '0');
                            setEditStockOpen(true);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Stock Dialog */}
      <Dialog open={editStockOpen} onOpenChange={setEditStockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cập nhật tồn kho</DialogTitle>
            <DialogDescription>
              {selectedProduct?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Số lượng tồn kho</Label>
              <Input
                id="quantity"
                type="number"
                min="0"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="Nhập số lượng"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStockOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleUpdateStock}
              disabled={updateStockMutation.isPending}
            >
              {updateStockMutation.isPending && <Spinner className="h-4 w-4 mr-2" />}
              Cập nhật
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Price Dialog */}
      <Dialog open={editPriceOpen} onOpenChange={setEditPriceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cập nhật giá sản phẩm</DialogTitle>
            <DialogDescription>
              {selectedProduct?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="price">Giá gốc (VNĐ)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="Nhập giá gốc"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="special_price">Giá khuyến mãi (VNĐ) - Tùy chọn</Label>
              <Input
                id="special_price"
                type="number"
                min="0"
                value={newSpecialPrice}
                onChange={(e) => setNewSpecialPrice(e.target.value)}
                placeholder="Nhập giá khuyến mãi"
              />
              <p className="text-xs text-muted-foreground">
                Để trống nếu không có khuyến mãi
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPriceOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleUpdatePrice}
              disabled={updatePriceMutation.isPending}
            >
              {updatePriceMutation.isPending && <Spinner className="h-4 w-4 mr-2" />}
              Cập nhật
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Chi tiết sản phẩm</DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
            </div>
          ) : productDetail ? (
            <ScrollArea className="h-[60vh]">
              <Tabs defaultValue="info" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="info">Thông tin</TabsTrigger>
                  <TabsTrigger value="skus">SKUs</TabsTrigger>
                  <TabsTrigger value="images">Hình ảnh</TabsTrigger>
                </TabsList>
                <TabsContent value="info" className="space-y-4 p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Item ID</Label>
                      <p className="font-medium">{String(productDetail.item_id || '-')}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Trạng thái</Label>
                      <p>{getStatusBadge(productDetail.status as string)}</p>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-muted-foreground">Tên sản phẩm</Label>
                      <p className="font-medium">
                        {(productDetail.attributes as Record<string, string>)?.name || String(productDetail.name || '-')}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Danh mục</Label>
                      <p>{String(productDetail.primary_category || '-')}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Thương hiệu</Label>
                      <p>{(productDetail.attributes as Record<string, string>)?.brand || '-'}</p>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-muted-foreground">Mô tả ngắn</Label>
                      <p className="text-sm">
                        {(productDetail.attributes as Record<string, string>)?.short_description || '-'}
                      </p>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="skus" className="p-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU ID</TableHead>
                        <TableHead>Seller SKU</TableHead>
                        <TableHead>Giá</TableHead>
                        <TableHead>Giá KM</TableHead>
                        <TableHead>Tồn kho</TableHead>
                        <TableHead>Trạng thái</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((productDetail.skus as Record<string, unknown>[]) || []).map((sku, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{String(sku.SkuId || '-')}</TableCell>
                          <TableCell>
                            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                              {String(sku.SellerSku || '-')}
                            </code>
                          </TableCell>
                          <TableCell>{formatCurrency(sku.price as number)}</TableCell>
                          <TableCell>
                            {sku.special_price ? formatCurrency(sku.special_price as number) : '-'}
                          </TableCell>
                          <TableCell>{String(sku.quantity || 0)}</TableCell>
                          <TableCell>{String(sku.Status || '-')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
                <TabsContent value="images" className="p-4">
                  <div className="grid grid-cols-4 gap-4">
                    {((productDetail.skus as Record<string, unknown>[]) || []).flatMap((sku) => {
                      const images = sku.Images;
                      if (!images) return [];
                      const imageList = typeof images === 'string'
                        ? (images.startsWith('[') ? JSON.parse(images) : [images])
                        : Array.isArray(images) ? images : [];
                      return imageList;
                    }).filter((v, i, a) => a.indexOf(v) === i).map((url, idx) => (
                      <div key={idx} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                        <img
                          src={url as string}
                          alt={`Product image ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                    {((productDetail.skus as Record<string, unknown>[]) || []).flatMap((sku) => {
                      const images = sku.Images;
                      if (!images) return [];
                      const imageList = typeof images === 'string'
                        ? (images.startsWith('[') ? JSON.parse(images) : [images])
                        : Array.isArray(images) ? images : [];
                      return imageList;
                    }).length === 0 && (
                      <div className="col-span-4 text-center py-8 text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>Không có hình ảnh</p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Không có dữ liệu
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LazadaProductsPanel;

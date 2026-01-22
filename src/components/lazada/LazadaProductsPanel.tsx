/**
 * Lazada Products Panel - Hiển thị và quản lý sản phẩm Lazada
 */

import { useState } from 'react';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import {
  useLazadaProducts,
  useSyncLazadaProducts,
  useLazadaProductStats,
  useUpdateLazadaStock,
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
import {
  Package,
  RefreshCw,
  Search,
  Box,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Edit,
  ExternalLink,
} from 'lucide-react';

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
    skus: { SkuId: number; SellerSku: string; quantity: number }[];
  } | null>(null);
  const [newQuantity, setNewQuantity] = useState('');

  const { data: products, isLoading, refetch } = useLazadaProducts({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    search: searchQuery || undefined,
    limit: 50,
  });

  const { data: stats } = useLazadaProductStats();
  const syncMutation = useSyncLazadaProducts();
  const updateStockMutation = useUpdateLazadaStock();

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

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Tổng sản phẩm</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
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
                  <p className="text-2xl font-bold text-green-600">{stats.active}</p>
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
                  <p className="text-2xl font-bold text-red-600">{stats.out_of_stock}</p>
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
                  <p className="text-2xl font-bold">{stats.total_available.toLocaleString()}</p>
                </div>
                <Package className="h-8 w-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
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
    </div>
  );
}

export default LazadaProductsPanel;

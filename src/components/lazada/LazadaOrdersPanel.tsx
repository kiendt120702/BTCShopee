/**
 * Lazada Orders Panel - Hiển thị và quản lý đơn hàng Lazada
 */

import { useState } from 'react';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { useLazadaOrders, useSyncLazadaOrders, useLazadaOrderStats } from '@/hooks/useLazadaData';
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
  Package,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
} from 'lucide-react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

const ORDER_STATUSES = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ xử lý' },
  { value: 'ready_to_ship', label: 'Sẵn sàng giao' },
  { value: 'shipped', label: 'Đang giao' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'returned', label: 'Hoàn trả' },
];

const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800';
    case 'ready_to_ship':
      return 'bg-blue-100 text-blue-800';
    case 'shipped':
      return 'bg-purple-100 text-purple-800';
    case 'delivered':
      return 'bg-green-100 text-green-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    case 'returned':
      return 'bg-orange-100 text-orange-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getStatusIcon = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'pending':
      return <Clock className="h-3 w-3" />;
    case 'ready_to_ship':
      return <Package className="h-3 w-3" />;
    case 'shipped':
      return <Truck className="h-3 w-3" />;
    case 'delivered':
      return <CheckCircle className="h-3 w-3" />;
    case 'cancelled':
    case 'returned':
      return <XCircle className="h-3 w-3" />;
    default:
      return <ShoppingCart className="h-3 w-3" />;
  }
};

const formatCurrency = (value: number | null) => {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(value);
};

export function LazadaOrdersPanel() {
  const { toast } = useToast();
  const { currentShop } = useLazadaAuth();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: orders, isLoading, refetch } = useLazadaOrders({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: 50,
  });

  const { data: stats } = useLazadaOrderStats();
  const syncMutation = useSyncLazadaOrders();

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync({ days: 30 });
      toast({
        title: 'Đồng bộ thành công',
        description: `Đã đồng bộ ${result.synced}/${result.total} đơn hàng`,
      });
    } catch (err) {
      toast({
        title: 'Lỗi đồng bộ',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  // Filter orders by search
  const filteredOrders = orders?.filter((order) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      order.order_number?.toLowerCase().includes(query) ||
      order.order_id.toString().includes(query) ||
      order.customer_first_name?.toLowerCase().includes(query) ||
      order.customer_last_name?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Tổng đơn hàng</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <ShoppingCart className="h-8 w-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Chờ xử lý</p>
                  <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Đã giao</p>
                  <p className="text-2xl font-bold text-green-600">{stats.delivered}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Doanh thu</p>
                  <p className="text-xl font-bold text-blue-600">
                    {formatCurrency(stats.total_revenue)}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>Đơn hàng Lazada</CardTitle>
              <CardDescription>
                Shop: {currentShop?.shop_name || currentShop?.seller_id}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm đơn hàng..."
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
                  {ORDER_STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Làm mới
              </Button>
              <Button
                size="sm"
                onClick={handleSync}
                disabled={syncMutation.isPending}
              >
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
          ) : !filteredOrders || filteredOrders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Chưa có đơn hàng nào</p>
              <Button className="mt-4" onClick={handleSync} disabled={syncMutation.isPending}>
                {syncMutation.isPending ? (
                  <Spinner className="h-4 w-4 mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Đồng bộ đơn hàng
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>Tổng tiền</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Ngày tạo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <div className="font-mono text-sm">
                        {order.order_number || order.order_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {[order.customer_first_name, order.customer_last_name]
                          .filter(Boolean)
                          .join(' ') || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.items_count} sản phẩm</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{formatCurrency(order.price)}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(order.status || '')}>
                        <span className="flex items-center gap-1">
                          {getStatusIcon(order.status || '')}
                          {ORDER_STATUSES.find((s) => s.value === order.status?.toLowerCase())
                            ?.label || order.status}
                        </span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {order.created_at_lazada
                          ? format(new Date(order.created_at_lazada), 'dd/MM/yyyy HH:mm', {
                              locale: vi,
                            })
                          : '-'}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default LazadaOrdersPanel;

/**
 * OrdersPanel - Giao diện giống Shopee Seller Center
 * Hiển thị danh sách đơn hàng với realtime updates từ database
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  Search,
  ShoppingCart,
  Package,
  Copy,
  Check,
  Eye,
  Loader2,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  Calendar,
  Download,
} from 'lucide-react';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useOrdersData, Order, MonthSyncResult } from '@/hooks/useOrdersData';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

interface OrdersPanelProps {
  shopId: number;
  userId: string;
}

// ==================== CONSTANTS ====================

const STATUS_TABS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'UNPAID', label: 'Chờ thanh toán' },
  { key: 'READY_TO_SHIP', label: 'Chờ lấy hàng' },
  { key: 'SHIPPED', label: 'Đang giao' },
  { key: 'TO_CONFIRM_RECEIVE', label: 'Chờ xác nhận' },
  { key: 'COMPLETED', label: 'Hoàn thành' },
  { key: 'TO_RETURN', label: 'Trả hàng' },
  { key: 'CANCELLED', label: 'Hủy' },
];

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  UNPAID: { label: 'Chờ thanh toán', bg: 'bg-yellow-500' },
  READY_TO_SHIP: { label: 'Chờ lấy hàng', bg: 'bg-orange-500' },
  PROCESSED: { label: 'Đang xử lý', bg: 'bg-blue-500' },
  SHIPPED: { label: 'Đang giao', bg: 'bg-purple-500' },
  TO_CONFIRM_RECEIVE: { label: 'Chờ xác nhận', bg: 'bg-indigo-500' },
  COMPLETED: { label: 'Hoàn thành', bg: 'bg-green-500' },
  TO_RETURN: { label: 'Trả hàng', bg: 'bg-pink-500' },
  IN_CANCEL: { label: 'Đang hủy', bg: 'bg-orange-500' },
  CANCELLED: { label: 'Đã hủy', bg: 'bg-red-500' },
  INVOICE_PENDING: { label: 'Chờ hóa đơn', bg: 'bg-blue-400' },
  PENDING: { label: 'Đang chờ', bg: 'bg-gray-500' },
};

// ==================== UTILITIES ====================

function formatPrice(price: number, currency?: string): string {
  if (currency === 'VND' || !currency) {
    return new Intl.NumberFormat('vi-VN').format(price) + ' đ';
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Chưa đồng bộ';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút trước`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ngày trước`;
}

function maskName(name: string): string {
  if (!name || name.length <= 2) return name;
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

// ==================== MAIN COMPONENT ====================

export function OrdersPanel({ shopId, userId }: OrdersPanelProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [monthFilter, setMonthFilter] = useState('ALL');

  // Use the hook with status filter and month filter - each combination has its own cache
  const {
    orders,
    loading,
    isFetching,
    error,
    syncStatus,
    syncing,
    syncOrders,
    syncMonth,
    continueMonthSync,
    availableMonths,
    loadMore,
    hasMore,
    loadingMore,
    totalCount,
    stats,
  } = useOrdersData(shopId, userId, statusFilter, monthFilter);

  // Show toast when error occurs
  useEffect(() => {
    if (error) {
      toast({ title: 'Lỗi', description: error, variant: 'destructive' });
    }
  }, [error, toast]);

  // Auto sync on first load if not synced yet - use ref to prevent multiple triggers
  const hasTriggeredAutoSync = useRef(false);
  useEffect(() => {
    if (syncStatus && !syncStatus.is_initial_sync_done && !syncing && !hasTriggeredAutoSync.current) {
      hasTriggeredAutoSync.current = true;
      console.log('[OrdersPanel] Initial sync not done, triggering sync...');
      syncOrders(false).then(result => {
        if (result.success) {
          toast({ title: 'Đồng bộ thành công', description: result.message });
        } else {
          // Show error but DON'T reset flag to prevent infinite retry loop
          // User can manually click sync button to retry
          toast({ title: 'Lỗi đồng bộ', description: result.message, variant: 'destructive' });
        }
      });
    }
  }, [syncStatus, syncing, syncOrders, toast]);

  const handleSync = async () => {
    const result = await syncOrders(false);
    if (result.success) {
      toast({ title: 'Đồng bộ thành công', description: result.message });
    } else {
      toast({ title: 'Lỗi đồng bộ', description: result.message, variant: 'destructive' });
    }
  };

  // Handle month sync with auto-continue
  const handleSyncMonth = async (month: string) => {
    toast({ title: 'Bắt đầu đồng bộ', description: `Đang tải đơn hàng tháng ${month}...` });

    let result: MonthSyncResult = await syncMonth(month);
    let totalSynced = result.synced_count;

    // Auto-continue if there are more chunks
    while (result.success && result.has_more) {
      toast({
        title: 'Đang đồng bộ',
        description: `Đã tải ${totalSynced} đơn, đang tiếp tục...`
      });
      result = await continueMonthSync();
      totalSynced += result.synced_count;
    }

    if (result.success) {
      toast({
        title: 'Đồng bộ hoàn tất',
        description: `Đã tải ${totalSynced} đơn hàng tháng ${month}`
      });
    } else {
      toast({
        title: 'Lỗi đồng bộ',
        description: result.error || 'Đã xảy ra lỗi',
        variant: 'destructive'
      });
    }
  };

  // Format month for display
  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
                       'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
  };

  // Check if month is synced
  const isMonthSynced = (month: string) => {
    return syncStatus?.synced_months?.includes(month) || false;
  };

  const handleViewDetail = (order: Order) => {
    navigate(`/orders/${order.order_sn}`);
  };

  // Orders are already filtered by status from server, only apply search filter client-side
  const filteredOrders = useMemo(() => {
    let result = orders;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        o =>
          o.order_sn.toLowerCase().includes(term) ||
          o.buyer_username?.toLowerCase().includes(term)
      );
    }
    return result;
  }, [orders, searchTerm]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: totalCount };
    // Use stats from database for accurate counts
    if (stats.statusCounts) {
      Object.entries(stats.statusCounts).forEach(([status, count]) => {
        counts[status] = count;
      });
    }
    return counts;
  }, [totalCount, stats]);

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Sync Status Bar */}
        {syncStatus && (
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b text-sm">
            <div className="flex items-center gap-2">
              {syncStatus.is_syncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span className="text-blue-600">Đang đồng bộ...</span>
                </>
              ) : syncStatus.last_error ? (
                <>
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span className="text-red-600">Lỗi: {syncStatus.last_error}</span>
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-slate-600">
                    Đồng bộ: {formatRelativeTime(syncStatus.last_sync_at)}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span>Tổng: {totalCount} đơn hàng</span>
              {stats.totalRevenue > 0 && (
                <>
                  <span className="text-slate-300">|</span>
                  <span className="text-green-600">
                    Doanh thu: {formatPrice(stats.totalRevenue)}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Status Tabs */}
        <div className="flex items-center border-b bg-white overflow-x-auto">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                'px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
                statusFilter === tab.key
                  ? 'border-orange-500 text-orange-600 font-medium'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              )}
            >
              {tab.label}
              {(statusCounts[tab.key] || 0) > 0 && (
                <span className="text-slate-400 ml-1">({statusCounts[tab.key]})</span>
              )}
            </button>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-3 p-3 border-b bg-slate-50">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Tìm mã đơn, tên người mua..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          {/* Month Filter Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={monthFilter !== 'ALL' ? 'default' : 'outline'}
                size="sm"
                className={monthFilter !== 'ALL' ? 'bg-orange-500 hover:bg-orange-600' : ''}
              >
                <Calendar className="h-4 w-4 mr-1" />
                {monthFilter === 'ALL' ? 'Tất cả tháng' : formatMonth(monthFilter)}
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Lọc theo tháng</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setMonthFilter('ALL')}
                className={cn("flex items-center justify-between", monthFilter === 'ALL' && "bg-orange-50")}
              >
                <span>Tất cả</span>
                {monthFilter === 'ALL' && <Check className="h-3 w-3 text-orange-500" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {availableMonths.map((month) => (
                <DropdownMenuItem
                  key={month}
                  onClick={() => setMonthFilter(month)}
                  className={cn("flex items-center justify-between", monthFilter === month && "bg-orange-50")}
                >
                  <span>{formatMonth(month)}</span>
                  {monthFilter === month && <Check className="h-3 w-3 text-orange-500" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Month Sync Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || syncing}
              >
                <Download className="h-4 w-4 mr-1" />
                Tải dữ liệu
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Chọn tháng để đồng bộ</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableMonths.map((month) => (
                <DropdownMenuItem
                  key={month}
                  onClick={() => handleSyncMonth(month)}
                  className="flex items-center justify-between"
                >
                  <span>{formatMonth(month)}</span>
                  {isMonthSynced(month) && (
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={loading || syncing}
          >
            <RefreshCw className={cn('h-4 w-4 mr-1', (syncing || isFetching) && 'animate-spin')} />
            {syncing ? 'Đang đồng bộ...' : 'Đồng bộ'}
          </Button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-px bg-slate-200">
          <div className="col-span-4 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            Thông tin sản phẩm
          </div>
          <div className="col-span-2 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">
            Tổng Tiền
          </div>
          <div className="col-span-2 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">
            Xử lý
          </div>
          <div className="col-span-2 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">
            Vận chuyển
          </div>
          <div className="col-span-1 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">
            Người nhận
          </div>
          <div className="col-span-1 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">
            Thao tác
          </div>
        </div>

        {/* Loading */}
        {loading && orders.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
            <span className="ml-2 text-slate-500">Đang tải đơn hàng...</span>
          </div>
        )}

        {/* Empty */}
        {!loading && filteredOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <ShoppingCart className="h-12 w-12 mb-3" />
            <p>Không có đơn hàng nào</p>
            {!syncStatus?.is_initial_sync_done && (
              <Button variant="outline" size="sm" className="mt-4" onClick={handleSync}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Đồng bộ đơn hàng
              </Button>
            )}
          </div>
        )}

        {/* Orders */}
        {filteredOrders.map(order => (
          <OrderRow key={order.order_sn} order={order} onViewDetail={handleViewDetail} />
        ))}

        {/* Load More - now available for all tabs */}
        {hasMore && !loading && filteredOrders.length > 0 && !searchTerm && (
          <div className="flex justify-center py-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Đang tải...
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Tải thêm ({orders.length} / {statusFilter === 'ALL' ? totalCount : (stats.statusCounts[statusFilter] || 0)})
                </>
              )}
            </Button>
          </div>
        )}

        {/* Footer */}
        {orders.length > 0 && (
          <div className="px-4 py-3 border-t bg-slate-50 text-sm text-slate-500">
            Hiển thị {filteredOrders.length} / {statusFilter === 'ALL' ? totalCount : (stats.statusCounts[statusFilter] || 0)} đơn hàng
            {statusFilter !== 'ALL' && (
              <span className="text-slate-400 ml-1">(Tổng: {totalCount})</span>
            )}
            {isFetching && !loading && (
              <span className="ml-2 text-blue-500">
                <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
                Đang cập nhật...
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OrderRow({
  order,
  onViewDetail,
}: {
  order: Order;
  onViewDetail: (order: Order) => void;
}) {
  const [copied, setCopied] = useState(false);
  const status = STATUS_BADGE[order.order_status] || {
    label: order.order_status,
    bg: 'bg-slate-500',
  };
  const items = order.item_list || [];

  const copyOrderSn = () => {
    navigator.clipboard.writeText(order.order_sn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-b">
      {/* Order Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-orange-50/50 border-b border-orange-100">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">{order.buyer_username}</span>
          <span className="text-slate-400">•</span>
          <span className="text-slate-500">Mã đơn hàng:</span>
          <span className="font-mono text-slate-700">{order.order_sn}</span>
          <button onClick={copyOrderSn} className="text-slate-400 hover:text-slate-600">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          {order.cod && (
            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">
              COD
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Đặt lúc: {formatDateTime(order.create_time)}
          </span>
          <span className={cn('px-2 py-1 rounded text-xs text-white font-medium', status.bg)}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Order Content - Each item is a row */}
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-px bg-slate-100">
          {/* Product Info */}
          <div className="col-span-4 bg-white p-3">
            <div className="flex gap-3">
              {item.image_info?.image_url ? (
                <ImageWithZoom
                  src={item.image_info.image_url}
                  alt={item.item_name}
                  className="w-14 h-14 object-cover rounded border flex-shrink-0"
                  zoomSize={240}
                />
              ) : (
                <div className="w-14 h-14 bg-slate-100 rounded border flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 line-clamp-2 leading-tight">
                  {item.item_name}
                </p>
                {item.model_name && (
                  <p className="text-xs text-slate-500 mt-1">Phân loại: {item.model_name}</p>
                )}
                {item.model_sku && <p className="text-xs text-slate-400">SKU: {item.model_sku}</p>}
              </div>
              <div className="text-sm text-slate-600 flex-shrink-0">
                x{item.model_quantity_purchased}
              </div>
            </div>
          </div>

          {/* Total - only show on first row */}
          <div className="col-span-2 bg-white p-3 flex flex-col items-center justify-center border-l">
            {idx === 0 && (
              <>
                <p className="text-sm font-semibold text-orange-600">
                  {formatPrice(order.total_amount, order.currency)}
                </p>
                {order.payment_method && (
                  <p className="text-xs text-slate-500 mt-1 text-center">
                    {order.payment_method}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Processing */}
          <div className="col-span-2 bg-white p-3 flex flex-col items-center justify-center text-xs border-l">
            {idx === 0 && order.ship_by_date && order.order_status === 'READY_TO_SHIP' && (
              <>
                <p className="text-red-500 font-medium">Giao trước:</p>
                <p className="text-slate-700">{formatDateTime(order.ship_by_date)}</p>
              </>
            )}
            {idx === 0 && order.order_status !== 'READY_TO_SHIP' && (
              <span className="text-slate-400">-</span>
            )}
          </div>

          {/* Shipping */}
          <div className="col-span-2 bg-white p-3 flex flex-col items-center justify-center text-xs border-l">
            {idx === 0 && (
              <>
                <p className="font-medium text-slate-700">{order.shipping_carrier || '-'}</p>
                {order.package_list && order.package_list[0]?.package_number && (
                  <>
                    <p className="text-slate-400 mt-1">Mã kiện:</p>
                    <p className="text-slate-600 font-mono text-[10px]">
                      {order.package_list[0].package_number}
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {/* Recipient */}
          <div className="col-span-1 bg-white p-3 flex flex-col items-center justify-center text-xs border-l">
            {idx === 0 && order.recipient_address && (
              <>
                <p className="font-medium text-slate-700">
                  {maskName(order.recipient_address.name)}
                </p>
                <p className="text-slate-500 mt-1">
                  {order.recipient_address.state || order.recipient_address.city}
                </p>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="col-span-1 bg-white p-3 flex items-center justify-center border-l">
            {idx === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewDetail(order)}
                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              >
                <Eye className="h-4 w-4 mr-1" />
                Chi tiết
              </Button>
            )}
          </div>
        </div>
      ))}

      {/* If no items */}
      {items.length === 0 && (
        <div className="grid grid-cols-12 gap-px bg-slate-100">
          <div className="col-span-11 bg-white p-4 text-center text-sm text-slate-400">
            Không có thông tin sản phẩm
          </div>
          <div className="col-span-1 bg-white p-3 flex items-center justify-center border-l">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewDetail(order)}
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            >
              <Eye className="h-4 w-4 mr-1" />
              Chi tiết
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersPanel;

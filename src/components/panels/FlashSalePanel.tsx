/**
 * FlashSalePanel - Main UI component for Flash Sale management
 * Displays list of Flash Sales with filter, sort, pagination
 */

import { useState, useMemo } from 'react';
import { RefreshCw, Trash2, Eye, Plus, Clock, Flame, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/hooks/use-toast';
import { useSyncData } from '@/hooks/useSyncData';
import { useFlashSaleData } from '@/hooks/useRealtimeData';
import { supabase } from '@/lib/supabase';
import {
  FlashSale,
  FlashSaleStatus,
  FlashSaleType,
  FilterType,
  FILTER_OPTIONS,
  ITEMS_PER_PAGE,
} from '@/lib/shopee/flash-sale';
import {
  filterFlashSales,
  sortFlashSalesByPriority,
  paginateFlashSales,
  calculateTotalPages,
  getStatusColor,
  getStatusLabel,
  getTypeLabel,
  formatTimeRange,
  canDeleteFlashSale,
  getTimeSinceSync,
  getErrorMessage,
} from '@/lib/shopee/flash-sale';
import { FlashSaleDetailPanel } from './FlashSaleDetailPanel';
import { CreateFlashSalePanel } from './CreateFlashSalePanel';

interface FlashSalePanelProps {
  shopId: number;
  userId: string;
}

// Type icon component
function TypeIcon({ type }: { type: FlashSaleType }) {
  switch (type) {
    case 1:
      return <Clock className="h-4 w-4 text-blue-500" />;
    case 2:
      return <Flame className="h-4 w-4 text-orange-500" />;
    case 3:
      return <CheckCircle className="h-4 w-4 text-gray-500" />;
    default:
      return null;
  }
}

// Status badge component
function StatusBadge({ status }: { status: FlashSaleStatus }) {
  const color = getStatusColor(status);
  const label = getStatusLabel(status);

  const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    green: 'default',
    yellow: 'secondary',
    red: 'destructive',
    gray: 'outline',
  };

  return (
    <Badge variant={variantMap[color] || 'outline'}>
      {label}
    </Badge>
  );
}

export function FlashSalePanel({ shopId, userId }: FlashSalePanelProps) {
  const { toast } = useToast();

  // State
  const [filterType, setFilterType] = useState<FilterType>('0');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSale, setSelectedSale] = useState<FlashSale | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // View state: 'list' | 'detail' | 'create'
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list');
  const [detailSale, setDetailSale] = useState<FlashSale | null>(null);

  // Hooks
  const { isSyncing, triggerSync, lastSyncedAt, isStale } = useSyncData({
    shopId,
    userId,
    autoSyncOnMount: true,
    syncType: 'flash_sales',
  });

  const { data: flashSales, loading, refetch } = useFlashSaleData(shopId, userId);

  // Process data: filter, sort, paginate
  const processedData = useMemo(() => {
    // Cast to FlashSale type
    const typedSales = flashSales as unknown as FlashSale[];

    // Filter
    const filtered = filterFlashSales(typedSales, filterType);

    // Sort by priority
    const sorted = sortFlashSalesByPriority(filtered);

    // Calculate pagination
    const totalPages = calculateTotalPages(sorted.length, ITEMS_PER_PAGE);

    // Paginate
    const paginated = paginateFlashSales(sorted, currentPage, ITEMS_PER_PAGE);

    return {
      items: paginated,
      totalItems: sorted.length,
      totalPages,
    };
  }, [flashSales, filterType, currentPage]);

  // Reset page when filter changes
  const handleFilterChange = (value: string) => {
    setFilterType(value as FilterType);
    setCurrentPage(1);
  };

  // Handle delete
  const handleDeleteClick = (sale: FlashSale) => {
    if (!canDeleteFlashSale(sale)) {
      toast({
        title: 'Không thể xóa',
        description: 'Chỉ có thể xóa Flash Sale "Sắp tới"',
        variant: 'destructive',
      });
      return;
    }
    setSelectedSale(sale);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedSale) return;

    setIsDeleting(true);

    try {
      // Call Edge Function to delete on Shopee
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'delete-flash-sale',
          shop_id: shopId,
          flash_sale_id: selectedSale.flash_sale_id,
        },
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(getErrorMessage(data.error));
      }

      // Delete from local database
      await supabase
        .from('apishopee_flash_sale_data')
        .delete()
        .eq('id', selectedSale.id);

      toast({
        title: 'Thành công',
        description: 'Đã xóa Flash Sale',
      });

      // Refetch data
      refetch();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setSelectedSale(null);
    }
  };

  // Handle view detail
  const handleViewDetail = (sale: FlashSale) => {
    setDetailSale(sale);
    setView('detail');
  };

  // Handle back to list
  const handleBackToList = () => {
    setView('list');
    setDetailSale(null);
    refetch();
  };

  // Handle create new
  const handleCreateNew = () => {
    setView('create');
  };

  // Handle created
  const handleCreated = () => {
    setView('list');
    refetch();
  };

  // Render detail view
  if (view === 'detail' && detailSale) {
    return (
      <FlashSaleDetailPanel
        shopId={shopId}
        flashSale={detailSale}
        onBack={handleBackToList}
      />
    );
  }

  // Render create view
  if (view === 'create') {
    return (
      <CreateFlashSalePanel
        shopId={shopId}
        userId={userId}
        onBack={handleBackToList}
        onCreated={handleCreated}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-xl">Flash Sale</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {lastSyncedAt ? (
              <>
                Cập nhật: {getTimeSinceSync(lastSyncedAt)}
                {isStale && <span className="text-yellow-500 ml-2">(Dữ liệu cũ)</span>}
              </>
            ) : (
              'Chưa đồng bộ'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => triggerSync()} disabled={isSyncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ'}
          </Button>
          <Button size="sm" onClick={handleCreateNew}>
            <Plus className="h-4 w-4 mr-2" />
            Tạo mới
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {/* Filter */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Lọc:</span>
            <Select value={filterType} onValueChange={handleFilterChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground">
            Tổng: {processedData.totalItems} Flash Sales
          </span>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-8 w-8" />
          </div>
        )}

        {/* Empty state */}
        {!loading && processedData.items.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            {flashSales.length === 0
              ? 'Chưa có Flash Sale nào. Nhấn "Đồng bộ" để lấy dữ liệu từ Shopee.'
              : 'Không có Flash Sale nào phù hợp với bộ lọc.'}
          </div>
        )}

        {/* Flash Sale list */}
        {!loading && processedData.items.length > 0 && (
          <div className="space-y-3">
            {processedData.items.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <TypeIcon type={sale.type} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">#{sale.flash_sale_id}</span>
                      <StatusBadge status={sale.status} />
                      <Badge variant="outline">{getTypeLabel(sale.type)}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {formatTimeRange(sale.start_time, sale.end_time)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right text-sm">
                    <div>{sale.enabled_item_count}/{sale.item_count} sản phẩm</div>
                    <div className="text-muted-foreground">
                      {sale.click_count} clicks • {sale.remindme_count} reminders
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Xem chi tiết"
                      onClick={() => handleViewDetail(sale)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Xóa"
                      onClick={() => handleDeleteClick(sale)}
                      disabled={!canDeleteFlashSale(sale)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {processedData.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Trước
            </Button>
            <span className="text-sm text-muted-foreground">
              Trang {currentPage} / {processedData.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(processedData.totalPages, p + 1))}
              disabled={currentPage === processedData.totalPages}
            >
              Sau
            </Button>
          </div>
        )}
      </CardContent>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa Flash Sale</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa Flash Sale #{selectedSale?.flash_sale_id}?
              <br />
              Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={isDeleting}>
              {isDeleting ? 'Đang xóa...' : 'Xóa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default FlashSalePanel;

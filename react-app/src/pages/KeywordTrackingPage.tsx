/**
 * Keyword Tracking Page - Theo dõi volume từ khóa
 */

import { useState, useEffect, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/ui/data-table';

interface VolumeHistoryEntry {
  date: string;
  volume: number;
}

interface TrackingItem {
  id: string;
  keyword: string;
  item_id?: number;
  item_name?: string;
  latest_volume?: number;
  latest_volume_date?: string;
  created_at: string;
  volume_history?: VolumeHistoryEntry[];
}

export default function KeywordTrackingPage() {
  const { toast } = useToast();
  const { token, isAuthenticated, isLoading } = useShopeeAuth();
  
  const [trackingList, setTrackingList] = useState<TrackingItem[]>([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [refreshingVolume, setRefreshingVolume] = useState(false);

  const formatNumber = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

  useEffect(() => {
    if (isAuthenticated && token?.shop_id) {
      loadTrackingList();
    } else {
      // Clear data when shop changes or user logs out
      setTrackingList([]);
    }
  }, [isAuthenticated, token?.shop_id]);

  const loadTrackingList = async () => {
    if (!token?.shop_id) return;
    setTrackingLoading(true);
    try {
      const { data } = await supabase.functions.invoke('shopee-keyword', {
        body: { action: 'get-tracking-list', shop_id: token.shop_id },
      });
      if (data?.response) setTrackingList(data.response);
    } catch { /* ignore */ }
    finally { setTrackingLoading(false); }
  };

  const removeFromTracking = async (trackingId: string) => {
    if (!token?.shop_id) return;
    try {
      await supabase.functions.invoke('shopee-keyword', {
        body: { action: 'remove-tracking', shop_id: token.shop_id, tracking_id: trackingId },
      });
      toast({ title: 'Đã xóa khỏi theo dõi' });
      setTrackingList(prev => prev.filter(t => t.id !== trackingId));
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const refreshTrackingVolume = async () => {
    if (!token?.shop_id) return;
    setRefreshingVolume(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-keyword', {
        body: { action: 'refresh-tracking-volume', shop_id: token.shop_id },
      });
      if (error) throw error;
      toast({ title: 'Đã cập nhật', description: `${data?.response?.updated || 0}/${data?.response?.total || 0} từ khóa` });
      loadTrackingList();
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally { setRefreshingVolume(false); }
  };

  // Lấy danh sách các ngày unique từ volume_history
  const volumeDates = useMemo(() => {
    const dateSet = new Set<string>();
    trackingList.forEach(t => {
      t.volume_history?.forEach(v => dateSet.add(v.date));
    });
    return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
  }, [trackingList]);

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  };

  const trackingColumns: ColumnDef<TrackingItem>[] = useMemo(() => {
    const baseColumns: ColumnDef<TrackingItem>[] = [
      {
        accessorKey: 'keyword',
        header: 'Từ khóa',
        cell: ({ row }) => (
          <span className="text-sm font-medium text-slate-700">{row.original.keyword}</span>
        ),
      },
    ];

    const dateColumns: ColumnDef<TrackingItem>[] = volumeDates.map((date) => ({
      id: `volume_${date}`,
      header: () => (
        <div className="text-center">
          <div>Volume</div>
          <div className="text-xs text-slate-400 font-normal">({formatShortDate(date)})</div>
        </div>
      ),
      size: 100,
      cell: ({ row }) => {
        const historyEntry = row.original.volume_history?.find(v => v.date === date);
        if (!historyEntry) return <span className="text-xs text-slate-300">-</span>;
        return (
          <span className="text-sm font-semibold text-blue-600">
            {formatNumber(historyEntry.volume)}
          </span>
        );
      },
    }));

    const actionColumn: ColumnDef<TrackingItem> = {
      id: 'actions',
      header: '',
      size: 60,
      cell: ({ row }) => (
        <button
          onClick={() => removeFromTracking(row.original.id)}
          className="p-1.5 text-red-500 hover:bg-red-50 rounded"
          title="Xóa"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      ),
    };

    return [...baseColumns, ...dateColumns, actionColumn];
  }, [volumeDates]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Đang tải...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Vui lòng đăng nhập để sử dụng tính năng này</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden p-4 space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-800">Từ khóa đang theo dõi</h3>
            <p className="text-xs text-gray-500 mt-1">
              Theo dõi volume tìm kiếm của từ khóa theo thời gian. Thêm từ khóa từ trang Tra cứu từ khóa.
            </p>
          </div>
          <Button
            onClick={refreshTrackingVolume}
            disabled={refreshingVolume || trackingList.length === 0}
            variant="outline"
            className="flex items-center gap-2"
          >
            <svg className={cn("w-4 h-4", refreshingVolume && "animate-spin")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshingVolume ? 'Đang cập nhật...' : 'Cập nhật Volume'}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden flex-1">
        <DataTable
          columns={trackingColumns}
          data={trackingList}
          loading={trackingLoading}
          loadingMessage="Đang tải..."
          emptyMessage="Chưa có từ khóa nào được theo dõi. Vào trang Từ khóa để thêm."
          pageSize={20}
        />
      </div>
    </div>
  );
}

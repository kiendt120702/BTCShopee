/**
 * Time Slots Panel - Component hiển thị trong main content
 * TanStack Table
 */

import { useState, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { DataTable } from '@/components/ui/data-table';

interface TimeSlot {
  timeslot_id: number;
  start_time: number;
  end_time: number;
}

interface ApiResponse {
  error?: string;
  message?: string;
  response?: TimeSlot[] | { time_slot_id?: TimeSlot[] };
}

export default function TimeSlotsPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [endDate, setEndDate] = useState('');

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const dateToTimestamp = (dateStr: string) => {
    return Math.floor(new Date(dateStr).getTime() / 1000);
  };

  // TanStack Table columns
  const columns: ColumnDef<TimeSlot>[] = useMemo(() => [
    {
      accessorKey: 'index',
      header: '#',
      size: 50,
      cell: ({ row }) => <span className="text-slate-500">{row.index + 1}</span>,
      enableSorting: false,
    },
    {
      accessorKey: 'timeslot_id',
      header: 'Timeslot ID',
      size: 130,
      cell: ({ row }) => (
        <span className="font-mono text-sm text-slate-600 whitespace-nowrap">{row.original.timeslot_id}</span>
      ),
    },
    {
      accessorKey: 'start_time',
      header: 'Bắt đầu',
      size: 160,
      cell: ({ row }) => <span className="text-slate-700 whitespace-nowrap">{formatDate(row.original.start_time)}</span>,
      sortingFn: (rowA, rowB) => rowA.original.start_time - rowB.original.start_time,
    },
    {
      accessorKey: 'end_time',
      header: 'Kết thúc',
      size: 160,
      cell: ({ row }) => <span className="text-slate-700 whitespace-nowrap">{formatDate(row.original.end_time)}</span>,
    },
    {
      accessorKey: 'duration',
      header: 'Thời lượng',
      size: 100,
      cell: ({ row }) => (
        <span className="text-orange-500 font-medium whitespace-nowrap">{Math.round((row.original.end_time - row.original.start_time) / 60)} phút</span>
      ),
      enableSorting: false,
    },
  ], []);

  const fetchTimeSlots = async () => {
    if (!token?.shop_id) {
      toast({ title: 'Lỗi', description: 'Chưa đăng nhập Shopee.', variant: 'destructive' });
      return;
    }
    if (!endDate) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn End Time', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000) + 10;
      const { data, error } = await supabase.functions.invoke<ApiResponse>('apishopee-flash-sale', {
        body: {
          action: 'get-time-slots',
          shop_id: token.shop_id,
          start_time: now,
          end_time: dateToTimestamp(endDate),
        },
      });

      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }

      // Shopee API trả về { response: { time_slot_id: [...] } } hoặc { response: [...] }
      const responseData = data?.response;
      const timeSlotsData = Array.isArray(responseData) 
        ? responseData 
        : (responseData as { time_slot_id?: TimeSlot[] })?.time_slot_id || [];
      setTimeSlots(timeSlotsData);
      toast({ title: 'Thành công', description: `Tìm thấy ${timeSlotsData.length || 0} time slots` });
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">⏰ Time Slots - Flash Sale</h1>

      {!isAuthenticated && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <span className="text-yellow-800">⚠️ Chưa đăng nhập Shopee. Vui lòng vào mục Authentication.</span>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Start Time (Now)</label>
            <Input type="text" value={new Date().toLocaleString('vi-VN')} disabled className="bg-gray-100" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">End Time</label>
            <Input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
        </div>
        <Button onClick={fetchTimeSlots} disabled={loading || !isAuthenticated}>
          {loading ? 'Đang tải...' : '🔍 Lấy Time Slots'}
        </Button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <DataTable
          columns={columns}
          data={timeSlots}
          loading={loading}
          loadingMessage="Đang tải time slots..."
          emptyMessage="Chưa có dữ liệu. Vui lòng chọn End Time và nhấn 'Lấy Time Slots'"
          pageSize={20}
        />
      </div>
    </div>
  );
}

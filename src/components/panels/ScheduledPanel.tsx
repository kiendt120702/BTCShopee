/**
 * Scheduled Panel - Quản lý lịch hẹn giờ Flash Sale
 * Layout đồng nhất với FlashSalePanel - TanStack Table
 */

import { useState, useEffect, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { supabase, getShopUuidFromShopId } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { DataTable } from '@/components/ui/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface ScheduledItem {
  id: string;
  shop_id: number;
  source_flash_sale_id: number;
  target_timeslot_id: number;
  target_start_time: number;
  target_end_time?: number;
  scheduled_at: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result_flash_sale_id?: number;
  result_message?: string;
  created_at: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: 'Chờ chạy', color: 'bg-amber-100 text-amber-700', icon: '⏳' },
  running: { label: 'Đang chạy', color: 'bg-blue-100 text-blue-700', icon: '🔄' },
  completed: { label: 'Hoàn thành', color: 'bg-green-100 text-green-700', icon: '✅' },
  failed: { label: 'Thất bại', color: 'bg-red-100 text-red-700', icon: '❌' },
};

export default function ScheduledPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated, isLoading: authLoading } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [schedules, setSchedules] = useState<ScheduledItem[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledItem | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [saving, setSaving] = useState(false);

  // Confirm dialog state
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'run' | 'cancel' | null>(null);
  const [confirmScheduleId, setConfirmScheduleId] = useState<string | null>(null);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return date.toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  // Format khung giờ Flash Sale (start_time -> end_time)
  const formatTimeSlot = (startTs: number, endTs?: number) => {
    const startDate = new Date(startTs * 1000);
    // Nếu có end_time thì dùng, không thì mặc định +3 giờ
    const endDate = endTs ? new Date(endTs * 1000) : new Date((startTs + 3 * 60 * 60) * 1000);

    const startTime = startDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = `${String(startDate.getDate()).padStart(2, '0')}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${startDate.getFullYear()}`;

    // Format: "15:00 27-12-2025 - 17:00"
    return `${startTime} ${dateStr} - ${endTime}`;
  };

  const fetchSchedules = async (showLoading = true) => {
    if (!token?.shop_id) return;

    if (showLoading) setLoading(true);
    try {
      // Get the UUID for this shop from the numeric shop_id
      const shopUuid = await getShopUuidFromShopId(token.shop_id);
      if (!shopUuid) {
        console.error('Could not find shop UUID for shop_id:', token.shop_id);
        if (showLoading) setLoading(false);
        return;
      }

      // Load trực tiếp từ database thay vì gọi edge function
      const { data, error } = await supabase
        .from('apishopee_scheduled_flash_sales')
        .select('*')
        .eq('shop_id', shopUuid)
        .order('scheduled_at', { ascending: true });

      if (error) throw error;
      setSchedules(data || []);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!token?.shop_id) return;
    
    // Show confirm dialog
    setConfirmAction('cancel');
    setConfirmScheduleId(id);
    setConfirmDialogOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!confirmScheduleId || !confirmAction) return;

    if (confirmAction === 'cancel') {
      try {
        const { error } = await supabase.functions.invoke('apishopee-scheduler', {
          body: { action: 'cancel', shop_id: token?.shop_id, schedule_id: confirmScheduleId },
        });

        if (error) throw error;
        toast({ title: 'Thành công', description: 'Đã hủy lịch hẹn' });
        setSchedules(prev => prev.filter(s => s.id !== confirmScheduleId));
      } catch (err) {
        toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
      }
    } else if (confirmAction === 'run') {
      setProcessing(true);
      try {
        const { data, error } = await supabase.functions.invoke('apishopee-scheduler', {
          body: { action: 'force-run', schedule_id: confirmScheduleId },
        });

        if (error) throw error;
        toast({
          title: data?.success ? 'Thành công!' : 'Thất bại',
          description: data?.message || 'Đã xử lý',
          variant: data?.success ? 'default' : 'destructive',
        });
        fetchSchedules();
      } catch (err) {
        toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
      } finally {
        setProcessing(false);
      }
    }

    setConfirmDialogOpen(false);
    setConfirmAction(null);
    setConfirmScheduleId(null);
  };

  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-scheduler', {
        body: { action: 'process' },
      });

      if (error) throw error;
      toast({ title: 'Hoàn thành', description: `Đã xử lý ${data?.processed || 0} lịch hẹn` });
      fetchSchedules();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const handleForceRun = async (scheduleId: string) => {
    // Show confirm dialog
    setConfirmAction('run');
    setConfirmScheduleId(scheduleId);
    setConfirmDialogOpen(true);
  };

  const handleEditSchedule = (schedule: ScheduledItem) => {
    setEditingSchedule(schedule);
    // Parse scheduled_at to date and time
    const dt = new Date(schedule.scheduled_at);
    setEditDate(dt.toISOString().split('T')[0]); // YYYY-MM-DD
    setEditTime(dt.toTimeString().slice(0, 5)); // HH:MM
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingSchedule || !token?.shop_id || !editDate || !editTime) return;

    setSaving(true);
    try {
      const newScheduledAt = new Date(`${editDate}T${editTime}:00`);

      const { data, error } = await supabase.functions.invoke('apishopee-scheduler', {
        body: {
          action: 'update',
          shop_id: token.shop_id,
          schedule_id: editingSchedule.id,
          scheduled_at: newScheduledAt.toISOString(),
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Cập nhật thất bại');

      toast({ title: 'Thành công', description: 'Đã cập nhật thời gian chạy' });
      setEditDialogOpen(false);
      setEditingSchedule(null);

      // Update local state
      setSchedules(prev => prev.map(s =>
        s.id === editingSchedule.id
          ? { ...s, scheduled_at: newScheduledAt.toISOString() }
          : s
      ));
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchSchedules();
    }
  }, [isAuthenticated, token?.shop_id]);

  // Auto refresh (silent - không hiện loading)
  useEffect(() => {
    const interval = setInterval(() => {
      if (isAuthenticated) fetchSchedules(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const pendingCount = schedules.filter(s => s.status === 'pending').length;
  const completedCount = schedules.filter(s => s.status === 'completed').length;
  const failedCount = schedules.filter(s => s.status === 'failed').length;

  const filteredSchedules = filterStatus === 'all'
    ? schedules
    : schedules.filter(s => s.status === filterStatus);

  // TanStack Table columns
  const columns: ColumnDef<ScheduledItem>[] = useMemo(() => [
    {
      accessorKey: 'target_start_time',
      header: 'Khung giờ',
      size: 200,
      cell: ({ row }) => (
        <span className="font-medium text-slate-700 whitespace-nowrap">
          {formatTimeSlot(row.original.target_start_time, row.original.target_end_time)}
        </span>
      ),
      sortingFn: (rowA, rowB) => rowA.original.target_start_time - rowB.original.target_start_time,
    },
    {
      accessorKey: 'status',
      header: 'Trạng thái',
      size: 110,
      cell: ({ row }) => {
        const statusInfo = STATUS_MAP[row.original.status];
        return (
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${statusInfo?.color}`}>
            {statusInfo?.icon} {statusInfo?.label}
          </span>
        );
      },
    },
    {
      accessorKey: 'scheduled_at',
      header: 'Thời gian chạy',
      size: 140,
      cell: ({ row }) => (
        <span className="font-semibold text-orange-500 whitespace-nowrap">{formatDate(row.original.scheduled_at)}</span>
      ),
      sortingFn: (rowA, rowB) => new Date(rowA.original.scheduled_at).getTime() - new Date(rowB.original.scheduled_at).getTime(),
    },
    {
      id: 'actions',
      header: 'Thao tác',
      size: 200,
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        if (item.status !== 'pending') return null;
        return (
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => handleEditSchedule(item)}
              className="px-2 py-1 hover:bg-blue-100 rounded-md text-blue-600 text-xs font-medium flex items-center gap-1"
              title="Chỉnh sửa"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Sửa
            </button>
            <button
              onClick={() => handleForceRun(item.id)}
              disabled={processing}
              className="px-2 py-1 hover:bg-violet-100 rounded-md text-violet-600 text-xs font-medium flex items-center gap-1"
              title="Chạy ngay"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
              Chạy
            </button>
            <button
              onClick={() => handleCancel(item.id)}
              className="px-2 py-1 hover:bg-red-100 rounded-md text-red-500 text-xs font-medium flex items-center gap-1"
              title="Hủy"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Hủy
            </button>
          </div>
        );
      },
    },
  ], [processing]);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-500 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Lịch hẹn giờ</h2>
              <p className="text-sm text-slate-400">{schedules.length} lịch hẹn</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Stats badges */}
            <div className="hidden md:flex items-center gap-2">
              <span className="px-2 py-1 bg-amber-50 text-amber-700 text-xs rounded-full">
                ⏳ {pendingCount} chờ
              </span>
              <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded-full">
                ✅ {completedCount} xong
              </span>
              {failedCount > 0 && (
                <span className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded-full">
                  ❌ {failedCount} lỗi
                </span>
              )}
            </div>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36 bg-slate-50">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="pending">⏳ Chờ chạy</SelectItem>
                <SelectItem value="completed">✅ Hoàn thành</SelectItem>
                <SelectItem value="failed">❌ Thất bại</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => fetchSchedules()}
              disabled={loading}
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </Button>

            <Button
              className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
              onClick={handleProcessNow}
              disabled={processing || pendingCount === 0 || !isAuthenticated}
            >
              {processing ? 'Đang chạy...' : 'Chạy ngay'}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {/* Table */}
        <div className="h-full overflow-auto bg-white">
          {!isAuthenticated ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-slate-500">Vui lòng kết nối Shopee để tiếp tục</p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredSchedules}
              loading={authLoading || loading}
              loadingMessage="Đang tải..."
              emptyMessage="Chưa có lịch hẹn nào"
              pageSize={20}
            />
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa thời gian chạy</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Ngày chạy</label>
              <Input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Giờ chạy</label>
              <Input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="w-full"
              />
            </div>
            {editingSchedule && (
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <p className="text-slate-500">Flash Sale đích:</p>
                <p className="font-medium text-slate-700">{formatTimestamp(editingSchedule.target_start_time)}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving || !editDate || !editTime}
              className="bg-violet-500 hover:bg-violet-600"
            >
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === 'run' ? 'Chạy ngay lịch hẹn?' : 'Hủy lịch hẹn?'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <p className="text-sm text-slate-600">
              {confirmAction === 'run' 
                ? 'Lịch hẹn sẽ được chạy ngay lập tức, bỏ qua thời gian đã hẹn.'
                : 'Bạn có chắc muốn hủy lịch hẹn này? Hành động này không thể hoàn tác.'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Không
            </Button>
            <Button
              onClick={handleConfirmAction}
              className={confirmAction === 'run' 
                ? 'bg-violet-500 hover:bg-violet-600' 
                : 'bg-red-500 hover:bg-red-600'}
            >
              {confirmAction === 'run' ? 'Chạy ngay' : 'Hủy lịch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * CreateFlashSalePanel - Create new Flash Sale by selecting time slot
 */

import { useState, useEffect } from 'react';
import { ArrowLeft, RefreshCw, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { TimeSlot, getErrorMessage } from '@/lib/shopee/flash-sale';

interface CreateFlashSalePanelProps {
  shopId: number;
  userId: string;
  onBack: () => void;
  onCreated?: (flashSaleId: number) => void;
}

// Format timestamp to readable date/time
function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format time range
function formatTimeRange(start: number, end: number): string {
  const startDate = new Date(start * 1000);
  const endDate = new Date(end * 1000);
  
  const startStr = startDate.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  
  const endStr = endDate.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  
  return `${startStr} - ${endStr}`;
}

// Check if time slot is in the past
function isExpired(endTime: number): boolean {
  return endTime * 1000 < Date.now();
}

// Check if time slot is starting soon (within 1 hour)
function isStartingSoon(startTime: number): boolean {
  const oneHour = 60 * 60 * 1000;
  return startTime * 1000 - Date.now() < oneHour && startTime * 1000 > Date.now();
}

export function CreateFlashSalePanel({
  shopId,
  userId,
  onBack,
  onCreated,
}: CreateFlashSalePanelProps) {
  const { toast } = useToast();

  // State
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Fetch available time slots
  const fetchTimeSlots = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: apiError } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'get-time-slots',
          shop_id: shopId,
        },
      });

      if (apiError) throw apiError;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      const slots = data?.response?.time_slot_list || [];
      // Filter out expired slots and sort by start time
      const validSlots = slots
        .filter((slot: TimeSlot) => !isExpired(slot.end_time))
        .sort((a: TimeSlot, b: TimeSlot) => a.start_time - b.start_time);
      
      setTimeSlots(validSlots);
    } catch (err) {
      setError((err as Error).message);
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeSlots();
  }, [shopId]);

  // Handle create flash sale
  const handleCreate = async () => {
    if (!selectedSlot) return;

    setIsCreating(true);
    try {
      const { data, error: apiError } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'create-flash-sale',
          shop_id: shopId,
          timeslot_id: selectedSlot.timeslot_id,
          start_time: selectedSlot.start_time,
          end_time: selectedSlot.end_time,
        },
      });

      if (apiError) throw apiError;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      const flashSaleId = data?.response?.flash_sale_id;
      
      toast({
        title: 'Thành công',
        description: `Đã tạo Flash Sale #${flashSaleId}`,
      });

      // Trigger sync to update local data
      await supabase.functions.invoke('apishopee-sync-worker', {
        body: {
          action: 'sync-flash-sale-data',
          shop_id: shopId,
          user_id: userId,
        },
      });

      if (onCreated && flashSaleId) {
        onCreated(flashSaleId);
      } else {
        onBack();
      }
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
      setShowConfirmDialog(false);
      setSelectedSlot(null);
    }
  };

  // Handle slot selection
  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    setShowConfirmDialog(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle className="text-xl">Tạo Flash Sale mới</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Chọn khung giờ để tạo Flash Sale
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTimeSlots} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
      </CardHeader>

      <CardContent>
        {/* Error state */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-8 w-8" />
          </div>
        )}

        {/* Empty state */}
        {!loading && timeSlots.length === 0 && !error && (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Không có khung giờ Flash Sale nào khả dụng.</p>
            <p className="text-sm mt-2">Vui lòng thử lại sau hoặc kiểm tra điều kiện tham gia Flash Sale của shop.</p>
          </div>
        )}

        {/* Time slots grid */}
        {!loading && timeSlots.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {timeSlots.map((slot) => {
              const startingSoon = isStartingSoon(slot.start_time);
              
              return (
                <div
                  key={slot.timeslot_id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors hover:border-primary hover:bg-muted/50 ${
                    startingSoon ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950' : ''
                  }`}
                  onClick={() => handleSelectSlot(slot)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">#{slot.timeslot_id}</span>
                    {startingSoon && (
                      <Badge variant="secondary" className="text-yellow-600">
                        Sắp bắt đầu
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatTimeRange(slot.start_time, slot.end_time)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Bắt đầu: {formatDateTime(slot.start_time)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info note */}
        {!loading && timeSlots.length > 0 && (
          <Alert className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Sau khi tạo Flash Sale, bạn cần thêm sản phẩm vào để Flash Sale hoạt động.
              Mỗi Flash Sale có thể chứa tối đa 50 sản phẩm.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      {/* Confirm dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận tạo Flash Sale</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn tạo Flash Sale cho khung giờ:
              <br />
              <strong className="text-foreground">
                {selectedSlot && formatTimeRange(selectedSlot.start_time, selectedSlot.end_time)}
              </strong>
              <br />
              <br />
              Sau khi tạo, bạn sẽ cần thêm sản phẩm vào Flash Sale.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreating}>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreate} disabled={isCreating}>
              {isCreating ? 'Đang tạo...' : 'Tạo Flash Sale'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default CreateFlashSalePanel;

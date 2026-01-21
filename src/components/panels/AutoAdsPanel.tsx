/**
 * AutoAdsPanel - Quảng cáo tự động (dạng bảng đơn giản)
 * - Không có phần overview thống kê
 * - Thông tin chiến dịch hiển thị dạng bảng
 * - Không có chi tiết theo giờ
 */

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Wifi, Zap, Clock, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  createBudgetSchedule,
  listBudgetSchedules,
  type ScheduledAdsBudget,
} from '@/lib/shopee/ads';
import { cn } from '@/lib/utils';
import { useAdsData, type CampaignWithPerformance } from '@/hooks/useAdsData';

// ==================== TYPES ====================

interface AutoAdsPanelProps {
  shopId: number;
  userId: string;
}

// ==================== CONSTANTS ====================

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ongoing: { label: 'Đang chạy', color: 'bg-green-100 text-green-700' },
  paused: { label: 'Tạm dừng', color: 'bg-yellow-100 text-yellow-700' },
  scheduled: { label: 'Đã lên lịch', color: 'bg-blue-100 text-blue-700' },
  ended: { label: 'Đã kết thúc', color: 'bg-gray-100 text-gray-700' },
  deleted: { label: 'Đã xóa', color: 'bg-red-100 text-red-700' },
  closed: { label: 'Đã đóng', color: 'bg-gray-100 text-gray-700' },
};

const AD_TYPE_MAP: Record<string, { label: string; color: string }> = {
  auto: { label: 'Tự động', color: 'bg-purple-100 text-purple-700' },
  manual: { label: 'Thủ công', color: 'bg-indigo-100 text-indigo-700' },
};

// ==================== HELPER FUNCTIONS ====================

const formatPrice = (p: number) => new Intl.NumberFormat('vi-VN').format(p) + 'đ';

// ==================== MAIN COMPONENT ====================

export function AutoAdsPanel({ shopId, userId }: AutoAdsPanelProps) {
  const { toast } = useToast();

  // ==================== USE REALTIME HOOK ====================
  // Memoize today's date to prevent re-renders
  const today = useMemo(() => new Date(), []);

  const {
    campaigns,
    syncStatus,
    loading: realtimeLoading,
    syncing,
    isFetching,
    error: realtimeError,
    syncFromAPI,
    lastSyncAt,
  } = useAdsData(shopId, userId, {
    dateRange: 'today',
    selectedDate: today,
    statusFilter: 'ongoing',
  });

  // State
  const [loading, setLoading] = useState(false);

  // Auto ADS dialog state
  const [showAutoAdsDialog, setShowAutoAdsDialog] = useState(false);
  const [autoAdsSelectedCampaigns, setAutoAdsSelectedCampaigns] = useState<number[]>([]);
  const [autoAdsTimeSlots, setAutoAdsTimeSlots] = useState<number[]>([]);
  const [autoAdsBudget, setAutoAdsBudget] = useState('');
  const [autoAdsDateType, setAutoAdsDateType] = useState<'daily' | 'specific'>('daily');
  const [autoAdsSpecificDates, setAutoAdsSpecificDates] = useState<string[]>([]);
  const [autoAdsProcessing, setAutoAdsProcessing] = useState<'set' | null>(null);
  const [existingSchedules, setExistingSchedules] = useState<ScheduledAdsBudget[]>([]);

  // Fetch existing schedules when dialog opens
  useEffect(() => {
    if (showAutoAdsDialog && shopId) {
      listBudgetSchedules(shopId).then((result) => {
        if (result.success && result.schedules) {
          setExistingSchedules(result.schedules);
        }
      });
    }
  }, [showAutoAdsDialog, shopId]);

  // Show realtime error
  useEffect(() => {
    if (realtimeError) {
      console.warn('[AutoAdsPanel] Realtime error (non-critical):', realtimeError);
    }
  }, [realtimeError]);

  // Sync từ Shopee API (manual trigger)
  const handleSyncFromAPI = async () => {
    if (syncing || loading) return;

    setLoading(true);
    try {
      const result = await syncFromAPI();

      if (result.success) {
        toast({
          title: 'Thành công',
          description: result.message
        });
      } else {
        toast({
          title: 'Lỗi',
          description: result.message,
          variant: 'destructive'
        });
      }
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ==================== AUTO ADS HANDLER ====================

  const handleAutoAds = async () => {
    // Validation
    if (autoAdsSelectedCampaigns.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn ít nhất 1 chiến dịch', variant: 'destructive' });
      return;
    }

    if (autoAdsTimeSlots.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn khung thời gian', variant: 'destructive' });
      return;
    }

    const budget = parseFloat(autoAdsBudget.replace(/\./g, ''));
    if (isNaN(budget) || budget < 100000) {
      toast({ title: 'Lỗi', description: 'Ngân sách tối thiểu là 100.000đ', variant: 'destructive' });
      return;
    }

    if (autoAdsDateType === 'specific' && autoAdsSpecificDates.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn ít nhất 1 ngày cụ thể', variant: 'destructive' });
      return;
    }

    setAutoAdsProcessing('set');

    try {
      const slot = autoAdsTimeSlots[0];
      const hour = Math.floor(slot / 2);
      const minute = (slot % 2) * 30;

      let daysOfWeek: number[] | null = null;
      let specificDates: string[] | null = null;

      switch (autoAdsDateType) {
        case 'daily':
          daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
          break;
        case 'specific':
          specificDates = autoAdsSpecificDates;
          break;
      }

      const results: { campaignId: number; success: boolean; error?: string }[] = [];

      for (const campaignId of autoAdsSelectedCampaigns) {
        const campaign = campaigns.find(c => c.campaign_id === campaignId);
        if (!campaign) continue;

        const adType = campaign.ad_type as 'auto' | 'manual';

        try {
          const result = await createBudgetSchedule({
            shop_id: shopId,
            campaign_id: campaignId,
            campaign_name: campaign.name || '',
            ad_type: adType,
            hour_start: hour,
            hour_end: hour + 1,
            minute_start: minute,
            minute_end: minute,
            budget: budget,
            days_of_week: daysOfWeek || undefined,
            specific_dates: specificDates || undefined,
          });

          if (result.success) {
            results.push({ campaignId, success: true });
          } else {
            results.push({ campaignId, success: false, error: result.error });
          }
        } catch (err) {
          results.push({ campaignId, success: false, error: (err as Error).message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      const timeLabel = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const dateLabel = autoAdsDateType === 'daily'
        ? 'hàng ngày'
        : `${autoAdsSpecificDates.length} ngày cụ thể`;

      if (successCount > 0 && failCount === 0) {
        toast({
          title: 'Đã lên lịch thành công',
          description: `${successCount} chiến dịch sẽ đặt ngân sách ${new Intl.NumberFormat('vi-VN').format(budget)}đ vào ${timeLabel} ${dateLabel}`,
        });
      } else if (successCount > 0 && failCount > 0) {
        toast({
          title: 'Hoàn thành một phần',
          description: `Đã lên lịch: ${successCount}, Thất bại: ${failCount}`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Lỗi',
          description: `Không thể tạo lịch. ${results[0]?.error || ''}`,
          variant: 'destructive',
        });
      }

      if (successCount > 0) {
        const refreshResult = await listBudgetSchedules(shopId);
        if (refreshResult.success && refreshResult.schedules) {
          setExistingSchedules(refreshResult.schedules);
        }
        setShowAutoAdsDialog(false);
        setAutoAdsSelectedCampaigns([]);
        setAutoAdsTimeSlots([]);
        setAutoAdsBudget('');
        setAutoAdsDateType('daily');
        setAutoAdsSpecificDates([]);
      }
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setAutoAdsProcessing(null);
    }
  };

  // ==================== RENDER ====================

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Header */}
        <div className="bg-white border-b">
          {/* Action Buttons */}
          <div className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
            <div className="flex-1 flex flex-wrap items-center gap-2 md:gap-3">
              <span className="text-xs md:text-sm text-gray-600">
                Hiển thị <span className="font-semibold text-green-600">{campaigns.length}</span> chiến dịch đang chạy
              </span>
              {/* Realtime Status Indicator */}
              <div className="flex items-center gap-1.5">
                {syncing ? (
                  <div className="flex items-center gap-1 text-orange-600">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                    <span className="text-[10px] md:text-xs">Đang sync...</span>
                  </div>
                ) : isFetching ? (
                  <div className="flex items-center gap-1 text-blue-600">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <span className="text-[10px] md:text-xs">Đang cập nhật...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-green-600">
                    <Wifi className="w-3 h-3" />
                    <span className="text-[10px] md:text-xs">Realtime</span>
                  </div>
                )}
              </div>
              {lastSyncAt && (
                <span className="text-[10px] md:text-xs text-gray-400 hidden md:inline">
                  Sync lần cuối: {new Date(lastSyncAt).toLocaleTimeString('vi-VN')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <Button variant="outline" size="sm" onClick={() => setShowAutoAdsDialog(true)} disabled={loading || syncing} className="h-8 text-xs whitespace-nowrap">
                <Zap className="h-4 w-4 mr-1 md:mr-2" />
                Tự động ADS
              </Button>
              <Button variant="outline" size="sm" onClick={handleSyncFromAPI} disabled={loading || syncing} className="h-8 text-xs whitespace-nowrap">
                <RefreshCw className={cn("h-4 w-4 mr-1 md:mr-2", (loading || syncing) && "animate-spin")} />
                <span className="hidden md:inline">{syncing ? 'Đang đồng bộ...' : 'Đồng bộ từ Shopee'}</span>
                <span className="md:hidden">Sync</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Content - Bảng chiến dịch đơn giản */}
        <div className="p-4 min-h-[400px]">
          <div className="space-y-4 relative">
            {(realtimeLoading || isFetching) && campaigns.length === 0 && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-gray-600 font-medium">Đang tải dữ liệu từ DB...</p>
                </div>
              </div>
            )}
            <CampaignTable
              campaigns={campaigns}
              loading={realtimeLoading && campaigns.length === 0}
            />
          </div>
        </div>

        {/* Auto ADS Dialog */}
        <Dialog open={showAutoAdsDialog} onOpenChange={setShowAutoAdsDialog}>
          <DialogContent className="max-w-4xl w-[95vw] md:w-auto max-h-[90vh] md:max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base md:text-lg">
                <Zap className="h-4 w-4 md:h-5 md:w-5 text-orange-500" />
                Tự động ADS - Cấu hình chiến dịch
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto py-2 md:py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                {/* Cột trái: Danh sách chiến dịch đang chạy */}
                <div className="border rounded-lg p-3 md:p-4">
                  <h3 className="font-semibold text-xs md:text-sm mb-2 md:mb-3 flex items-center gap-2">
                    <Play className="h-3 w-3 md:h-4 md:w-4 text-green-500" />
                    Chiến dịch đang chạy ({campaigns.length})
                  </h3>
                  <div className="space-y-1.5 md:space-y-2 max-h-[200px] md:max-h-[400px] overflow-auto">
                    {campaigns.length === 0 ? (
                      <p className="text-xs md:text-sm text-gray-500 text-center py-4">
                        Không có chiến dịch nào đang chạy
                      </p>
                    ) : (
                      campaigns.map((campaign) => (
                        <label
                          key={campaign.campaign_id}
                          className={cn(
                            "flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg border cursor-pointer transition-all",
                            autoAdsSelectedCampaigns.includes(campaign.campaign_id)
                              ? "border-orange-500 bg-orange-50"
                              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={autoAdsSelectedCampaigns.includes(campaign.campaign_id)}
                            onChange={() => {
                              setAutoAdsSelectedCampaigns(prev =>
                                prev.includes(campaign.campaign_id)
                                  ? prev.filter(id => id !== campaign.campaign_id)
                                  : [...prev, campaign.campaign_id]
                              );
                            }}
                            className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs md:text-sm font-medium truncate">{campaign.name}</p>
                            <div className="flex items-center gap-1.5 md:gap-2 mt-1 flex-wrap">
                              <span className={cn(
                                "text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full",
                                AD_TYPE_MAP[campaign.ad_type]?.color || 'bg-gray-100 text-gray-600'
                              )}>
                                {AD_TYPE_MAP[campaign.ad_type]?.label || campaign.ad_type}
                              </span>
                              {campaign.performance && (
                                <span className="text-[10px] md:text-xs text-gray-500">
                                  ROAS: {campaign.performance.roas?.toFixed(2) || '0.00'}
                                </span>
                              )}
                              <span className="text-[10px] md:text-xs text-orange-600 font-medium">
                                NS: {campaign.campaign_budget
                                  ? new Intl.NumberFormat('vi-VN').format(campaign.campaign_budget) + 'đ'
                                  : '--'}
                              </span>
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  {campaigns.length > 0 && (
                    <div className="mt-2 md:mt-3 pt-2 md:pt-3 border-t flex items-center justify-between">
                      <button
                        onClick={() => {
                          if (autoAdsSelectedCampaigns.length === campaigns.length) {
                            setAutoAdsSelectedCampaigns([]);
                          } else {
                            setAutoAdsSelectedCampaigns(campaigns.map(c => c.campaign_id));
                          }
                        }}
                        className="text-[10px] md:text-xs text-orange-600 hover:text-orange-700 font-medium"
                      >
                        {autoAdsSelectedCampaigns.length === campaigns.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                      </button>
                      <span className="text-[10px] md:text-xs text-gray-500">
                        Đã chọn: {autoAdsSelectedCampaigns.length}/{campaigns.length}
                      </span>
                    </div>
                  )}
                </div>

                {/* Cột phải: Khung thời gian */}
                <div className="border rounded-lg p-3 md:p-4">
                  {/* Dropdown chọn ngày */}
                  <div className="mb-3 md:mb-4">
                    <label className="text-[10px] md:text-xs font-medium text-gray-700 mb-1.5 md:mb-2 block">Chọn ngày áp dụng</label>
                    <select
                      value={autoAdsDateType}
                      onChange={(e) => {
                        setAutoAdsDateType(e.target.value as 'daily' | 'specific');
                        if (e.target.value !== 'specific') {
                          setAutoAdsSpecificDates([]);
                        }
                      }}
                      className="w-full px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="daily">Hàng ngày</option>
                      <option value="specific">Ngày cụ thể</option>
                    </select>
                  </div>

                  {/* Bảng chọn ngày cụ thể */}
                  {autoAdsDateType === 'specific' && (
                    <div className="mb-3 md:mb-4 p-2 md:p-3 bg-gray-50 rounded-lg">
                      <p className="text-[10px] md:text-xs text-gray-600 mb-2">Chọn các ngày:</p>
                      <div className="grid grid-cols-7 gap-0.5 md:gap-1">
                        {Array.from({ length: 14 }, (_, i) => {
                          const date = new Date();
                          date.setDate(date.getDate() + i);
                          const dateStr = date.toISOString().split('T')[0];
                          const dayOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()];
                          const isSelected = autoAdsSpecificDates.includes(dateStr);
                          return (
                            <button
                              key={dateStr}
                              onClick={() => {
                                setAutoAdsSpecificDates(prev =>
                                  prev.includes(dateStr)
                                    ? prev.filter(d => d !== dateStr)
                                    : [...prev, dateStr].sort()
                                );
                              }}
                              className={cn(
                                "p-1 md:p-1.5 rounded text-[8px] md:text-[10px] font-medium transition-all flex flex-col items-center",
                                isSelected
                                  ? "bg-blue-500 text-white"
                                  : "bg-white border border-gray-200 hover:border-blue-300 text-gray-600"
                              )}
                            >
                              <span className="text-[6px] md:text-[8px] opacity-70">{dayOfWeek}</span>
                              <span>{date.getDate()}/{date.getMonth() + 1}</span>
                            </button>
                          );
                        })}
                      </div>
                      {autoAdsSpecificDates.length > 0 && (
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[10px] md:text-xs text-gray-500">
                            Đã chọn: {autoAdsSpecificDates.length} ngày
                          </span>
                          <button
                            onClick={() => setAutoAdsSpecificDates([])}
                            className="text-[10px] md:text-xs text-red-500 hover:text-red-600"
                          >
                            Xóa tất cả
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <h3 className="font-semibold text-xs md:text-sm mb-2 md:mb-3 flex items-center gap-2">
                    <Clock className="h-3 w-3 md:h-4 md:w-4 text-blue-500" />
                    Khung thời gian chạy ADS
                  </h3>
                  <p className="text-[10px] md:text-xs text-gray-500 mb-2 md:mb-3">
                    Chọn khung giờ áp dụng <span className="text-orange-500">(● = đã có lịch)</span>
                  </p>
                  <div className="grid grid-cols-4 md:grid-cols-8 gap-1 md:gap-1.5 max-h-[180px] md:max-h-[280px] overflow-auto">
                    {Array.from({ length: 48 }, (_, slot) => {
                      const hour = Math.floor(slot / 2);
                      const minute = (slot % 2) * 30;
                      const timeLabel = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                      const isSelected = autoAdsTimeSlots[0] === slot;

                      const schedulesForSlot = existingSchedules.filter(s =>
                        s.hour_start === hour && (s.minute_start || 0) === minute
                      );
                      const hasSchedule = schedulesForSlot.length > 0;
                      const scheduleInfo = hasSchedule
                        ? schedulesForSlot.map(s => `${s.campaign_name || 'Campaign'}: ${new Intl.NumberFormat('vi-VN').format(s.budget)}đ`).join('\n')
                        : '';

                      return (
                        <button
                          key={slot}
                          onClick={() => {
                            if (hasSchedule) return;
                            setAutoAdsTimeSlots(isSelected ? [] : [slot]);
                          }}
                          disabled={hasSchedule}
                          title={hasSchedule ? `Đã có lịch:\n${scheduleInfo}` : timeLabel}
                          className={cn(
                            "p-1 md:p-1.5 rounded-lg border text-[9px] md:text-[10px] font-medium transition-all relative",
                            isSelected
                              ? "bg-blue-500 text-white border-blue-500 shadow-md"
                              : hasSchedule
                                ? "bg-orange-100 text-orange-400 border-orange-200 cursor-not-allowed opacity-70"
                                : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                          )}
                        >
                          {timeLabel}
                          {hasSchedule && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-orange-500 rounded-full" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Ngân sách */}
                  <div className="mt-3 md:mt-4 pt-2 md:pt-3 border-t">
                    <label className="text-[10px] md:text-xs font-medium text-gray-700 mb-1.5 md:mb-2 block">
                      Ngân sách (VNĐ) <span className="text-gray-400 font-normal">- Tối thiểu 100.000đ</span>
                    </label>
                    <Input
                      type="text"
                      value={autoAdsBudget ? new Intl.NumberFormat('vi-VN').format(Number(autoAdsBudget.replace(/\./g, '')) || 0) : ''}
                      onChange={e => {
                        const raw = e.target.value.replace(/\./g, '').replace(/\D/g, '');
                        setAutoAdsBudget(raw);
                      }}
                      placeholder="Tối thiểu 100.000"
                      className="text-xs md:text-sm h-8 md:h-10"
                    />
                    {autoAdsBudget && parseFloat(autoAdsBudget.replace(/\./g, '')) < 100000 && (
                      <p className="text-[10px] md:text-xs text-red-500 mt-1">Ngân sách tối thiểu là 100.000đ</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="border-t pt-3 md:pt-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between w-full gap-2 md:gap-0">
                <div className="text-[10px] md:text-sm text-gray-500 order-2 md:order-1">
                  {(() => {
                    const hasCampaigns = autoAdsSelectedCampaigns.length > 0;
                    const hasTimeSlot = autoAdsTimeSlots.length === 1;
                    const budgetValue = autoAdsBudget ? parseFloat(autoAdsBudget.replace(/\./g, '')) : 0;
                    const hasBudget = budgetValue >= 100000;
                    const hasValidDates = autoAdsDateType !== 'specific' || autoAdsSpecificDates.length > 0;

                    const missing: string[] = [];
                    if (!hasCampaigns) missing.push('chiến dịch');
                    if (!hasValidDates) missing.push('ngày áp dụng');
                    if (!hasTimeSlot) missing.push('khung giờ');
                    if (!hasBudget) missing.push('ngân sách (tối thiểu 100.000đ)');

                    if (missing.length === 0) {
                      const slot = autoAdsTimeSlots[0];
                      const hour = Math.floor(slot / 2);
                      const minute = (slot % 2) * 30;
                      const timeLabel = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                      return (
                        <span className="text-green-600">
                          {autoAdsSelectedCampaigns.length} chiến dịch | {timeLabel} | {new Intl.NumberFormat('vi-VN').format(budgetValue)}đ
                        </span>
                      );
                    }
                    return (
                      <span className="text-red-500">
                        Thiếu: {missing.join(', ')}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex gap-2 order-1 md:order-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAutoAdsDialog(false);
                      setAutoAdsSelectedCampaigns([]);
                      setAutoAdsTimeSlots([]);
                      setAutoAdsBudget('');
                      setAutoAdsDateType('daily');
                      setAutoAdsSpecificDates([]);
                    }}
                    disabled={autoAdsProcessing !== null}
                    className="h-8 md:h-9 text-xs md:text-sm"
                  >
                    Hủy
                  </Button>
                  <Button
                    onClick={() => handleAutoAds()}
                    size="sm"
                    disabled={
                      autoAdsProcessing !== null ||
                      autoAdsSelectedCampaigns.length === 0 ||
                      autoAdsTimeSlots.length === 0 ||
                      !autoAdsBudget ||
                      parseFloat(autoAdsBudget.replace(/\./g, '')) < 100000 ||
                      (autoAdsDateType === 'specific' && autoAdsSpecificDates.length === 0)
                    }
                    className="bg-orange-500 hover:bg-orange-600 h-8 md:h-9 text-xs md:text-sm"
                  >
                    {autoAdsProcessing === 'set' ? (
                      <RefreshCw className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 animate-spin" />
                    ) : (
                      <Zap className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                    )}
                    Áp dụng
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ==================== SUB-COMPONENTS ====================

function CampaignTable({
  campaigns,
  loading,
}: {
  campaigns: CampaignWithPerformance[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500">Đang tải...</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="font-medium">Chưa có chiến dịch</p>
        <p className="text-sm mt-1">Nhấn "Đồng bộ từ Shopee" để tải</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* Table Header */}
      <div className="grid grid-cols-[1fr_auto_100px] gap-3 px-4 py-3 bg-gradient-to-r from-gray-50 to-gray-100/50 border-b text-xs font-semibold text-gray-600">
        <div>Tên chiến dịch</div>
        <div className="w-16 text-center">Loại</div>
        <div className="text-right">Ngân sách</div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-gray-100">
        {campaigns.map(c => {
          const adType = AD_TYPE_MAP[c.ad_type] || { label: c.ad_type, color: 'bg-gray-100 text-gray-600' };

          return (
            <div
              key={c.campaign_id}
              className="grid grid-cols-[1fr_auto_100px] gap-3 px-4 py-3.5 items-center hover:bg-orange-50/50 transition-colors cursor-pointer group"
            >
              {/* Campaign Name */}
              <div className="min-w-0">
                <p
                  className="font-medium text-sm text-gray-800 leading-snug line-clamp-2 group-hover:text-orange-700 transition-colors"
                  title={c.name || undefined}
                >
                  {c.name || `Campaign ${c.campaign_id}`}
                </p>
                {c.performance && c.performance.roas > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    ROAS: <span className="font-medium text-green-600">{c.performance.roas.toFixed(2)}</span>
                  </p>
                )}
              </div>

              {/* Ad Type Badge */}
              <div className="w-16 flex justify-center">
                <span className={cn(
                  "text-[10px] px-2 py-1 rounded-full font-medium whitespace-nowrap",
                  adType.color
                )}>
                  {adType.label}
                </span>
              </div>

              {/* Budget */}
              <div className="text-right">
                <span className="text-sm font-semibold text-orange-600">
                  {c.campaign_budget ? formatPrice(c.campaign_budget) : '-'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

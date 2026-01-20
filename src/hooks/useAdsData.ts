/**
 * useAdsData - Hook for Ads data with Realtime subscription
 * 
 * Mô hình Realtime (DB-First):
 * 1. Worker (Backend): Gọi Shopee API định kỳ (15 phút/lần)
 * 2. Supabase DB: Lưu/Cập nhật dữ liệu vào bảng (UPSERT tránh trùng)
 * 3. Supabase Realtime: Tự động bắn tín hiệu UPDATE/INSERT xuống Frontend
 * 4. Frontend: Tự cập nhật giao diện mà không cần F5
 * 
 * QUAN TRỌNG: Frontend KHÔNG gọi Shopee API trực tiếp, chỉ đọc từ DB!
 */

import { useEffect, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ==================== TYPES ====================

export interface AdsCampaign {
  id: string;
  shop_id: number;
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  name: string | null;
  status: string | null;
  campaign_placement: string | null;
  bidding_method: string | null;
  campaign_budget: number;
  start_time: number | null;
  end_time: number | null;
  item_count: number;
  roas_target: number | null;
  synced_at: string;
  cached_at: string;
}

export interface AdsPerformanceDaily {
  id: string;
  shop_id: number;
  campaign_id: number;
  performance_date: string;
  impression: number;
  clicks: number;
  ctr: number;
  expense: number;
  direct_order: number;
  direct_gmv: number;
  broad_order: number;
  broad_gmv: number;
  direct_item_sold: number;
  broad_item_sold: number;
  roas: number;
  acos: number;
  synced_at: string;
}

export interface AdsPerformanceHourly {
  id: string;
  shop_id: number;
  campaign_id: number;
  performance_date: string;
  hour: number;
  impression: number;
  clicks: number;
  ctr: number;
  expense: number;
  direct_order: number;
  direct_gmv: number;
  broad_order: number;
  broad_gmv: number;
  direct_item_sold: number;
  broad_item_sold: number;
  roas: number;
  acos: number;
  synced_at: string;
}

export interface AdsSyncStatus {
  is_syncing: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  sync_progress: Record<string, unknown> | null;
  total_campaigns: number;
  ongoing_campaigns: number;
}

export interface CampaignWithPerformance extends AdsCampaign {
  performance?: {
    impression: number;
    clicks: number;
    ctr: number;
    expense: number;
    orders: number;
    gmv: number;
    roas: number;
    acos: number;
  };
  comparison?: {
    expense_change: number;
    gmv_change: number;
    roas_change: number;
    clicks_change: number;
    acos_change: number;
  };
}

export interface UseAdsDataOptions {
  dateRange?: 'today' | '7days' | '30days';
  selectedDate?: Date;
  statusFilter?: 'ongoing' | 'all';
}

export interface UseAdsDataReturn {
  // Data
  campaigns: CampaignWithPerformance[];
  allCampaigns: CampaignWithPerformance[]; // TẤT CẢ campaigns để tính tổng
  hourlyData: Record<number, AdsPerformanceHourly[]>;
  syncStatus: AdsSyncStatus | null;
  shopLevelPerformance: {
    impression: number;
    clicks: number;
    ctr: number;
    direct_order: number;
    broad_item_sold: number;
    broad_gmv: number;
    expense: number;
    broad_roas: number;
  } | null;

  // Loading states
  loading: boolean;
  syncing: boolean;
  isFetching: boolean;

  // Error
  error: string | null;

  // Actions
  refetch: () => Promise<void>;
  syncFromAPI: () => Promise<{ success: boolean; message: string }>;
  backfillFromAPI: (daysBack?: number) => Promise<{ success: boolean; message: string }>;
  loadHourlyData: (campaignId: number) => Promise<void>;

  // Metadata
  dataUpdatedAt: number | undefined;
  lastSyncAt: string | null;
}

// ==================== HELPER FUNCTIONS ====================

function formatDateForDB(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getDateRange(dateRange: 'today' | '7days' | '30days', selectedDate: Date): { startDate: string; endDate: string } {
  const endDate = new Date(selectedDate);
  let startDate = new Date(selectedDate);

  if (dateRange === '7days') {
    startDate.setDate(startDate.getDate() - 6);
  } else if (dateRange === '30days') {
    startDate.setDate(startDate.getDate() - 29);
  }

  return {
    startDate: formatDateForDB(startDate),
    endDate: formatDateForDB(endDate),
  };
}

// Lấy khoảng thời gian của kỳ trước để so sánh
function getPreviousDateRange(dateRange: 'today' | '7days' | '30days', selectedDate: Date): { startDate: string; endDate: string } {
  const currentEnd = new Date(selectedDate);
  let currentStart = new Date(selectedDate);

  if (dateRange === '7days') {
    currentStart.setDate(currentStart.getDate() - 6);
  } else if (dateRange === '30days') {
    currentStart.setDate(currentStart.getDate() - 29);
  }

  // Kỳ trước: cùng độ dài, ngay trước kỳ hiện tại
  const daysDiff = dateRange === 'today' ? 1 : dateRange === '7days' ? 7 : 30;

  const prevEnd = new Date(currentStart);
  prevEnd.setDate(prevEnd.getDate() - 1); // Ngày trước ngày bắt đầu kỳ hiện tại

  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - daysDiff + 1);

  return {
    startDate: formatDateForDB(prevStart),
    endDate: formatDateForDB(prevEnd),
  };
}

// Tính % thay đổi
function calculatePercentChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

// ==================== MAIN HOOK ====================

export function useAdsData(
  shopId: number,
  userId: string,
  options: UseAdsDataOptions = {}
): UseAdsDataReturn {
  const {
    dateRange = 'today',
    selectedDate = new Date(),
    statusFilter = 'ongoing',
  } = options;

  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<AdsSyncStatus | null>(null);
  const [hourlyData, setHourlyData] = useState<Record<number, AdsPerformanceHourly[]>>({});

  // Query keys
  const campaignsQueryKey = ['ads-campaigns', shopId, statusFilter];
  const allCampaignsQueryKey = ['ads-all-campaigns', shopId]; // Để tính tổng performance
  const performanceQueryKey = ['ads-performance', shopId, dateRange, formatDateForDB(selectedDate)];
  const prevPerformanceQueryKey = ['ads-performance-prev', shopId, dateRange, formatDateForDB(selectedDate)];

  // ==================== FETCH FUNCTIONS ====================

  // Fetch campaigns from cache (filtered by status for display)
  const fetchCampaigns = async (): Promise<AdsCampaign[]> => {
    if (!shopId || !userId) return [];

    let query = supabase
      .from('apishopee_ads_campaign_data')
      .select('*')
      .eq('shop_id', shopId)
      .order('name', { ascending: true });

    if (statusFilter === 'ongoing') {
      query = query.eq('status', 'ongoing');
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return (data as AdsCampaign[]) || [];
  };

  // Fetch ALL campaigns (không filter status) để tính tổng performance
  const fetchAllCampaigns = async (): Promise<AdsCampaign[]> => {
    if (!shopId || !userId) return [];

    const { data, error } = await supabase
      .from('apishopee_ads_campaign_data')
      .select('*')
      .eq('shop_id', shopId)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return (data as AdsCampaign[]) || [];
  };

  // Fetch daily performance from DB (fallback to empty if table doesn't exist)
  const fetchDailyPerformance = async (): Promise<AdsPerformanceDaily[]> => {
    if (!shopId || !userId) return [];

    try {
      const { startDate, endDate } = getDateRange(dateRange, selectedDate);

      const { data, error } = await supabase
        .from('apishopee_ads_performance_daily')
        .select('*')
        .eq('shop_id', shopId)
        .gte('performance_date', startDate)
        .lte('performance_date', endDate);

      if (error) {
        // Table might not exist yet, return empty
        console.warn('[useAdsData] Daily performance table not ready:', error.message);
        return [];
      }
      return (data as AdsPerformanceDaily[]) || [];
    } catch (err) {
      console.warn('[useAdsData] Error fetching daily performance:', err);
      return [];
    }
  };

  // Fetch previous period performance for comparison
  const fetchPreviousPerformance = async (): Promise<AdsPerformanceDaily[]> => {
    if (!shopId || !userId) return [];

    try {
      const { startDate, endDate } = getPreviousDateRange(dateRange, selectedDate);

      const { data, error } = await supabase
        .from('apishopee_ads_performance_daily')
        .select('*')
        .eq('shop_id', shopId)
        .gte('performance_date', startDate)
        .lte('performance_date', endDate);

      if (error) {
        console.warn('[useAdsData] Previous performance fetch error:', error.message);
        return [];
      }
      return (data as AdsPerformanceDaily[]) || [];
    } catch (err) {
      console.warn('[useAdsData] Error fetching previous performance:', err);
      return [];
    }
  };

  // Fetch sync status (fallback to null if table doesn't exist or no record)
  const fetchSyncStatus = useCallback(async () => {
    if (!shopId) return;

    try {
      const { data, error } = await supabase
        .from('apishopee_ads_sync_status')
        .select('*')
        .eq('shop_id', shopId)
        .maybeSingle(); // Use maybeSingle instead of single to avoid 406 error

      if (!error && data) {
        setSyncStatus(data as AdsSyncStatus);
      } else {
        // No record found, set default
        setSyncStatus(null);
      }
    } catch (err) {
      // Table might not exist yet, ignore
      console.warn('[useAdsData] Sync status fetch error:', err);
    }
  }, [shopId]);

  // Fetch shop-level performance (tổng tất cả ads - chính xác hơn)
  const fetchShopLevelPerformance = async () => {
    if (!shopId || !userId) return null;

    try {
      const { startDate, endDate } = getDateRange(dateRange, selectedDate);

      const { data, error } = await supabase
        .from('apishopee_ads_shop_performance_daily')
        .select('*')
        .eq('shop_id', shopId)
        .gte('performance_date', startDate)
        .lte('performance_date', endDate);

      if (error) {
        console.warn('[useAdsData] Shop-level performance table not ready:', error.message);
        return null;
      }

      if (!data || data.length === 0) return null;

      // Tổng hợp nếu có nhiều ngày
      const totals = data.reduce((acc, day) => ({
        impression: acc.impression + (day.impression || 0),
        clicks: acc.clicks + (day.clicks || 0),
        direct_order: acc.direct_order + (day.direct_order || 0),
        broad_item_sold: acc.broad_item_sold + (day.broad_item_sold || 0),
        broad_gmv: acc.broad_gmv + (day.broad_gmv || 0),
        expense: acc.expense + (day.expense || 0),
      }), { impression: 0, clicks: 0, direct_order: 0, broad_item_sold: 0, broad_gmv: 0, expense: 0 });

      const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
      const broad_roas = totals.expense > 0 ? totals.broad_gmv / totals.expense : 0;

      return {
        impression: totals.impression,
        clicks: totals.clicks,
        ctr,
        direct_order: totals.direct_order,
        broad_item_sold: totals.broad_item_sold,
        broad_gmv: totals.broad_gmv,
        expense: totals.expense,
        broad_roas,
      };
    } catch (err) {
      console.warn('[useAdsData] Error fetching shop-level performance:', err);
      return null;
    }
  };

  // ==================== REACT QUERY ====================

  // Campaigns query (filtered for display)
  const {
    data: campaignsData,
    isLoading: campaignsLoading,
    isFetching: campaignsFetching,
    error: campaignsError,
    refetch: refetchCampaigns,
    dataUpdatedAt: campaignsUpdatedAt,
  } = useQuery({
    queryKey: campaignsQueryKey,
    queryFn: fetchCampaigns,
    enabled: !!shopId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes - allow refetch after this time
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: true, // Always refetch on mount to ensure fresh data
  });

  // ALL Campaigns query (để tính tổng performance)
  const {
    data: allCampaignsData,
    refetch: refetchAllCampaigns,
  } = useQuery({
    queryKey: allCampaignsQueryKey,
    queryFn: fetchAllCampaigns,
    enabled: !!shopId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes - allow refetch after this time
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true, // Always refetch on mount to ensure fresh data
  });

  // Performance query
  const {
    data: performanceData,
    isLoading: performanceLoading,
    isFetching: performanceFetching,
    error: performanceError,
    refetch: refetchPerformance,
  } = useQuery({
    queryKey: performanceQueryKey,
    queryFn: fetchDailyPerformance,
    enabled: !!shopId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes - allow refetch after this time
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true, // Always refetch on mount to ensure fresh data
  });

  // Previous period performance query (for comparison)
  const {
    data: prevPerformanceData,
  } = useQuery({
    queryKey: prevPerformanceQueryKey,
    queryFn: fetchPreviousPerformance,
    enabled: !!shopId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes - allow refetch after this time
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true, // Always refetch on mount to ensure fresh data
  });

  // Shop-level performance query (tổng tất cả ads - chính xác hơn)
  // QUAN TRỌNG: Đây là nguồn dữ liệu chính cho Overview vì bao gồm TẤT CẢ loại ads
  const shopLevelQueryKey = ['ads-shop-level', shopId, dateRange, formatDateForDB(selectedDate)];
  const {
    data: shopLevelData,
    isLoading: shopLevelLoading,
    isFetching: shopLevelFetching,
    refetch: refetchShopLevel,
  } = useQuery({
    queryKey: shopLevelQueryKey,
    queryFn: fetchShopLevelPerformance,
    enabled: !!shopId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes - allow refetch after this time
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true, // Always refetch on mount to ensure fresh data
  });

  // ==================== COMBINE DATA ====================

  // Helper function to calculate totals from performance data
  const calculateTotals = (perfData: AdsPerformanceDaily[]) => {
    const totals = perfData.reduce(
      (acc, day) => ({
        impression: acc.impression + (day.impression || 0),
        clicks: acc.clicks + (day.clicks || 0),
        expense: acc.expense + (day.expense || 0),
        orders: acc.orders + (day.broad_order || 0),
        gmv: acc.gmv + (day.broad_gmv || 0),
      }),
      { impression: 0, clicks: 0, expense: 0, orders: 0, gmv: 0 }
    );

    const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
    const roas = totals.expense > 0 ? totals.gmv / totals.expense : 0;
    const acos = totals.gmv > 0 ? (totals.expense / totals.gmv) * 100 : 0;

    return { ...totals, ctr, roas, acos };
  };

  // Combine campaigns with performance data (cho display - chỉ ongoing)
  const campaignsWithPerformance: CampaignWithPerformance[] = (campaignsData || []).map(campaign => {
    // Filter performance for this campaign - current period
    const campPerf = (performanceData || []).filter(p => p.campaign_id === campaign.campaign_id);
    // Filter performance for this campaign - previous period
    const prevCampPerf = (prevPerformanceData || []).filter(p => p.campaign_id === campaign.campaign_id);

    if (campPerf.length === 0) {
      return campaign;
    }

    // Calculate current period totals
    const current = calculateTotals(campPerf);

    // Calculate previous period totals for comparison
    const previous = calculateTotals(prevCampPerf);

    // Calculate comparison (% change)
    const comparison = prevCampPerf.length > 0 ? {
      expense_change: calculatePercentChange(current.expense, previous.expense),
      gmv_change: calculatePercentChange(current.gmv, previous.gmv),
      roas_change: calculatePercentChange(current.roas, previous.roas),
      clicks_change: calculatePercentChange(current.clicks, previous.clicks),
      acos_change: calculatePercentChange(current.acos, previous.acos),
    } : undefined;

    return {
      ...campaign,
      performance: {
        impression: current.impression,
        clicks: current.clicks,
        ctr: current.ctr,
        expense: current.expense,
        orders: current.orders,
        gmv: current.gmv,
        roas: current.roas,
        acos: current.acos,
      },
      comparison,
    };
  });

  // Combine ALL campaigns with performance data (để tính tổng - bao gồm tất cả status)
  const allCampaignsWithPerformance: CampaignWithPerformance[] = (allCampaignsData || []).map(campaign => {
    const campPerf = (performanceData || []).filter(p => p.campaign_id === campaign.campaign_id);
    const prevCampPerf = (prevPerformanceData || []).filter(p => p.campaign_id === campaign.campaign_id);

    if (campPerf.length === 0) {
      return campaign;
    }

    const current = calculateTotals(campPerf);
    const previous = calculateTotals(prevCampPerf);

    const comparison = prevCampPerf.length > 0 ? {
      expense_change: calculatePercentChange(current.expense, previous.expense),
      gmv_change: calculatePercentChange(current.gmv, previous.gmv),
      roas_change: calculatePercentChange(current.roas, previous.roas),
      clicks_change: calculatePercentChange(current.clicks, previous.clicks),
      acos_change: calculatePercentChange(current.acos, previous.acos),
    } : undefined;

    return {
      ...campaign,
      performance: {
        impression: current.impression,
        clicks: current.clicks,
        ctr: current.ctr,
        expense: current.expense,
        orders: current.orders,
        gmv: current.gmv,
        roas: current.roas,
        acos: current.acos,
      },
      comparison,
    };
  });

  // ==================== ACTIONS ====================

  // Sync from Shopee API (realtime - chỉ hôm nay)
  const syncFromAPI = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (syncing) return { success: false, message: 'Đang đồng bộ...' };

    setSyncing(true);
    try {
      const res = await supabase.functions.invoke('apishopee-ads-sync', {
        body: { action: 'sync', shop_id: shopId },
      });

      if (res.error) throw res.error;

      const result = res.data;
      if (result.success) {
        await fetchSyncStatus();

        // Invalidate queries to trigger refetch
        queryClient.invalidateQueries({ queryKey: campaignsQueryKey });
        queryClient.invalidateQueries({ queryKey: performanceQueryKey });
        queryClient.invalidateQueries({ queryKey: prevPerformanceQueryKey });
        queryClient.invalidateQueries({ queryKey: shopLevelQueryKey }); // QUAN TRỌNG: Invalidate shop-level để overview cập nhật

        return {
          success: true,
          message: `Đã đồng bộ ${result.campaigns_synced} chiến dịch, ${result.daily_records} bản ghi daily, ${result.hourly_records} bản ghi hourly`,
        };
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (err) {
      return { success: false, message: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [shopId, syncing, fetchSyncStatus, queryClient, campaignsQueryKey, performanceQueryKey, prevPerformanceQueryKey, shopLevelQueryKey]);

  /**
   * Backfill từ Shopee API - Sync 7 ngày để cập nhật GMV attribution
   * 
   * LÝ DO CẦN BACKFILL:
   * Shopee Ads có "7-day attribution window" - đơn hàng hôm nay có thể được gán
   * cho click từ 3-7 ngày trước. Nếu chỉ sync hôm nay, GMV của các ngày cũ sẽ
   * không được cập nhật → dữ liệu không khớp với Shopee Seller Center.
   */
  const backfillFromAPI = useCallback(async (daysBack: number = 7): Promise<{ success: boolean; message: string }> => {
    if (syncing) return { success: false, message: 'Đang đồng bộ...' };

    setSyncing(true);
    try {
      const res = await supabase.functions.invoke('apishopee-ads-sync', {
        body: { action: 'backfill', shop_id: shopId, days_back: daysBack },
      });

      if (res.error) throw res.error;

      const result = res.data;
      if (result.success) {
        await fetchSyncStatus();

        // Invalidate queries to trigger refetch
        queryClient.invalidateQueries({ queryKey: campaignsQueryKey });
        queryClient.invalidateQueries({ queryKey: performanceQueryKey });
        queryClient.invalidateQueries({ queryKey: prevPerformanceQueryKey });
        queryClient.invalidateQueries({ queryKey: shopLevelQueryKey }); // QUAN TRỌNG: Invalidate shop-level để overview cập nhật

        return {
          success: true,
          message: `Backfill ${daysBack} ngày: ${result.campaigns_synced} chiến dịch, ${result.daily_records} daily, ${result.hourly_records} hourly`,
        };
      } else {
        throw new Error(result.error || 'Backfill failed');
      }
    } catch (err) {
      return { success: false, message: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [shopId, syncing, fetchSyncStatus, queryClient, campaignsQueryKey, performanceQueryKey, prevPerformanceQueryKey, shopLevelQueryKey]);

  // Load hourly data for a specific campaign
  const loadHourlyData = useCallback(async (campaignId: number) => {
    if (hourlyData[campaignId]) return; // Already loaded

    try {
      const dateStr = formatDateForDB(selectedDate);

      const { data, error } = await supabase
        .from('apishopee_ads_performance_hourly')
        .select('*')
        .eq('shop_id', shopId)
        .eq('campaign_id', campaignId)
        .eq('performance_date', dateStr)
        .order('hour', { ascending: true });

      if (error) throw error;

      // Normalize to ensure all 24 hours
      const normalizedData = Array.from({ length: 24 }, (_, hour) => {
        const existing = (data || []).find((d: AdsPerformanceHourly) => d.hour === hour);
        return existing || {
          id: `empty-${campaignId}-${hour}`,
          shop_id: shopId,
          campaign_id: campaignId,
          performance_date: dateStr,
          hour,
          impression: 0,
          clicks: 0,
          ctr: 0,
          expense: 0,
          direct_order: 0,
          direct_gmv: 0,
          broad_order: 0,
          broad_gmv: 0,
          direct_item_sold: 0,
          broad_item_sold: 0,
          roas: 0,
          acos: 0,
          synced_at: new Date().toISOString(),
        };
      });

      setHourlyData(prev => ({
        ...prev,
        [campaignId]: normalizedData as AdsPerformanceHourly[],
      }));
    } catch (err) {
      console.error('[useAdsData] Error loading hourly data:', err);
    }
  }, [shopId, selectedDate, hourlyData]);

  // Refetch all data
  const refetch = async () => {
    await Promise.all([refetchCampaigns(), refetchPerformance(), refetchShopLevel()]);
  };

  // ==================== EFFECTS ====================

  // Fetch sync status on mount
  useEffect(() => {
    if (shopId && userId) {
      fetchSyncStatus();
    }
  }, [shopId, userId, fetchSyncStatus]);

  // Clear hourly data when date changes
  useEffect(() => {
    setHourlyData({});
  }, [selectedDate, dateRange]);

  // REMOVED: Auto-sync interval - Cron job handles sync from Shopee API
  // Realtime subscription handles UI updates when DB changes

  // ==================== REALTIME SUBSCRIPTION ====================

  useEffect(() => {
    if (!shopId || !userId) return;

    // Unique channel name để tránh conflict
    const channelName = `ads_${shopId}_${userId.slice(0, 8)}`;

    const channel = supabase
      .channel(channelName)
      // Subscribe to campaigns changes
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_ads_campaign_data',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log('[useAdsData] Campaigns changed:', payload.eventType);
          // Debounce invalidation để tránh nhiều lần refetch
          queryClient.invalidateQueries({ queryKey: campaignsQueryKey });
        }
      )
      // Subscribe to daily performance changes
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_ads_performance_daily',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log('[useAdsData] Daily performance changed:', payload.eventType);
          queryClient.invalidateQueries({ queryKey: performanceQueryKey });
        }
      )
      // Subscribe to sync status changes
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_ads_sync_status',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log('[useAdsData] Sync status changed:', payload.eventType);
          if (payload.new) {
            setSyncStatus(payload.new as AdsSyncStatus);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[useAdsData] Realtime subscription active for shop', shopId);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[useAdsData] Realtime channel error');
        }
      });

    return () => {
      console.log('[useAdsData] Unsubscribing from realtime');
      supabase.removeChannel(channel);
    };
  }, [shopId, userId, queryClient, campaignsQueryKey, performanceQueryKey]);

  // ==================== RETURN ====================

  return {
    campaigns: campaignsWithPerformance,
    allCampaigns: allCampaignsWithPerformance, // TẤT CẢ campaigns để tính tổng
    hourlyData,
    syncStatus,
    shopLevelPerformance: shopLevelData || null,
    loading: (campaignsLoading || performanceLoading || shopLevelLoading) && !campaignsData,
    syncing,
    isFetching: campaignsFetching || performanceFetching || shopLevelFetching,
    error: campaignsError?.message || performanceError?.message || null,
    refetch,
    syncFromAPI,
    backfillFromAPI,
    loadHourlyData,
    dataUpdatedAt: campaignsUpdatedAt,
    lastSyncAt: syncStatus?.last_sync_at || null,
  };
}

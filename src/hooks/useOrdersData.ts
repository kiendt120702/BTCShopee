/**
 * useOrdersData - Hook for orders data with realtime subscription
 * Uses React Query for caching + Supabase realtime for instant updates
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ==================== INTERFACES ====================

export type OrderStatus =
  | 'UNPAID'
  | 'READY_TO_SHIP'
  | 'PROCESSED'
  | 'SHIPPED'
  | 'TO_CONFIRM_RECEIVE'
  | 'COMPLETED'
  | 'TO_RETURN'
  | 'IN_CANCEL'
  | 'CANCELLED'
  | 'INVOICE_PENDING'
  | 'PENDING';

export interface RecipientAddress {
  name: string;
  phone: string;
  town?: string;
  district?: string;
  city?: string;
  state?: string;
  region: string;
  zipcode?: string;
  full_address: string;
  geolocation?: { latitude: number; longitude: number };
}

export interface PackageItem {
  item_id: number;
  model_id: number;
  model_quantity: number;
  order_item_id: number;
  promotion_group_id?: number;
  product_location_id?: string;
}

export interface PackageInfo {
  package_number: string;
  logistics_status: string;
  logistics_channel_id: number;
  shipping_carrier: string;
  allow_self_design_awb?: boolean;
  item_list: PackageItem[];
  parcel_chargeable_weight_gram?: number;
  group_shipment_id?: number;
  virtual_contact_number?: string;
  package_query_number?: string;
  sorting_group?: string;
}

export interface PromotionInfo {
  promotion_type: string;
  promotion_id: number;
}

export interface OrderItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_id: number;
  model_name?: string;
  model_sku?: string;
  model_quantity_purchased: number;
  model_original_price: number;
  model_discounted_price: number;
  wholesale: boolean;
  weight?: number;
  add_on_deal?: boolean;
  main_item?: boolean;
  add_on_deal_id?: number;
  promotion_type?: string;
  promotion_id?: number;
  order_item_id: number;
  promotion_group_id?: number;
  image_info?: { image_url: string };
  product_location_id?: string[];
  is_prescription_item?: boolean;
  is_b2c_owned_item?: boolean;
  consultation_id?: string;
  promotion_list?: PromotionInfo[];
  hot_listing_item?: boolean;
}

export interface InvoiceData {
  number?: string;
  series_number?: string;
  access_key?: string;
  issue_date?: number;
  total_value?: number;
  products_total_value?: number;
  tax_code?: string;
}

export interface PaymentInfo {
  payment_method: string;
  payment_processor_register?: string;
  card_brand?: string;
  transaction_id?: string;
  payment_amount: number;
}

export interface Order {
  id: string;
  shop_id: number;
  order_sn: string;
  booking_sn?: string;
  order_status: OrderStatus;
  pending_terms?: string[];
  pending_description?: string[];
  currency: string;
  cod: boolean;
  total_amount: number;
  estimated_shipping_fee?: number;
  actual_shipping_fee?: number;
  actual_shipping_fee_confirmed?: boolean;
  reverse_shipping_fee?: number;
  order_chargeable_weight_gram?: number;
  create_time: number;
  update_time: number;
  pay_time?: number;
  ship_by_date?: number;
  pickup_done_time?: number;
  buyer_user_id?: number;
  buyer_username?: string;
  buyer_cpf_id?: string;
  region: string;
  recipient_address?: RecipientAddress;
  shipping_carrier?: string;
  checkout_shipping_carrier?: string;
  days_to_ship?: number;
  fulfillment_flag?: string;
  goods_to_declare?: boolean;
  split_up?: boolean;
  payment_method?: string;
  payment_info?: PaymentInfo[];
  item_list?: OrderItem[];
  package_list?: PackageInfo[];
  cancel_by?: string;
  cancel_reason?: string;
  buyer_cancel_reason?: string;
  message_to_seller?: string;
  note?: string;
  note_update_time?: number;
  invoice_data?: InvoiceData;
  dropshipper?: string;
  dropshipper_phone?: string;
  return_request_due_date?: number;
  edt_from?: number;
  edt_to?: number;
  advance_package?: boolean;
  is_buyer_shop_collection?: boolean;
  buyer_proof_of_collection?: string[];
  hot_listing_order?: boolean;
  prescription_images?: string[];
  prescription_check_status?: number;
  pharmacist_name?: string;
  prescription_approval_time?: number;
  prescription_rejection_time?: number;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface OrderSyncStatus {
  shop_id: number;
  is_syncing: boolean;
  is_initial_sync_done: boolean;
  last_sync_at: string | null;
  last_sync_update_time: number | null;
  total_synced: number;
  new_orders?: number;
  updated_orders?: number;
  last_error?: string | null;
  // Chunked sync state
  current_sync_month?: string | null; // "2026-01" format
  current_chunk_end?: number | null; // timestamp
  synced_months?: string[]; // List of completed months
}

export interface MonthSyncResult {
  success: boolean;
  synced_count: number;
  has_more: boolean;
  next_chunk_end?: number;
  month_completed?: boolean;
  error?: string;
}

export interface OrderStats {
  total: number;
  totalRevenue: number;
  statusCounts: Record<string, number>;
}

export interface UseOrdersDataReturn {
  orders: Order[];
  loading: boolean;
  error: string | null;
  syncStatus: OrderSyncStatus | null;
  syncing: boolean;
  refetch: () => Promise<void>;
  syncOrders: (forceInitial?: boolean) => Promise<{ success: boolean; message: string }>;
  /** Sync orders for a specific month (chunked) */
  syncMonth: (month: string, chunkEnd?: number) => Promise<MonthSyncResult>;
  /** Continue syncing current month */
  continueMonthSync: () => Promise<MonthSyncResult>;
  /** Available months to sync (last 12 months) */
  availableMonths: string[];
  dataUpdatedAt: number | undefined;
  isFetching: boolean;
  /** Load more orders */
  loadMore: () => Promise<void>;
  /** Whether more orders can be loaded */
  hasMore: boolean;
  /** Whether load more is in progress */
  loadingMore: boolean;
  /** Total count of orders in database */
  totalCount: number;
  /** Stats for all orders in database */
  stats: OrderStats;
  /** Get order by order_sn */
  getOrderBySn: (orderSn: string) => Order | undefined;
}

// Pagination constants
const INITIAL_LIMIT = 50;
const LOAD_MORE_LIMIT = 50;

// Default stats
const DEFAULT_STATS: OrderStats = {
  total: 0,
  totalRevenue: 0,
  statusCounts: {},
};

/**
 * Get start and end timestamps for a month filter
 * @param monthFilter - Month in format 'YYYY-MM' or 'ALL'
 * @returns { startTime, endTime } in unix seconds, or null if 'ALL'
 */
function getMonthTimeRange(monthFilter: string): { startTime: number; endTime: number } | null {
  if (monthFilter === 'ALL') return null;

  const [year, month] = monthFilter.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1, 0, 0, 0);
  const endDate = new Date(year, month, 0, 23, 59, 59); // Last day of month

  return {
    startTime: Math.floor(startDate.getTime() / 1000),
    endTime: Math.floor(endDate.getTime() / 1000),
  };
}

/**
 * Hook for orders data with realtime subscription
 * @param statusFilter - Optional status filter ('ALL' or specific status like 'COMPLETED')
 * @param monthFilter - Optional month filter ('ALL' or 'YYYY-MM' format)
 */
export function useOrdersData(
  shopId: number,
  userId: string,
  statusFilter: string = 'ALL',
  monthFilter: string = 'ALL'
): UseOrdersDataReturn {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<OrderSyncStatus | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<OrderStats>(DEFAULT_STATS);

  // Keep previous stats when shopId changes to prevent UI flicker
  const prevStatsRef = useRef<OrderStats>(DEFAULT_STATS);
  const prevShopIdRef = useRef(shopId);
  const prevMonthFilterRef = useRef(monthFilter);
  const prevStatusFilterRef = useRef(statusFilter);

  // Query key for orders - includes statusFilter and monthFilter for separate caching
  const queryKey = useMemo(() => ['orders', shopId, userId, statusFilter, monthFilter], [shopId, userId, statusFilter, monthFilter]);

  // Get month time range for filtering
  const monthTimeRange = useMemo(() => getMonthTimeRange(monthFilter), [monthFilter]);

  // Reset stats when filter changes to prevent showing stale data
  useEffect(() => {
    if (prevMonthFilterRef.current !== monthFilter || prevStatusFilterRef.current !== statusFilter) {
      console.log(`[useOrdersData] Filter changed, resetting stats`);
      setStats(DEFAULT_STATS);
      setTotalCount(0);
      prevMonthFilterRef.current = monthFilter;
      prevStatusFilterRef.current = statusFilter;
    }
  }, [monthFilter, statusFilter]);

  // Fetch stats for orders using database function (handles large datasets correctly)
  const fetchStats = useCallback(async (): Promise<OrderStats> => {
    if (!shopId) return DEFAULT_STATS;

    // Use RPC function to calculate stats with SQL aggregation
    const { data, error } = await supabase.rpc('get_orders_stats', {
      p_shop_id: shopId,
      p_start_time: monthTimeRange?.startTime || null,
      p_end_time: monthTimeRange?.endTime || null,
    });

    if (error) {
      console.error('[useOrdersData] Error fetching stats:', error);
      return DEFAULT_STATS;
    }

    if (!data) {
      return DEFAULT_STATS;
    }

    return {
      total: data.total || 0,
      totalRevenue: Number(data.totalRevenue) || 0,
      statusCounts: data.statusCounts || {},
    };
  }, [shopId, monthTimeRange]);

  // Fetch orders with pagination - initial load
  const fetchOrders = async (): Promise<Order[]> => {
    if (!shopId || !userId) return [];

    // Build query with optional status filter
    let query = supabase
      .from('apishopee_orders')
      .select('*')
      .eq('shop_id', shopId);

    // Apply status filter if not 'ALL'
    if (statusFilter !== 'ALL') {
      query = query.eq('order_status', statusFilter);
    }

    // Apply month filter if set
    if (monthTimeRange) {
      query = query
        .gte('create_time', monthTimeRange.startTime)
        .lte('create_time', monthTimeRange.endTime);
    }

    query = query.order('create_time', { ascending: false }).limit(INITIAL_LIMIT);

    // Fetch orders and stats in parallel
    const [ordersResult, orderStats] = await Promise.all([
      query,
      fetchStats()
    ]);

    if (ordersResult.error) throw new Error(ordersResult.error.message);

    // Cache stats
    setStats(orderStats);
    setTotalCount(orderStats.total);
    prevStatsRef.current = orderStats;

    return (ordersResult.data as Order[]) || [];
  };

  // Fetch sync status
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await supabase.functions.invoke('apishopee-orders-sync', {
        body: { action: 'status', shop_id: shopId },
      });
      if (res.data?.success) {
        setSyncStatus(res.data.status);
      }
    } catch (err) {
      console.error('[useOrdersData] Error fetching sync status:', err);
    }
  }, [shopId]);

  // Sync orders from Shopee API
  const syncOrders = useCallback(async (forceInitial = false): Promise<{ success: boolean; message: string }> => {
    if (syncing) return { success: false, message: 'Đang đồng bộ...' };

    setSyncing(true);
    try {
      const res = await supabase.functions.invoke('apishopee-orders-sync', {
        body: {
          action: 'sync',
          shop_id: shopId,
          force_initial: forceInitial,
        },
      });

      if (res.error) throw res.error;

      const result = res.data;
      if (result.success) {
        await fetchSyncStatus();
        // Invalidate cache to trigger refetch
        queryClient.invalidateQueries({ queryKey });

        const message = result.mode === 'quick'
          ? `Đã tải ${result.synced_count} đơn hàng`
          : `Mới: ${result.new_orders}, Cập nhật: ${result.updated_orders}`;
        return { success: true, message };
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (err) {
      return { success: false, message: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [shopId, syncing, fetchSyncStatus, queryClient, queryKey]);

  // Sync orders for a specific month (chunked)
  const syncMonth = useCallback(async (month: string, chunkEnd?: number): Promise<MonthSyncResult> => {
    if (syncing) return { success: false, synced_count: 0, has_more: false, error: 'Đang đồng bộ...' };

    setSyncing(true);
    try {
      const res = await supabase.functions.invoke('apishopee-orders-sync', {
        body: {
          action: 'sync-month',
          shop_id: shopId,
          month,
          chunk_end: chunkEnd,
        },
      });

      if (res.error) throw res.error;

      const result = res.data as MonthSyncResult;
      if (result.success) {
        await fetchSyncStatus();
        queryClient.invalidateQueries({ queryKey });
      }
      return result;
    } catch (err) {
      return { success: false, synced_count: 0, has_more: false, error: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [shopId, syncing, fetchSyncStatus, queryClient, queryKey]);

  // Continue syncing current month
  const continueMonthSync = useCallback(async (): Promise<MonthSyncResult> => {
    if (syncing) return { success: false, synced_count: 0, has_more: false, error: 'Đang đồng bộ...' };

    setSyncing(true);
    try {
      const res = await supabase.functions.invoke('apishopee-orders-sync', {
        body: {
          action: 'continue-month-sync',
          shop_id: shopId,
        },
      });

      if (res.error) throw res.error;

      const result = res.data as MonthSyncResult;
      if (result.success) {
        await fetchSyncStatus();
        queryClient.invalidateQueries({ queryKey });
      }
      return result;
    } catch (err) {
      return { success: false, synced_count: 0, has_more: false, error: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [shopId, syncing, fetchSyncStatus, queryClient, queryKey]);

  // Get available months (last 12 months)
  const availableMonths = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months.push(monthStr);
    }
    return months;
  }, []);

  // Use React Query for caching
  const { data, isLoading, isFetching, error, refetch: queryRefetch, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: fetchOrders,
    enabled: !!shopId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: 'always', // Always refetch on mount
    // Note: Don't use placeholderData across different filters - causes stale data
  });

  // Reset state when shopId changes
  useEffect(() => {
    if (prevShopIdRef.current !== shopId && prevShopIdRef.current !== undefined) {
      console.log(`[useOrdersData] Shop changed from ${prevShopIdRef.current} to ${shopId}, resetting state`);
      setSyncStatus(null);
      // Clear cache for old shop
      queryClient.removeQueries({
        queryKey: ['orders', prevShopIdRef.current, userId]
      });
    }
    prevShopIdRef.current = shopId;
  }, [shopId, userId, queryClient]);

  // Fetch sync status on mount and when shopId changes
  useEffect(() => {
    if (shopId && userId) {
      fetchSyncStatus();
    }
  }, [shopId, userId, fetchSyncStatus]);

  // Realtime subscription for instant UI updates
  // Debounce to prevent event storm when bulk syncing
  const pendingInvalidation = useRef<NodeJS.Timeout | null>(null);
  const eventCountRef = useRef(0);

  useEffect(() => {
    if (!shopId || !userId) return;

    const channelName = `orders_${shopId}_${userId}_${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_orders',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          eventCountRef.current++;

          // Clear existing timeout
          if (pendingInvalidation.current) {
            clearTimeout(pendingInvalidation.current);
          }

          // Debounce: wait 500ms of inactivity before invalidating
          // This coalesces many rapid INSERT events into a single refetch
          pendingInvalidation.current = setTimeout(() => {
            console.log(`[useOrdersData] Orders changed: ${payload.eventType} (${eventCountRef.current} events batched)`);
            eventCountRef.current = 0;
            queryClient.invalidateQueries({ queryKey });
          }, 500);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[useOrdersData] Realtime subscription active');
        }
      });

    return () => {
      console.log('[useOrdersData] Unsubscribing from realtime');
      if (pendingInvalidation.current) {
        clearTimeout(pendingInvalidation.current);
      }
      supabase.removeChannel(channel);
    };
  }, [shopId, userId, queryClient, queryKey]);

  // Also subscribe to sync status changes
  useEffect(() => {
    if (!shopId || !userId) return;

    const channelName = `orders_sync_status_${shopId}_${userId}_${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_orders_sync_status',
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          console.log('[useOrdersData] Sync status changed');
          fetchSyncStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shopId, userId, fetchSyncStatus]);

  const refetch = useCallback(async () => {
    const orderStats = await fetchStats();
    setStats(orderStats);
    setTotalCount(orderStats.total);
    await queryRefetch();
  }, [fetchStats, queryRefetch]);

  // Load more orders (append to existing data)
  const loadMore = useCallback(async () => {
    if (loadingMore || !data) return;

    // Calculate max count based on current filter
    const maxCount = statusFilter === 'ALL'
      ? totalCount
      : (stats.statusCounts[statusFilter] || 0);

    if (data.length >= maxCount) return;

    setLoadingMore(true);
    try {
      const offset = data.length;
      let query = supabase
        .from('apishopee_orders')
        .select('*')
        .eq('shop_id', shopId);

      // Apply status filter if not 'ALL'
      if (statusFilter !== 'ALL') {
        query = query.eq('order_status', statusFilter);
      }

      // Apply month filter if set
      if (monthTimeRange) {
        query = query
          .gte('create_time', monthTimeRange.startTime)
          .lte('create_time', monthTimeRange.endTime);
      }

      const { data: moreOrders, error: moreError } = await query
        .order('create_time', { ascending: false })
        .range(offset, offset + LOAD_MORE_LIMIT - 1);

      if (moreError) throw moreError;
      if (!moreOrders || moreOrders.length === 0) return;

      // Append to cache
      queryClient.setQueryData(queryKey, [...data, ...(moreOrders as Order[])]);
    } catch (err) {
      console.error('[useOrdersData] Error loading more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, data, totalCount, shopId, queryClient, queryKey, statusFilter, stats.statusCounts, monthTimeRange]);

  // Get order by order_sn
  const getOrderBySn = useCallback((orderSn: string): Order | undefined => {
    return data?.find(o => o.order_sn === orderSn);
  }, [data]);

  // Calculate hasMore based on current filter
  const currentMaxCount = statusFilter === 'ALL'
    ? totalCount
    : (stats.statusCounts[statusFilter] || 0);
  const hasMore = (data?.length || 0) < currentMaxCount;

  return {
    orders: data || [],
    loading: isLoading && !data,
    error: error ? (error as Error).message : null,
    syncStatus,
    syncing,
    refetch,
    syncOrders,
    syncMonth,
    continueMonthSync,
    availableMonths,
    dataUpdatedAt,
    isFetching,
    loadMore,
    hasMore,
    loadingMore,
    totalCount,
    stats: stats.total > 0 ? stats : prevStatsRef.current,
    getOrderBySn,
  };
}

/**
 * Hook to get a single order by order_sn from database
 */
export function useOrderDetail(shopId: number, orderSn: string) {
  const queryKey = ['order-detail', shopId, orderSn];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<Order | null> => {
      if (!shopId || !orderSn) return null;

      const { data, error } = await supabase
        .from('apishopee_orders')
        .select('*')
        .eq('shop_id', shopId)
        .eq('order_sn', orderSn)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data as Order;
    },
    enabled: !!shopId && !!orderSn,
    staleTime: 1 * 60 * 1000, // 1 minute
  });

  return {
    order: data,
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}

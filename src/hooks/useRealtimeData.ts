/**
 * useRealtimeData - Generic hook for realtime data subscription
 * Uses React Query for caching + Supabase realtime for updates
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface UseRealtimeDataOptions {
  orderBy?: string;
  orderAsc?: boolean;
  filter?: Record<string, unknown>;
  enabled?: boolean;
  staleTime?: number;
  /** Auto refetch interval in milliseconds. Set to false to disable. */
  refetchInterval?: number | false;
}

export interface UseRealtimeDataReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Timestamp of last successful data fetch */
  dataUpdatedAt: number | undefined;
  /** Whether a background refetch is in progress */
  isFetching: boolean;
}

export function useRealtimeData<T>(
  tableName: string,
  shopId: number,
  userId: string,
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataReturn<T> {
  const { 
    orderBy = 'created_at', 
    orderAsc = false, 
    filter,
    enabled = true,
    staleTime = 5 * 60 * 1000, // 5 minutes default
    refetchInterval = false, // Disabled by default
  } = options;

  const queryClient = useQueryClient();
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Query key for caching
  const queryKey = ['realtime', tableName, shopId, userId, orderBy, orderAsc, JSON.stringify(filter)];

  // Fetch function
  const fetchData = async (): Promise<T[]> => {
    if (!shopId || !userId) {
      return [];
    }

    // Note: RLS policy handles user access control via apishopee_shop_members
    // We only need to filter by shop_id
    let query = supabase
      .from(tableName)
      .select('*')
      .eq('shop_id', shopId);

    // Apply additional filters
    if (filterRef.current) {
      Object.entries(filterRef.current).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      });
    }

    // Apply ordering
    query = query.order(orderBy, { ascending: orderAsc });

    const { data: result, error: queryError } = await query;

    if (queryError) {
      throw new Error(queryError.message);
    }

    return (result as T[]) || [];
  };

  // Use React Query for caching
  const { data, isLoading, isFetching, error, refetch: queryRefetch, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: fetchData,
    enabled: enabled && !!shopId && !!userId,
    staleTime,
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false, // Don't refetch when tab becomes active
    refetchOnMount: false, // Don't refetch on mount if data exists in cache
    refetchInterval: refetchInterval, // Auto refetch at specified interval
    refetchIntervalInBackground: false, // Don't refetch when tab is not focused
    retry: 2, // Retry failed requests
    retryDelay: 1000, // Wait 1 second between retries
    placeholderData: (previousData) => previousData, // Keep previous data while refetching to prevent UI flicker
  });

  // Invalidate và refetch khi shopId thay đổi
  // Sử dụng queryClient.invalidateQueries thay vì queryRefetch để đảm bảo data mới được fetch
  const prevShopIdRef = useRef(shopId);
  useEffect(() => {
    if (shopId && userId && enabled) {
      // Nếu shopId thay đổi, reset cache của shop cũ và fetch data mới
      if (prevShopIdRef.current !== shopId && prevShopIdRef.current !== undefined) {
        console.log(`[useRealtimeData] Shop changed from ${prevShopIdRef.current} to ${shopId}, clearing cache and refetching`);
        // Remove cache của shop cũ
        queryClient.removeQueries({ 
          queryKey: ['realtime', tableName, prevShopIdRef.current, userId]
        });
      }
      prevShopIdRef.current = shopId;
    }
  }, [shopId, userId, enabled, tableName, queryClient]);

  // Subscribe to realtime changes - only invalidate cache, don't refetch directly
  useEffect(() => {
    if (!shopId || !userId || !enabled) return;

    const channelName = `${tableName}_${shopId}_${userId}_${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log(`[useRealtimeData] ${tableName} changed:`, payload.eventType);
          // Invalidate cache to trigger refetch
          queryClient.invalidateQueries({ queryKey: ['realtime', tableName, shopId, userId] });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[useRealtimeData] ${tableName} subscription active`);
        }
      });

    return () => {
      console.log(`[useRealtimeData] Unsubscribing from ${channelName}`);
      supabase.removeChannel(channel);
    };
  }, [tableName, shopId, userId, enabled, queryClient]);

  const refetch = async () => {
    await queryRefetch();
  };

  return {
    data: data || [],
    loading: isLoading && !data, // Only show loading if no cached data
    error: error ? (error as Error).message : null,
    refetch,
    dataUpdatedAt,
    isFetching, // Expose isFetching for background refresh indicator
  };
}

/**
 * Specialized hook for Flash Sale data
 * Data is synced by cron job every 30 minutes
 * Realtime subscription handles UI updates when DB changes
 */
export function useFlashSaleData(shopId: number, userId: string) {
  return useRealtimeData<{
    id: string;
    shop_id: number;
    user_id: string;
    flash_sale_id: number;
    timeslot_id: number;
    status: number;
    start_time: number;
    end_time: number;
    enabled_item_count: number;
    item_count: number;
    type: number;
    remindme_count: number;
    click_count: number;
    raw_response: Record<string, unknown> | null;
    synced_at: string;
    created_at: string;
    updated_at: string;
  }>('apishopee_flash_sale_data', shopId, userId, {
    orderBy: 'start_time',
    orderAsc: false,
    staleTime: 2 * 60 * 1000, // 2 minutes - allow refetch after this time
    refetchInterval: false, // Disabled - cron job handles sync
  });
}

/**
 * Review interface for useReviewsData hook
 */
export interface Review {
  id: string;
  shop_id: number;
  comment_id: number;
  order_sn: string;
  item_id: number;
  model_id: number;
  buyer_username: string;
  rating_star: number;
  comment: string;
  create_time: number;
  reply_text: string | null;
  reply_time: number | null;
  reply_hidden: boolean;
  images: string[];
  videos: { url: string }[];
  item_name: string | null;
  item_image: string | null;
  editable: boolean;
  synced_at: string;
}

export interface ReviewSyncStatus {
  is_syncing: boolean;
  is_initial_sync_done: boolean;
  last_sync_at: string | null;
  total_synced: number;
}

/** Stats for all reviews in database (not just loaded ones) */
export interface ReviewStats {
  totalCount: number;
  repliedCount: number;
  avgRating: number;
  ratingCounts: Record<number, number>;
}

export interface UseReviewsDataReturn {
  reviews: Review[];
  loading: boolean;
  error: string | null;
  syncStatus: ReviewSyncStatus | null;
  syncing: boolean;
  refetch: () => Promise<void>;
  syncReviews: (forceInitial?: boolean) => Promise<{ success: boolean; message: string }>;
  dataUpdatedAt: number | undefined;
  isFetching: boolean;
  /** Load more reviews */
  loadMore: () => Promise<void>;
  /** Whether more reviews can be loaded */
  hasMore: boolean;
  /** Whether load more is in progress */
  loadingMore: boolean;
  /** Total count of reviews in database */
  totalCount: number;
  /** Stats for all reviews in database */
  stats: ReviewStats;
}

// Pagination constants
const INITIAL_LIMIT = 100;
const LOAD_MORE_LIMIT = 50;

// Select columns for reviews query (reusable)
const REVIEW_SELECT_COLUMNS = `
  id,
  shop_id,
  comment_id,
  order_sn,
  item_id,
  model_id,
  buyer_username,
  rating_star,
  comment,
  create_time,
  reply_text,
  reply_time,
  images,
  videos,
  item_name,
  item_image,
  editable,
  synced_at
`;

/**
 * Specialized hook for Reviews data with pagination
 * - Realtime subscription for instant UI updates when DB changes
 * - Cron job handles sync from Shopee API
 * - Enriches reviews with product info
 * - Pagination: loads 100 initially, then 50 more on demand
 */
const DEFAULT_STATS: ReviewStats = {
  totalCount: 0,
  repliedCount: 0,
  avgRating: 0,
  ratingCounts: {},
};

export function useReviewsData(shopId: number, userId: string): UseReviewsDataReturn {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<ReviewSyncStatus | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<ReviewStats>(DEFAULT_STATS);
  const [productMap, setProductMap] = useState<Map<number, { item_name: string; image_url_list: string[] }>>(new Map());

  // Keep previous stats when shopId changes to prevent UI flicker
  const prevStatsRef = useRef<ReviewStats>(DEFAULT_STATS);
  const prevShopIdRef = useRef(shopId);

  // Query key for reviews
  const queryKey = ['reviews', shopId, userId];

  // Fetch stats for all reviews (total, replied, rating counts, avg)
  const fetchStats = useCallback(async (): Promise<ReviewStats> => {
    if (!shopId) return DEFAULT_STATS;

    // First, get exact count using count query
    const { count: totalCount, error: countError } = await supabase
      .from('apishopee_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);

    if (countError) {
      console.error('[useReviewsData] Error fetching count:', countError);
      return DEFAULT_STATS;
    }

    console.log('[useReviewsData] Total reviews count:', totalCount, 'for shop_id:', shopId);

    // Then fetch rating_star and reply_text for all reviews (up to 10k)
    // Use .range(0, 9999) to override Supabase's default 1000 row limit
    const { data, error } = await supabase
      .from('apishopee_reviews')
      .select('rating_star, reply_text')
      .eq('shop_id', shopId)
      .range(0, 9999);

    if (error || !data || data.length === 0) {
      console.error('[useReviewsData] Error fetching stats:', error);
      return DEFAULT_STATS;
    }

    console.log('[useReviewsData] Fetched reviews data:', data.length, 'rows');

    const repliedCount = data.filter(r => r.reply_text).length;
    const sumRating = data.reduce((acc, r) => acc + r.rating_star, 0);
    const avgRating = totalCount && totalCount > 0 ? sumRating / totalCount : 0;

    const ratingCounts: Record<number, number> = {};
    data.forEach(r => {
      ratingCounts[r.rating_star] = (ratingCounts[r.rating_star] || 0) + 1;
    });

    return { totalCount: totalCount || 0, repliedCount, avgRating, ratingCounts };
  }, [shopId]);

  // Fetch products for enrichment (cached separately)
  const fetchProducts = useCallback(async () => {
    if (!shopId) return new Map();
    const { data } = await supabase
      .from('apishopee_products')
      .select('item_id, item_name, image_url_list')
      .eq('shop_id', shopId);
    return new Map(data?.map(p => [p.item_id, p]) || []);
  }, [shopId]);

  // Enrich reviews with product info
  const enrichReviews = useCallback((reviews: Review[], products: Map<number, { item_name: string; image_url_list: string[] }>): Review[] => {
    return reviews.map(r => ({
      ...r,
      reply_hidden: false,
      item_name: products.get(r.item_id)?.item_name || r.item_name,
      item_image: products.get(r.item_id)?.image_url_list?.[0] || r.item_image,
    }));
  }, []);

  // Fetch reviews with pagination - initial load
  const fetchReviews = async (): Promise<Review[]> => {
    if (!shopId || !userId) return [];

    // Fetch reviews, products, and stats in parallel
    const [reviewsResult, products, reviewStats] = await Promise.all([
      supabase
        .from('apishopee_reviews')
        .select(REVIEW_SELECT_COLUMNS)
        .eq('shop_id', shopId)
        .order('create_time', { ascending: false })
        .limit(INITIAL_LIMIT),
      fetchProducts(),
      fetchStats()
    ]);

    if (reviewsResult.error) throw new Error(reviewsResult.error.message);
    
    // Cache products and stats
    setProductMap(products);
    setStats(reviewStats);
    setTotalCount(reviewStats.totalCount);
    prevStatsRef.current = reviewStats; // Save for next render

    if (!reviewsResult.data || reviewsResult.data.length === 0) return [];

    return enrichReviews(reviewsResult.data as Review[], products);
  };

  // Fetch sync status
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await supabase.functions.invoke('apishopee-reviews-sync', {
        body: { action: 'status', shop_id: shopId },
      });
      if (res.data?.success) {
        setSyncStatus(res.data.status);
      }
    } catch (err) {
      console.error('[useReviewsData] Error fetching sync status:', err);
    }
  }, [shopId]);

  // Sync reviews from Shopee API
  const syncReviews = useCallback(async (forceInitial = false): Promise<{ success: boolean; message: string }> => {
    if (syncing) return { success: false, message: 'Đang đồng bộ...' };
    
    setSyncing(true);
    try {
      const res = await supabase.functions.invoke('apishopee-reviews-sync', {
        body: { 
          action: 'sync', 
          shop_id: shopId, 
          user_id: userId,
          force_initial: forceInitial,
        },
      });

      if (res.error) throw res.error;

      const result = res.data;
      if (result.success) {
        await fetchSyncStatus();
        // Invalidate cache to trigger refetch
        queryClient.invalidateQueries({ queryKey });
        
        const message = result.mode === 'initial'
          ? `Đã tải ${result.total_synced} đánh giá`
          : `Mới: ${result.new_reviews}, Cập nhật: ${result.updated_reviews}`;
        return { success: true, message };
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (err) {
      return { success: false, message: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [shopId, userId, syncing, fetchSyncStatus, queryClient, queryKey]);

  // Use React Query for caching
  const { data, isLoading, isFetching, error, refetch: queryRefetch, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: fetchReviews,
    enabled: !!shopId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes - allow refetch after this time
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: 'always', // Always refetch on mount to ensure fresh data when switching shops
    placeholderData: (previousData) => previousData, // Keep previous data while refetching to prevent UI flicker
  });

  // Reset state when shopId changes
  useEffect(() => {
    if (prevShopIdRef.current !== shopId && prevShopIdRef.current !== undefined) {
      console.log(`[useReviewsData] Shop changed from ${prevShopIdRef.current} to ${shopId}, resetting state`);
      // Keep previous stats temporarily to prevent UI flicker
      // They will be updated when new data is fetched
      setSyncStatus(null);
      // Clear cache for old shop
      queryClient.removeQueries({ 
        queryKey: ['reviews', prevShopIdRef.current, userId]
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

  // REMOVED: Auto-sync interval - cron job handles this now
  // Realtime subscription handles UI updates when DB changes

  // Realtime subscription for instant UI updates
  useEffect(() => {
    if (!shopId || !userId) return;

    const channelName = `reviews_${shopId}_${userId}_${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_reviews',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log('[useReviewsData] Reviews changed:', payload.eventType);
          // Invalidate cache to trigger refetch
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[useReviewsData] Realtime subscription active');
        }
      });

    return () => {
      console.log('[useReviewsData] Unsubscribing from realtime');
      supabase.removeChannel(channel);
    };
  }, [shopId, userId, queryClient, queryKey]);

  const refetch = async () => {
    // Refetch stats and reviews
    const reviewStats = await fetchStats();
    setStats(reviewStats);
    setTotalCount(reviewStats.totalCount);
    await queryRefetch();
  };

  // Load more reviews (append to existing data)
  const loadMore = useCallback(async () => {
    if (loadingMore || !data || data.length >= totalCount) return;

    setLoadingMore(true);
    try {
      const offset = data.length;
      const { data: moreReviews, error: moreError } = await supabase
        .from('apishopee_reviews')
        .select(REVIEW_SELECT_COLUMNS)
        .eq('shop_id', shopId)
        .order('create_time', { ascending: false })
        .range(offset, offset + LOAD_MORE_LIMIT - 1);

      if (moreError) throw moreError;
      if (!moreReviews || moreReviews.length === 0) return;

      // Enrich and append to cache
      const enrichedMore = enrichReviews(moreReviews as Review[], productMap);
      queryClient.setQueryData(queryKey, [...data, ...enrichedMore]);
    } catch (err) {
      console.error('[useReviewsData] Error loading more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, data, totalCount, shopId, productMap, enrichReviews, queryClient, queryKey]);

  // Calculate hasMore
  const hasMore = (data?.length || 0) < totalCount;

  return {
    reviews: data || [],
    loading: isLoading && !data,
    error: error ? (error as Error).message : null,
    syncStatus,
    syncing,
    refetch,
    syncReviews,
    dataUpdatedAt,
    isFetching,
    loadMore,
    hasMore,
    loadingMore,
    totalCount,
    // Return previous stats if current stats are empty (during refetch)
    stats: stats.totalCount > 0 ? stats : prevStatsRef.current,
  };
}

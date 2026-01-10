/**
 * useRealtimeData - Generic hook for realtime data subscription
 * Automatically refetches data when database changes
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface UseRealtimeDataOptions {
  orderBy?: string;
  orderAsc?: boolean;
  filter?: Record<string, unknown>;
}

export interface UseRealtimeDataReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useRealtimeData<T>(
  tableName: string,
  shopId: number,
  userId: string,
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataReturn<T> {
  const { orderBy = 'created_at', orderAsc = false, filter } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch data from database
   */
  const fetchData = useCallback(async () => {
    if (!shopId || !userId) {
      setData([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from(tableName)
        .select('*')
        .eq('shop_id', shopId);

      // Apply additional filters
      if (filter) {
        Object.entries(filter).forEach(([key, value]) => {
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

      setData((result as T[]) || []);
    } catch (err) {
      const errorMessage = (err as Error).message;
      console.error(`[useRealtimeData] Error fetching ${tableName}:`, errorMessage);
      setError(errorMessage);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [tableName, shopId, userId, orderBy, orderAsc, filter]);

  /**
   * Initial fetch
   */
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Subscribe to realtime changes
   */
  useEffect(() => {
    if (!shopId || !userId) return;

    const channelName = `${tableName}_${shopId}_${userId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: tableName,
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log(`[useRealtimeData] ${tableName} changed:`, payload.eventType);
          // Refetch data on any change
          fetchData();
        }
      )
      .subscribe((status) => {
        console.log(`[useRealtimeData] ${tableName} subscription status:`, status);
      });

    return () => {
      console.log(`[useRealtimeData] Unsubscribing from ${channelName}`);
      supabase.removeChannel(channel);
    };
  }, [tableName, shopId, userId, fetchData]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Specialized hook for Flash Sale data
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
  });
}

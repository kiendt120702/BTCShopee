/**
 * useSyncData - Hook quản lý sync data từ Shopee
 * Hỗ trợ sync Flash Sales và Campaigns
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { SyncStatus, STALE_MINUTES } from '@/lib/shopee/flash-sale';
import { useToast } from '@/hooks/use-toast';

export interface UseSyncDataOptions {
  shopId: number;
  userId: string;
  autoSyncOnMount?: boolean;
  syncType: 'flash_sales' | 'campaigns';
  staleMinutes?: number;
}

export interface UseSyncDataReturn {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  isStale: boolean;
  triggerSync: () => Promise<void>;
  syncStatus: SyncStatus | null;
}

/**
 * Check if data is stale based on last sync time
 */
function isDataStale(lastSyncedAt: string | null, staleMinutes: number): boolean {
  if (!lastSyncedAt) return true;

  const lastSync = new Date(lastSyncedAt);
  const now = new Date();
  const diffMs = now.getTime() - lastSync.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  return diffMinutes > staleMinutes;
}

export function useSyncData(options: UseSyncDataOptions): UseSyncDataReturn {
  const {
    shopId,
    userId,
    autoSyncOnMount = false,
    syncType,
    staleMinutes = STALE_MINUTES,
  } = options;

  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Derived state
  const lastSyncedAt = syncType === 'flash_sales'
    ? syncStatus?.flash_sales_synced_at ?? null
    : syncStatus?.campaigns_synced_at ?? null;

  const isStale = isDataStale(lastSyncedAt, staleMinutes);

  /**
   * Fetch sync status from database
   */
  const fetchSyncStatus = useCallback(async () => {
    if (!shopId || !userId) return null;

    const { data, error } = await supabase
      .from('apishopee_sync_status')
      .select('*')
      .eq('shop_id', shopId)
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[useSyncData] Error fetching sync status:', error);
      return null;
    }

    return data as SyncStatus | null;
  }, [shopId, userId]);

  /**
   * Trigger sync with Shopee API
   */
  const triggerSync = useCallback(async () => {
    if (!shopId || !userId) {
      console.error('[useSyncData] Missing shopId or userId');
      return;
    }

    if (isSyncing) {
      console.log('[useSyncData] Already syncing, skipping...');
      return;
    }

    setIsSyncing(true);
    setLastError(null);

    try {
      const action = syncType === 'flash_sales' ? 'sync-flash-sale-data' : 'sync-campaign-data';

      const { data, error } = await supabase.functions.invoke('apishopee-sync-worker', {
        body: {
          action,
          shop_id: shopId,
          user_id: userId,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Refresh sync status
      const newStatus = await fetchSyncStatus();
      setSyncStatus(newStatus);

      toast({
        title: 'Đồng bộ thành công',
        description: `Đã đồng bộ ${data?.synced_count || 0} ${syncType === 'flash_sales' ? 'Flash Sales' : 'Campaigns'}`,
      });
    } catch (error) {
      const errorMessage = (error as Error).message;
      setLastError(errorMessage);

      toast({
        title: 'Lỗi đồng bộ',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [shopId, userId, syncType, isSyncing, fetchSyncStatus, toast]);

  /**
   * Initial fetch and auto sync
   */
  useEffect(() => {
    const init = async () => {
      const status = await fetchSyncStatus();
      setSyncStatus(status);

      // Auto sync if enabled and data is stale
      if (autoSyncOnMount) {
        const syncedAt = syncType === 'flash_sales'
          ? status?.flash_sales_synced_at
          : status?.campaigns_synced_at;

        if (!status || isDataStale(syncedAt ?? null, staleMinutes)) {
          triggerSync();
        }
      }
    };

    if (shopId && userId) {
      init();
    }
  }, [shopId, userId, autoSyncOnMount, syncType, staleMinutes, fetchSyncStatus, triggerSync]);

  /**
   * Subscribe to sync status changes
   */
  useEffect(() => {
    if (!shopId || !userId) return;

    const channel = supabase
      .channel(`sync_status_${shopId}_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_sync_status',
          filter: `shop_id=eq.${shopId}`,
        },
        async () => {
          const newStatus = await fetchSyncStatus();
          setSyncStatus(newStatus);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shopId, userId, fetchSyncStatus]);

  return {
    isSyncing,
    lastSyncedAt,
    lastError,
    isStale,
    triggerSync,
    syncStatus,
  };
}

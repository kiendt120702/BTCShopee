/**
 * Lazada Data Hooks
 * Custom hooks để lấy và quản lý data từ Lazada
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import {
  getOrdersFromDB,
  getProductsFromDB,
  getSyncStatus,
  syncOrders,
  syncProducts,
  updateProductPrice,
  updateProductStock,
  LazadaOrder,
  LazadaProduct,
} from '@/lib/lazada/client';
import { supabase } from '@/lib/supabase';
import { useEffect } from 'react';

// ==================== ORDERS ====================

export function useLazadaOrders(params: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const { currentShop } = useLazadaAuth();
  const sellerId = currentShop?.seller_id;

  const query = useQuery({
    queryKey: ['lazada-orders', sellerId, params],
    queryFn: () => getOrdersFromDB(sellerId!, params),
    enabled: !!sellerId,
    staleTime: 1000 * 60, // 1 minute
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!sellerId) return;

    const channel = supabase
      .channel(`lazada_orders_${sellerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apilazada_orders',
          filter: `seller_id=eq.${sellerId}`,
        },
        () => {
          query.refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sellerId, query]);

  return query;
}

export function useSyncLazadaOrders() {
  const { currentShop } = useLazadaAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ days = 7, status }: { days?: number; status?: string } = {}) => {
      if (!currentShop?.seller_id) throw new Error('No shop selected');
      return syncOrders(currentShop.seller_id, days, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lazada-orders'] });
      queryClient.invalidateQueries({ queryKey: ['lazada-sync-status'] });
    },
  });
}

// ==================== PRODUCTS ====================

export function useLazadaProducts(params: {
  status?: string;
  limit?: number;
  offset?: number;
  search?: string;
} = {}) {
  const { currentShop } = useLazadaAuth();
  const sellerId = currentShop?.seller_id;

  const query = useQuery({
    queryKey: ['lazada-products', sellerId, params],
    queryFn: () => getProductsFromDB(sellerId!, params),
    enabled: !!sellerId,
    staleTime: 1000 * 60, // 1 minute
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!sellerId) return;

    const channel = supabase
      .channel(`lazada_products_${sellerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apilazada_products',
          filter: `seller_id=eq.${sellerId}`,
        },
        () => {
          query.refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sellerId, query]);

  return query;
}

export function useSyncLazadaProducts() {
  const { currentShop } = useLazadaAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filter: string = 'all') => {
      if (!currentShop?.seller_id) throw new Error('No shop selected');
      return syncProducts(currentShop.seller_id, filter);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lazada-products'] });
      queryClient.invalidateQueries({ queryKey: ['lazada-sync-status'] });
    },
  });
}

export function useUpdateLazadaPrice() {
  const { currentShop } = useLazadaAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      skuId,
      price,
      specialPrice,
    }: {
      itemId: string;
      skuId: string;
      price: number;
      specialPrice?: number;
    }) => {
      if (!currentShop?.seller_id) throw new Error('No shop selected');
      return updateProductPrice(currentShop.seller_id, itemId, skuId, price, specialPrice);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lazada-products'] });
    },
  });
}

export function useUpdateLazadaStock() {
  const { currentShop } = useLazadaAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      skuId,
      quantity,
    }: {
      itemId: string;
      skuId: string;
      quantity: number;
    }) => {
      if (!currentShop?.seller_id) throw new Error('No shop selected');
      return updateProductStock(currentShop.seller_id, itemId, skuId, quantity);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lazada-products'] });
    },
  });
}

// ==================== SYNC STATUS ====================

export function useLazadaSyncStatus() {
  const { currentShop } = useLazadaAuth();
  const sellerId = currentShop?.seller_id;

  const query = useQuery({
    queryKey: ['lazada-sync-status', sellerId],
    queryFn: () => getSyncStatus(sellerId!),
    enabled: !!sellerId,
    refetchInterval: 5000, // Poll every 5 seconds when syncing
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!sellerId) return;

    const channel = supabase
      .channel(`lazada_sync_status_${sellerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apilazada_sync_status',
          filter: `seller_id=eq.${sellerId}`,
        },
        () => {
          query.refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sellerId, query]);

  return query;
}

// ==================== STATS ====================

export function useLazadaOrderStats() {
  const { currentShop } = useLazadaAuth();
  const sellerId = currentShop?.seller_id;

  return useQuery({
    queryKey: ['lazada-order-stats', sellerId],
    queryFn: async () => {
      if (!sellerId) return null;

      const { data, error } = await supabase
        .from('apilazada_orders')
        .select('status, price')
        .eq('seller_id', sellerId);

      if (error) throw error;

      const stats = {
        total: data.length,
        pending: 0,
        ready_to_ship: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0,
        returned: 0,
        total_revenue: 0,
      };

      for (const order of data) {
        const status = order.status?.toLowerCase() || 'pending';
        if (status in stats) {
          (stats as Record<string, number>)[status]++;
        }
        if (order.price && !['cancelled', 'returned'].includes(status)) {
          stats.total_revenue += Number(order.price) || 0;
        }
      }

      return stats;
    },
    enabled: !!sellerId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useLazadaProductStats() {
  const { currentShop } = useLazadaAuth();
  const sellerId = currentShop?.seller_id;

  return useQuery({
    queryKey: ['lazada-product-stats', sellerId],
    queryFn: async () => {
      if (!sellerId) return null;

      const { data, error } = await supabase
        .from('apilazada_products')
        .select('status, quantity, available')
        .eq('seller_id', sellerId);

      if (error) throw error;

      const stats = {
        total: data.length,
        active: 0,
        inactive: 0,
        deleted: 0,
        total_quantity: 0,
        total_available: 0,
        out_of_stock: 0,
      };

      for (const product of data) {
        const status = product.status?.toLowerCase() || 'active';
        if (status === 'active') stats.active++;
        else if (status === 'inactive') stats.inactive++;
        else if (status === 'deleted') stats.deleted++;

        stats.total_quantity += product.quantity || 0;
        stats.total_available += product.available || 0;
        if ((product.available || 0) === 0) stats.out_of_stock++;
      }

      return stats;
    },
    enabled: !!sellerId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * useMultiChannelStats - Hook tổng hợp dữ liệu từ tất cả channels (Shopee, Lazada)
 * Cung cấp thống kê đơn hàng, doanh thu cho trang tổng quan đa kênh
 */

import { useQuery } from '@tanstack/react-query';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { supabase } from '@/lib/supabase';

export type Platform = 'all' | 'shopee' | 'lazada';
export type DateRange = 'today' | 'yesterday' | '7days' | '30days' | 'month';

export interface ChannelStats {
  channel: 'shopee' | 'lazada';
  shopId: string | number;
  shopName: string;
  shopLogo: string | null;
  // Current period
  revenue: number;
  orders: number;
  avgOrderValue: number; // GTTB = revenue / orders
  // Change vs previous period (percentage)
  revenueChange: number | null;
  ordersChange: number | null;
  avgOrderValueChange: number | null;
  // Additional metrics (may be null if not available)
  adsSpend: number | null;
  profit: number | null;
  profitMargin: number | null; // %DT (% doanh thu)
}

export interface PlatformSummary {
  channel: 'shopee' | 'lazada' | 'total';
  revenue: number;
  orders: number;
  avgOrderValue: number;
  revenueChange: number | null;
  ordersChange: number | null;
  avgOrderValueChange: number | null;
  adsSpend: number | null;
  profit: number | null;
  profitMargin: number | null;
  shops: ChannelStats[];
}

export interface MultiChannelStatsResult {
  total: PlatformSummary;
  shopee: PlatformSummary;
  lazada: PlatformSummary;
  allShops: ChannelStats[];
}

interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Calculate time range for current and previous periods
 */
function getTimeRanges(dateRange: DateRange): { current: TimeRange; previous: TimeRange } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (dateRange) {
    case 'today': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const dayBefore = new Date(yesterday);
      dayBefore.setDate(dayBefore.getDate() - 1);
      return {
        current: { start: today, end: now },
        previous: { start: yesterday, end: today },
      };
    }
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const dayBefore = new Date(yesterday);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const twoDaysBefore = new Date(dayBefore);
      twoDaysBefore.setDate(twoDaysBefore.getDate() - 1);
      return {
        current: { start: yesterday, end: today },
        previous: { start: dayBefore, end: yesterday },
      };
    }
    case '7days': {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fourteenDaysAgo = new Date(today);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      return {
        current: { start: sevenDaysAgo, end: now },
        previous: { start: fourteenDaysAgo, end: sevenDaysAgo },
      };
    }
    case '30days': {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sixtyDaysAgo = new Date(today);
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      return {
        current: { start: thirtyDaysAgo, end: now },
        previous: { start: sixtyDaysAgo, end: thirtyDaysAgo },
      };
    }
    case 'month': {
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        current: { start: firstDayOfMonth, end: now },
        previous: { start: firstDayOfLastMonth, end: firstDayOfMonth },
      };
    }
  }
}

/**
 * Calculate percentage change
 */
function calcChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return current > 0 ? 100 : null;
  }
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Query Shopee orders stats for a shop
 */
async function getShopeeStats(
  shopId: number,
  timeRange: TimeRange
): Promise<{ revenue: number; orders: number }> {
  const startUnix = Math.floor(timeRange.start.getTime() / 1000);
  const endUnix = Math.floor(timeRange.end.getTime() / 1000);

  const { data, error } = await supabase
    .from('apishopee_orders')
    .select('total_amount, order_status')
    .eq('shop_id', shopId)
    .gte('create_time', startUnix)
    .lt('create_time', endUnix)
    .not('order_status', 'in', '("CANCELLED","TO_RETURN","IN_CANCEL")');

  if (error) {
    console.error('[MultiChannel] Shopee query error:', error);
    return { revenue: 0, orders: 0 };
  }

  const orders = data?.length || 0;
  const revenue = data?.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) || 0;

  return { revenue, orders };
}

/**
 * Query Lazada orders stats for a shop
 */
async function getLazadaStats(
  sellerId: number,
  timeRange: TimeRange
): Promise<{ revenue: number; orders: number }> {
  const startISO = timeRange.start.toISOString();
  const endISO = timeRange.end.toISOString();

  const { data, error } = await supabase
    .from('apilazada_orders')
    .select('price, status')
    .eq('seller_id', sellerId)
    .gte('created_at_lazada', startISO)
    .lt('created_at_lazada', endISO)
    .not('status', 'in', '("cancelled","returned")');

  if (error) {
    console.error('[MultiChannel] Lazada query error:', error);
    return { revenue: 0, orders: 0 };
  }

  const orders = data?.length || 0;
  const revenue = data?.reduce((sum, o) => sum + (Number(o.price) || 0), 0) || 0;

  return { revenue, orders };
}

/**
 * Main hook to get multi-channel statistics
 */
export function useMultiChannelStats(params: {
  platform?: Platform;
  shopId?: string;
  dateRange: DateRange;
}) {
  const { platform = 'all', shopId, dateRange } = params;
  const { shops: shopeeShops } = useShopeeAuth();
  const { shops: lazadaShops } = useLazadaAuth();

  return useQuery({
    queryKey: ['multi-channel-stats', platform, shopId, dateRange, shopeeShops.length, lazadaShops.length],
    queryFn: async (): Promise<MultiChannelStatsResult> => {
      const { current, previous } = getTimeRanges(dateRange);
      const allShops: ChannelStats[] = [];

      // Process Shopee shops
      if (platform === 'all' || platform === 'shopee') {
        for (const shop of shopeeShops) {
          // If specific shop is selected, filter
          if (shopId && shopId !== `shopee-${shop.shop_id}`) continue;

          const [currentStats, previousStats] = await Promise.all([
            getShopeeStats(shop.shop_id, current),
            getShopeeStats(shop.shop_id, previous),
          ]);

          const avgOrderValue = currentStats.orders > 0
            ? currentStats.revenue / currentStats.orders
            : 0;
          const prevAvgOrderValue = previousStats.orders > 0
            ? previousStats.revenue / previousStats.orders
            : 0;

          allShops.push({
            channel: 'shopee',
            shopId: shop.shop_id,
            shopName: shop.shop_name || `Shop ${shop.shop_id}`,
            shopLogo: shop.shop_logo,
            revenue: currentStats.revenue,
            orders: currentStats.orders,
            avgOrderValue,
            revenueChange: calcChange(currentStats.revenue, previousStats.revenue),
            ordersChange: calcChange(currentStats.orders, previousStats.orders),
            avgOrderValueChange: calcChange(avgOrderValue, prevAvgOrderValue),
            adsSpend: null, // TODO: Integrate ads data
            profit: null,
            profitMargin: null,
          });
        }
      }

      // Process Lazada shops
      if (platform === 'all' || platform === 'lazada') {
        for (const shop of lazadaShops) {
          // If specific shop is selected, filter
          if (shopId && shopId !== `lazada-${shop.seller_id}`) continue;

          const [currentStats, previousStats] = await Promise.all([
            getLazadaStats(shop.seller_id, current),
            getLazadaStats(shop.seller_id, previous),
          ]);

          const avgOrderValue = currentStats.orders > 0
            ? currentStats.revenue / currentStats.orders
            : 0;
          const prevAvgOrderValue = previousStats.orders > 0
            ? previousStats.revenue / previousStats.orders
            : 0;

          allShops.push({
            channel: 'lazada',
            shopId: shop.seller_id,
            shopName: shop.shop_name || `Seller ${shop.seller_id}`,
            shopLogo: shop.shop_logo,
            revenue: currentStats.revenue,
            orders: currentStats.orders,
            avgOrderValue,
            revenueChange: calcChange(currentStats.revenue, previousStats.revenue),
            ordersChange: calcChange(currentStats.orders, previousStats.orders),
            avgOrderValueChange: calcChange(avgOrderValue, prevAvgOrderValue),
            adsSpend: null,
            profit: null,
            profitMargin: null,
          });
        }
      }

      // Aggregate by platform
      const shopeeStats = allShops.filter(s => s.channel === 'shopee');
      const lazadaStats = allShops.filter(s => s.channel === 'lazada');

      const aggregatePlatform = (shops: ChannelStats[], channel: 'shopee' | 'lazada' | 'total'): PlatformSummary => {
        const revenue = shops.reduce((sum, s) => sum + s.revenue, 0);
        const orders = shops.reduce((sum, s) => sum + s.orders, 0);
        const avgOrderValue = orders > 0 ? revenue / orders : 0;

        // Calculate aggregate change by summing previous values
        const prevRevenue = shops.reduce((sum, s) => {
          if (s.revenueChange === null) return sum;
          return sum + (s.revenue / (1 + s.revenueChange / 100));
        }, 0);
        const prevOrders = shops.reduce((sum, s) => {
          if (s.ordersChange === null) return sum;
          return sum + Math.round(s.orders / (1 + s.ordersChange / 100));
        }, 0);
        const prevAvgOrderValue = prevOrders > 0 ? prevRevenue / prevOrders : 0;

        return {
          channel,
          revenue,
          orders,
          avgOrderValue,
          revenueChange: calcChange(revenue, prevRevenue),
          ordersChange: calcChange(orders, prevOrders),
          avgOrderValueChange: calcChange(avgOrderValue, prevAvgOrderValue),
          adsSpend: null,
          profit: null,
          profitMargin: null,
          shops,
        };
      };

      const shopeeSummary = aggregatePlatform(shopeeStats, 'shopee');
      const lazadaSummary = aggregatePlatform(lazadaStats, 'lazada');
      const totalSummary = aggregatePlatform(allShops, 'total');

      return {
        total: totalSummary,
        shopee: shopeeSummary,
        lazada: lazadaSummary,
        allShops,
      };
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    enabled: shopeeShops.length > 0 || lazadaShops.length > 0,
  });
}

/**
 * Get list of all shops for filter dropdown
 */
export function useAllShops() {
  const { shops: shopeeShops } = useShopeeAuth();
  const { shops: lazadaShops } = useLazadaAuth();

  const allShops = [
    ...shopeeShops.map(s => ({
      id: `shopee-${s.shop_id}`,
      name: s.shop_name || `Shop ${s.shop_id}`,
      logo: s.shop_logo,
      channel: 'shopee' as const,
    })),
    ...lazadaShops.map(s => ({
      id: `lazada-${s.seller_id}`,
      name: s.shop_name || `Seller ${s.seller_id}`,
      logo: s.shop_logo,
      channel: 'lazada' as const,
    })),
  ];

  return allShops;
}

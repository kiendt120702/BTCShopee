/**
 * Lazada Dashboard Page - Trang tổng quan Lazada
 */

import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { useLazadaOrderStats, useLazadaProductStats, useLazadaSyncStatus } from '@/hooks/useLazadaData';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertCircle,
  Store,
  ShoppingCart,
  Package,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Link } from 'react-router-dom';

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '₫0';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(value);
};

export default function LazadaDashboardPage() {
  const { shops, currentShop, isLoading } = useLazadaAuth();
  const { data: orderStats, isLoading: loadingOrders } = useLazadaOrderStats();
  const { data: productStats, isLoading: loadingProducts } = useLazadaProductStats();
  const { data: syncStatus } = useLazadaSyncStatus();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (shops.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Store className="h-16 w-16 mx-auto mb-4 text-blue-500 opacity-50" />
              <h2 className="text-xl font-semibold mb-2">Chào mừng đến với Lazada Integration</h2>
              <p className="text-muted-foreground mb-6">
                Kết nối shop Lazada của bạn để bắt đầu quản lý đơn hàng và sản phẩm
              </p>
              <Button asChild>
                <Link to="/lazada/shops">
                  <Store className="h-4 w-4 mr-2" />
                  Kết nối Shop Lazada
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Shop Info */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            {currentShop?.shop_logo ? (
              <img
                src={currentShop.shop_logo}
                alt={currentShop.shop_name || ''}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Store className="h-6 w-6 text-blue-500" />
              </div>
            )}
            <div>
              <CardTitle>{currentShop?.shop_name || `Shop ${currentShop?.seller_id}`}</CardTitle>
              <CardDescription>
                Seller ID: {currentShop?.seller_id} • Region: {currentShop?.region || 'VN'}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-blue-500 border-blue-200 bg-blue-50">
            Lazada
          </Badge>
        </CardHeader>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Orders Stats */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tổng đơn hàng</p>
                <p className="text-3xl font-bold">
                  {loadingOrders ? <Spinner className="h-6 w-6" /> : orderStats?.total || 0}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <ShoppingCart className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Chờ xử lý</p>
                <p className="text-3xl font-bold text-yellow-600">
                  {loadingOrders ? <Spinner className="h-6 w-6" /> : orderStats?.pending || 0}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center">
                <Clock className="h-6 w-6 text-yellow-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Doanh thu</p>
                <p className="text-2xl font-bold text-green-600">
                  {loadingOrders ? (
                    <Spinner className="h-6 w-6" />
                  ) : (
                    formatCurrency(orderStats?.total_revenue)
                  )}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sản phẩm</p>
                <p className="text-3xl font-bold">
                  {loadingProducts ? <Spinner className="h-6 w-6" /> : productStats?.total || 0}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                <Package className="h-6 w-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <Link to="/lazada/orders">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <ShoppingCart className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-medium">Đơn hàng</h3>
                  <p className="text-sm text-muted-foreground">Quản lý đơn hàng Lazada</p>
                </div>
                <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Link>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <Link to="/lazada/products">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Package className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <h3 className="font-medium">Sản phẩm</h3>
                  <p className="text-sm text-muted-foreground">Quản lý sản phẩm Lazada</p>
                </div>
                <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Link>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <Link to="/lazada/shops">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <Store className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <h3 className="font-medium">Quản lý Shop</h3>
                  <p className="text-sm text-muted-foreground">Kết nối và quản lý shop</p>
                </div>
                <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Link>
        </Card>
      </div>

      {/* Sync Status */}
      {syncStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trạng thái đồng bộ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Đơn hàng</p>
                  <p className="text-xs text-muted-foreground">
                    {syncStatus.orders_synced_at
                      ? `Cập nhật ${formatDistanceToNow(new Date(syncStatus.orders_synced_at), {
                          addSuffix: true,
                          locale: vi,
                        })}`
                      : 'Chưa đồng bộ'}
                  </p>
                </div>
                {syncStatus.orders_is_syncing && <Spinner className="h-4 w-4" />}
              </div>
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Sản phẩm</p>
                  <p className="text-xs text-muted-foreground">
                    {syncStatus.products_synced_at
                      ? `Cập nhật ${formatDistanceToNow(new Date(syncStatus.products_synced_at), {
                          addSuffix: true,
                          locale: vi,
                        })}`
                      : 'Chưa đồng bộ'}
                  </p>
                </div>
                {syncStatus.products_is_syncing && <Spinner className="h-4 w-4" />}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

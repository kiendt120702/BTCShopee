/**
 * Lazada Orders Page - Trang quản lý đơn hàng Lazada
 */

import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { LazadaOrdersPanel } from '@/components/lazada/LazadaOrdersPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Store } from 'lucide-react';

export default function LazadaOrdersPage() {
  const { shops, currentShop, isLoading } = useLazadaAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (shops.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Bạn chưa kết nối shop Lazada nào. Vui lòng vào{' '}
          <a href="/lazada/shops" className="text-blue-500 hover:underline font-medium">
            Quản lý Shop Lazada
          </a>{' '}
          để kết nối shop.
        </AlertDescription>
      </Alert>
    );
  }

  if (!currentShop) {
    return (
      <Alert>
        <Store className="h-4 w-4" />
        <AlertDescription>Vui lòng chọn shop Lazada để xem đơn hàng.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <LazadaOrdersPanel />
    </div>
  );
}

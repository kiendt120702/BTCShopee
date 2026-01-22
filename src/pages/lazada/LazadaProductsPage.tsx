/**
 * Lazada Products Page - Trang quản lý sản phẩm Lazada
 */

import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { LazadaProductsPanel } from '@/components/lazada/LazadaProductsPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Store } from 'lucide-react';

export default function LazadaProductsPage() {
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
        <AlertDescription>Vui lòng chọn shop Lazada để xem sản phẩm.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <LazadaProductsPanel />
    </div>
  );
}

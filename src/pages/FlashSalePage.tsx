/**
 * Flash Sale Page - Trang quản lý Flash Sale
 */

import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { FlashSalePanel } from '@/components/panels/FlashSalePanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Store } from 'lucide-react';

export default function FlashSalePage() {
  const { user } = useAuth();
  const { shops, selectedShopId, isLoading } = useShopeeAuth();

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Flash Sale</h1>
          <p className="text-slate-500 mt-1">Quản lý Flash Sale cho shop của bạn</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      </div>
    );
  }

  // No shops connected
  if (shops.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Flash Sale</h1>
          <p className="text-slate-500 mt-1">Quản lý Flash Sale cho shop của bạn</p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Bạn chưa kết nối shop nào. Vui lòng vào{' '}
            <a href="/settings/shops" className="text-orange-500 hover:underline font-medium">
              Cài đặt → Quản lý Shop
            </a>{' '}
            để kết nối shop Shopee.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Flash Sale</h1>
        <p className="text-slate-500 mt-1">Quản lý Flash Sale cho shop của bạn</p>
      </div>

      {/* Flash Sale Panel */}
      {selectedShopId && user?.id ? (
        <FlashSalePanel shopId={selectedShopId} userId={user.id} />
      ) : (
        <Alert>
          <Store className="h-4 w-4" />
          <AlertDescription>
            Vui lòng chọn shop để xem Flash Sale.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

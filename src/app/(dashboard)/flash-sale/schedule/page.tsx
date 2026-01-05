"use client";

import { useShopeeAuth } from "@/hooks/useShopeeAuth";
import { ScheduledPanel } from "@/components/panels";

/**
 * Flash Sale Schedule Page
 * Quản lý lịch hẹn giờ đăng ký Flash Sale
 */
export default function FlashSaleSchedulePage() {
  const { token, isLoading } = useShopeeAuth();

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/3"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!token?.shop_id) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-amber-800 mb-2">
            Chưa kết nối Shop
          </h3>
          <p className="text-amber-600 text-sm">
            Vui lòng kết nối Shop Shopee để sử dụng tính năng hẹn giờ Flash Sale.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Lịch hẹn giờ Flash Sale</h1>
        <p className="text-slate-500 text-sm mt-1">
          Đặt lịch tự động đăng ký sản phẩm vào Flash Sale
        </p>
      </div>
      
      <ScheduledPanel />
    </div>
  );
}

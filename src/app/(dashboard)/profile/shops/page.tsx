"use client";

import { ShopManagementPanel } from "@/components/profile/ShopManagementPanel";

/**
 * Shop Management Page
 * Quản lý các Shop Shopee đã kết nối
 */
export default function ShopsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Quản lý Shop</h1>
        <p className="text-slate-500 text-sm mt-1">
          Quản lý các Shop Shopee đã kết nối với tài khoản của bạn
        </p>
      </div>
      
      <ShopManagementPanel />
    </div>
  );
}

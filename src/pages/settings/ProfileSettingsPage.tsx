/**
 * Profile Settings Page - Hiển thị danh sách shop đã kết nối
 */

import { Store } from 'lucide-react';
import ShopManagementPanel from '@/components/profile/ShopManagementPanel';

export default function ProfileSettingsPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg">
          <Store className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Shop đã kết nối</h1>
          <p className="text-sm text-slate-500">Danh sách các shop Shopee đã kết nối</p>
        </div>
      </div>

      {/* Shop Management Panel */}
      <ShopManagementPanel />
    </div>
  );
}

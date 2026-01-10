/**
 * Profile Settings Page - Thông tin cá nhân
 * Hiển thị danh sách shop có quyền truy cập (chỉ xem, không có action)
 */

import ShopManagementPanel from '@/components/profile/ShopManagementPanel';

export default function ProfileSettingsPage() {
  return (
    <div className="space-y-6 bg-white min-h-full">
      {/* Shop Management Panel - Chế độ chỉ xem */}
      <ShopManagementPanel readOnly />
    </div>
  );
}

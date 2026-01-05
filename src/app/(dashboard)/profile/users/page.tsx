"use client";

import { UserManagementPanel } from "@/components/profile/UserManagementPanel";
import { useAuth } from "@/hooks/useAuth";

/**
 * User Management Page
 * Quản lý người dùng trong hệ thống (Admin only)
 */
export default function UsersPage() {
  const { profile, isLoading } = useAuth();

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

  // TODO: Implement proper admin check
  // For now, show the panel for all users
  // In production, check user role from apishopee_shop_members or sys_profile_departments

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Quản lý User</h1>
        <p className="text-slate-500 text-sm mt-1">
          Quản lý người dùng và phân quyền trong hệ thống
        </p>
      </div>
      
      <UserManagementPanel />
    </div>
  );
}

/**
 * Menu Configuration - Single source of truth cho menu items và permissions
 * 
 * Khi thêm menu mới, chỉ cần thêm vào đây và cả Sidebar lẫn Permission Dialog
 * sẽ tự động cập nhật.
 */

import {
  Home,
  Settings,
  User,
  Users,
  Store,
  Zap,
  Package,
  ShoppingCart,
  Star,
  Megaphone,
  Clock,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';

// Admin email - chỉ tài khoản này mới có full quyền
export const ADMIN_EMAIL = 'betacom.work@gmail.com';

export interface MenuChildItem {
  title: string;
  icon: LucideIcon;
  path: string;
  permissionKey?: string;
  adminOnly?: boolean;
}

export interface MenuItem {
  title: string;
  icon: LucideIcon;
  path?: string;
  permissionKey?: string; // Key để check permission
  description?: string; // Mô tả cho dialog phân quyền
  adminOnly?: boolean;
  children?: MenuChildItem[];
}

/**
 * Menu items configuration
 * - permissionKey: dùng để check quyền truy cập
 * - description: hiển thị trong dialog phân quyền
 * - adminOnly: chỉ admin mới thấy (không hiển thị trong permission dialog)
 */
export const menuItems: MenuItem[] = [
  {
    title: 'Trang chủ',
    icon: Home,
    path: '/',
    permissionKey: 'home',
    description: 'Xem tổng quan hệ thống',
  },
  {
    title: 'Đơn hàng',
    icon: ShoppingCart,
    permissionKey: 'orders',
    description: 'Quản lý đơn hàng',
    children: [
      { title: 'Danh sách đơn hàng', icon: ShoppingCart, path: '/orders', permissionKey: 'orders' },
    ],
  },
  {
    title: 'Sản phẩm',
    icon: Package,
    permissionKey: 'products',
    description: 'Quản lý sản phẩm',
    children: [
      { title: 'Danh sách sản phẩm', icon: Package, path: '/products', permissionKey: 'products' },
    ],
  },
  {
    title: 'Đánh giá',
    icon: Star,
    permissionKey: 'reviews',
    description: 'Quản lý đánh giá',
    children: [
      { title: 'Quản lý đánh giá', icon: Star, path: '/reviews', permissionKey: 'reviews' },
      { title: 'Đánh giá tự động', icon: Zap, path: '/reviews/auto-reply', permissionKey: 'reviews' },
    ],
  },
  {
    title: 'Flash Sale',
    icon: Zap,
    permissionKey: 'flash-sale',
    description: 'Quản lý Flash Sale',
    children: [
      { title: 'Danh sách', icon: Zap, path: '/flash-sale', permissionKey: 'flash-sale' },
      { title: 'Lịch sử', icon: Clock, path: '/flash-sale/auto-setup', permissionKey: 'flash-sale' },
    ],
  },
  {
    title: 'Quảng cáo',
    icon: Megaphone,
    permissionKey: 'ads',
    description: 'Quản lý quảng cáo',
    children: [
      { title: 'Quản lý quảng cáo', icon: Megaphone, path: '/ads', permissionKey: 'ads' },
      { title: 'Quảng cáo tự động', icon: Zap, path: '/ads/auto', permissionKey: 'ads' },
      { title: 'Lịch tự động', icon: Clock, path: '/ads/schedules', permissionKey: 'ads' },
      { title: 'Lịch sử thực thi', icon: Zap, path: '/ads/history', permissionKey: 'ads' },
    ],
  },
  {
    title: 'Phân tích',
    icon: BarChart3,
    permissionKey: 'analytics',
    description: 'Phân tích dữ liệu',
    children: [
      { title: 'Đơn hàng', icon: ShoppingCart, path: '/analytics/orders', permissionKey: 'analytics' },
      { title: 'Đánh giá', icon: Star, path: '/analytics/reviews', permissionKey: 'analytics' },
      { title: 'Chiến dịch', icon: Megaphone, path: '/analytics/campaigns', permissionKey: 'analytics' },
    ],
  },
  {
    title: 'Cài đặt',
    icon: Settings,
    children: [
      {
        title: 'Thông tin cá nhân',
        icon: User,
        path: '/settings/profile',
        permissionKey: 'settings/profile'
      },
      {
        title: 'Quản lý Shop',
        icon: Store,
        path: '/settings/shops',
        permissionKey: 'settings/shops',
        adminOnly: true
      },
      {
        title: 'Quản lý người dùng',
        icon: Users,
        path: '/settings/users',
        permissionKey: 'settings/users',
        adminOnly: true
      },
    ],
  },
];

export interface FeaturePermission {
  key: string;
  label: string;
  icon: LucideIcon;
  description: string;
  group?: string;
  adminOnly?: boolean;
}

/**
 * Tự động generate danh sách permissions từ menuItems
 * Hàm này đảm bảo permission dialog luôn đồng bộ với sidebar
 */
export function getFeaturePermissions(): FeaturePermission[] {
  const permissions: FeaturePermission[] = [];

  menuItems.forEach((item) => {
    // Menu cha không có children
    if (!item.children && item.permissionKey) {
      permissions.push({
        key: item.permissionKey,
        label: item.title,
        icon: item.icon,
        description: item.description || `Truy cập ${item.title}`,
        adminOnly: item.adminOnly,
      });
    }

    // Menu cha có children - chỉ lấy permission của cha nếu có
    if (item.children) {
      // Nếu menu cha có permissionKey (như Đánh giá, Flash Sale, Quảng cáo)
      if (item.permissionKey) {
        permissions.push({
          key: item.permissionKey,
          label: item.title,
          icon: item.icon,
          description: item.description || `Truy cập ${item.title}`,
          adminOnly: item.adminOnly,
        });
      }

      // Thêm các children thuộc group Cài đặt (vì có permission riêng)
      if (item.title === 'Cài đặt') {
        item.children.forEach((child) => {
          if (child.permissionKey) {
            permissions.push({
              key: child.permissionKey,
              label: child.title,
              icon: child.icon,
              description: `Truy cập ${child.title}`,
              group: 'Cài đặt',
              adminOnly: child.adminOnly,
            });
          }
        });
      }
    }
  });

  return permissions;
}

/**
 * Lấy danh sách permissions có thể assign cho user (không bao gồm adminOnly)
 */
export function getAssignablePermissions(): FeaturePermission[] {
  return getFeaturePermissions().filter((p) => !p.adminOnly);
}

/**
 * Lấy tất cả permission keys có thể assign
 */
export function getAllAssignablePermissionKeys(): string[] {
  return getAssignablePermissions().map((p) => p.key);
}

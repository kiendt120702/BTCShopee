/**
 * Sidebar Component - Menu điều hướng chính
 */

import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  Zap,
  Megaphone,
  Package,
  ShoppingCart,
  LayoutDashboard,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  User,
  Store,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface MenuItem {
  title: string;
  icon: typeof LayoutDashboard;
  path?: string;
  children?: { title: string; icon: typeof User; path: string }[];
}

const menuItems: MenuItem[] = [
  {
    title: 'Dashboard',
    icon: LayoutDashboard,
    path: '/dashboard',
  },
  {
    title: 'Flash Sale',
    icon: Zap,
    path: '/flash-sale',
  },
  {
    title: 'Quảng cáo (ADS)',
    icon: Megaphone,
    path: '/ads',
  },
  {
    title: 'Sản phẩm',
    icon: Package,
    path: '/products',
  },
  {
    title: 'Đơn hàng',
    icon: ShoppingCart,
    path: '/orders',
  },
  {
    title: 'Cài đặt',
    icon: Settings,
    children: [
      { title: 'Thông tin cá nhân', icon: User, path: '/settings/profile' },
      { title: 'Quản lý Shop', icon: Store, path: '/settings/shops' },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const { user, profile, signOut } = useAuth();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['Cài đặt']);

  const toggleMenu = (title: string) => {
    setExpandedMenus((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const isMenuActive = (item: MenuItem) => {
    if (item.path) return location.pathname === item.path;
    if (item.children) return item.children.some((child) => location.pathname === child.path);
    return false;
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-white border-r border-slate-200 transition-all duration-300 z-20 flex flex-col',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-3 p-4 border-b border-slate-200',
        collapsed ? 'justify-center' : ''
      )}>
        <img
          src="/logo_betacom.png"
          alt="BETACOM"
          className="w-10 h-10 rounded-lg object-contain flex-shrink-0"
        />
        {!collapsed && (
          <div>
            <h1 className="font-bold text-xl text-red-500">BETACOM</h1>
            <p className="text-xs text-slate-500">Quản lý Shop Shopee</p>
          </div>
        )}
      </div>

      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-sm hover:bg-slate-50 transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {/* Menu Items */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = isMenuActive(item);
          const isExpanded = expandedMenus.includes(item.title);
          const hasChildren = item.children && item.children.length > 0;

          if (hasChildren) {
            return (
              <div key={item.title}>
                <button
                  onClick={() => !collapsed && toggleMenu(item.title)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                    isActive && !isExpanded
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                      : 'text-slate-600 hover:bg-slate-100',
                    collapsed ? 'justify-center' : ''
                  )}
                >
                  <Icon className={cn('w-5 h-5 flex-shrink-0', isActive && !isExpanded ? 'text-white' : 'text-slate-500')} />
                  {!collapsed && (
                    <>
                      <span className={cn('font-medium text-sm flex-1 text-left', isActive && !isExpanded ? 'text-white' : 'text-slate-700')}>
                        {item.title}
                      </span>
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 transition-transform',
                          isExpanded ? 'rotate-180' : '',
                          isActive && !isExpanded ? 'text-white' : 'text-slate-400'
                        )}
                      />
                    </>
                  )}
                </button>
                {!collapsed && isExpanded && (
                  <div className="mt-1 ml-4 pl-4 border-l border-slate-200 space-y-1">
                    {item.children!.map((child) => {
                      const ChildIcon = child.icon;
                      const isChildActive = location.pathname === child.path;
                      return (
                        <NavLink
                          key={child.path}
                          to={child.path}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
                            isChildActive
                              ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                              : 'text-slate-600 hover:bg-slate-100'
                          )}
                        >
                          <ChildIcon className={cn('w-4 h-4', isChildActive ? 'text-white' : 'text-slate-500')} />
                          <span className={cn('font-medium text-sm', isChildActive ? 'text-white' : 'text-slate-700')}>
                            {child.title}
                          </span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.path}
              to={item.path!}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                isActive
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                  : 'text-slate-600 hover:bg-slate-100',
                collapsed ? 'justify-center' : ''
              )}
            >
              <Icon className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-white' : 'text-slate-500')} />
              {!collapsed && (
                <span className={cn('font-medium text-sm', isActive ? 'text-white' : 'text-slate-700')}>
                  {item.title}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-slate-200 p-3">
        {!collapsed ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 px-2">
              <div className="w-9 h-9 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {profile?.full_name?.[0]?.toUpperCase() ||
                  user?.email?.[0]?.toUpperCase() ||
                  'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">
                  {profile?.full_name || user?.email?.split('@')[0]}
                </p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium text-sm">Đăng xuất</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-center">
              <div className="w-9 h-9 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                {profile?.full_name?.[0]?.toUpperCase() ||
                  user?.email?.[0]?.toUpperCase() ||
                  'U'}
              </div>
            </div>
            <button
              onClick={signOut}
              className="w-full flex justify-center py-2.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
              title="Đăng xuất"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

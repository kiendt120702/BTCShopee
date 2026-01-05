/**
 * Dashboard Page - Hiển thị thống kê dữ liệu
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { supabase } from '@/lib/supabase';

interface DashboardStats {
  shops: {
    total: number;
    valid: number;
    expired: number;
  };
  flashSales: {
    total: number;
    upcoming: number;
    ongoing: number;
  };
  scheduledFlashSales: {
    total: number;
    pending: number;
    completed: number;
  };
  ads: {
    total: number;
    ongoing: number;
    paused: number;
    ended: number;
  };
  budgetLogs: {
    total: number;
    recent: Array<{
      id: string;
      campaign_name: string;
      old_budget: number;
      new_budget: number;
      status: string;
      executed_at: string;
    }>;
  };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { token, shops } = useShopeeAuth();
  const { user, profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const currentShop = shops.find((s) => s.shop_id === token?.shop_id);
  const shopName = currentShop?.shop_name || `Shop ${token?.shop_id}`;

  useEffect(() => {
    async function fetchStats() {
      if (!user?.id) return;
      
      try {
        const nowMs = Date.now();
        
        // Fetch all stats in parallel
        const [
          shopsRes,
          flashSalesRes,
          scheduledRes,
          adsRes,
          budgetLogsRes
        ] = await Promise.all([
          // Shops with token status
          supabase.from('apishopee_shops').select('shop_id, expired_at').eq('user_id', user.id),
          // Flash sales
          supabase.from('apishopee_flash_sale_data').select('status').eq('user_id', user.id),
          // Scheduled flash sales
          supabase.from('apishopee_scheduled_flash_sales').select('status').eq('user_id', user.id),
          // Ads campaigns
          supabase.from('apishopee_ads_campaign_data').select('status'),
          // Budget logs (recent 5)
          supabase.from('apishopee_ads_budget_logs').select('*').order('executed_at', { ascending: false }).limit(5)
        ]);

        // Process shops
        const shopsData = shopsRes.data || [];
        const validShops = shopsData.filter(s => s.expired_at > nowMs).length;
        
        // Process flash sales (status: 1=upcoming, 2=ongoing, 3=ended)
        const flashData = flashSalesRes.data || [];
        const upcoming = flashData.filter(f => f.status === 1).length;
        const ongoing = flashData.filter(f => f.status === 2).length;

        // Process scheduled flash sales
        const scheduledData = scheduledRes.data || [];
        const pending = scheduledData.filter(s => s.status === 'pending').length;
        const completed = scheduledData.filter(s => s.status === 'completed').length;

        // Process ads
        const adsData = adsRes.data || [];
        const adsOngoing = adsData.filter(a => a.status === 'ongoing').length;
        const adsPaused = adsData.filter(a => a.status === 'paused').length;
        const adsEnded = adsData.filter(a => a.status === 'ended' || a.status === 'closed').length;

        setStats({
          shops: {
            total: shopsData.length,
            valid: validShops,
            expired: shopsData.length - validShops
          },
          flashSales: {
            total: flashData.length,
            upcoming,
            ongoing
          },
          scheduledFlashSales: {
            total: scheduledData.length,
            pending,
            completed
          },
          ads: {
            total: adsData.length,
            ongoing: adsOngoing,
            paused: adsPaused,
            ended: adsEnded
          },
          budgetLogs: {
            total: budgetLogsRes.data?.length || 0,
            recent: budgetLogsRes.data || []
          }
        });
      } catch (err) {
        console.error('Failed to fetch dashboard stats:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [user?.id]);

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl p-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-2">Xin chào, {profile?.full_name || user?.email?.split('@')[0]}! 👋</h1>
            <p className="text-orange-100 text-sm">Chào mừng bạn đến với BETACOM - Công cụ quản lý Shop Shopee</p>
            {token?.shop_id && (
              <div className="mt-4 flex items-center gap-2 bg-white/20 rounded-lg px-3 py-2 w-fit">
                <ShopIcon />
                <span className="text-sm font-medium">{shopName}</span>
              </div>
            )}
          </div>
          <div className="hidden md:block">
            <div className="w-24 h-24 bg-white/20 rounded-2xl flex items-center justify-center">
              <FlashIcon className="w-12 h-12 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard 
          icon={<ShopIcon />} 
          label="Shops" 
          value={loading ? '...' : `${stats?.shops.valid || 0}/${stats?.shops.total || 0}`}
          subtext={stats?.shops.expired ? `${stats.shops.expired} hết hạn` : 'Tất cả hoạt động'}
          color="green" 
          onClick={() => handleNavigate('/settings')} 
        />
        <StatCard 
          icon={<FlashIcon />} 
          label="Flash Sale" 
          value={loading ? '...' : String(stats?.flashSales.total || 0)}
          subtext={`${stats?.flashSales.upcoming || 0} sắp diễn ra`}
          color="orange" 
          onClick={() => handleNavigate('/flash-sale')} 
        />
        <StatCard 
          icon={<ClockIcon />} 
          label="Hẹn giờ FS" 
          value={loading ? '...' : String(stats?.scheduledFlashSales.pending || 0)}
          subtext="Đang chờ"
          color="blue" 
          onClick={() => handleNavigate('/flash-sale/schedule')} 
        />
        <StatCard 
          icon={<AdsIcon />} 
          label="Quảng cáo" 
          value={loading ? '...' : String(stats?.ads.total || 0)}
          subtext={`${stats?.ads.ongoing || 0} đang chạy`}
          color="purple" 
          onClick={() => handleNavigate('/ads')} 
        />
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Flash Sale Stats */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
              <FlashIcon className="text-orange-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Flash Sale</h3>
              <p className="text-xs text-slate-500">Tổng quan chiến dịch</p>
            </div>
          </div>
          <div className="space-y-3">
            <StatRow label="Tổng số" value={stats?.flashSales.total || 0} />
            <StatRow label="Sắp diễn ra" value={stats?.flashSales.upcoming || 0} color="blue" />
            <StatRow label="Đang diễn ra" value={stats?.flashSales.ongoing || 0} color="green" />
          </div>
          <button 
            onClick={() => handleNavigate('/flash-sale')}
            className="mt-4 w-full text-sm text-orange-600 hover:text-orange-700 font-medium py-2 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors"
          >
            Xem chi tiết →
          </button>
        </div>

        {/* Ads Stats */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <AdsIcon className="text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Quảng cáo</h3>
              <p className="text-xs text-slate-500">Trạng thái chiến dịch</p>
            </div>
          </div>
          <div className="space-y-3">
            <StatRow label="Tổng số" value={stats?.ads.total || 0} />
            <StatRow label="Đang chạy" value={stats?.ads.ongoing || 0} color="green" />
            <StatRow label="Tạm dừng" value={stats?.ads.paused || 0} color="yellow" />
            <StatRow label="Đã kết thúc" value={stats?.ads.ended || 0} color="gray" />
          </div>
          <button 
            onClick={() => handleNavigate('/ads')}
            className="mt-4 w-full text-sm text-purple-600 hover:text-purple-700 font-medium py-2 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors"
          >
            Xem chi tiết →
          </button>
        </div>

        {/* Scheduled Tasks */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <ClockIcon className="text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Hẹn giờ</h3>
              <p className="text-xs text-slate-500">Tác vụ tự động</p>
            </div>
          </div>
          <div className="space-y-3">
            <StatRow label="Flash Sale chờ" value={stats?.scheduledFlashSales.pending || 0} color="blue" />
            <StatRow label="Flash Sale xong" value={stats?.scheduledFlashSales.completed || 0} color="green" />
            <StatRow label="Budget logs" value={stats?.budgetLogs.total || 0} />
          </div>
          <button 
            onClick={() => handleNavigate('/flash-sale/schedule')}
            className="mt-4 w-full text-sm text-blue-600 hover:text-blue-700 font-medium py-2 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
          >
            Xem lịch hẹn giờ →
          </button>
        </div>
      </div>

      {/* Recent Activity */}
      {stats?.budgetLogs.recent && stats.budgetLogs.recent.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Hoạt động gần đây</h3>
            <p className="text-xs text-slate-500">Lịch sử thay đổi ngân sách quảng cáo</p>
          </div>
          <div className="divide-y divide-slate-100">
            {stats.budgetLogs.recent.map((log) => (
              <div key={log.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${log.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{log.campaign_name || 'Campaign'}</p>
                    <p className="text-xs text-slate-500">
                      {formatCurrency(log.old_budget)} → {formatCurrency(log.new_budget)}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">
                  {formatDate(log.executed_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* API Integration Info */}
      <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
            <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-800 mb-1">Tích hợp Shopee Open Platform API</h3>
            <p className="text-sm text-slate-600 mb-3">Dữ liệu được đồng bộ trực tiếp từ Shopee thông qua API chính thức. Token tự động refresh mỗi 30 phút.</p>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs px-2 py-1 bg-white rounded-full text-slate-600 border border-slate-200">🔐 OAuth 2.0</span>
              <span className="text-xs px-2 py-1 bg-white rounded-full text-slate-600 border border-slate-200">⚡ Real-time</span>
              <span className="text-xs px-2 py-1 bg-white rounded-full text-slate-600 border border-slate-200">🔄 Auto Refresh</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Icons
function ShopIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function FlashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function AdsIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
    </svg>
  );
}

// Stat Card Component
function StatCard({ 
  icon, 
  label, 
  value, 
  subtext,
  color, 
  onClick 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  subtext?: string;
  color: string; 
  onClick?: () => void;
}) {
  const colorClasses: Record<string, string> = {
    orange: 'bg-orange-100 text-orange-600 group-hover:bg-orange-200',
    blue: 'bg-blue-100 text-blue-600 group-hover:bg-blue-200',
    purple: 'bg-purple-100 text-purple-600 group-hover:bg-purple-200',
    green: 'bg-green-100 text-green-600 group-hover:bg-green-200',
  };

  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-slate-300 hover:shadow-sm transition-all group">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${colorClasses[color]}`}>{icon}</div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-lg font-bold text-slate-800">{value}</p>
          {subtext && <p className="text-xs text-slate-400">{subtext}</p>}
        </div>
      </div>
    </button>
  );
}

// Stat Row Component
function StatRow({ label, value, color }: { label: string; value: number; color?: string }) {
  const dotColors: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    gray: 'bg-gray-400',
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {color && <div className={`w-2 h-2 rounded-full ${dotColors[color]}`} />}
        <span className="text-sm text-slate-600">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

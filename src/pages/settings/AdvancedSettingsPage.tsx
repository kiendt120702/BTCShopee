/**
 * Advanced Settings Page - Quản lý nâng cao (Admin only)
 * Hiển thị tất cả logs hoạt động của hệ thống để admin theo dõi và kiểm soát
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SimpleDataTable, CellText, CellBadge } from '@/components/ui/data-table';
import { toast } from 'sonner';
import {
  RefreshCw,
  Search,
  FileText,
  Megaphone,
  Star,
  Zap,
  Key,
  ShoppingCart,
  Package,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Store,
  Filter,
  Eye,
  Activity,
  Calendar,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

// Types
interface ActivityLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  shop_id: number | null;
  shop_name: string | null;
  action_type: string;
  action_category: string;
  action_description: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  request_data: Record<string, unknown> | null;
  response_data: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  source: string | null;
  created_at: string;
}

interface ShopInfo {
  shop_id: number;
  shop_name: string | null;
}

interface UserInfo {
  id: string;
  email: string;
  full_name: string | null;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Activity; color: string }> = {
  ads: { label: 'Quảng cáo', icon: Megaphone, color: 'text-purple-500 bg-purple-50' },
  reviews: { label: 'Đánh giá', icon: Star, color: 'text-yellow-500 bg-yellow-50' },
  flash_sale: { label: 'Flash Sale', icon: Zap, color: 'text-orange-500 bg-orange-50' },
  orders: { label: 'Đơn hàng', icon: ShoppingCart, color: 'text-blue-500 bg-blue-50' },
  products: { label: 'Sản phẩm', icon: Package, color: 'text-green-500 bg-green-50' },
  system: { label: 'Hệ thống', icon: Settings, color: 'text-slate-500 bg-slate-50' },
  auth: { label: 'Xác thực', icon: Key, color: 'text-red-500 bg-red-50' },
};

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'destructive' | 'warning' | 'default' }> = {
  success: { label: 'Thành công', variant: 'success' },
  failed: { label: 'Thất bại', variant: 'destructive' },
  pending: { label: 'Đang xử lý', variant: 'warning' },
  cancelled: { label: 'Đã hủy', variant: 'default' },
};

const SOURCE_CONFIG: Record<string, string> = {
  manual: 'Thủ công',
  scheduled: 'Lịch trình',
  auto: 'Tự động',
  webhook: 'Webhook',
  api: 'API',
};

const PAGE_SIZE = 50;

export default function AdvancedSettingsPage() {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [shopFilter, setShopFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('7'); // Days

  // Reference data
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);

  // Detail dialog
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Fetch reference data
  useEffect(() => {
    const fetchReferenceData = async () => {
      const [shopsRes, usersRes] = await Promise.all([
        supabase.from('apishopee_shops').select('shop_id, shop_name').order('shop_name'),
        supabase.from('sys_profiles').select('id, email, full_name').order('full_name'),
      ]);

      if (shopsRes.data) setShops(shopsRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    };
    fetchReferenceData();
  }, []);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('system_activity_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Apply filters
      if (categoryFilter !== 'all') {
        query = query.eq('action_category', categoryFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (shopFilter !== 'all') {
        query = query.eq('shop_id', parseInt(shopFilter));
      }
      if (userFilter !== 'all') {
        query = query.eq('user_id', userFilter);
      }
      if (sourceFilter !== 'all') {
        query = query.eq('source', sourceFilter);
      }
      if (dateFilter !== 'all') {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(dateFilter));
        query = query.gte('created_at', daysAgo.toISOString());
      }
      if (searchQuery) {
        query = query.or(`action_description.ilike.%${searchQuery}%,target_name.ilike.%${searchQuery}%,error_message.ilike.%${searchQuery}%`);
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setLogs(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast.error('Không thể tải logs');
    } finally {
      setLoading(false);
    }
  }, [page, categoryFilter, statusFilter, shopFilter, userFilter, sourceFilter, dateFilter, searchQuery]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [categoryFilter, statusFilter, shopFilter, userFilter, sourceFilter, dateFilter, searchQuery]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const getCategoryBadge = (category: string) => {
    const config = CATEGORY_CONFIG[category] || { label: category, icon: Activity, color: 'text-slate-500 bg-slate-50' };
    const Icon = config.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || { label: status, variant: 'default' as const };
    const Icon = status === 'success' ? CheckCircle : status === 'failed' ? XCircle : status === 'pending' ? Clock : AlertCircle;
    return (
      <CellBadge variant={config.variant}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </CellBadge>
    );
  };

  const openDetail = (log: ActivityLog) => {
    setSelectedLog(log);
    setIsDetailOpen(true);
  };

  const columns = [
    {
      key: 'created_at',
      header: 'Thời gian',
      width: '140px',
      render: (log: ActivityLog) => (
        <div className="text-xs">
          <div className="text-slate-700">{formatDate(log.created_at).split(' ').slice(0, 1).join(' ')}</div>
          <div className="text-slate-500">{formatDate(log.created_at).split(' ').slice(1).join(' ')}</div>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'Người thực hiện',
      width: '180px',
      mobileHeader: true,
      render: (log: ActivityLog) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {log.user_name?.[0]?.toUpperCase() || log.user_email?.[0]?.toUpperCase() || 'S'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700 truncate">
              {log.user_name || log.source === 'scheduled' ? 'Hệ thống' : 'Ẩn danh'}
            </p>
            <p className="text-xs text-slate-500 truncate">{log.user_email || SOURCE_CONFIG[log.source || 'manual']}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Loại',
      width: '120px',
      render: (log: ActivityLog) => getCategoryBadge(log.action_category),
    },
    {
      key: 'description',
      header: 'Mô tả',
      width: '300px',
      render: (log: ActivityLog) => (
        <div>
          <p className="text-sm text-slate-700 line-clamp-1">{log.action_description}</p>
          {log.target_name && (
            <p className="text-xs text-slate-500 truncate">
              {log.target_type}: {log.target_name}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'shop',
      header: 'Shop',
      width: '140px',
      hideOnMobile: true,
      render: (log: ActivityLog) => (
        log.shop_name ? (
          <div className="flex items-center gap-1.5">
            <Store className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-sm truncate max-w-[100px]">{log.shop_name}</span>
          </div>
        ) : (
          <CellText muted>-</CellText>
        )
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: '120px',
      mobileBadge: true,
      render: (log: ActivityLog) => getStatusBadge(log.status),
    },
    {
      key: 'duration',
      header: 'Thời gian',
      width: '80px',
      hideOnMobile: true,
      render: (log: ActivityLog) => (
        <CellText muted className="text-xs">{formatDuration(log.duration_ms)}</CellText>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '60px',
      render: (log: ActivityLog) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => openDetail(log)}
          title="Xem chi tiết"
        >
          <Eye className="w-4 h-4 text-slate-500" />
        </Button>
      ),
    },
  ];

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4 sm:space-y-6 bg-white min-h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-6 border-b">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-purple-500" />
            Quản lý nâng cao
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Theo dõi logs hoạt động của hệ thống - ai làm gì, khi nào, kết quả
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchLogs}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Làm mới</span>
        </Button>
      </div>

      {/* Stats */}
      <div className="px-4 sm:px-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-green-50 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs text-green-600 font-medium">Thành công</span>
          </div>
          <p className="text-lg font-bold text-green-700 mt-1">
            {logs.filter(l => l.status === 'success').length}
          </p>
        </div>
        <div className="bg-red-50 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-red-600 font-medium">Thất bại</span>
          </div>
          <p className="text-lg font-bold text-red-700 mt-1">
            {logs.filter(l => l.status === 'failed').length}
          </p>
        </div>
        <div className="bg-yellow-50 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-500" />
            <span className="text-xs text-yellow-600 font-medium">Đang xử lý</span>
          </div>
          <p className="text-lg font-bold text-yellow-700 mt-1">
            {logs.filter(l => l.status === 'pending').length}
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-500" />
            <span className="text-xs text-slate-600 font-medium">Tổng cộng</span>
          </div>
          <p className="text-lg font-bold text-slate-700 mt-1">{totalCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 sm:px-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">Bộ lọc</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Tìm kiếm mô tả, lỗi..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[130px]">
              <Calendar className="w-4 h-4 mr-2 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">24 giờ qua</SelectItem>
              <SelectItem value="7">7 ngày qua</SelectItem>
              <SelectItem value="30">30 ngày qua</SelectItem>
              <SelectItem value="90">90 ngày qua</SelectItem>
              <SelectItem value="all">Tất cả</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Loại" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả loại</SelectItem>
              {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key}>{config.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả TT</SelectItem>
              <SelectItem value="success">Thành công</SelectItem>
              <SelectItem value="failed">Thất bại</SelectItem>
              <SelectItem value="pending">Đang xử lý</SelectItem>
            </SelectContent>
          </Select>
          <Select value={shopFilter} onValueChange={setShopFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Shop" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả shop</SelectItem>
              {shops.map((shop) => (
                <SelectItem key={shop.shop_id} value={shop.shop_id.toString()}>
                  {shop.shop_name || `Shop ${shop.shop_id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Người dùng" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả user</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.full_name || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Nguồn" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả nguồn</SelectItem>
              {Object.entries(SOURCE_CONFIG).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="px-4 sm:px-6 pb-4">
        <div className="border rounded-lg overflow-hidden">
          <SimpleDataTable
            columns={columns}
            data={logs}
            keyExtractor={(log) => log.id}
            loading={loading}
            loadingMessage="Đang tải logs..."
            emptyMessage="Chưa có logs nào"
            emptyDescription="Logs sẽ xuất hiện khi có hoạt động trong hệ thống"
          />
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-slate-500">
              Trang {page + 1} / {totalPages} ({totalCount} bản ghi)
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || loading}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-purple-500" />
              Chi tiết hoạt động
            </DialogTitle>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              {/* Status & Category */}
              <div className="flex items-center gap-3">
                {getStatusBadge(selectedLog.status)}
                {getCategoryBadge(selectedLog.action_category)}
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                  {SOURCE_CONFIG[selectedLog.source || 'manual']}
                </span>
              </div>

              {/* Description */}
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-700">{selectedLog.action_description}</p>
                {selectedLog.target_name && (
                  <p className="text-xs text-slate-500 mt-1">
                    {selectedLog.target_type}: {selectedLog.target_name} (ID: {selectedLog.target_id})
                  </p>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Người thực hiện</p>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400" />
                    <span className="text-sm">{selectedLog.user_name || selectedLog.user_email || 'Hệ thống'}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Shop</p>
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-slate-400" />
                    <span className="text-sm">{selectedLog.shop_name || '-'}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Bắt đầu</p>
                  <p className="text-sm">{formatDate(selectedLog.started_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Hoàn thành</p>
                  <p className="text-sm">{formatDate(selectedLog.completed_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Thời gian xử lý</p>
                  <p className="text-sm">{formatDuration(selectedLog.duration_ms)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Action Type</p>
                  <p className="text-sm font-mono text-xs">{selectedLog.action_type}</p>
                </div>
              </div>

              {/* Error */}
              {selectedLog.error_message && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-medium text-red-700">Lỗi</span>
                    {selectedLog.error_code && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">
                        {selectedLog.error_code}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-red-600">{selectedLog.error_message}</p>
                </div>
              )}

              {/* Request Data */}
              {selectedLog.request_data && Object.keys(selectedLog.request_data).length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Request Data</p>
                  <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.request_data, null, 2)}
                  </pre>
                </div>
              )}

              {/* Response Data */}
              {selectedLog.response_data && Object.keys(selectedLog.response_data).length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Response Data</p>
                  <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.response_data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

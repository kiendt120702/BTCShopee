/**
 * Users Settings Page - Quản lý người dùng (Admin only)
 * Hiển thị danh sách người dùng và cho phép admin tạo tài khoản mới
 * Cấu hình chức năng cơ bản (global permissions) cho tất cả user
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SimpleDataTable, CellText, CellBadge, CellActions } from '@/components/ui/data-table';
import { toast } from 'sonner';
import { Plus, UserPlus, Mail, User, Phone, Shield, RefreshCw, Trash2, Store, Check, Search, Zap, Save } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getAssignablePermissions, getAllAssignablePermissionKeys } from '@/config/menu-config';

// Lấy danh sách permissions có thể gán (không bao gồm adminOnly)
const ASSIGNABLE_PERMISSIONS = getAssignablePermissions();

interface ShopInfo {
  id: string;
  shop_id: number;
  shop_name: string | null;
  shop_logo?: string | null;
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  system_role: 'admin' | 'user';
  join_date: string | null;
  created_at: string;
  updated_at: string;
  shops?: ShopInfo[];
  permissions?: string[];
}

const SYSTEM_ROLES = [
  { value: 'admin', label: 'Quản trị viên', description: 'Toàn quyền quản lý hệ thống' },
  { value: 'user', label: 'Người dùng', description: 'Quyền sử dụng cơ bản' },
];

export default function UsersSettingsPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  
  // Shop assignment dialog state
  const [isPermissionDialogOpen, setIsPermissionDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);

  // Global permissions dialog state
  const [isGlobalPermissionsDialogOpen, setIsGlobalPermissionsDialogOpen] = useState(false);

  // Shop permission state
  const [allShops, setAllShops] = useState<ShopInfo[]>([]);
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [loadingPermissionData, setLoadingPermissionData] = useState(false);
  const [shopSearchQuery, setShopSearchQuery] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    systemRole: 'user' as 'admin' | 'user',
  });

  // Global permissions state
  const [globalPermissions, setGlobalPermissions] = useState<string[]>([]);
  const [loadingGlobalPermissions, setLoadingGlobalPermissions] = useState(true);
  const [savingGlobalPermissions, setSavingGlobalPermissions] = useState(false);

  // Fetch global permissions
  const fetchGlobalPermissions = async () => {
    setLoadingGlobalPermissions(true);
    try {
      const { data, error } = await supabase
        .from('sys_settings')
        .select('value')
        .eq('key', 'global_permissions')
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data?.value) {
        setGlobalPermissions(data.value as string[]);
      } else {
        // Default: tất cả chức năng cơ bản đều bật
        setGlobalPermissions(getAllAssignablePermissionKeys());
      }
    } catch (error) {
      console.error('Error fetching global permissions:', error);
      // Fallback to all permissions
      setGlobalPermissions(getAllAssignablePermissionKeys());
    } finally {
      setLoadingGlobalPermissions(false);
    }
  };

  // Save global permissions
  const handleSaveGlobalPermissions = async () => {
    setSavingGlobalPermissions(true);
    try {
      const { error } = await supabase
        .from('sys_settings')
        .upsert({
          key: 'global_permissions',
          value: globalPermissions,
          description: 'Danh sách chức năng cơ bản mà tất cả user đều được dùng',
        }, { onConflict: 'key' });

      if (error) throw error;
      toast.success('Đã lưu cấu hình chức năng cơ bản');
    } catch (error) {
      console.error('Error saving global permissions:', error);
      toast.error('Không thể lưu cấu hình');
    } finally {
      setSavingGlobalPermissions(false);
    }
  };

  // Toggle global permission
  const toggleGlobalPermission = (key: string) => {
    setGlobalPermissions(prev =>
      prev.includes(key)
        ? prev.filter(p => p !== key)
        : [...prev, key]
    );
  };

  // Toggle all global permissions
  const toggleAllGlobalPermissions = () => {
    const allKeys = getAllAssignablePermissionKeys();
    if (globalPermissions.length === allKeys.length) {
      setGlobalPermissions([]);
    } else {
      setGlobalPermissions(allKeys);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch users with permissions
      const { data: usersData, error: usersError } = await supabase
        .from('sys_profiles')
        .select('*, permissions')
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;

      // Fetch all shops first (exclude demo shop 999999001)
      const { data: shopsData, error: shopsError } = await supabase
        .from('apishopee_shops')
        .select('id, shop_id, shop_name')
        .neq('shop_id', 999999001);

      if (shopsError) {
        console.error('Error fetching shops:', shopsError);
      }

      // Create shops lookup map
      const shopsMap: Record<string, ShopInfo> = {};
      (shopsData || []).forEach((shop) => {
        shopsMap[shop.id] = {
          id: shop.id,
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
        };
      });

      // Fetch shop members
      const { data: membersData, error: membersError } = await supabase
        .from('apishopee_shop_members')
        .select('profile_id, shop_id')
        .eq('is_active', true);

      if (membersError) {
        console.error('Error fetching shop members:', membersError);
      }

      // Group shops by user
      const shopsByUser: Record<string, ShopInfo[]> = {};
      (membersData || []).forEach((m) => {
        const shop = shopsMap[m.shop_id];
        if (shop) {
          if (!shopsByUser[m.profile_id]) {
            shopsByUser[m.profile_id] = [];
          }
          shopsByUser[m.profile_id].push(shop);
        }
      });

      // Merge shops into users
      const usersWithShops = (usersData || []).map(user => ({
        ...user,
        shops: shopsByUser[user.id] || [],
      }));

      setUsers(usersWithShops);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Không thể tải danh sách người dùng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchGlobalPermissions();
  }, []);

  const handleCreateUser = async () => {
    if (!formData.email || !formData.password) {
      toast.error('Vui lòng nhập email và mật khẩu');
      return;
    }

    if (formData.password.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự');
      return;
    }

    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Nếu session sắp hết hạn, refresh
      if (session && session.expires_at && (session.expires_at * 1000 - Date.now()) < 60000) {
        const { data: { session: newSession }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          throw new Error('Không thể refresh session. Vui lòng đăng nhập lại.');
        }
      }

      // Dùng supabase.functions.invoke() với adminEmail để bypass JWT verification
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          phone: formData.phone,
          systemRole: formData.systemRole,
          adminEmail: session?.user?.email, // Gửi email để verify admin
        },
      });

      if (error) {
        throw new Error(error.message || 'Không thể tạo tài khoản');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Thêm user mới vào đầu danh sách ngay lập tức
      const newUser: UserProfile = {
        id: data.user.id,
        email: formData.email,
        full_name: formData.fullName || null,
        phone: formData.phone || null,
        system_role: formData.systemRole,
        join_date: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setUsers(prev => [newUser, ...prev]);

      toast.success('Tạo tài khoản thành công');
      setIsCreateDialogOpen(false);
      setFormData({ email: '', password: '', fullName: '', phone: '', systemRole: 'user' });
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error(error instanceof Error ? error.message : 'Không thể tạo tài khoản');
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getRoleDisplay = (role: string) => {
    const roleInfo = SYSTEM_ROLES.find(r => r.value === role);
    return roleInfo?.label || role;
  };

  // Mở dialog gán shop
  const openPermissionDialog = async (user: UserProfile) => {
    setSelectedUser(user);
    setIsPermissionDialogOpen(true);
    setShopSearchQuery('');
    setLoadingPermissionData(true);

    try {
      // Load all shops và current shop assignments song song
      // Filter out demo shop 999999001
      const [shopsRes, memberRes] = await Promise.all([
        supabase
          .from('apishopee_shops')
          .select('id, shop_id, shop_name, shop_logo')
          .neq('shop_id', 999999001)
          .order('shop_name'),
        supabase
          .from('apishopee_shop_members')
          .select('shop_id')
          .eq('profile_id', user.id)
          .eq('is_active', true),
      ]);

      if (shopsRes.error) throw shopsRes.error;
      if (memberRes.error) throw memberRes.error;

      setAllShops(shopsRes.data || []);
      setSelectedShopIds((memberRes.data || []).map(m => m.shop_id));
    } catch (error) {
      console.error('Error loading shop data:', error);
      toast.error('Không thể tải danh sách shop');
    } finally {
      setLoadingPermissionData(false);
    }
  };

  // Lưu shop assignments (không còn lưu per-user permissions)
  const handleSavePermissions = async () => {
    if (!selectedUser) return;

    setSavingPermissions(true);
    try {
      // Lấy member role để assign shop
      const { data: rolesData } = await supabase
        .from('apishopee_roles')
        .select('id')
        .eq('name', 'member')
        .single();

      const memberRoleId = rolesData?.id;

      // Lấy danh sách shop hiện tại của user
      const { data: currentMembers } = await supabase
        .from('apishopee_shop_members')
        .select('id, shop_id')
        .eq('profile_id', selectedUser.id)
        .eq('is_active', true);

      const currentShopIds = (currentMembers || []).map(m => m.shop_id);

      // Shops cần thêm (có trong selectedShopIds nhưng không có trong current)
      const shopsToAdd = selectedShopIds.filter(id => !currentShopIds.includes(id));

      // Shops cần xóa (có trong current nhưng không có trong selectedShopIds)
      const memberIdsToDelete = (currentMembers || [])
        .filter(m => !selectedShopIds.includes(m.shop_id))
        .map(m => m.id);

      // 1. Thêm shop mới (nếu có)
      if (shopsToAdd.length > 0 && memberRoleId) {
        const insertData = shopsToAdd.map(shopId => ({
          shop_id: shopId,
          profile_id: selectedUser.id,
          role_id: memberRoleId,
          is_active: true,
        }));
        const { error: insertError } = await supabase
          .from('apishopee_shop_members')
          .insert(insertData);

        if (insertError) throw insertError;
      }

      // 2. Xóa shop không còn được chọn (nếu có)
      if (memberIdsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('apishopee_shop_members')
          .delete()
          .in('id', memberIdsToDelete);

        if (deleteError) throw deleteError;
      }

      // Cập nhật local state - chỉ shops
      const updatedShops = allShops.filter(s => selectedShopIds.includes(s.id));
      setUsers(prev => prev.map(u =>
        u.id === selectedUser.id
          ? { ...u, shops: updatedShops }
          : u
      ));

      toast.success('Đã cập nhật shop cho người dùng');
      setIsPermissionDialogOpen(false);
    } catch (error) {
      console.error('Error saving shop assignments:', error);
      toast.error('Không thể cập nhật');
    } finally {
      setSavingPermissions(false);
    }
  };

  // Toggle shop selection
  const toggleShopSelection = (shopId: string) => {
    setSelectedShopIds(prev =>
      prev.includes(shopId)
        ? prev.filter(id => id !== shopId)
        : [...prev, shopId]
    );
  };

  // Chọn tất cả / Bỏ chọn tất cả shops
  const toggleAllShops = () => {
    if (selectedShopIds.length === allShops.length) {
      setSelectedShopIds([]);
    } else {
      setSelectedShopIds(allShops.map(s => s.id));
    }
  };

  // Filter shops by search query
  const filteredShops = allShops.filter(shop =>
    !shopSearchQuery ||
    shop.shop_name?.toLowerCase().includes(shopSearchQuery.toLowerCase()) ||
    shop.shop_id.toString().includes(shopSearchQuery)
  );

  const columns = [
    {
      key: 'user',
      header: 'Người dùng',
      width: '280px',
      mobileHeader: true,
      render: (user: UserProfile) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {user.full_name?.[0]?.toUpperCase() || user.email[0]?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-slate-800 truncate">
              {user.full_name || 'Chưa cập nhật'}
            </p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'system_role',
      header: 'Vai trò',
      width: '140px',
      mobileBadge: true,
      render: (user: UserProfile) => (
        <CellBadge variant={user.system_role === 'admin' ? 'warning' : 'default'}>
          {user.system_role === 'admin' ? (
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {getRoleDisplay(user.system_role)}
            </span>
          ) : (
            getRoleDisplay(user.system_role)
          )}
        </CellBadge>
      ),
    },
    {
      key: 'phone',
      header: 'Số điện thoại',
      width: '140px',
      hideOnMobile: true,
      render: (user: UserProfile) => (
        <CellText muted={!user.phone}>{user.phone || '-'}</CellText>
      ),
    },
    {
      key: 'created_at',
      header: 'Ngày tạo',
      width: '120px',
      hideOnMobile: true,
      render: (user: UserProfile) => (
        <CellText muted>{formatDate(user.created_at)}</CellText>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: '100px',
      hideOnMobile: true,
      render: (user: UserProfile) => (
        <CellBadge variant={user.id === currentUser?.id ? 'success' : 'default'}>
          {user.id === currentUser?.id ? 'Bạn' : 'Active'}
        </CellBadge>
      ),
    },
    {
      key: 'shops',
      header: 'Shop quản lý',
      width: '200px',
      hideOnMobile: true,
      render: (user: UserProfile) => {
        const shops = user.shops || [];
        if (shops.length === 0) {
          return <CellText muted>-</CellText>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {shops.slice(0, 2).map((shop) => (
              <span
                key={shop.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full"
                title={shop.shop_name || `Shop ${shop.shop_id}`}
              >
                <Store className="w-3 h-3" />
                <span className="max-w-[80px] truncate">{shop.shop_name || shop.shop_id}</span>
              </span>
            ))}
            {shops.length > 2 && (
              <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                +{shops.length - 2}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '100px',
      render: (user: UserProfile) => (
        <CellActions>
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 h-7 w-7 p-0"
            onClick={() => openPermissionDialog(user)}
            title="Phân quyền"
            disabled={user.id === currentUser?.id}
          >
            <Shield className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 w-7 p-0"
            onClick={() => {
              // TODO: Implement delete user
              toast.info('Chức năng đang phát triển');
            }}
            title="Xóa người dùng"
            disabled={user.id === currentUser?.id}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </CellActions>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6 bg-white min-h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-6 border-b">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-800">Quản lý người dùng</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Xem danh sách và tạo tài khoản cho người dùng mới
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsGlobalPermissionsDialogOpen(true)}
            className="border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          >
            <Zap className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Chức năng cơ bản</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateDialogOpen(true)}
            className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
          >
            <UserPlus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Tạo tài khoản</span>
          </Button>
        </div>
      </div>

      {/* Users Table */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="border rounded-lg overflow-hidden">
          <SimpleDataTable
            columns={columns}
            data={users}
            keyExtractor={(user) => user.id}
            loading={loading}
            loadingMessage="Đang tải danh sách người dùng..."
            emptyMessage="Chưa có người dùng nào"
            emptyDescription="Tạo tài khoản mới để bắt đầu"
          />
        </div>
        {!loading && users.length > 0 && (
          <p className="text-xs sm:text-sm text-slate-500 mt-2 sm:mt-3">
            Tổng cộng: {users.length} người dùng
          </p>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-orange-500" />
              Tạo tài khoản mới
            </DialogTitle>
            <DialogDescription>
              Nhập thông tin để tạo tài khoản cho người dùng mới
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-500" />
                Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Mật khẩu <span className="text-red-500">*</span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Tối thiểu 6 ký tự"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullName" className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500" />
                Họ và tên
              </Label>
              <Input
                id="fullName"
                placeholder="Nguyễn Văn A"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-500" />
                Số điện thoại
              </Label>
              <Input
                id="phone"
                placeholder="0901234567"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemRole" className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-500" />
                Vai trò <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.systemRole}
                onValueChange={(value: 'admin' | 'user') => 
                  setFormData({ ...formData, systemRole: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn vai trò" />
                </SelectTrigger>
                <SelectContent>
                  {SYSTEM_ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      <div className="flex flex-col">
                        <span>{role.label}</span>
                        <span className="text-xs text-slate-500">{role.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={creating}
            >
              Hủy
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={creating}
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
            >
              {creating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Đang tạo...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Tạo tài khoản
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shop Assignment Dialog - Simplified (only shop selection) */}
      <Dialog open={isPermissionDialogOpen} onOpenChange={setIsPermissionDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Store className="w-5 h-5 text-orange-500" />
              Gán Shop cho người dùng
            </DialogTitle>
            <DialogDescription>
              Chọn các shop mà <span className="font-medium text-slate-700">{selectedUser?.full_name || selectedUser?.email}</span> được quyền truy cập
            </DialogDescription>
          </DialogHeader>

          {loadingPermissionData ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              <span className="ml-2 text-slate-500">Đang tải dữ liệu...</span>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {/* Header with select all */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-orange-500" />
                  <h3 className="text-sm font-semibold text-slate-800">Quyền truy cập Shop</h3>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <span>Chọn tất cả</span>
                  <Checkbox
                    checked={selectedShopIds.length === allShops.length && allShops.length > 0}
                    onCheckedChange={toggleAllShops}
                    disabled={allShops.length === 0}
                  />
                </label>
              </div>

              {/* Search shops */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Tìm shop theo tên hoặc ID..."
                  value={shopSearchQuery}
                  onChange={(e) => setShopSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>

              <ScrollArea className="h-[350px] pr-3">
                {allShops.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Store className="w-10 h-10 mb-2" />
                    <p className="text-sm">Chưa có shop nào</p>
                  </div>
                ) : filteredShops.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Search className="w-10 h-10 mb-2" />
                    <p className="text-sm">Không tìm thấy shop</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredShops.map((shop) => (
                      <label
                        key={shop.id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          selectedShopIds.includes(shop.id)
                            ? 'border-orange-300 bg-orange-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <Checkbox
                          checked={selectedShopIds.includes(shop.id)}
                          onCheckedChange={() => toggleShopSelection(shop.id)}
                        />
                        {shop.shop_logo ? (
                          <img
                            src={shop.shop_logo}
                            alt={shop.shop_name || ''}
                            className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                            {shop.shop_name?.[0]?.toUpperCase() || 'S'}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">
                            {shop.shop_name || `Shop ${shop.shop_id}`}
                          </p>
                          <p className="text-xs text-slate-500">ID: {shop.shop_id}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* Shop count info */}
              <div className="p-2.5 bg-orange-50 rounded-lg flex items-center justify-between">
                <p className="text-xs text-orange-700">
                  Đã chọn <strong>{selectedShopIds.length}</strong> / {allShops.length} shop
                </p>
                {selectedShopIds.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-orange-600 hover:text-orange-800 cursor-pointer"
                    onClick={() => setSelectedShopIds([])}
                  >
                    Bỏ chọn tất cả
                  </button>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="border-t pt-4">
            <Button
              variant="outline"
              onClick={() => setIsPermissionDialogOpen(false)}
              disabled={savingPermissions}
            >
              Hủy
            </Button>
            <Button
              onClick={handleSavePermissions}
              disabled={savingPermissions || loadingPermissionData}
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
            >
              {savingPermissions ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Lưu
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Global Permissions Dialog - Compact Design */}
      <Dialog open={isGlobalPermissionsDialogOpen} onOpenChange={setIsGlobalPermissionsDialogOpen}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">Chức năng cơ bản</h3>
                <p className="text-xs text-slate-500">Áp dụng cho tất cả người dùng</p>
              </div>
            </div>
          </div>

          {loadingGlobalPermissions ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              {/* Select all row */}
              <div className="px-5 py-2.5 border-b bg-slate-50/50 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Đã chọn <span className="font-semibold text-blue-600">{globalPermissions.length}</span> / {getAllAssignablePermissionKeys().length} chức năng
                </span>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer hover:text-blue-600 transition-colors">
                  <span>Chọn tất cả</span>
                  <Checkbox
                    checked={globalPermissions.length === getAllAssignablePermissionKeys().length}
                    onCheckedChange={toggleAllGlobalPermissions}
                    className="w-4 h-4"
                  />
                </label>
              </div>

              {/* Features grid */}
              <div className="px-4 py-3 max-h-[320px] overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                  {[...ASSIGNABLE_PERMISSIONS.filter(f => !f.group), ...ASSIGNABLE_PERMISSIONS.filter(f => f.group === 'Cài đặt')].map((feature) => {
                    const Icon = feature.icon;
                    const isEnabled = globalPermissions.includes(feature.key);
                    return (
                      <label
                        key={feature.key}
                        className={`group flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isEnabled
                            ? 'border-blue-200 bg-blue-50/80 shadow-sm'
                            : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50/50'
                        }`}
                      >
                        <Checkbox
                          checked={isEnabled}
                          onCheckedChange={() => toggleGlobalPermission(feature.key)}
                          className="w-4 h-4 flex-shrink-0"
                        />
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors ${
                          isEnabled ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                        }`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${isEnabled ? 'text-blue-700' : 'text-slate-600'}`}>
                            {feature.label}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate leading-tight">{feature.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="px-5 py-3 border-t bg-slate-50/50 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsGlobalPermissionsDialogOpen(false)}
              disabled={savingGlobalPermissions}
              className="h-8 px-3 text-xs"
            >
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                await handleSaveGlobalPermissions();
                setIsGlobalPermissionsDialogOpen(false);
              }}
              disabled={savingGlobalPermissions || loadingGlobalPermissions}
              className="h-8 px-4 text-xs bg-blue-600 hover:bg-blue-700"
            >
              {savingGlobalPermissions ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Lưu cấu hình
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

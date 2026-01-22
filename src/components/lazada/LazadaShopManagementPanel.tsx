/**
 * Lazada Shop Management Panel - Quản lý danh sách shop Lazada
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { LAZADA_CONFIG, LazadaAppInfo } from '@/lib/lazada/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Plus,
  RefreshCw,
  Store,
  Trash2,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

export function LazadaShopManagementPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { shops, currentShop, isLoading, login, loadShops, switchShop, handleCallback } =
    useLazadaAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Dialog states
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [appKeyInput, setAppKeyInput] = useState(LAZADA_CONFIG.APP_KEY);
  const [appSecretInput, setAppSecretInput] = useState('');
  const [appNameInput, setAppNameInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shopToDelete, setShopToDelete] = useState<(typeof shops)[0] | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    if (code && user?.id) {
      handleCallback(code).then((success) => {
        // Clear URL params
        searchParams.delete('code');
        setSearchParams(searchParams, { replace: true });

        if (success) {
          toast({
            title: 'Thành công',
            description: 'Đã kết nối shop Lazada thành công!',
          });
        } else {
          toast({
            title: 'Lỗi',
            description: 'Không thể kết nối shop Lazada',
            variant: 'destructive',
          });
        }
      });
    }
  }, [searchParams, user?.id, handleCallback, setSearchParams, toast]);

  // Connect new shop
  const handleConnect = async () => {
    if (!appSecretInput.trim()) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng nhập App Secret',
        variant: 'destructive',
      });
      return;
    }

    setConnecting(true);
    try {
      const appInfo: LazadaAppInfo = {
        app_key: appKeyInput || LAZADA_CONFIG.APP_KEY,
        app_secret: appSecretInput,
        app_name: appNameInput || undefined,
        app_created_by: user?.id,
      };

      // Save to localStorage for callback
      localStorage.setItem('lazada_app_info', JSON.stringify(appInfo));

      await login(appInfo);
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message || 'Không thể kết nối shop',
        variant: 'destructive',
      });
      setConnecting(false);
    }
  };

  // Delete shop
  const handleDeleteShop = async () => {
    if (!shopToDelete) return;

    setDeleting(true);
    try {
      // Remove shop member first
      await supabase
        .from('apilazada_shop_members')
        .delete()
        .eq('shop_id', shopToDelete.id)
        .eq('profile_id', user?.id);

      // Check if any other members exist
      const { data: remainingMembers } = await supabase
        .from('apilazada_shop_members')
        .select('id')
        .eq('shop_id', shopToDelete.id);

      // If no members left, delete the shop
      if (!remainingMembers || remainingMembers.length === 0) {
        await supabase.from('apilazada_shops').delete().eq('id', shopToDelete.id);
      }

      toast({
        title: 'Thành công',
        description: 'Đã xóa shop khỏi danh sách',
      });

      setDeleteDialogOpen(false);
      setShopToDelete(null);
      loadShops();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: 'Không thể xóa shop',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  // Check token status
  const getTokenStatus = (shop: (typeof shops)[0]) => {
    if (!shop.access_token) {
      return { status: 'disconnected', label: 'Chưa kết nối', variant: 'secondary' as const };
    }

    const now = new Date();
    const expiresAt = shop.access_token_expires_at ? new Date(shop.access_token_expires_at) : null;

    if (expiresAt && expiresAt < now) {
      return { status: 'expired', label: 'Token hết hạn', variant: 'destructive' as const };
    }

    return { status: 'active', label: 'Đang hoạt động', variant: 'default' as const };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5 text-blue-500" />
              Quản lý Shop Lazada
            </CardTitle>
            <CardDescription>Kết nối và quản lý các shop Lazada của bạn</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => loadShops()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
            </Button>
            <Button size="sm" onClick={() => setConnectDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Kết nối Shop
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {shops.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Store className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Chưa có shop nào được kết nối</p>
              <Button className="mt-4" onClick={() => setConnectDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Kết nối Shop đầu tiên
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shop</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Cập nhật token</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shops.map((shop) => {
                  const tokenStatus = getTokenStatus(shop);
                  const isSelected = currentShop?.seller_id === shop.seller_id;

                  return (
                    <TableRow
                      key={shop.id}
                      className={isSelected ? 'bg-blue-50' : undefined}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {shop.shop_logo ? (
                            <img
                              src={shop.shop_logo}
                              alt={shop.shop_name || 'Shop'}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                              <Store className="h-5 w-5 text-blue-500" />
                            </div>
                          )}
                          <div>
                            <div className="font-medium">
                              {shop.shop_name || `Shop ${shop.seller_id}`}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              ID: {shop.seller_id}
                            </div>
                          </div>
                          {isSelected && (
                            <Badge variant="outline" className="ml-2">
                              Đang chọn
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{shop.region || 'VN'}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tokenStatus.variant}>
                          {tokenStatus.status === 'active' && (
                            <CheckCircle className="h-3 w-3 mr-1" />
                          )}
                          {tokenStatus.status === 'expired' && (
                            <AlertCircle className="h-3 w-3 mr-1" />
                          )}
                          {tokenStatus.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {shop.token_updated_at ? (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Clock className="h-3 w-3 mr-1" />
                            {formatDistanceToNow(new Date(shop.token_updated_at), {
                              addSuffix: true,
                              locale: vi,
                            })}
                          </div>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {!isSelected && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => switchShop(shop.seller_id)}
                            >
                              Chọn
                            </Button>
                          )}
                          {tokenStatus.status === 'expired' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => login()}
                            >
                              <RefreshCw className="h-4 w-4 mr-1" />
                              Kết nối lại
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => {
                              setShopToDelete(shop);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Connect Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kết nối Shop Lazada</DialogTitle>
            <DialogDescription>
              Nhập thông tin App từ Lazada Open Platform để kết nối shop
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="appKey">App Key</Label>
              <Input
                id="appKey"
                value={appKeyInput}
                onChange={(e) => setAppKeyInput(e.target.value)}
                placeholder="Nhập App Key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appSecret">
                App Secret <span className="text-red-500">*</span>
              </Label>
              <Input
                id="appSecret"
                type="password"
                value={appSecretInput}
                onChange={(e) => setAppSecretInput(e.target.value)}
                placeholder="Nhập App Secret"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appName">Tên App (tùy chọn)</Label>
              <Input
                id="appName"
                value={appNameInput}
                onChange={(e) => setAppNameInput(e.target.value)}
                placeholder="Đặt tên để dễ nhận biết"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <a
                href="https://open.lazada.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline inline-flex items-center"
              >
                Lấy credentials từ Lazada Open Platform
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting && <Spinner className="h-4 w-4 mr-2" />}
              Kết nối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận xóa shop</DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn xóa shop{' '}
              <strong>{shopToDelete?.shop_name || shopToDelete?.seller_id}</strong> khỏi danh
              sách? Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleDeleteShop} disabled={deleting}>
              {deleting && <Spinner className="h-4 w-4 mr-2" />}
              Xóa shop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LazadaShopManagementPanel;

/**
 * FlashSaleDetailPanel - Display Flash Sale details and manage items
 */

import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Edit, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import {
  FlashSale,
  FlashSaleStatus,
  FlashSaleItem,
  FlashSaleItemModel,
} from '@/lib/shopee/flash-sale';
import {
  getStatusColor,
  getStatusLabel,
  getTypeLabel,
  formatTimeRange,
  canEditFlashSale,
  getErrorMessage,
} from '@/lib/shopee/flash-sale';

interface FlashSaleDetailPanelProps {
  shopId: number;
  flashSale: FlashSale;
  onBack: () => void;
}

interface FlashSaleItemData {
  item_id: number;
  item_name?: string;
  status: number;
  purchase_limit: number;
  stock?: number;
  promo_price?: number;
  original_price?: number;
  models?: Array<{
    model_id: number;
    model_name?: string;
    stock: number;
    promo_price: number;
    original_price?: number;
  }>;
}

// Add Item form state
interface AddItemFormState {
  item_id: string;
  purchase_limit: string;
  has_models: boolean;
  // For items without variants
  item_promo_price: string;
  item_stock: string;
  // For items with variants
  models: Array<{
    model_id: string;
    promo_price: string;
    stock: string;
  }>;
}

// Edit Item form state
interface EditItemFormState {
  item_id: number;
  purchase_limit: string;
  has_models: boolean;
  item_promo_price: string;
  item_stock: string;
  models: Array<{
    model_id: number;
    promo_price: string;
    stock: string;
  }>;
}

const initialAddItemForm: AddItemFormState = {
  item_id: '',
  purchase_limit: '0',
  has_models: false,
  item_promo_price: '',
  item_stock: '',
  models: [],
};

// Validate add item form
function validateAddItemForm(form: AddItemFormState): string | null {
  if (!form.item_id || isNaN(Number(form.item_id))) {
    return 'Vui lòng nhập Item ID hợp lệ';
  }
  if (form.has_models) {
    if (form.models.length === 0) {
      return 'Vui lòng thêm ít nhất 1 biến thể';
    }
    for (const model of form.models) {
      if (!model.model_id || isNaN(Number(model.model_id))) {
        return 'Model ID không hợp lệ';
      }
      if (!model.promo_price || isNaN(Number(model.promo_price)) || Number(model.promo_price) <= 0) {
        return 'Giá khuyến mãi phải lớn hơn 0';
      }
      if (!model.stock || isNaN(Number(model.stock)) || Number(model.stock) < 0) {
        return 'Số lượng không hợp lệ';
      }
    }
  } else {
    if (!form.item_promo_price || isNaN(Number(form.item_promo_price)) || Number(form.item_promo_price) <= 0) {
      return 'Giá khuyến mãi phải lớn hơn 0';
    }
    if (!form.item_stock || isNaN(Number(form.item_stock)) || Number(form.item_stock) < 0) {
      return 'Số lượng không hợp lệ';
    }
  }
  return null;
}

// Build FlashSaleItem from form
function buildFlashSaleItem(form: AddItemFormState): FlashSaleItem {
  const item: FlashSaleItem = {
    item_id: Number(form.item_id),
    purchase_limit: Number(form.purchase_limit) || 0,
  };

  if (form.has_models) {
    item.models = form.models.map((m) => ({
      model_id: Number(m.model_id),
      input_promo_price: Number(m.promo_price),
      stock: Number(m.stock),
    }));
  } else {
    item.item_input_promo_price = Number(form.item_promo_price);
    item.item_stock = Number(form.item_stock);
  }

  return item;
}

// Status badge component
function StatusBadge({ status }: { status: FlashSaleStatus }) {
  const color = getStatusColor(status);
  const label = getStatusLabel(status);

  const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    green: 'default',
    yellow: 'secondary',
    red: 'destructive',
    gray: 'outline',
  };

  return <Badge variant={variantMap[color] || 'outline'}>{label}</Badge>;
}

export function FlashSaleDetailPanel({
  shopId,
  flashSale,
  onBack,
}: FlashSaleDetailPanelProps) {
  const { toast } = useToast();

  // State
  const [items, setItems] = useState<FlashSaleItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<FlashSaleItemData | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Add Item dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addItemForm, setAddItemForm] = useState<AddItemFormState>(initialAddItemForm);
  const [isAdding, setIsAdding] = useState(false);

  // Edit Item dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editItemForm, setEditItemForm] = useState<EditItemFormState | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const canEdit = canEditFlashSale(flashSale);

  // Fetch items
  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'get-items',
          shop_id: shopId,
          flash_sale_id: flashSale.flash_sale_id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      setItems(data?.response?.items || []);
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [shopId, flashSale.flash_sale_id]);

  // Handle add item
  const handleAddItem = async () => {
    const error = validateAddItemForm(addItemForm);
    if (error) {
      toast({ title: 'Lỗi', description: error, variant: 'destructive' });
      return;
    }

    setIsAdding(true);
    try {
      const item = buildFlashSaleItem(addItemForm);
      const { data, error: apiError } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'add-items',
          shop_id: shopId,
          flash_sale_id: flashSale.flash_sale_id,
          items: [item],
        },
      });

      if (apiError) throw apiError;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      toast({ title: 'Thành công', description: 'Đã thêm sản phẩm vào Flash Sale' });
      setShowAddDialog(false);
      setAddItemForm(initialAddItemForm);
      fetchItems();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsAdding(false);
    }
  };

  // Handle edit item click
  const handleEditClick = (item: FlashSaleItemData) => {
    const hasModels = !!(item.models && item.models.length > 0);
    setEditItemForm({
      item_id: item.item_id,
      purchase_limit: String(item.purchase_limit || 0),
      has_models: hasModels,
      item_promo_price: hasModels ? '' : String(item.promo_price || ''),
      item_stock: hasModels ? '' : String(item.stock || ''),
      models: hasModels
        ? item.models!.map((m) => ({
            model_id: m.model_id,
            promo_price: String(m.promo_price || ''),
            stock: String(m.stock || ''),
          }))
        : [],
    });
    setShowEditDialog(true);
  };

  // Handle update item
  const handleUpdateItem = async () => {
    if (!editItemForm) return;

    setIsUpdating(true);
    try {
      const item: FlashSaleItem = {
        item_id: editItemForm.item_id,
        purchase_limit: Number(editItemForm.purchase_limit) || 0,
      };

      if (editItemForm.has_models) {
        item.models = editItemForm.models.map((m) => ({
          model_id: m.model_id,
          input_promo_price: Number(m.promo_price),
          stock: Number(m.stock),
        }));
      } else {
        item.item_input_promo_price = Number(editItemForm.item_promo_price);
        item.item_stock = Number(editItemForm.item_stock);
      }

      const { data, error: apiError } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'update-items',
          shop_id: shopId,
          flash_sale_id: flashSale.flash_sale_id,
          items: [item],
        },
      });

      if (apiError) throw apiError;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      toast({ title: 'Thành công', description: 'Đã cập nhật sản phẩm' });
      setShowEditDialog(false);
      setEditItemForm(null);
      fetchItems();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsUpdating(false);
    }
  };

  // Add model to form
  const addModelToForm = () => {
    setAddItemForm((prev) => ({
      ...prev,
      models: [...prev.models, { model_id: '', promo_price: '', stock: '' }],
    }));
  };

  // Remove model from form
  const removeModelFromForm = (index: number) => {
    setAddItemForm((prev) => ({
      ...prev,
      models: prev.models.filter((_, i) => i !== index),
    }));
  };

  // Handle delete item
  const handleDeleteItem = async () => {
    if (!selectedItem) return;

    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'delete-items',
          shop_id: shopId,
          flash_sale_id: flashSale.flash_sale_id,
          item_id: selectedItem.item_id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      toast({
        title: 'Thành công',
        description: 'Đã xóa sản phẩm khỏi Flash Sale',
      });

      fetchItems();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setSelectedItem(null);
    }
  };

  // Format price
  const formatPrice = (price?: number) => {
    if (!price) return '-';
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(price);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle className="text-xl">
              Flash Sale #{flashSale.flash_sale_id}
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={flashSale.status} />
              <Badge variant="outline">{getTypeLabel(flashSale.type)}</Badge>
              <span className="text-sm text-muted-foreground">
                {formatTimeRange(flashSale.start_time, flashSale.end_time)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchItems}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Làm mới
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Thêm sản phẩm
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="p-4 border rounded-lg">
            <div className="text-2xl font-bold">{flashSale.item_count}</div>
            <div className="text-sm text-muted-foreground">Tổng sản phẩm</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-2xl font-bold">{flashSale.enabled_item_count}</div>
            <div className="text-sm text-muted-foreground">Đang hoạt động</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-2xl font-bold">{flashSale.click_count}</div>
            <div className="text-sm text-muted-foreground">Lượt click</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-2xl font-bold">{flashSale.remindme_count}</div>
            <div className="text-sm text-muted-foreground">Lượt nhắc nhở</div>
          </div>
        </div>

        {/* Items list */}
        <div className="border rounded-lg">
          <div className="p-4 border-b bg-muted/50">
            <h3 className="font-medium">Danh sách sản phẩm ({items.length})</h3>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-8 w-8" />
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Chưa có sản phẩm nào trong Flash Sale này
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="divide-y">
              {items.map((item) => (
                <div
                  key={item.item_id}
                  className="p-4 flex items-center justify-between hover:bg-muted/50"
                >
                  <div>
                    <div className="font-medium">
                      {item.item_name || `Item #${item.item_id}`}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Giới hạn mua: {item.purchase_limit || 'Không giới hạn'}
                      {item.models && item.models.length > 0 && (
                        <span className="ml-2">• {item.models.length} biến thể</span>
                      )}
                    </div>
                    {item.models && item.models.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {item.models.slice(0, 3).map((model) => (
                          <div key={model.model_id} className="text-sm">
                            {model.model_name || `Model #${model.model_id}`}:{' '}
                            <span className="text-green-600">{formatPrice(model.promo_price)}</span>
                            {model.original_price && (
                              <span className="text-muted-foreground line-through ml-2">
                                {formatPrice(model.original_price)}
                              </span>
                            )}
                            <span className="text-muted-foreground ml-2">
                              (SL: {model.stock})
                            </span>
                          </div>
                        ))}
                        {item.models.length > 3 && (
                          <div className="text-sm text-muted-foreground">
                            +{item.models.length - 3} biến thể khác
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-1 text-sm">
                        <span className="text-green-600">{formatPrice(item.promo_price)}</span>
                        {item.original_price && (
                          <span className="text-muted-foreground line-through ml-2">
                            {formatPrice(item.original_price)}
                          </span>
                        )}
                        <span className="text-muted-foreground ml-2">
                          (SL: {item.stock || 0})
                        </span>
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Chỉnh sửa"
                        onClick={() => handleEditClick(item)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Xóa"
                        onClick={() => {
                          setSelectedItem(item);
                          setShowDeleteDialog(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa sản phẩm</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa sản phẩm #{selectedItem?.item_id} khỏi Flash Sale?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteItem} disabled={isDeleting}>
              {isDeleting ? 'Đang xóa...' : 'Xóa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Item dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm sản phẩm vào Flash Sale</DialogTitle>
            <DialogDescription>
              Nhập thông tin sản phẩm để thêm vào Flash Sale #{flashSale.flash_sale_id}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="item_id">Item ID</Label>
              <Input
                id="item_id"
                type="number"
                value={addItemForm.item_id}
                onChange={(e) => setAddItemForm((prev) => ({ ...prev, item_id: e.target.value }))}
                placeholder="Nhập Item ID"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="purchase_limit">Giới hạn mua (0 = không giới hạn)</Label>
              <Input
                id="purchase_limit"
                type="number"
                value={addItemForm.purchase_limit}
                onChange={(e) => setAddItemForm((prev) => ({ ...prev, purchase_limit: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="has_models"
                checked={addItemForm.has_models}
                onChange={(e) => setAddItemForm((prev) => ({ ...prev, has_models: e.target.checked }))}
              />
              <Label htmlFor="has_models">Sản phẩm có biến thể</Label>
            </div>

            {!addItemForm.has_models ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="item_promo_price">Giá khuyến mãi</Label>
                  <Input
                    id="item_promo_price"
                    type="number"
                    value={addItemForm.item_promo_price}
                    onChange={(e) => setAddItemForm((prev) => ({ ...prev, item_promo_price: e.target.value }))}
                    placeholder="VND"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="item_stock">Số lượng</Label>
                  <Input
                    id="item_stock"
                    type="number"
                    value={addItemForm.item_stock}
                    onChange={(e) => setAddItemForm((prev) => ({ ...prev, item_stock: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Biến thể</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addModelToForm}>
                    <Plus className="h-3 w-3 mr-1" /> Thêm
                  </Button>
                </div>
                {addItemForm.models.map((model, index) => (
                  <div key={index} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Biến thể {index + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeModelFromForm(index)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <Input
                      type="number"
                      placeholder="Model ID"
                      value={model.model_id}
                      onChange={(e) => {
                        const newModels = [...addItemForm.models];
                        newModels[index].model_id = e.target.value;
                        setAddItemForm((prev) => ({ ...prev, models: newModels }));
                      }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder="Giá KM"
                        value={model.promo_price}
                        onChange={(e) => {
                          const newModels = [...addItemForm.models];
                          newModels[index].promo_price = e.target.value;
                          setAddItemForm((prev) => ({ ...prev, models: newModels }));
                        }}
                      />
                      <Input
                        type="number"
                        placeholder="Số lượng"
                        value={model.stock}
                        onChange={(e) => {
                          const newModels = [...addItemForm.models];
                          newModels[index].stock = e.target.value;
                          setAddItemForm((prev) => ({ ...prev, models: newModels }));
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} disabled={isAdding}>
              Hủy
            </Button>
            <Button onClick={handleAddItem} disabled={isAdding}>
              {isAdding ? 'Đang thêm...' : 'Thêm sản phẩm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa sản phẩm</DialogTitle>
            <DialogDescription>
              Cập nhật thông tin sản phẩm #{editItemForm?.item_id}
            </DialogDescription>
          </DialogHeader>

          {editItemForm && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit_purchase_limit">Giới hạn mua (0 = không giới hạn)</Label>
                <Input
                  id="edit_purchase_limit"
                  type="number"
                  value={editItemForm.purchase_limit}
                  onChange={(e) => setEditItemForm((prev) => prev ? { ...prev, purchase_limit: e.target.value } : null)}
                />
              </div>

              {!editItemForm.has_models ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="edit_promo_price">Giá khuyến mãi</Label>
                    <Input
                      id="edit_promo_price"
                      type="number"
                      value={editItemForm.item_promo_price}
                      onChange={(e) => setEditItemForm((prev) => prev ? { ...prev, item_promo_price: e.target.value } : null)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_stock">Số lượng</Label>
                    <Input
                      id="edit_stock"
                      type="number"
                      value={editItemForm.item_stock}
                      onChange={(e) => setEditItemForm((prev) => prev ? { ...prev, item_stock: e.target.value } : null)}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <Label>Biến thể</Label>
                  {editItemForm.models.map((model, index) => (
                    <div key={model.model_id} className="p-3 border rounded-lg space-y-2">
                      <span className="text-sm font-medium">Model #{model.model_id}</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Giá KM</Label>
                          <Input
                            type="number"
                            value={model.promo_price}
                            onChange={(e) => {
                              const newModels = [...editItemForm.models];
                              newModels[index].promo_price = e.target.value;
                              setEditItemForm((prev) => prev ? { ...prev, models: newModels } : null);
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Số lượng</Label>
                          <Input
                            type="number"
                            value={model.stock}
                            onChange={(e) => {
                              const newModels = [...editItemForm.models];
                              newModels[index].stock = e.target.value;
                              setEditItemForm((prev) => prev ? { ...prev, models: newModels } : null);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={isUpdating}>
              Hủy
            </Button>
            <Button onClick={handleUpdateItem} disabled={isUpdating}>
              {isUpdating ? 'Đang cập nhật...' : 'Cập nhật'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default FlashSaleDetailPanel;

/**
 * OrderDetailDialog - Dialog hiển thị chi tiết đơn hàng
 * Hiển thị đầy đủ thông tin từ Shopee API với các tab
 * Bao gồm thông tin tài chính từ get_escrow_detail API
 */

import { Copy, Check, Package, Truck, User, FileText, MapPin, CreditCard, Clock, AlertCircle, Tag, DollarSign, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import type { ShopeeOrder } from '@/components/panels/OrdersPanel';

interface OrderDetailDialogProps {
  order: ShopeeOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: number;
}

// ==================== ESCROW INTERFACES ====================

interface EscrowItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_id: number;
  model_name?: string;
  model_sku?: string;
  original_price: number;
  selling_price: number;
  discounted_price: number;
  seller_discount: number;
  shopee_discount: number;
  discount_from_coin: number;
  discount_from_voucher_shopee: number;
  discount_from_voucher_seller: number;
  quantity_purchased: number;
  activity_type?: string;
  activity_id?: number;
  is_main_item?: boolean;
  is_b2c_shop_item?: boolean;
  ams_commission_fee?: number;
  promotion_list?: { promotion_type: string; promotion_id: number }[];
}

interface OrderAdjustment {
  amount: number;
  date: number;
  currency: string;
  adjustment_reason?: string;
}

interface BuyerPaymentInfo {
  buyer_payment_method?: string;
  buyer_total_amount?: number;
  merchant_subtotal?: number;
  shipping_fee?: number;
  seller_voucher?: number;
  shopee_voucher?: number;
  shopee_coins_redeemed?: number;
  credit_card_promotion?: number;
  insurance_premium?: number;
  buyer_service_fee?: number;
  buyer_tax_amount?: number;
  is_paid_by_credit_card?: boolean;
}

interface OrderIncome {
  escrow_amount: number;
  buyer_total_amount: number;
  original_price: number;
  order_original_price: number;
  order_discounted_price: number;
  order_selling_price: number;
  order_seller_discount: number;
  seller_discount: number;
  shopee_discount: number;
  original_shopee_discount: number;
  voucher_from_seller: number;
  voucher_from_shopee: number;
  coins: number;
  buyer_paid_shipping_fee: number;
  buyer_transaction_fee: number;
  cross_border_tax: number;
  payment_promotion: number;
  commission_fee: number;
  service_fee: number;
  seller_transaction_fee: number;
  seller_lost_compensation: number;
  seller_coin_cash_back: number;
  escrow_tax: number;
  estimated_shipping_fee: number;
  final_shipping_fee: number;
  actual_shipping_fee: number;
  shopee_shipping_rebate: number;
  shipping_fee_discount_from_3pl: number;
  seller_shipping_discount: number;
  reverse_shipping_fee: number;
  drc_adjustable_refund: number;
  cost_of_goods_sold: number;
  original_cost_of_goods_sold: number;
  seller_return_refund: number;
  campaign_fee: number;
  order_ams_commission_fee: number;
  final_product_protection: number;
  credit_card_promotion: number;
  credit_card_transaction_fee: number;
  final_product_vat_tax: number;
  final_shipping_vat_tax: number;
  final_escrow_product_gst: number;
  final_escrow_shipping_gst: number;
  total_adjustment_amount: number;
  escrow_amount_after_adjustment: number;
  buyer_payment_method?: string;
  instalment_plan?: string;
  items: EscrowItem[];
  order_adjustment?: OrderAdjustment[];
  seller_voucher_code?: string[];
  // Additional fields
  shipping_fee_sst?: number;
  reverse_shipping_fee_sst?: number;
  rsf_seller_protection_fee_claim_amount?: number;
  shipping_seller_protection_fee_amount?: number;
  delivery_seller_protection_fee_premium_amount?: number;
  withholding_tax?: number;
  sales_tax_on_lvg?: number;
  overseas_return_service_fee?: number;
  vat_on_imported_goods?: number;
  withholding_vat_tax?: number;
  withholding_pit_tax?: number;
  seller_order_processing_fee?: number;
  fbs_fee?: number;
  net_commission_fee?: number;
  net_service_fee?: number;
}

interface EscrowData {
  order_sn: string;
  buyer_user_name: string;
  return_order_sn_list: string[];
  order_income: OrderIncome;
  buyer_payment_info?: BuyerPaymentInfo;
}

// ==================== CONSTANTS ====================

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  UNPAID: { label: 'Chờ thanh toán', variant: 'secondary' },
  READY_TO_SHIP: { label: 'Chờ lấy hàng', variant: 'default' },
  PROCESSED: { label: 'Đang xử lý', variant: 'outline' },
  SHIPPED: { label: 'Đang giao', variant: 'default' },
  COMPLETED: { label: 'Hoàn thành', variant: 'default' },
  IN_CANCEL: { label: 'Đang hủy', variant: 'destructive' },
  CANCELLED: { label: 'Đã hủy', variant: 'destructive' },
  INVOICE_PENDING: { label: 'Chờ hóa đơn', variant: 'outline' },
  PENDING: { label: 'Đang chờ', variant: 'secondary' },
};

const LOGISTICS_STATUS: Record<string, string> = {
  LOGISTICS_NOT_STARTED: 'Chưa bắt đầu',
  LOGISTICS_REQUEST_CREATED: 'Đã tạo yêu cầu',
  LOGISTICS_PICKUP_DONE: 'Đã lấy hàng',
  LOGISTICS_PICKUP_RETRY: 'Lấy hàng lại',
  LOGISTICS_PICKUP_FAILED: 'Lấy hàng thất bại',
  LOGISTICS_DELIVERY_DONE: 'Đã giao hàng',
  LOGISTICS_DELIVERY_FAILED: 'Giao hàng thất bại',
  LOGISTICS_REQUEST_CANCELED: 'Đã hủy yêu cầu',
  LOGISTICS_COD_REJECTED: 'COD bị từ chối',
  LOGISTICS_READY: 'Sẵn sàng',
  LOGISTICS_INVALID: 'Không hợp lệ',
  LOGISTICS_LOST: 'Thất lạc',
  LOGISTICS_PENDING_ARRANGE: 'Chờ sắp xếp',
};

const FULFILLMENT_FLAGS: Record<string, string> = {
  fulfilled_by_shopee: 'Shopee Fulfillment',
  fulfilled_by_cb_seller: 'Cross-border Seller',
  fulfilled_by_local_seller: 'Seller tự giao',
};

// ==================== UTILITIES ====================

function formatPrice(price: number | undefined | null, currency?: string): string {
  if (price === undefined || price === null) return '-';
  if (currency === 'VND' || !currency) {
    return new Intl.NumberFormat('vi-VN').format(price) + ' đ';
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
}

function formatDateTime(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function formatDate(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

// ==================== SUB COMPONENTS ====================

function InfoRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex justify-between py-2 border-b border-slate-100 last:border-0", className)}>
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="text-slate-800 text-sm font-medium text-right">{value || '-'}</span>
    </div>
  );
}

function FinanceRow({
  label,
  value,
  currency,
  type = 'neutral',
  indent = false
}: {
  label: string;
  value: number | undefined | null;
  currency?: string;
  type?: 'income' | 'expense' | 'neutral';
  indent?: boolean;
}) {
  if (value === undefined || value === null || value === 0) return null;

  const Icon = type === 'income' ? TrendingUp : type === 'expense' ? TrendingDown : Minus;
  const colorClass = type === 'income' ? 'text-green-600' : type === 'expense' ? 'text-red-600' : 'text-slate-700';

  return (
    <div className={cn("flex justify-between py-1.5", indent && "pl-4")}>
      <span className={cn("text-sm", indent ? "text-slate-400" : "text-slate-600")}>{label}</span>
      <div className={cn("flex items-center gap-1 text-sm font-medium", colorClass)}>
        <Icon className="h-3 w-3" />
        <span>{type === 'expense' ? '-' : ''}{formatPrice(Math.abs(value), currency)}</span>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b">
      <Icon className="h-4 w-4 text-orange-500" />
      <h4 className="font-semibold text-slate-800">{title}</h4>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy} className="ml-2 text-slate-400 hover:text-slate-600">
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ==================== MAIN COMPONENT ====================

export function OrderDetailDialog({ order, open, onOpenChange, shopId }: OrderDetailDialogProps) {
  const status = STATUS_BADGE[order.order_status] || { label: order.order_status, variant: 'outline' as const };

  // Escrow data state
  const [escrowData, setEscrowData] = useState<EscrowData | null>(null);
  const [loadingEscrow, setLoadingEscrow] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);

  // Fetch escrow data
  const fetchEscrowData = useCallback(async () => {
    if (!shopId || !order.order_sn) return;

    setLoadingEscrow(true);
    setEscrowError(null);

    try {
      const res = await supabase.functions.invoke('apishopee-proxy', {
        body: {
          api_path: '/api/v2/payment/get_escrow_detail',
          method: 'GET',
          shop_id: shopId,
          params: {
            order_sn: order.order_sn,
          },
        },
      });

      if (res.error) throw res.error;

      const data = res.data?.response?.data?.response;
      if (data) {
        setEscrowData(data);
      } else if (res.data?.response?.data?.error) {
        setEscrowError(res.data.response.data.message || 'Không thể tải thông tin tài chính');
      }
    } catch (err) {
      setEscrowError((err as Error).message);
    } finally {
      setLoadingEscrow(false);
    }
  }, [shopId, order.order_sn]);

  // Fetch escrow data when dialog opens
  useEffect(() => {
    if (open) {
      fetchEscrowData();
    }
  }, [open, fetchEscrowData]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-lg">Chi tiết đơn hàng</DialogTitle>
              <Badge variant={status.variant}>{status.label}</Badge>
              {order.cod && <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">COD</Badge>}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Mã đơn:</span>
              <code className="font-mono bg-slate-100 px-2 py-1 rounded">{order.order_sn}</code>
              <CopyButton text={order.order_sn} />
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="general">Thông tin chung</TabsTrigger>
            <TabsTrigger value="products">Sản phẩm ({order.item_list?.length || 0})</TabsTrigger>
            <TabsTrigger value="shipping">Vận chuyển</TabsTrigger>
            <TabsTrigger value="finance">
              <DollarSign className="h-3.5 w-3.5 mr-1" />
              Tài chính
            </TabsTrigger>
            <TabsTrigger value="other">Khác</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto mt-4">
            {/* Tab 1: Thông tin chung */}
            <TabsContent value="general" className="mt-0 space-y-6">
              {/* Thông tin đơn hàng */}
              <div className="bg-white rounded-lg border p-4">
                <SectionTitle icon={FileText} title="Thông tin đơn hàng" />
                <div className="grid grid-cols-2 gap-x-8">
                  <InfoRow label="Mã đơn hàng" value={<span className="font-mono">{order.order_sn}</span>} />
                  <InfoRow label="Trạng thái" value={<Badge variant={status.variant}>{status.label}</Badge>} />
                  <InfoRow label="Khu vực" value={order.region} />
                  <InfoRow label="Tiền tệ" value={order.currency} />
                  <InfoRow label="Ngày tạo" value={formatDateTime(order.create_time)} />
                  <InfoRow label="Cập nhật lần cuối" value={formatDateTime(order.update_time)} />
                  <InfoRow label="Hạn giao hàng" value={order.days_to_ship ? `${order.days_to_ship} ngày` : '-'} />
                  <InfoRow label="Giao trước ngày" value={formatDateTime(order.ship_by_date)} />
                  {order.booking_sn && <InfoRow label="Mã booking" value={<span className="font-mono">{order.booking_sn}</span>} />}
                  {order.fulfillment_flag && <InfoRow label="Fulfillment" value={FULFILLMENT_FLAGS[order.fulfillment_flag] || order.fulfillment_flag} />}
                </div>
              </div>

              {/* Thông tin người mua */}
              <div className="bg-white rounded-lg border p-4">
                <SectionTitle icon={User} title="Thông tin người mua" />
                <div className="grid grid-cols-2 gap-x-8">
                  <InfoRow label="Tên người mua" value={order.buyer_username} />
                  <InfoRow label="User ID" value={order.buyer_user_id} />
                  {order.buyer_cpf_id && <InfoRow label="CPF ID" value={order.buyer_cpf_id} />}
                  {order.dropshipper && <InfoRow label="Dropshipper" value={order.dropshipper} />}
                  {order.dropshipper_phone && <InfoRow label="SĐT Dropshipper" value={order.dropshipper_phone} />}
                </div>
              </div>

              {/* Thông tin thanh toán */}
              <div className="bg-white rounded-lg border p-4">
                <SectionTitle icon={CreditCard} title="Thông tin thanh toán" />
                <div className="grid grid-cols-2 gap-x-8">
                  <InfoRow
                    label="Tổng tiền"
                    value={<span className="text-orange-600 font-bold">{formatPrice(order.total_amount, order.currency)}</span>}
                  />
                  <InfoRow label="Phương thức thanh toán" value={order.payment_method} />
                  <InfoRow label="Thời gian thanh toán" value={formatDateTime(order.pay_time)} />
                  <InfoRow label="COD" value={order.cod ? 'Có' : 'Không'} />
                  <InfoRow label="Phí vận chuyển (dự kiến)" value={order.estimated_shipping_fee ? formatPrice(order.estimated_shipping_fee, order.currency) : '-'} />
                  <InfoRow label="Phí vận chuyển (thực tế)" value={order.actual_shipping_fee ? formatPrice(order.actual_shipping_fee, order.currency) : '-'} />
                  {order.actual_shipping_fee_confirmed !== undefined && (
                    <InfoRow label="Phí vận chuyển đã xác nhận" value={order.actual_shipping_fee_confirmed ? 'Có' : 'Chưa'} />
                  )}
                  {order.reverse_shipping_fee !== undefined && order.reverse_shipping_fee > 0 && (
                    <InfoRow label="Phí hoàn trả" value={formatPrice(order.reverse_shipping_fee, order.currency)} />
                  )}
                  {order.order_chargeable_weight_gram && (
                    <InfoRow label="Trọng lượng tính phí" value={`${order.order_chargeable_weight_gram}g`} />
                  )}
                </div>

                {/* Payment Info (BR) */}
                {order.payment_info && order.payment_info.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <h5 className="text-sm font-medium text-slate-700 mb-2">Chi tiết thanh toán</h5>
                    <div className="space-y-2">
                      {order.payment_info.map((pi, idx) => (
                        <div key={idx} className="bg-slate-50 rounded p-3 text-sm">
                          <div className="flex justify-between">
                            <span>{pi.payment_method}</span>
                            <span className="font-medium">{formatPrice(pi.payment_amount, order.currency)}</span>
                          </div>
                          {pi.card_brand && <div className="text-slate-500 text-xs mt-1">Card: {pi.card_brand}</div>}
                          {pi.transaction_id && <div className="text-slate-500 text-xs">Transaction: {pi.transaction_id}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Pending Info */}
              {order.pending_terms && order.pending_terms.length > 0 && (
                <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
                  <SectionTitle icon={Clock} title="Đang chờ xử lý" />
                  <div className="space-y-2">
                    {order.pending_terms.map((term, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-yellow-800">{term}</p>
                          {order.pending_description?.[idx] && (
                            <p className="text-xs text-yellow-600">{order.pending_description[idx]}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Tab 2: Sản phẩm */}
            <TabsContent value="products" className="mt-0 space-y-4">
              {order.item_list && order.item_list.length > 0 ? (
                order.item_list.map((item, idx) => (
                  <div key={idx} className="bg-white rounded-lg border p-4">
                    <div className="flex gap-4">
                      {/* Image */}
                      {item.image_info?.image_url ? (
                        <ImageWithZoom
                          src={item.image_info.image_url}
                          alt={item.item_name}
                          className="w-24 h-24 object-cover rounded-lg border flex-shrink-0"
                          zoomSize={300}
                        />
                      ) : (
                        <div className="w-24 h-24 bg-slate-100 rounded-lg border flex items-center justify-center flex-shrink-0">
                          <Package className="w-8 h-8 text-slate-400" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-800 line-clamp-2">{item.item_name}</h4>

                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          {item.model_name && (
                            <div className="text-slate-500">
                              Phân loại: <span className="text-slate-700">{item.model_name}</span>
                            </div>
                          )}
                          {item.item_sku && (
                            <div className="text-slate-500">
                              SKU: <code className="bg-slate-100 px-1 rounded">{item.item_sku}</code>
                            </div>
                          )}
                          {item.model_sku && (
                            <div className="text-slate-500">
                              Model SKU: <code className="bg-slate-100 px-1 rounded">{item.model_sku}</code>
                            </div>
                          )}
                          <div className="text-slate-500">
                            Item ID: <span className="font-mono">{item.item_id}</span>
                          </div>
                          {item.model_id !== 0 && (
                            <div className="text-slate-500">
                              Model ID: <span className="font-mono">{item.model_id}</span>
                            </div>
                          )}
                          {item.weight && (
                            <div className="text-slate-500">
                              Trọng lượng: <span className="text-slate-700">{item.weight}kg</span>
                            </div>
                          )}
                        </div>

                        {/* Promotion */}
                        {item.promotion_type && (
                          <div className="mt-2 flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5 text-red-500" />
                            <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded">
                              {item.promotion_type}
                            </span>
                            {item.promotion_id && (
                              <span className="text-xs text-slate-400">ID: {item.promotion_id}</span>
                            )}
                          </div>
                        )}

                        {/* Add-on Deal */}
                        {item.add_on_deal && (
                          <div className="mt-1 text-xs text-blue-600">
                            {item.main_item ? 'Sản phẩm chính (Add-on Deal)' : 'Sản phẩm phụ (Add-on Deal)'}
                          </div>
                        )}
                      </div>

                      {/* Price & Quantity */}
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-bold text-orange-600">
                          {formatPrice(item.model_discounted_price, order.currency)}
                        </div>
                        {item.model_original_price !== item.model_discounted_price && (
                          <div className="text-sm text-slate-400 line-through">
                            {formatPrice(item.model_original_price, order.currency)}
                          </div>
                        )}
                        <div className="text-sm text-slate-600 mt-1">
                          x{item.model_quantity_purchased}
                        </div>
                        <div className="text-sm font-medium text-slate-800 mt-2 pt-2 border-t">
                          = {formatPrice(item.model_discounted_price * item.model_quantity_purchased, order.currency)}
                        </div>
                        {item.wholesale && (
                          <Badge variant="outline" className="mt-2">Bán sỉ</Badge>
                        )}
                      </div>
                    </div>

                    {/* Product Location */}
                    {item.product_location_id && item.product_location_id.length > 0 && (
                      <div className="mt-3 pt-3 border-t text-xs text-slate-500">
                        Kho hàng: {item.product_location_id.join(', ')}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <Package className="h-12 w-12 mx-auto mb-3" />
                  <p>Không có thông tin sản phẩm</p>
                </div>
              )}

              {/* Tổng cộng */}
              {order.item_list && order.item_list.length > 0 && (
                <div className="bg-orange-50 rounded-lg border border-orange-200 p-4">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-slate-700">Tổng tiền hàng:</span>
                    <span className="text-xl font-bold text-orange-600">
                      {formatPrice(order.total_amount, order.currency)}
                    </span>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Tab 3: Vận chuyển */}
            <TabsContent value="shipping" className="mt-0 space-y-6">
              {/* Địa chỉ nhận hàng */}
              <div className="bg-white rounded-lg border p-4">
                <SectionTitle icon={MapPin} title="Địa chỉ nhận hàng" />
                {order.recipient_address ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <User className="h-4 w-4 text-slate-400 mt-1" />
                      <div>
                        <p className="font-medium text-slate-800">{order.recipient_address.name}</p>
                        <p className="text-sm text-slate-600">{order.recipient_address.phone}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 text-slate-400 mt-1" />
                      <div className="text-sm text-slate-600">
                        <p>{order.recipient_address.full_address}</p>
                        <p className="mt-1">
                          {[
                            order.recipient_address.town,
                            order.recipient_address.district,
                            order.recipient_address.city,
                            order.recipient_address.state,
                            order.recipient_address.region
                          ].filter(Boolean).join(', ')}
                        </p>
                        {order.recipient_address.zipcode && (
                          <p className="text-slate-400">Mã bưu điện: {order.recipient_address.zipcode}</p>
                        )}
                      </div>
                    </div>
                    {order.recipient_address.geolocation && (
                      <div className="text-xs text-slate-400">
                        Tọa độ: {order.recipient_address.geolocation.latitude}, {order.recipient_address.geolocation.longitude}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">Không có thông tin địa chỉ</p>
                )}
              </div>

              {/* Thông tin vận chuyển */}
              <div className="bg-white rounded-lg border p-4">
                <SectionTitle icon={Truck} title="Thông tin vận chuyển" />
                <div className="grid grid-cols-2 gap-x-8">
                  <InfoRow label="Đơn vị vận chuyển" value={order.shipping_carrier} />
                  <InfoRow label="Đơn vị checkout" value={order.checkout_shipping_carrier} />
                  <InfoRow label="Thời gian lấy hàng" value={formatDateTime(order.pickup_done_time)} />
                  <InfoRow label="Chia tách đơn" value={order.split_up ? 'Có' : 'Không'} />
                  <InfoRow label="Khai báo hải quan" value={order.goods_to_declare ? 'Có' : 'Không'} />
                  {order.advance_package !== undefined && (
                    <InfoRow label="Advance Fulfillment" value={order.advance_package ? 'Có' : 'Không'} />
                  )}
                </div>
              </div>

              {/* Danh sách kiện hàng */}
              {order.package_list && order.package_list.length > 0 && (
                <div className="bg-white rounded-lg border p-4">
                  <SectionTitle icon={Package} title={`Kiện hàng (${order.package_list.length})`} />
                  <div className="space-y-4">
                    {order.package_list.map((pkg, idx) => (
                      <div key={idx} className="bg-slate-50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-slate-500" />
                            <code className="font-mono text-sm bg-white px-2 py-1 rounded border">
                              {pkg.package_number}
                            </code>
                            <CopyButton text={pkg.package_number} />
                          </div>
                          <Badge variant="outline">
                            {LOGISTICS_STATUS[pkg.logistics_status] || pkg.logistics_status}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                          <div className="text-slate-500">
                            Đơn vị vận chuyển: <span className="text-slate-700">{pkg.shipping_carrier}</span>
                          </div>
                          <div className="text-slate-500">
                            Channel ID: <span className="font-mono text-slate-700">{pkg.logistics_channel_id}</span>
                          </div>
                          {pkg.parcel_chargeable_weight_gram && (
                            <div className="text-slate-500">
                              Trọng lượng: <span className="text-slate-700">{pkg.parcel_chargeable_weight_gram}g</span>
                            </div>
                          )}
                          {pkg.group_shipment_id && (
                            <div className="text-slate-500">
                              Group Shipment: <span className="font-mono text-slate-700">{pkg.group_shipment_id}</span>
                            </div>
                          )}
                          {pkg.virtual_contact_number && (
                            <div className="text-slate-500">
                              SĐT ảo: <span className="text-slate-700">{pkg.virtual_contact_number}</span>
                            </div>
                          )}
                          {pkg.sorting_group && (
                            <div className="text-slate-500">
                              Nhóm phân loại: <span className="text-slate-700">{pkg.sorting_group}</span>
                            </div>
                          )}
                          {pkg.allow_self_design_awb !== undefined && (
                            <div className="text-slate-500">
                              Tự thiết kế AWB: <span className="text-slate-700">{pkg.allow_self_design_awb ? 'Có' : 'Không'}</span>
                            </div>
                          )}
                        </div>

                        {/* Items trong package */}
                        {pkg.item_list && pkg.item_list.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-200">
                            <p className="text-xs font-medium text-slate-500 mb-2">Sản phẩm trong kiện ({pkg.item_list.length})</p>
                            <div className="space-y-1">
                              {pkg.item_list.map((pi, pidx) => (
                                <div key={pidx} className="flex justify-between text-xs bg-white rounded px-2 py-1">
                                  <span className="text-slate-600">
                                    Item {pi.item_id} / Model {pi.model_id}
                                  </span>
                                  <span className="text-slate-800">x{pi.model_quantity}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* EDT (Estimated Delivery Time) */}
              {(order.edt_from || order.edt_to) && (
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                  <SectionTitle icon={Clock} title="Thời gian giao hàng dự kiến" />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-slate-500">Từ:</span>
                      <p className="font-medium">{formatDateTime(order.edt_from)}</p>
                    </div>
                    <div>
                      <span className="text-sm text-slate-500">Đến:</span>
                      <p className="font-medium">{formatDateTime(order.edt_to)}</p>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Tab 4: Tài chính */}
            <TabsContent value="finance" className="mt-0 space-y-6">
              {loadingEscrow ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
                  <span className="ml-2 text-slate-500">Đang tải thông tin tài chính...</span>
                </div>
              ) : escrowError ? (
                <div className="bg-red-50 rounded-lg border border-red-200 p-6 text-center">
                  <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
                  <p className="text-red-600 mb-3">{escrowError}</p>
                  <Button variant="outline" size="sm" onClick={fetchEscrowData}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Thử lại
                  </Button>
                </div>
              ) : escrowData ? (
                <>
                  {/* Tổng quan */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200 p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-green-700 mb-1">Thu nhập dự kiến</p>
                        <p className="text-3xl font-bold text-green-600">
                          {formatPrice(escrowData.order_income.escrow_amount, order.currency)}
                        </p>
                        {escrowData.order_income.total_adjustment_amount !== 0 && (
                          <p className="text-sm text-green-600 mt-1">
                            Sau điều chỉnh: {formatPrice(escrowData.order_income.escrow_amount_after_adjustment, order.currency)}
                          </p>
                        )}
                      </div>
                      <DollarSign className="h-12 w-12 text-green-300" />
                    </div>
                  </div>

                  {/* Buyer Payment Info */}
                  {escrowData.buyer_payment_info && (
                    <div className="bg-white rounded-lg border p-4">
                      <SectionTitle icon={CreditCard} title="Thông tin thanh toán của người mua" />
                      <div className="space-y-1">
                        <FinanceRow label="Tổng thanh toán" value={escrowData.buyer_payment_info.buyer_total_amount} currency={order.currency} type="neutral" />
                        <FinanceRow label="Tiền hàng" value={escrowData.buyer_payment_info.merchant_subtotal} currency={order.currency} type="neutral" />
                        <FinanceRow label="Phí vận chuyển" value={escrowData.buyer_payment_info.shipping_fee} currency={order.currency} type="neutral" />
                        <FinanceRow label="Voucher người bán" value={escrowData.buyer_payment_info.seller_voucher} currency={order.currency} type="income" />
                        <FinanceRow label="Voucher Shopee" value={escrowData.buyer_payment_info.shopee_voucher} currency={order.currency} type="income" />
                        <FinanceRow label="Shopee Coins" value={escrowData.buyer_payment_info.shopee_coins_redeemed} currency={order.currency} type="income" />
                        <FinanceRow label="Khuyến mãi thẻ tín dụng" value={escrowData.buyer_payment_info.credit_card_promotion} currency={order.currency} type="income" />
                        <FinanceRow label="Bảo hiểm" value={escrowData.buyer_payment_info.insurance_premium} currency={order.currency} type="neutral" />
                        <FinanceRow label="Phí dịch vụ" value={escrowData.buyer_payment_info.buyer_service_fee} currency={order.currency} type="neutral" />
                        <FinanceRow label="Thuế" value={escrowData.buyer_payment_info.buyer_tax_amount} currency={order.currency} type="neutral" />
                      </div>
                      <div className="mt-3 pt-3 border-t text-sm text-slate-500">
                        Phương thức: {escrowData.buyer_payment_info.buyer_payment_method || '-'}
                        {escrowData.buyer_payment_info.is_paid_by_credit_card && ' (Thẻ tín dụng)'}
                      </div>
                    </div>
                  )}

                  {/* Chi tiết thu nhập */}
                  <div className="bg-white rounded-lg border p-4">
                    <SectionTitle icon={TrendingUp} title="Chi tiết thu nhập" />
                    <div className="space-y-1">
                      <FinanceRow label="Giá gốc đơn hàng" value={escrowData.order_income.order_original_price} currency={order.currency} type="neutral" />
                      <FinanceRow label="Giá bán đơn hàng" value={escrowData.order_income.order_selling_price} currency={order.currency} type="neutral" />
                      <FinanceRow label="Giá sau giảm" value={escrowData.order_income.order_discounted_price} currency={order.currency} type="neutral" />
                      <FinanceRow label="Giá vốn hàng bán" value={escrowData.order_income.cost_of_goods_sold} currency={order.currency} type="income" />
                      <FinanceRow label="Phí vận chuyển (người mua trả)" value={escrowData.order_income.buyer_paid_shipping_fee} currency={order.currency} type="income" />
                      <FinanceRow label="Hỗ trợ vận chuyển từ Shopee" value={escrowData.order_income.shopee_shipping_rebate} currency={order.currency} type="income" />
                      <FinanceRow label="Giảm giá vận chuyển từ 3PL" value={escrowData.order_income.shipping_fee_discount_from_3pl} currency={order.currency} type="income" />
                      <FinanceRow label="Bồi thường mất hàng" value={escrowData.order_income.seller_lost_compensation} currency={order.currency} type="income" />
                      <FinanceRow label="Hoàn trả cho seller" value={escrowData.order_income.seller_return_refund} currency={order.currency} type="income" />
                    </div>
                  </div>

                  {/* Các khoản giảm trừ */}
                  <div className="bg-white rounded-lg border p-4">
                    <SectionTitle icon={TrendingDown} title="Các khoản giảm trừ" />
                    <div className="space-y-1">
                      <FinanceRow label="Giảm giá từ seller" value={escrowData.order_income.seller_discount} currency={order.currency} type="expense" />
                      <FinanceRow label="Giảm giá từ Shopee" value={escrowData.order_income.shopee_discount} currency={order.currency} type="expense" />
                      <FinanceRow label="Voucher seller" value={escrowData.order_income.voucher_from_seller} currency={order.currency} type="expense" />
                      <FinanceRow label="Shopee Coins hoàn lại" value={escrowData.order_income.seller_coin_cash_back} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí hoa hồng" value={escrowData.order_income.commission_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí dịch vụ" value={escrowData.order_income.service_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí giao dịch seller" value={escrowData.order_income.seller_transaction_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí chiến dịch" value={escrowData.order_income.campaign_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí affiliate" value={escrowData.order_income.order_ams_commission_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí vận chuyển thực tế" value={escrowData.order_income.actual_shipping_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí vận chuyển hoàn" value={escrowData.order_income.reverse_shipping_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Hoàn tiền từ DRC" value={escrowData.order_income.drc_adjustable_refund} currency={order.currency} type="expense" />
                      <FinanceRow label="Thuế escrow" value={escrowData.order_income.escrow_tax} currency={order.currency} type="expense" />
                      <FinanceRow label="VAT sản phẩm" value={escrowData.order_income.final_product_vat_tax} currency={order.currency} type="expense" />
                      <FinanceRow label="VAT vận chuyển" value={escrowData.order_income.final_shipping_vat_tax} currency={order.currency} type="expense" />
                      <FinanceRow label="GST sản phẩm" value={escrowData.order_income.final_escrow_product_gst} currency={order.currency} type="expense" />
                      <FinanceRow label="GST vận chuyển" value={escrowData.order_income.final_escrow_shipping_gst} currency={order.currency} type="expense" />
                      <FinanceRow label="Thuế khấu trừ" value={escrowData.order_income.withholding_tax} currency={order.currency} type="expense" />
                      <FinanceRow label="Thuế VAT khấu trừ" value={escrowData.order_income.withholding_vat_tax} currency={order.currency} type="expense" />
                      <FinanceRow label="Thuế TNCN khấu trừ" value={escrowData.order_income.withholding_pit_tax} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí xử lý đơn hàng" value={escrowData.order_income.seller_order_processing_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí FBS" value={escrowData.order_income.fbs_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Phí hoàn hàng quốc tế" value={escrowData.order_income.overseas_return_service_fee} currency={order.currency} type="expense" />
                      <FinanceRow label="Thuế hàng nhập khẩu" value={escrowData.order_income.vat_on_imported_goods} currency={order.currency} type="expense" />
                    </div>
                  </div>

                  {/* Điều chỉnh */}
                  {escrowData.order_income.order_adjustment && escrowData.order_income.order_adjustment.length > 0 && (
                    <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
                      <SectionTitle icon={AlertCircle} title="Điều chỉnh đơn hàng" />
                      <div className="space-y-3">
                        {escrowData.order_income.order_adjustment.map((adj, idx) => (
                          <div key={idx} className="bg-white rounded p-3">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-medium text-slate-700">{adj.adjustment_reason || 'Điều chỉnh'}</p>
                                <p className="text-xs text-slate-500 mt-1">{formatDateTime(adj.date)}</p>
                              </div>
                              <span className={cn(
                                "font-medium",
                                adj.amount >= 0 ? "text-green-600" : "text-red-600"
                              )}>
                                {adj.amount >= 0 ? '+' : ''}{formatPrice(adj.amount, adj.currency)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-3 border-t flex justify-between">
                        <span className="font-medium text-slate-700">Tổng điều chỉnh:</span>
                        <span className={cn(
                          "font-bold",
                          escrowData.order_income.total_adjustment_amount >= 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {formatPrice(escrowData.order_income.total_adjustment_amount, order.currency)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Return Orders */}
                  {escrowData.return_order_sn_list && escrowData.return_order_sn_list.length > 0 && (
                    <div className="bg-orange-50 rounded-lg border border-orange-200 p-4">
                      <SectionTitle icon={Package} title="Đơn hoàn trả" />
                      <div className="flex flex-wrap gap-2">
                        {escrowData.return_order_sn_list.map((sn, idx) => (
                          <div key={idx} className="flex items-center gap-1 bg-white px-2 py-1 rounded border">
                            <code className="font-mono text-sm">{sn}</code>
                            <CopyButton text={sn} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Voucher codes */}
                  {escrowData.order_income.seller_voucher_code && escrowData.order_income.seller_voucher_code.length > 0 && (
                    <div className="bg-white rounded-lg border p-4">
                      <SectionTitle icon={Tag} title="Mã voucher seller" />
                      <div className="flex flex-wrap gap-2">
                        {escrowData.order_income.seller_voucher_code.map((code, idx) => (
                          <Badge key={idx} variant="outline">{code}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Chi tiết sản phẩm từ Escrow */}
                  {escrowData.order_income.items && escrowData.order_income.items.length > 0 && (
                    <div className="bg-white rounded-lg border p-4">
                      <SectionTitle icon={Package} title="Chi tiết tài chính theo sản phẩm" />
                      <div className="space-y-4">
                        {escrowData.order_income.items.map((item, idx) => (
                          <div key={idx} className="bg-slate-50 rounded-lg p-4">
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-slate-800 line-clamp-1">{item.item_name}</p>
                                <p className="text-xs text-slate-500 mt-1">
                                  {item.model_name && `${item.model_name} • `}
                                  x{item.quantity_purchased}
                                </p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                              <div className="flex justify-between">
                                <span className="text-slate-500">Giá gốc:</span>
                                <span>{formatPrice(item.original_price, order.currency)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500">Giá bán:</span>
                                <span>{formatPrice(item.selling_price, order.currency)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500">Giá sau giảm:</span>
                                <span className="text-orange-600 font-medium">{formatPrice(item.discounted_price, order.currency)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500">Giảm từ seller:</span>
                                <span className="text-red-500">-{formatPrice(item.seller_discount, order.currency)}</span>
                              </div>
                              {item.shopee_discount > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Giảm từ Shopee:</span>
                                  <span className="text-red-500">-{formatPrice(item.shopee_discount, order.currency)}</span>
                                </div>
                              )}
                              {item.discount_from_coin > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Từ Coins:</span>
                                  <span className="text-red-500">-{formatPrice(item.discount_from_coin, order.currency)}</span>
                                </div>
                              )}
                              {item.discount_from_voucher_shopee > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Voucher Shopee:</span>
                                  <span className="text-red-500">-{formatPrice(item.discount_from_voucher_shopee, order.currency)}</span>
                                </div>
                              )}
                              {item.discount_from_voucher_seller > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Voucher Seller:</span>
                                  <span className="text-red-500">-{formatPrice(item.discount_from_voucher_seller, order.currency)}</span>
                                </div>
                              )}
                              {item.ams_commission_fee && item.ams_commission_fee > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Phí affiliate:</span>
                                  <span className="text-red-500">-{formatPrice(item.ams_commission_fee, order.currency)}</span>
                                </div>
                              )}
                            </div>
                            {item.activity_type && (
                              <div className="mt-2 pt-2 border-t border-slate-200">
                                <Badge variant="outline" className="text-xs">
                                  {item.activity_type === 'bundle_deal' ? 'Bundle Deal' : item.activity_type}
                                </Badge>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Download JSON */}
                  <div className="bg-white rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Tải dữ liệu tài chính (JSON)</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const blob = new Blob([JSON.stringify(escrowData, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `escrow_${order.order_sn}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        Tải JSON
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-16 text-slate-400">
                  <DollarSign className="h-12 w-12 mx-auto mb-3" />
                  <p>Không có thông tin tài chính</p>
                  <Button variant="outline" size="sm" onClick={fetchEscrowData} className="mt-4">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Tải thông tin
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Tab 5: Thông tin khác */}
            <TabsContent value="other" className="mt-0 space-y-6">
              {/* Ghi chú */}
              <div className="bg-white rounded-lg border p-4">
                <SectionTitle icon={FileText} title="Ghi chú" />
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tin nhắn từ người mua</label>
                    <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded p-3 min-h-[60px]">
                      {order.message_to_seller || <span className="text-slate-400 italic">Không có tin nhắn</span>}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Ghi chú của người bán</label>
                    <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded p-3 min-h-[60px]">
                      {order.note || <span className="text-slate-400 italic">Không có ghi chú</span>}
                    </p>
                    {order.note_update_time && (
                      <p className="text-xs text-slate-400 mt-1">
                        Cập nhật: {formatDateTime(order.note_update_time)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Thông tin hủy đơn */}
              {(order.cancel_by || order.cancel_reason || order.buyer_cancel_reason) && (
                <div className="bg-red-50 rounded-lg border border-red-200 p-4">
                  <SectionTitle icon={AlertCircle} title="Thông tin hủy đơn" />
                  <div className="space-y-2">
                    {order.cancel_by && (
                      <InfoRow label="Hủy bởi" value={
                        <Badge variant="destructive">{order.cancel_by}</Badge>
                      } />
                    )}
                    {order.cancel_reason && (
                      <InfoRow label="Lý do hủy" value={order.cancel_reason} />
                    )}
                    {order.buyer_cancel_reason && (
                      <InfoRow label="Lý do từ người mua" value={order.buyer_cancel_reason} />
                    )}
                  </div>
                </div>
              )}

              {/* Invoice Data */}
              {order.invoice_data && Object.keys(order.invoice_data).length > 0 && (
                <div className="bg-white rounded-lg border p-4">
                  <SectionTitle icon={FileText} title="Hóa đơn" />
                  <div className="grid grid-cols-2 gap-x-8">
                    {order.invoice_data.number && (
                      <InfoRow label="Số hóa đơn" value={order.invoice_data.number} />
                    )}
                    {order.invoice_data.series_number && (
                      <InfoRow label="Số series" value={order.invoice_data.series_number} />
                    )}
                    {order.invoice_data.issue_date && (
                      <InfoRow label="Ngày phát hành" value={formatDate(order.invoice_data.issue_date)} />
                    )}
                    {order.invoice_data.total_value && (
                      <InfoRow label="Tổng giá trị" value={formatPrice(order.invoice_data.total_value, order.currency)} />
                    )}
                    {order.invoice_data.products_total_value && (
                      <InfoRow label="Giá trị sản phẩm" value={formatPrice(order.invoice_data.products_total_value, order.currency)} />
                    )}
                    {order.invoice_data.tax_code && (
                      <InfoRow label="Mã số thuế" value={order.invoice_data.tax_code} />
                    )}
                    {order.invoice_data.access_key && (
                      <InfoRow label="Access Key" value={
                        <code className="text-xs break-all">{order.invoice_data.access_key}</code>
                      } />
                    )}
                  </div>
                </div>
              )}

              {/* Return Request */}
              {order.return_request_due_date && (
                <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
                  <SectionTitle icon={Clock} title="Hoàn trả / Đổi hàng" />
                  <InfoRow
                    label="Hạn yêu cầu hoàn trả"
                    value={formatDateTime(order.return_request_due_date)}
                  />
                </div>
              )}

              {/* Buyer Shop Collection */}
              {order.is_buyer_shop_collection && (
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                  <SectionTitle icon={MapPin} title="Nhận tại cửa hàng" />
                  <p className="text-sm text-blue-700">Đơn hàng này được nhận tại cửa hàng</p>
                  {order.buyer_proof_of_collection && order.buyer_proof_of_collection.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-slate-500 mb-2">Ảnh xác nhận nhận hàng:</p>
                      <div className="flex gap-2">
                        {order.buyer_proof_of_collection.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`Proof ${idx + 1}`}
                            className="w-20 h-20 object-cover rounded border"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Hot Listing */}
              {order.hot_listing_order && (
                <div className="bg-orange-50 rounded-lg border border-orange-200 p-4">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-orange-500">Hot Listing</Badge>
                    <span className="text-sm text-orange-700">Đơn hàng này có sản phẩm hot listing</span>
                  </div>
                </div>
              )}

              {/* Raw JSON Button */}
              <div className="bg-white rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Xem dữ liệu JSON gốc</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(order, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `order_${order.order_sn}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Tải JSON
                  </Button>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default OrderDetailDialog;

/**
 * OrderDetailPage - Trang chi tiết đơn hàng giống Shopee Seller Center
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Copy, Check, Package, Truck, MapPin,
  Clock, AlertCircle, RefreshCw, FileText, CreditCard, User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { ShopeeOrder } from '@/components/panels/OrdersPanel';

// ==================== ESCROW INTERFACES ====================

interface EscrowItem {
  item_id: number;
  item_name: string;
  model_id: number;
  model_name?: string;
  original_price: number;
  selling_price: number;
  discounted_price: number;
  seller_discount: number;
  shopee_discount: number;
  discount_from_coin: number;
  discount_from_voucher_shopee: number;
  discount_from_voucher_seller: number;
  quantity_purchased: number;
}

interface OrderIncome {
  escrow_amount: number;
  buyer_total_amount: number;
  order_original_price: number;
  order_selling_price: number;
  buyer_paid_shipping_fee: number;
  commission_fee: number;
  service_fee: number;
  seller_transaction_fee: number;
  // Tất cả các loại thuế từ Shopee API
  escrow_tax: number;
  final_product_vat_tax: number;
  final_shipping_vat_tax: number;
  final_escrow_product_gst: number;
  final_escrow_shipping_gst: number;
  withholding_tax?: number;
  withholding_vat_tax?: number;
  withholding_pit_tax?: number;
  cross_border_tax?: number;
  sales_tax_on_lvg?: number;
  vat_on_imported_goods?: number;
  items: EscrowItem[];
}

interface BuyerPaymentInfo {
  buyer_total_amount?: number;
  merchant_subtotal?: number;
  shipping_fee?: number;
  seller_voucher?: number;
  shopee_voucher?: number;
  shopee_coins_redeemed?: number;
}

interface EscrowData {
  order_sn: string;
  order_income: OrderIncome;
  buyer_payment_info?: BuyerPaymentInfo;
}

// ==================== CONSTANTS ====================

const FULL_OPTIONAL_FIELDS = [
  'buyer_user_id', 'buyer_username', 'estimated_shipping_fee',
  'recipient_address', 'actual_shipping_fee', 'goods_to_declare',
  'note', 'note_update_time', 'item_list', 'pay_time',
  'dropshipper', 'dropshipper_phone', 'split_up',
  'buyer_cancel_reason', 'cancel_by', 'cancel_reason',
  'actual_shipping_fee_confirmed', 'buyer_cpf_id',
  'fulfillment_flag', 'pickup_done_time', 'package_list',
  'shipping_carrier', 'payment_method', 'total_amount',
  'invoice_data', 'order_chargeable_weight_gram',
  'return_request_due_date', 'edt', 'payment_info'
].join(',');

const STATUS_STYLES: Record<string, { label: string; color: string; borderColor: string }> = {
  UNPAID: { label: 'Chờ thanh toán', color: 'text-yellow-700', borderColor: 'border-l-yellow-500' },
  READY_TO_SHIP: { label: 'Chờ lấy hàng', color: 'text-orange-600', borderColor: 'border-l-orange-500' },
  PROCESSED: { label: 'Đang xử lý', color: 'text-blue-700', borderColor: 'border-l-blue-500' },
  SHIPPED: { label: 'Đang giao', color: 'text-purple-700', borderColor: 'border-l-purple-500' },
  COMPLETED: { label: 'Hoàn thành', color: 'text-green-700', borderColor: 'border-l-green-500' },
  IN_CANCEL: { label: 'Đang hủy', color: 'text-orange-700', borderColor: 'border-l-orange-500' },
  CANCELLED: { label: 'Đã hủy', color: 'text-red-700', borderColor: 'border-l-red-500' },
};

// ==================== UTILITIES ====================

function formatPrice(price: number | undefined | null, currency?: string): string {
  if (price === undefined || price === null) return '₫0';
  if (currency === 'VND' || !currency) {
    return '₫' + new Intl.NumberFormat('vi-VN').format(price);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
}

function formatDateTime(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function maskText(text: string | undefined, keepFirst = 1, keepLast = 1): string {
  if (!text || text.length <= keepFirst + keepLast) return text || '';
  return text.slice(0, keepFirst) + '*'.repeat(Math.min(text.length - keepFirst - keepLast, 5)) + text.slice(-keepLast);
}

// ==================== SUB COMPONENTS ====================

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="ml-1 text-slate-400 hover:text-slate-600 transition-colors">
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function SectionCard({ icon: Icon, title, children, iconColor = "text-orange-500" }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  iconColor?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Icon className={cn("h-4 w-4", iconColor)} />
        <span className="text-sm font-semibold text-slate-800">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

export default function OrderDetailPage() {
  const { orderSn } = useParams<{ orderSn: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { selectedShopId } = useShopeeAuth();

  const [order, setOrder] = useState<ShopeeOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [escrowData, setEscrowData] = useState<EscrowData | null>(null);
  const [loadingEscrow, setLoadingEscrow] = useState(false);

  // Fetch order detail
  const fetchOrderDetail = useCallback(async () => {
    if (!selectedShopId || !orderSn) return;

    setLoading(true);
    setError(null);

    try {
      const res = await supabase.functions.invoke('apishopee-proxy', {
        body: {
          api_path: '/api/v2/order/get_order_detail',
          method: 'GET',
          shop_id: selectedShopId,
          params: {
            order_sn_list: orderSn,
            response_optional_fields: FULL_OPTIONAL_FIELDS,
            request_order_status_pending: 'true',
          },
        },
      });

      if (res.error) throw res.error;

      const orderList = res.data?.response?.data?.response?.order_list;
      if (orderList && orderList.length > 0) {
        setOrder(orderList[0]);
      } else {
        setError('Không tìm thấy đơn hàng');
      }
    } catch (err) {
      setError((err as Error).message);
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, orderSn, toast]);

  // Fetch escrow data
  const fetchEscrowData = useCallback(async () => {
    if (!selectedShopId || !orderSn) return;

    setLoadingEscrow(true);
    try {
      const res = await supabase.functions.invoke('apishopee-proxy', {
        body: {
          api_path: '/api/v2/payment/get_escrow_detail',
          method: 'GET',
          shop_id: selectedShopId,
          params: { order_sn: orderSn },
        },
      });

      if (res.error) throw res.error;
      const data = res.data?.response?.data?.response;
      if (data) setEscrowData(data);
    } catch {
      // Silently fail
    } finally {
      setLoadingEscrow(false);
    }
  }, [selectedShopId, orderSn]);

  useEffect(() => {
    fetchOrderDetail();
    fetchEscrowData();
  }, [fetchOrderDetail, fetchEscrowData]);

  if (!selectedShopId || !user?.id) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-12 w-12 text-slate-300 mb-4" />
        <p className="text-slate-500">Vui lòng chọn shop để xem chi tiết đơn hàng</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-12 w-12 text-red-300 mb-4" />
        <p className="text-red-500 mb-4">{error || 'Không tìm thấy đơn hàng'}</p>
        <Button variant="outline" onClick={() => navigate('/orders')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Quay lại
        </Button>
      </div>
    );
  }

  const status = STATUS_STYLES[order.order_status] || { label: order.order_status, color: 'text-gray-700', borderColor: 'border-l-gray-500' };
  const items = order.item_list || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Main 2-column layout */}
        <div className="flex gap-4">
          {/* LEFT COLUMN - Main Content */}
          <div className="flex-1 space-y-4">
            {/* Status Banner */}
            <div className={cn("bg-white rounded-lg shadow-sm border-l-4 p-4", status.borderColor)}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className={cn("h-5 w-5", status.color)} />
                    <span className={cn("text-sm font-semibold", status.color)}>{status.label}</span>
                    <button className="text-slate-400 hover:text-slate-600">
                      <AlertCircle className="h-4 w-4" />
                    </button>
                  </div>
                  {order.order_status === 'READY_TO_SHIP' && order.ship_by_date && (
                    <p className="text-sm text-slate-500">
                      Để tránh việc giao hàng trễ, vui lòng giao hàng/chuẩn bị hàng trước {formatDateTime(order.ship_by_date)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Combined Order Info Card */}
            <div className="bg-white rounded-lg shadow-sm border">
              {/* Mã đơn hàng */}
              <div className="px-4 py-3 border-b">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-semibold text-slate-800">Mã đơn hàng</span>
                </div>
                <div className="flex items-center pl-6">
                  <span className="text-sm text-orange-500 font-medium">{order.order_sn}</span>
                  <CopyButton text={order.order_sn} />
                </div>
              </div>

              {/* Địa chỉ nhận hàng */}
              <div className="px-4 py-3 border-b">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-semibold text-slate-800">Địa chỉ nhận hàng</span>
                </div>
                <div className="pl-6">
                  {order.recipient_address ? (
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700">
                          {maskText(order.recipient_address.name, 1, 1)}
                        </span>
                        <span className="text-slate-500">
                          {maskText(order.recipient_address.phone, 0, 2)}
                        </span>
                      </div>
                      <p className="text-slate-500">
                        {order.recipient_address.full_address?.replace(/[^,\s]/g, (char, i, str) => {
                          const commaIndex = str.lastIndexOf(',');
                          return i < commaIndex - 10 ? '*' : char;
                        })}
                      </p>
                      <p className="text-slate-500">
                        {[
                          order.recipient_address.town,
                          order.recipient_address.district,
                          order.recipient_address.city,
                          order.recipient_address.state
                        ].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  ) : (
                    <p className="text-slate-400 italic text-sm">Không có thông tin địa chỉ</p>
                  )}
                </div>
              </div>

              {/* Thông tin vận chuyển */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-semibold text-slate-800">Thông tin vận chuyển</span>
                </div>
                <div className="pl-6 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-slate-700">Kiện hàng 1:</span>
                    <span className="text-slate-600">{order.shipping_carrier || 'Nhanh'}</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-600">{order.checkout_shipping_carrier || 'SPX Express'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {items.slice(0, 3).map((item, idx) => (
                        item.image_info?.image_url ? (
                          <img
                            key={idx}
                            src={item.image_info.image_url}
                            alt=""
                            className="w-10 h-10 rounded border-2 border-white object-cover"
                          />
                        ) : (
                          <div key={idx} className="w-10 h-10 rounded border-2 border-white bg-slate-100 flex items-center justify-center">
                            <Package className="w-4 h-4 text-slate-400" />
                          </div>
                        )
                      ))}
                    </div>
                    <span className="text-sm text-slate-500">Total {items.length} products</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Buyer Info Card */}
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                    <User className="h-5 w-5 text-slate-500" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">{order.buyer_username}</span>
                </div>
                <Button variant="outline" size="sm" className="text-sm text-orange-500 border-orange-500 hover:bg-orange-50">
                  Theo dõi
                </Button>
              </div>
            </div>

            {/* Payment Info Table */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-semibold text-slate-800">Thông tin thanh toán</span>
                </div>
                <button className="text-sm text-blue-600 hover:underline">
                  Xem lịch sử giao dịch
                </button>
              </div>

              {/* Products Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide w-10">STT</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Sản phẩm</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide w-24">Đơn Giá</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide w-16">SL</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide w-24">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item, idx) => {
                      const escrowItem = escrowData?.order_income.items?.find(
                        ei => ei.item_id === item.item_id && ei.model_id === item.model_id
                      );
                      const isGift = escrowItem?.discounted_price === 0 || item.model_discounted_price === 0;

                      return (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="px-3 py-3 text-sm text-slate-500 align-top">{idx + 1}</td>
                          <td className="px-3 py-3">
                            <div className="flex gap-3">
                              {/* Product Image - Smaller size */}
                              <div className="flex-shrink-0">
                                {item.image_info?.image_url ? (
                                  <ImageWithZoom
                                    src={item.image_info.image_url}
                                    alt={item.item_name}
                                    className="w-12 h-12 object-cover rounded border"
                                    zoomSize={200}
                                  />
                                ) : (
                                  <div className="w-12 h-12 bg-slate-100 rounded border flex items-center justify-center">
                                    <Package className="w-5 h-5 text-slate-400" />
                                  </div>
                                )}
                              </div>
                              {/* Product Info */}
                              <div className="flex-1 min-w-0">
                                {/* Gift tag + Product name - inline layout */}
                                <div className="text-sm text-slate-700 leading-snug">
                                  {isGift && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold text-white bg-gradient-to-r from-blue-500 to-cyan-400 mr-1.5 align-middle">
                                      Quà tặng
                                    </span>
                                  )}
                                  <span>{item.item_name}</span>
                                </div>
                                {/* Variant */}
                                {item.model_name && (
                                  <p className="text-xs text-slate-500 mt-1">
                                    Phân loại: {item.model_name}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-600 text-right align-top">
                            {formatPrice(item.model_discounted_price, order.currency)}
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-600 text-center align-top">
                            {item.model_quantity_purchased}
                          </td>
                          <td className="px-3 py-3 text-sm text-slate-600 text-right align-top">
                            {formatPrice(item.model_discounted_price * item.model_quantity_purchased, order.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Financial Summary */}
              <div className="border-t px-4 py-4">
                <details className="group" open>
                  <summary className="flex items-center justify-end gap-1 cursor-pointer text-sm text-blue-600 hover:underline mb-4">
                    <span>Ẩn chi tiết doanh thu</span>
                    <span className="group-open:rotate-180 transition-transform text-xs">▲</span>
                  </summary>

                  <div className="text-sm">
                    {/* Tổng tiền sản phẩm - dùng order_selling_price (giá thực tế người mua thấy) */}
                    {(() => {
                      // Tính tổng giá sản phẩm từ item list nếu không có escrow data
                      const productTotal = escrowData?.order_income.order_selling_price
                        || items.reduce((sum, item) => sum + (item.model_discounted_price * item.model_quantity_purchased), 0)
                        || order.total_amount;

                      return (
                        <>
                          <div className="flex justify-end gap-6 py-1.5">
                            <span className="text-slate-700 font-medium text-right">Tổng tiền sản phẩm</span>
                            <span className="text-slate-700 w-24 text-right">{formatPrice(productTotal, order.currency)}</span>
                          </div>
                          <div className="flex justify-end gap-6 py-1">
                            <span className="text-slate-500 text-right">Giá sản phẩm</span>
                            <span className="text-slate-500 w-24 text-right">{formatPrice(productTotal, order.currency)}</span>
                          </div>
                        </>
                      );
                    })()}

                    {/* Tổng phí vận chuyển ước tính */}
                    <div className="flex justify-end gap-6 py-1.5 mt-2">
                      <span className="text-slate-700 font-medium text-right">Tổng phí vận chuyển ước tính</span>
                      <span className="text-slate-700 w-24 text-right">{formatPrice(escrowData?.order_income.buyer_paid_shipping_fee || 0, order.currency)}</span>
                    </div>
                    <div className="flex justify-end gap-6 py-1">
                      <span className="text-slate-500 text-right">Phí vận chuyển Người mua trả</span>
                      <span className="text-slate-500 w-24 text-right">{formatPrice(escrowData?.order_income.buyer_paid_shipping_fee || 0, order.currency)}</span>
                    </div>
                    <div className="flex justify-end gap-6 py-1">
                      <span className="text-slate-500 text-right">Phí vận chuyển ước tính</span>
                      <span className="text-slate-500 w-24 text-right">{formatPrice(0, order.currency)}</span>
                    </div>

                    {/* Phụ phí */}
                    <div className="flex justify-end gap-6 py-1.5 mt-2">
                      <span className="text-slate-700 font-medium text-right">Phụ phí</span>
                      <span className="text-red-600 w-24 text-right">
                        -{formatPrice(
                          (escrowData?.order_income.commission_fee || 0) +
                          (escrowData?.order_income.service_fee || 0) +
                          (escrowData?.order_income.seller_transaction_fee || 0),
                          order.currency
                        )}
                      </span>
                    </div>
                    {escrowData?.order_income.commission_fee ? (
                      <div className="flex justify-end gap-6 py-1">
                        <span className="text-slate-500 text-right">Phí cố định</span>
                        <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.commission_fee, order.currency)}</span>
                      </div>
                    ) : null}
                    {escrowData?.order_income.service_fee ? (
                      <div className="flex justify-end gap-6 py-1">
                        <span className="text-slate-500 text-right">Phí Dịch Vụ</span>
                        <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.service_fee, order.currency)}</span>
                      </div>
                    ) : null}
                    {escrowData?.order_income.seller_transaction_fee ? (
                      <div className="flex justify-end gap-6 py-1">
                        <span className="text-slate-500 text-right">Phí thanh toán</span>
                        <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.seller_transaction_fee, order.currency)}</span>
                      </div>
                    ) : null}

                    {/* Thuế */}
                    {(() => {
                      const taxTotal =
                        (escrowData?.order_income.escrow_tax || 0) +
                        (escrowData?.order_income.final_product_vat_tax || 0) +
                        (escrowData?.order_income.final_shipping_vat_tax || 0) +
                        (escrowData?.order_income.final_escrow_product_gst || 0) +
                        (escrowData?.order_income.final_escrow_shipping_gst || 0) +
                        (escrowData?.order_income.withholding_tax || 0) +
                        (escrowData?.order_income.withholding_vat_tax || 0) +
                        (escrowData?.order_income.withholding_pit_tax || 0) +
                        (escrowData?.order_income.cross_border_tax || 0) +
                        (escrowData?.order_income.sales_tax_on_lvg || 0) +
                        (escrowData?.order_income.vat_on_imported_goods || 0);

                      return (
                        <>
                          <div className="flex justify-end gap-6 py-1.5 mt-2">
                            <span className="text-slate-700 font-medium text-right">Thuế</span>
                            <span className="text-red-600 w-24 text-right">
                              -{formatPrice(taxTotal, order.currency)}
                            </span>
                          </div>
                          {escrowData?.order_income.escrow_tax ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế Escrow</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.escrow_tax, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.final_product_vat_tax ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế GTGT (sản phẩm)</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.final_product_vat_tax, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.final_shipping_vat_tax ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế GTGT (vận chuyển)</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.final_shipping_vat_tax, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.final_escrow_product_gst ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">GST (sản phẩm)</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.final_escrow_product_gst, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.final_escrow_shipping_gst ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">GST (vận chuyển)</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.final_escrow_shipping_gst, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.withholding_tax ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế khấu trừ</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.withholding_tax, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.withholding_vat_tax ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế GTGT khấu trừ</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.withholding_vat_tax, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.withholding_pit_tax ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế TNCN</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.withholding_pit_tax, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.cross_border_tax ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế xuyên biên giới</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.cross_border_tax, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.sales_tax_on_lvg ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">Thuế bán hàng LVG</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.sales_tax_on_lvg, order.currency)}</span>
                            </div>
                          ) : null}
                          {escrowData?.order_income.vat_on_imported_goods ? (
                            <div className="flex justify-end gap-6 py-1">
                              <span className="text-slate-500 text-right">VAT hàng nhập khẩu</span>
                              <span className="text-slate-500 w-24 text-right">-{formatPrice(escrowData.order_income.vat_on_imported_goods, order.currency)}</span>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}

                    {/* Tổng phụ dịch vụ giá trị gia tăng */}
                    <div className="flex justify-end gap-6 py-1.5 mt-2">
                      <span className="text-slate-700 font-medium text-right">Tổng phụ dịch vụ giá trị gia tăng cho người mua</span>
                      <span className="text-slate-700 w-24 text-right">{formatPrice(0, order.currency)}</span>
                    </div>

                    {/* Doanh thu đơn hàng ước tính */}
                    <div className="flex justify-end gap-6 items-center py-3 mt-3 border-t border-slate-200">
                      <span className="text-slate-700 font-medium text-right">Doanh thu đơn hàng ước tính</span>
                      <span className="text-lg font-bold text-orange-500 w-24 text-right">
                        {formatPrice(escrowData?.order_income.escrow_amount || order.total_amount, order.currency)}
                      </span>
                    </div>
                  </div>
                </details>
              </div>
            </div>

            {/* Số tiền cuối cùng */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">Số tiền cuối cùng</span>
                </div>
                <span className="text-lg font-bold text-orange-500">
                  {formatPrice(escrowData?.order_income.escrow_amount || order.total_amount, order.currency)}
                </span>
              </div>
            </div>

            {/* Thanh toán của Người Mua */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                <User className="h-4 w-4 text-red-500" />
                <span className="text-sm font-semibold text-slate-800">Thanh toán của Người Mua</span>
              </div>
              <div className="px-4 py-4 text-sm">
                <div className="flex justify-end gap-6 py-1.5">
                  <span className="text-slate-500 text-right">Tổng tiền sản phẩm</span>
                  <span className="text-slate-500 w-24 text-right">{formatPrice(escrowData?.buyer_payment_info?.merchant_subtotal || order.total_amount, order.currency)}</span>
                </div>
                <div className="flex justify-end gap-6 py-1.5">
                  <span className="text-slate-500 text-right">Phí vận chuyển</span>
                  <span className="text-slate-500 w-24 text-right">{formatPrice(escrowData?.buyer_payment_info?.shipping_fee || 0, order.currency)}</span>
                </div>
                <div className="flex justify-end gap-6 py-1.5">
                  <span className="text-slate-500 text-right">Shopee Voucher</span>
                  <span className="text-slate-500 w-24 text-right">{formatPrice(escrowData?.buyer_payment_info?.shopee_voucher || 0, order.currency)}</span>
                </div>
                <div className="flex justify-end gap-6 py-1.5">
                  <span className="text-slate-500 text-right">Mã giảm giá của Shop</span>
                  <span className="text-slate-500 w-24 text-right">{formatPrice(escrowData?.buyer_payment_info?.seller_voucher || 0, order.currency)}</span>
                </div>
                <div className="flex justify-end gap-6 py-2 mt-2 border-t border-slate-200">
                  <span className="text-slate-700 font-medium text-right">Tổng tiền Thanh toán</span>
                  <span className="text-orange-500 font-bold w-24 text-right">{formatPrice(escrowData?.buyer_payment_info?.buyer_total_amount || order.total_amount, order.currency)}</span>
                </div>
              </div>
            </div>

            {loadingEscrow && (
              <div className="bg-white rounded shadow-sm border p-4 flex items-center justify-center">
                <Spinner className="h-5 w-5 mr-2" />
                <span className="text-sm text-slate-500">Đang tải thông tin tài chính...</span>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN - Notes & History */}
          <div className="w-72 space-y-4">
            {/* Notes */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-600">Thêm {order.note ? '1' : '0'} ghi chú</span>
                </div>
              </div>
              <div className="p-4 text-sm text-slate-500 min-h-[60px]">
                {order.note || <span className="text-slate-400 italic">Chưa có ghi chú</span>}
              </div>
            </div>

            {/* Order History */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="px-4 py-3 border-b">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">LỊCH SỬ ĐƠN HÀNG</span>
              </div>
              <div className="p-4">
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[5px] top-2 bottom-2 w-0.5 bg-slate-200"></div>

                  {/* Timeline items */}
                  <div className="space-y-4">
                    <div className="flex gap-3 relative">
                      <div className="w-3 h-3 rounded-full bg-orange-500 mt-1 z-10"></div>
                      <div>
                        <p className="text-sm font-medium text-orange-600">Đơn hàng mới</p>
                        <p className="text-xs text-slate-500">{formatDateTime(order.create_time)}</p>
                      </div>
                    </div>

                    {order.pay_time && order.pay_time !== order.create_time && (
                      <div className="flex gap-3 relative">
                        <div className="w-3 h-3 rounded-full bg-slate-300 mt-1 z-10"></div>
                        <div>
                          <p className="text-sm text-slate-600">Đã thanh toán</p>
                          <p className="text-xs text-slate-500">{formatDateTime(order.pay_time)}</p>
                        </div>
                      </div>
                    )}

                    {order.pickup_done_time && (
                      <div className="flex gap-3 relative">
                        <div className="w-3 h-3 rounded-full bg-slate-300 mt-1 z-10"></div>
                        <div>
                          <p className="text-sm text-slate-600">Đã lấy hàng</p>
                          <p className="text-xs text-slate-500">{formatDateTime(order.pickup_done_time)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Message from buyer */}
            {order.message_to_seller && (
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="px-4 py-3 border-b">
                  <span className="text-sm font-semibold text-slate-700">Tin nhắn từ người mua</span>
                </div>
                <div className="p-4 text-sm text-slate-500">
                  {order.message_to_seller}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

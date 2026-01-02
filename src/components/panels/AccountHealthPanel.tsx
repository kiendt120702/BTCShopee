"use client";

import { useState, useEffect } from 'react';
import React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

// Types
interface ShopeeMetric {
  metric_id: number;
  metric_name: string;
  metric_type: number;
  current_period: number | null;
  last_period: number | null;
  target: { value: number; comparator: string };
  unit: number;
  parent_metric_id: number;
  exemption_end_date: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const METRIC_NAMES: Record<string, string> = {
  'non_fulfillment_rate': 'Tỷ lệ đơn hàng không thành công',
  'cancellation_rate': 'Tỷ lệ hủy đơn',
  'return_refund_rate': 'Tỷ lệ Trả hàng/Hoàn tiền',
  'late_shipment_rate': 'Tỷ lệ giao hàng trễ',
  'preparation_time': 'Thời gian chuẩn bị hàng',
  'response_rate': 'Tỉ lệ phản hồi',
  'shop_rating': 'Đánh giá Shop',
  'severe_listing_violations': 'Sản phẩm bị khóa/xóa',
  'spam_listings': 'Sản phẩm spam',
  'counterfeit_ip_infringement': 'Vi phạm bản quyền',
  'prohibited_listings': 'Sản phẩm cấm',
  'pqr_products': 'Sản phẩm PQR',
  'pre_order_listing_rate': 'Hàng đặt trước',
  'the_amount_of_pre_order_listing': 'Số ngày tỷ lệ hàng đặt trước vượt quá chỉ tiêu',
  'other_listing_violations': 'Các vi phạm khác',
};

const METRIC_GROUPS = {
  fulfillment: {
    title: 'Quản Lý Đơn Hàng',
    metrics: ['non_fulfillment_rate', 'cancellation_rate', 'return_refund_rate', 'late_shipment_rate', 'preparation_time'],
  },
  listing: {
    title: 'Vi phạm đăng bán',
    metrics: ['severe_listing_violations', 'spam_listings', 'counterfeit_ip_infringement', 'prohibited_listings', 'pqr_products', 'pre_order_listing_rate', 'the_amount_of_pre_order_listing', 'other_listing_violations'],
  },
  customer_service: {
    title: 'Chăm sóc khách hàng',
    metrics: ['response_rate', 'shop_rating'],
  },
};

async function callAccountHealthAPI(action: string, shopId: number, params: Record<string, unknown> = {}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/apishopee-account-health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action, shop_id: shopId, ...params }),
  });
  return response.json();
}

function formatValue(value: number | null, unit: number, metricName: string): string {
  if (value === null || value === undefined) return '-';
  if (metricName === 'shop_rating') return `${value}/5`;
  switch (unit) {
    case 1: return value.toString();
    case 2: return `${value}%`;
    case 4: return `${value} ngày`;
    default: return value.toString();
  }
}

function formatTarget(target: { value: number; comparator: string }, unit: number, metricName: string): string {
  if (!target) return '-';
  const comp = { '<': '<', '<=': '≤', '>': '>', '>=': '≥' }[target.comparator] || target.comparator;
  if (metricName === 'shop_rating') return `${comp}${target.value}/5`;
  switch (unit) {
    case 1: return `${comp}${target.value}`;
    case 2: return `${comp}${target.value}%`;
    case 4: return `${comp}${target.value} ngày`;
    default: return `${comp}${target.value}`;
  }
}

function isMetricFailing(metric: ShopeeMetric): boolean {
  if (metric.current_period === null) return false;
  const { value, comparator } = metric.target;
  const current = metric.current_period;
  switch (comparator) {
    case '<': return current >= value;
    case '<=': return current > value;
    case '>': return current <= value;
    case '>=': return current < value;
    default: return false;
  }
}

function MetricRow({ metric, isChild = false, isExpanded = false, hasChildren = false, onToggle }: { 
  metric: ShopeeMetric; isChild?: boolean; isExpanded?: boolean; hasChildren?: boolean; onToggle?: () => void;
}) {
  const isFailing = isMetricFailing(metric);
  const displayName = METRIC_NAMES[metric.metric_name] || metric.metric_name.replace(/_/g, ' ');
  
  return (
    <tr className={cn("border-b border-slate-100 hover:bg-slate-50/50", isChild && "bg-slate-50/30")}>
      <td className="py-3 px-4">
        <div className={cn("flex items-center gap-2", isChild && "pl-8")}>
          {hasChildren && (
            <button onClick={onToggle} className="p-0.5 hover:bg-slate-200 rounded">
              {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>
          )}
          {!hasChildren && !isChild && <span className="w-5" />}
          <span className="text-sm text-slate-700">{displayName}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={cn("text-sm", isFailing ? "text-red-500" : "text-slate-700")}>
          {formatValue(metric.current_period, metric.unit, metric.metric_name)}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className="text-sm text-slate-500">{formatTarget(metric.target, metric.unit, metric.metric_name)}</span>
      </td>
    </tr>
  );
}

function MetricGroup({ title, metricNames, allMetrics }: { title: string; metricNames: string[]; allMetrics: ShopeeMetric[] }) {
  const [expandedMetrics, setExpandedMetrics] = useState<Set<number>>(new Set());
  const groupMetrics = metricNames.map(name => allMetrics.find(m => m.metric_name === name)).filter((m): m is ShopeeMetric => m !== undefined);
  const parentMetrics = groupMetrics.filter(m => m.parent_metric_id === 0);
  const getChildren = (parentId: number) => allMetrics.filter(m => m.parent_metric_id === parentId);
  const toggleExpand = (metricId: number) => setExpandedMetrics(prev => { const next = new Set(prev); next.has(metricId) ? next.delete(metricId) : next.add(metricId); return next; });
  
  if (parentMetrics.length === 0) return null;
  
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={3} className="py-2.5 px-4"><span className="text-sm font-medium text-slate-800">{title}</span></td>
      </tr>
      {parentMetrics.map(metric => {
        const children = getChildren(metric.metric_id);
        const hasChildren = children.length > 0;
        const isExpanded = expandedMetrics.has(metric.metric_id);
        return (
          <React.Fragment key={metric.metric_id}>
            <MetricRow metric={metric} hasChildren={hasChildren} isExpanded={isExpanded} onToggle={() => toggleExpand(metric.metric_id)} />
            {isExpanded && children.map(child => <MetricRow key={child.metric_id} metric={child} isChild />)}
          </React.Fragment>
        );
      })}
    </>
  );
}


export default function AccountHealthPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [rawMetrics, setRawMetrics] = useState<ShopeeMetric[]>([]);

  useEffect(() => {
    if (isAuthenticated && token?.shop_id) {
      loadOverview();
    }
  }, [isAuthenticated, token?.shop_id]);

  const loadOverview = async () => {
    if (!token?.shop_id) return;
    setLoading(true);
    try {
      const perfRes = await callAccountHealthAPI('get-shop-performance', token.shop_id);
      if (perfRes.response) {
        setRawMetrics(perfRes.response.metric_list || []);
      }
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b flex-shrink-0">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Sức khỏe tài khoản</h1>
              <p className="text-xs text-slate-500">Theo dõi hiệu suất và vi phạm của shop</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadOverview} disabled={loading}>
            {loading ? 'Đang tải...' : 'Làm mới'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl border">
          {/* Metrics Table */}
          {rawMetrics.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-[50%]">Chỉ số</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-[25%]">Shop của tôi</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-[25%]">Chỉ tiêu</th>
                  </tr>
                </thead>
                <tbody>
                  <MetricGroup title={METRIC_GROUPS.fulfillment.title} metricNames={METRIC_GROUPS.fulfillment.metrics} allMetrics={rawMetrics} />
                  <MetricGroup title={METRIC_GROUPS.listing.title} metricNames={METRIC_GROUPS.listing.metrics} allMetrics={rawMetrics} />
                  <MetricGroup title={METRIC_GROUPS.customer_service.title} metricNames={METRIC_GROUPS.customer_service.metrics} allMetrics={rawMetrics} />
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center">
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-slate-500">Đang tải dữ liệu...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <p className="text-slate-500">Nhấn "Làm mới" để tải dữ liệu sức khỏe tài khoản</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

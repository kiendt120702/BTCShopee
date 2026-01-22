/**
 * Home Page - Dashboard tổng quan đa kênh
 * Hiển thị thống kê từ tất cả các kênh bán hàng (Shopee, Lazada)
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Store,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertCircle,
  ArrowRight,
  Zap,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Calendar,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import {
  useMultiChannelStats,
  useAllShops,
  Platform,
  DateRange,
  PlatformSummary,
  ChannelStats,
} from '@/hooks/useMultiChannelStats';
import { cn } from '@/lib/utils';
import { ADMIN_EMAIL } from '@/config/menu-config';

// Platform icons
const ShopeeIcon = () => (
  <img
    src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRcS-HdfgUSCDmV_LNqOxasca8KcceWStGP_A&s"
    alt="Shopee"
    className="w-5 h-5 object-contain"
  />
);

const LazadaIcon = () => (
  <img
    src="https://recland.s3.ap-southeast-1.amazonaws.com/company/19a57791bf92848b511de18eaebca94a.png"
    alt="Lazada"
    className="w-5 h-5 object-contain"
  />
);

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: '7days', label: '7 ngày qua' },
  { value: '30days', label: '30 ngày qua' },
  { value: 'month', label: 'Tháng này' },
];

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'all', label: 'Tất cả kênh' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
];

// Format currency
const formatCurrency = (value: number) => {
  if (value >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  }
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  return new Intl.NumberFormat('vi-VN').format(Math.round(value));
};

// Change badge component
function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">-</span>;

  const isPositive = value >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        isPositive ? 'text-green-600' : 'text-red-600'
      )}
    >
      <Icon className="w-3 h-3" />
      {isPositive ? '+' : ''}
      {value}%
    </span>
  );
}

// Platform row with expandable shops
function PlatformRow({
  summary,
  expanded,
  onToggle,
}: {
  summary: PlatformSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasShops = summary.shops.length > 0;
  const Icon = summary.channel === 'shopee' ? ShopeeIcon : LazadaIcon;
  const channelName = summary.channel === 'shopee' ? 'Shopee' : 'Lazada';
  const bgColor = summary.channel === 'shopee' ? 'bg-orange-50' : 'bg-blue-50';

  return (
    <>
      <TableRow
        className={cn('cursor-pointer hover:bg-slate-50', bgColor)}
        onClick={onToggle}
      >
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {hasShops ? (
              expanded ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )
            ) : (
              <span className="w-4" />
            )}
            <Icon />
            <span>{channelName}</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{formatCurrency(summary.revenue)}</span>
            <ChangeBadge value={summary.revenueChange} />
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{summary.orders}</span>
            <ChangeBadge value={summary.ordersChange} />
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span>{formatCurrency(summary.avgOrderValue)}</span>
            <ChangeBadge value={summary.avgOrderValueChange} />
          </div>
        </TableCell>
        <TableCell className="text-slate-400">
          {summary.adsSpend !== null ? formatCurrency(summary.adsSpend) : '-'}
        </TableCell>
        <TableCell className="text-slate-400">
          {summary.profit !== null ? formatCurrency(summary.profit) : '-'}
        </TableCell>
        <TableCell className="text-slate-400">
          {summary.profitMargin !== null ? `${summary.profitMargin}%` : '-'}
        </TableCell>
      </TableRow>
      {expanded &&
        summary.shops.map((shop) => (
          <ShopRow key={`${shop.channel}-${shop.shopId}`} shop={shop} />
        ))}
    </>
  );
}

// Individual shop row
function ShopRow({ shop }: { shop: ChannelStats }) {
  return (
    <TableRow className="bg-slate-50/50">
      <TableCell className="pl-12">
        <div className="flex items-center gap-2">
          {shop.shopLogo ? (
            <img
              src={shop.shopLogo}
              alt={shop.shopName}
              className="w-5 h-5 rounded object-cover"
            />
          ) : (
            <Store className="w-4 h-4 text-slate-400" />
          )}
          <span className="text-slate-600">{shop.shopName}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{formatCurrency(shop.revenue)}</span>
          <ChangeBadge value={shop.revenueChange} />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{shop.orders}</span>
          <ChangeBadge value={shop.ordersChange} />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{formatCurrency(shop.avgOrderValue)}</span>
          <ChangeBadge value={shop.avgOrderValueChange} />
        </div>
      </TableCell>
      <TableCell className="text-slate-400">
        {shop.adsSpend !== null ? formatCurrency(shop.adsSpend) : '-'}
      </TableCell>
      <TableCell className="text-slate-400">
        {shop.profit !== null ? formatCurrency(shop.profit) : '-'}
      </TableCell>
      <TableCell className="text-slate-400">
        {shop.profitMargin !== null ? `${shop.profitMargin}%` : '-'}
      </TableCell>
    </TableRow>
  );
}

// Total summary row
function TotalRow({ summary }: { summary: PlatformSummary }) {
  return (
    <TableRow className="bg-slate-100 font-semibold">
      <TableCell>
        <div className="flex items-center gap-2">
          <ChevronDown className="w-4 h-4 text-transparent" />
          <span>Đơn hàng</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{formatCurrency(summary.revenue)}</span>
          <ChangeBadge value={summary.revenueChange} />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{summary.orders}</span>
          <ChangeBadge value={summary.ordersChange} />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{formatCurrency(summary.avgOrderValue)}</span>
          <ChangeBadge value={summary.avgOrderValueChange} />
        </div>
      </TableCell>
      <TableCell className="text-slate-500">
        {summary.adsSpend !== null ? formatCurrency(summary.adsSpend) : '-'}
      </TableCell>
      <TableCell className="text-slate-500">
        {summary.profit !== null ? formatCurrency(summary.profit) : '-'}
      </TableCell>
      <TableCell className="text-slate-500">
        {summary.profitMargin !== null ? `${summary.profitMargin}%` : '-'}
      </TableCell>
    </TableRow>
  );
}

// Main overview component
function MultiChannelOverview() {
  const [platform, setPlatform] = useState<Platform>('all');
  const [shopId, setShopId] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(
    new Set(['shopee', 'lazada'])
  );

  const allShops = useAllShops();
  const { data, isLoading, refetch } = useMultiChannelStats({
    platform,
    shopId: shopId === 'all' ? undefined : shopId,
    dateRange,
  });

  const togglePlatform = (channel: string) => {
    setExpandedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) {
        next.delete(channel);
      } else {
        next.add(channel);
      }
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <CardTitle className="text-lg font-semibold">Tổng quan</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <SelectTrigger className="w-[140px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={shopId} onValueChange={setShopId}>
              <SelectTrigger className="w-[180px]">
                <Store className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Tất cả cửa hàng" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả cửa hàng</SelectItem>
                {allShops.map((shop) => (
                  <SelectItem key={shop.id} value={shop.id}>
                    <div className="flex items-center gap-2">
                      {shop.channel === 'shopee' ? (
                        <span className="text-orange-500 text-xs">[S]</span>
                      ) : (
                        <span className="text-blue-500 text-xs">[L]</span>
                      )}
                      <span className="truncate max-w-[120px]">{shop.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <SelectTrigger className="w-[140px]">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="w-8 h-8" />
          </div>
        ) : !data || (data.shopee.shops.length === 0 && data.lazada.shops.length === 0) ? (
          <div className="text-center py-12 text-slate-500">
            <Store className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Chưa có shop nào được kết nối</p>
            <div className="flex justify-center gap-2 mt-4">
              <Link to="/settings/shops">
                <Button variant="outline" size="sm">
                  <ShopeeIcon />
                  <span className="ml-2">Kết nối Shopee</span>
                </Button>
              </Link>
              <Link to="/lazada/shops">
                <Button variant="outline" size="sm">
                  <LazadaIcon />
                  <span className="ml-2">Kết nối Lazada</span>
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Kênh bán</TableHead>
                  <TableHead>Doanh thu</TableHead>
                  <TableHead>Số đơn</TableHead>
                  <TableHead>GTTB</TableHead>
                  <TableHead>Ads</TableHead>
                  <TableHead>Lợi nhuận</TableHead>
                  <TableHead>%DT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Total row */}
                <TotalRow summary={data.total} />

                {/* Shopee section */}
                {(platform === 'all' || platform === 'shopee') &&
                  data.shopee.shops.length > 0 && (
                    <PlatformRow
                      summary={data.shopee}
                      expanded={expandedPlatforms.has('shopee')}
                      onToggle={() => togglePlatform('shopee')}
                    />
                  )}

                {/* Lazada section */}
                {(platform === 'all' || platform === 'lazada') &&
                  data.lazada.shops.length > 0 && (
                    <PlatformRow
                      summary={data.lazada}
                      expanded={expandedPlatforms.has('lazada')}
                      onToggle={() => togglePlatform('lazada')}
                    />
                  )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Token status alert for admin
function TokenAlerts() {
  const { user, profile } = useAuth();
  const { shops: shopeeShops } = useShopeeAuth();
  const { shops: lazadaShops } = useLazadaAuth();

  const isAdmin =
    user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() ||
    profile?.system_role === 'admin';

  if (!isAdmin) return null;

  // Check for expiring tokens
  const now = Date.now();
  const expiringShops: { name: string; channel: string; daysLeft: number }[] = [];

  // TODO: Add token expiry check for Shopee shops
  // For now, Lazada shops have explicit token expiry
  lazadaShops.forEach((shop) => {
    if (shop.access_token_expires_at) {
      const expiry = new Date(shop.access_token_expires_at).getTime();
      const daysLeft = Math.floor((expiry - now) / (24 * 60 * 60 * 1000));
      if (daysLeft <= 7) {
        expiringShops.push({
          name: shop.shop_name || `Seller ${shop.seller_id}`,
          channel: 'Lazada',
          daysLeft,
        });
      }
    }
  });

  if (expiringShops.length === 0) return null;

  const hasExpired = expiringShops.some((s) => s.daysLeft <= 0);
  const hasCritical = expiringShops.some((s) => s.daysLeft > 0 && s.daysLeft <= 3);

  return (
    <Card
      className={cn(
        'border',
        hasExpired || hasCritical
          ? 'border-red-200 bg-gradient-to-br from-red-50 to-rose-50'
          : 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50'
      )}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
              hasExpired || hasCritical ? 'bg-red-100' : 'bg-amber-100'
            )}
          >
            {hasExpired ? (
              <XCircle className="w-5 h-5 text-red-600" />
            ) : hasCritical ? (
              <AlertCircle className="w-5 h-5 text-red-600" />
            ) : (
              <Clock className="w-5 h-5 text-amber-600" />
            )}
          </div>
          <div className="flex-1">
            <p
              className={cn(
                'font-semibold',
                hasExpired || hasCritical ? 'text-red-800' : 'text-amber-800'
              )}
            >
              {hasExpired ? 'Token đã hết hạn' : 'Cảnh báo Token'}
            </p>
            <div className="text-sm mt-1 space-y-1">
              {expiringShops.map((shop, i) => (
                <p
                  key={i}
                  className={cn(
                    shop.daysLeft <= 0
                      ? 'text-red-700'
                      : shop.daysLeft <= 3
                        ? 'text-red-600'
                        : 'text-amber-700'
                  )}
                >
                  [{shop.channel}] {shop.name}:{' '}
                  {shop.daysLeft <= 0
                    ? 'Đã hết hạn'
                    : `Còn ${shop.daysLeft} ngày`}
                </p>
              ))}
            </div>
            <Link to="/lazada/shops">
              <Button
                size="sm"
                className={cn(
                  'mt-3 text-white',
                  hasExpired || hasCritical
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-amber-500 hover:bg-amber-600'
                )}
              >
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Gia hạn ngay
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const { shops: shopeeShops, isLoading: isShopeeLoading } = useShopeeAuth();
  const { shops: lazadaShops, isLoading: isLazadaLoading } = useLazadaAuth();

  const isLoading = isShopeeLoading || isLazadaLoading;
  const hasShops = shopeeShops.length > 0 || lazadaShops.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!user) {
    return <LandingContent />;
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Token Alerts for Admin */}
      <TokenAlerts />

      {/* Multi-Channel Overview */}
      <MultiChannelOverview />

      {/* Quick Actions when no shops */}
      {!hasShops && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <Store className="w-12 h-12 mx-auto mb-4 text-slate-400" />
              <h3 className="text-lg font-semibold text-slate-800 mb-2">
                Bắt đầu kết nối shop của bạn
              </h3>
              <p className="text-slate-500 mb-6">
                Kết nối shop để bắt đầu quản lý đơn hàng, sản phẩm và xem thống kê
              </p>
              <div className="flex justify-center gap-3">
                <Link to="/settings/shops">
                  <Button className="bg-orange-500 hover:bg-orange-600">
                    <ShopeeIcon />
                    <span className="ml-2">Kết nối Shopee</span>
                  </Button>
                </Link>
                <Link to="/lazada/shops">
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <LazadaIcon />
                    <span className="ml-2">Kết nối Lazada</span>
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Landing Content for non-logged in users
function LandingContent() {
  const features = [
    {
      title: 'Quản lý đa kênh',
      description: 'Kết nối và quản lý Shopee, Lazada trong một nền tảng',
      icon: Store,
      color: 'from-orange-500 to-red-500',
    },
    {
      title: 'Tự động hóa',
      description: 'Flash Sale tự động, refresh token tự động',
      icon: Zap,
      color: 'from-amber-500 to-orange-500',
    },
    {
      title: 'Thống kê chi tiết',
      description: 'Theo dõi đơn hàng, doanh thu theo thời gian thực',
      icon: TrendingUp,
      color: 'from-blue-500 to-indigo-500',
    },
  ];

  return (
    <div className="space-y-8 p-6">
      <div className="text-center py-12">
        <img
          src="/logo_betacom.png"
          alt="BETACOM"
          className="w-20 h-20 rounded-2xl mx-auto mb-6 shadow-lg"
        />
        <h1 className="text-4xl font-bold text-slate-800 mb-4">
          Chào mừng đến với{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-red-500">
            BETACOM
          </span>
        </h1>
        <p className="text-lg text-slate-600 max-w-xl mx-auto">
          Nền tảng quản lý đa kênh thương mại điện tử chuyên nghiệp
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card key={feature.title} className="text-center hover:shadow-lg transition-shadow">
              <CardContent className="pt-8 pb-6">
                <div
                  className={`inline-flex p-4 rounded-2xl bg-gradient-to-br ${feature.color} mb-4`}
                >
                  <Icon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">
                  {feature.title}
                </h3>
                <p className="text-slate-600">{feature.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center">
        <Link to="/auth">
          <Button
            size="lg"
            className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white px-8"
          >
            Đăng nhập để bắt đầu
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

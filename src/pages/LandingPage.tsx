/**
 * Landing Page - Trang giới thiệu công khai cho Shopee ISV Review
 */

import { Link } from 'react-router-dom';
import {
  ShoppingCart,
  Package,
  TrendingUp,
  MessageSquare,
  BarChart3,
  Zap,
  Check,
  ArrowRight,
  Store,
  RefreshCw
} from 'lucide-react';

// Platform icons
const ShopeeIcon = () => (
  <img
    src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRcS-HdfgUSCDmV_LNqOxasca8KcceWStGP_A&s"
    alt="Shopee"
    className="w-8 h-8 object-contain"
  />
);

const LazadaIcon = () => (
  <img
    src="https://recland.s3.ap-southeast-1.amazonaws.com/company/19a57791bf92848b511de18eaebca94a.png"
    alt="Lazada"
    className="w-8 h-8 object-contain"
  />
);

const TikTokIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
  </svg>
);

const FEATURES = [
  {
    icon: ShoppingCart,
    title: 'Quản lý Đơn hàng',
    description: 'Theo dõi và xử lý đơn hàng từ nhiều nền tảng trong một giao diện duy nhất.',
    color: 'text-orange-500',
    bgColor: 'bg-orange-100',
  },
  {
    icon: Package,
    title: 'Đồng bộ Sản phẩm',
    description: 'Quản lý kho hàng, cập nhật giá và tồn kho đồng bộ trên tất cả kênh bán.',
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
  },
  {
    icon: TrendingUp,
    title: 'Quản lý Quảng cáo',
    description: 'Tối ưu hóa chiến dịch quảng cáo với tự động điều chỉnh ngân sách theo lịch.',
    color: 'text-green-500',
    bgColor: 'bg-green-100',
  },
  {
    icon: MessageSquare,
    title: 'Tự động Trả lời Đánh giá',
    description: 'AI tự động phản hồi đánh giá của khách hàng theo template cài đặt sẵn.',
    color: 'text-purple-500',
    bgColor: 'bg-purple-100',
  },
  {
    icon: BarChart3,
    title: 'Phân tích & Báo cáo',
    description: 'Dashboard thống kê chi tiết doanh thu, đơn hàng và hiệu suất bán hàng.',
    color: 'text-red-500',
    bgColor: 'bg-red-100',
  },
  {
    icon: RefreshCw,
    title: 'Auto Token Refresh',
    description: 'Tự động làm mới token API để duy trì kết nối liên tục 24/7.',
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-100',
  },
];

const PRICING_PLANS = [
  {
    name: 'Free',
    price: '0',
    description: 'Dành cho người mới bắt đầu',
    features: [
      'Kết nối 1 shop',
      'Quản lý đơn hàng cơ bản',
      'Đồng bộ sản phẩm',
      'Thống kê 7 ngày',
    ],
    cta: 'Bắt đầu miễn phí',
    popular: false,
  },
  {
    name: 'Pro',
    price: '499.000',
    description: 'Dành cho shop chuyên nghiệp',
    features: [
      'Kết nối không giới hạn shop',
      'Quản lý đơn hàng nâng cao',
      'Tự động trả lời đánh giá',
      'Quản lý quảng cáo thông minh',
      'Thống kê không giới hạn',
      'Hỗ trợ ưu tiên',
    ],
    cta: 'Dùng thử 14 ngày',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 'Liên hệ',
    description: 'Giải pháp tùy chỉnh',
    features: [
      'Tất cả tính năng Pro',
      'API tích hợp riêng',
      'Dedicated support',
      'SLA 99.9%',
      'Training team',
      'Custom features',
    ],
    cta: 'Liên hệ tư vấn',
    popular: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <img src="/logo_betacom.png" alt="BETACOM" className="w-10 h-10 rounded-xl object-contain" />
              <span className="text-xl font-bold text-red-500">BETACOM</span>
            </div>
            <div className="flex items-center gap-4">
              <Link
                to="/auth"
                className="text-slate-600 hover:text-slate-900 font-medium transition-colors cursor-pointer"
              >
                Đăng nhập
              </Link>
              <Link
                to="/auth?demo=true"
                className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium rounded-lg hover:from-orange-600 hover:to-red-600 transition-all shadow-lg shadow-orange-500/25 cursor-pointer"
              >
                Dùng thử Demo
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-orange-50 via-white to-red-50 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-orange-200 rounded-full opacity-20 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-red-200 rounded-full opacity-20 blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto relative">
          <div className="text-center max-w-4xl mx-auto">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-md border border-slate-100">
                <ShopeeIcon />
                <span className="text-sm font-medium text-orange-500">Shopee</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-md border border-slate-100">
                <LazadaIcon />
                <span className="text-sm font-medium text-blue-600">Lazada</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-white/60 rounded-full border border-slate-200">
                <TikTokIcon />
                <span className="text-sm font-medium text-slate-500">TikTok Shop</span>
                <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">Soon</span>
              </div>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-6">
              Quản lý Shop{' '}
              <span className="bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
                Đa Nền Tảng
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-slate-600 mb-8 max-w-2xl mx-auto">
              Nền tảng quản lý tập trung cho Shopee và Lazada. Đồng bộ đơn hàng, sản phẩm,
              quảng cáo và đánh giá từ một dashboard duy nhất.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/auth"
                className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-red-600 transition-all shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                Bắt đầu ngay
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                to="/auth?demo=true"
                className="w-full sm:w-auto px-8 py-4 bg-white text-slate-700 font-semibold rounded-xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Store className="w-5 h-5" />
                Xem Demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Tính năng nổi bật
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Đầy đủ công cụ để quản lý và tối ưu hóa hoạt động kinh doanh đa kênh của bạn
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature, index) => (
              <div
                key={index}
                className="p-6 bg-white rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-lg transition-all group"
              >
                <div className={`w-12 h-12 ${feature.bgColor} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <feature.icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{feature.title}</h3>
                <p className="text-slate-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-slate-50 to-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Bảng giá đơn giản
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Chọn gói phù hợp với quy mô kinh doanh của bạn
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {PRICING_PLANS.map((plan, index) => (
              <div
                key={index}
                className={`relative p-8 bg-white rounded-2xl border-2 transition-all ${
                  plan.popular
                    ? 'border-orange-500 shadow-xl shadow-orange-500/10'
                    : 'border-slate-100 hover:border-slate-200 hover:shadow-lg'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-medium rounded-full">
                    Phổ biến nhất
                  </div>
                )}

                <div className="text-center mb-6">
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{plan.name}</h3>
                  <p className="text-slate-500 text-sm mb-4">{plan.description}</p>
                  <div className="flex items-baseline justify-center gap-1">
                    {plan.price !== 'Liên hệ' && <span className="text-lg text-slate-500">đ</span>}
                    <span className="text-4xl font-bold text-slate-900">{plan.price}</span>
                    {plan.price !== 'Liên hệ' && plan.price !== '0' && (
                      <span className="text-slate-500">/tháng</span>
                    )}
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center gap-3">
                      <Check className={`w-5 h-5 flex-shrink-0 ${plan.popular ? 'text-orange-500' : 'text-green-500'}`} />
                      <span className="text-slate-600">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  className={`w-full py-3 font-semibold rounded-xl transition-all cursor-pointer ${
                    plan.popular
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600 shadow-lg shadow-orange-500/25'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Section for Shopee Reviewer */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-orange-500 to-red-500">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 rounded-full text-white/90 text-sm font-medium mb-6">
            <Zap className="w-4 h-4" />
            Dành cho Shopee ISV Reviewer
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Tài khoản Demo
          </h2>
          <p className="text-lg text-white/80 mb-8 max-w-2xl mx-auto">
            Sử dụng thông tin đăng nhập bên dưới để trải nghiệm đầy đủ tính năng của hệ thống
          </p>

          <div className="bg-white rounded-2xl p-8 max-w-md mx-auto shadow-2xl">
            <div className="space-y-4 text-left">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">Email</label>
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <code className="text-slate-800 font-mono text-sm flex-1">reviewer@betacom.agency</code>
                  <button
                    onClick={() => navigator.clipboard.writeText('reviewer@betacom.agency')}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Copy"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">Password</label>
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <code className="text-slate-800 font-mono text-sm flex-1">ShopeeISV@2024</code>
                  <button
                    onClick={() => navigator.clipboard.writeText('ShopeeISV@2024')}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Copy"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <Link
              to="/auth?demo=true"
              className="mt-6 w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-red-600 transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              Đăng nhập Demo
              <ArrowRight className="w-5 h-5" />
            </Link>

            <p className="mt-4 text-xs text-slate-500">
              Demo account đã được kết nối sẵn với Shopee Shop và Lazada Shop mẫu
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-slate-900">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo_betacom.png" alt="BETACOM" className="w-10 h-10 rounded-xl object-contain" />
              <div>
                <span className="text-xl font-bold text-white">BETACOM</span>
                <p className="text-sm text-slate-400">Multi-platform E-commerce Manager</p>
              </div>
            </div>

            <div className="flex items-center gap-6 text-slate-400">
              <span className="text-sm">Hỗ trợ:</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 rounded-lg">
                  <ShopeeIcon />
                  <span className="text-sm text-orange-400">Shopee</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 rounded-lg">
                  <LazadaIcon />
                  <span className="text-sm text-blue-400">Lazada</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-slate-800 text-center">
            <p className="text-sm text-slate-500">
              © 2024 BETACOM. All rights reserved. |
              <a href="mailto:support@betacom.agency" className="text-slate-400 hover:text-white ml-1 cursor-pointer">
                support@betacom.agency
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

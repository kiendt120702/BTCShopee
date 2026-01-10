/**
 * Home Page - Trang chủ giới thiệu
 */

import { Store, Shield, Zap, Users } from 'lucide-react';

export default function HomePage() {
  const features = [
    {
      title: 'Quản lý đa Shop',
      description: 'Kết nối và quản lý nhiều shop Shopee cùng lúc một cách dễ dàng',
      icon: Store,
      color: 'from-orange-500 to-red-500',
    },
    {
      title: 'Bảo mật cao',
      description: 'Xác thực OAuth 2.0 chính thức từ Shopee, an toàn tuyệt đối',
      icon: Shield,
      color: 'from-green-500 to-emerald-500',
    },
    {
      title: 'Nhanh chóng',
      description: 'Giao diện tối ưu, thao tác nhanh gọn, tiết kiệm thời gian',
      icon: Zap,
      color: 'from-yellow-500 to-orange-500',
    },
    {
      title: 'Hỗ trợ đội nhóm',
      description: 'Phân quyền thành viên, làm việc nhóm hiệu quả',
      icon: Users,
      color: 'from-blue-500 to-indigo-500',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="text-center py-8">
        <div className="inline-flex items-center gap-3 mb-4">
          <img
            src="/logo_betacom.png"
            alt="BETACOM"
            className="w-16 h-16 rounded-xl object-contain"
          />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-3">
          Chào mừng đến với <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-red-500">BETACOM</span>
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Nền tảng quản lý Shop Shopee chuyên nghiệp, giúp bạn kết nối và quản lý nhiều shop một cách hiệu quả
        </p>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-all"
            >
              <div className={`inline-flex p-3 rounded-lg bg-gradient-to-br ${feature.color} mb-4`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">{feature.title}</h3>
              <p className="text-slate-600">{feature.description}</p>
            </div>
          );
        })}
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-8 text-center text-white">
        <h2 className="text-2xl font-bold mb-3">Bắt đầu ngay hôm nay</h2>
        <p className="text-orange-100 mb-6">
          Truy cập phần Cài đặt → Quản lý Shop để kết nối shop Shopee của bạn
        </p>
        <a
          href="/settings/shops"
          className="inline-flex items-center gap-2 px-6 py-3 bg-white text-orange-600 font-semibold rounded-lg hover:bg-orange-50 transition-colors"
        >
          <Store className="w-5 h-5" />
          Kết nối Shop ngay
        </a>
      </div>
    </div>
  );
}

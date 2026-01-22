/**
 * Auth Page - Trang đăng nhập
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

// Platform icons
const ShopeeIcon = () => (
  <img
    src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRcS-HdfgUSCDmV_LNqOxasca8KcceWStGP_A&s"
    alt="Shopee"
    className="w-7 h-7 object-contain"
  />
);

const LazadaIcon = () => (
  <img
    src="https://recland.s3.ap-southeast-1.amazonaws.com/company/19a57791bf92848b511de18eaebca94a.png"
    alt="Lazada"
    className="w-7 h-7 object-contain"
  />
);

const TikTokIcon = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const PLATFORMS = [
  { name: 'Shopee', icon: ShopeeIcon, color: 'text-orange-500', bgColor: 'bg-orange-100', available: true },
  { name: 'Lazada', icon: LazadaIcon, color: 'text-blue-600', bgColor: 'bg-blue-100', available: true },
  { name: 'TikTok Shop', icon: TikTokIcon, color: 'text-slate-800', bgColor: 'bg-slate-100', available: false },
  { name: 'Facebook', icon: FacebookIcon, color: 'text-blue-500', bgColor: 'bg-blue-100', available: false },
];

const FEATURES = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    title: 'Kết nối đa nền tảng',
    description: 'Shopee, Lazada, TikTok Shop, Facebook trong một nơi',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    title: 'Quản lý tập trung',
    description: 'Quản lý nhiều shop, nhiều nền tảng từ một dashboard',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
    title: 'Auto Refresh Token',
    description: 'Tự động làm mới token để duy trì kết nối liên tục',
  },
];

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { error, signIn, isAuthenticated } = useAuth();
  const isDemo = searchParams.get('demo') === 'true';
  const [email, setEmail] = useState(isDemo ? 'reviewer@betacom.agency' : '');
  const [password, setPassword] = useState(isDemo ? 'ShopeeISV@2024' : '');
  const [localError, setLocalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (isAuthenticated) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (!email || !password) {
      setLocalError('Vui lòng điền đầy đủ thông tin');
      return;
    }

    setIsSubmitting(true);
    const result = await signIn(email, password);
    
    // Nếu login thành công, navigate sẽ được trigger bởi useEffect
    // Nếu thất bại, tắt loading để user có thể thử lại
    if (!result.success) {
      setIsSubmitting(false);
    }
    // Nếu thành công, giữ isSubmitting = true cho đến khi navigate
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50 flex">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-orange-200 rounded-full opacity-20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-red-200 rounded-full opacity-20 blur-3xl" />
      </div>

      {/* Left Side - Features */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-12">
        <div className="max-w-lg">
          <div className="flex items-center gap-3 mb-8">
            <img src="/logo_betacom.png" alt="BETACOM" className="w-12 h-12 rounded-xl object-contain" />
            <div>
              <h1 className="text-2xl font-bold text-red-500">BETACOM</h1>
            </div>
          </div>

          <h2 className="text-4xl font-bold text-slate-800 mb-4">
            Quản lý Shop <span className="text-orange-500">đa nền tảng</span>
          </h2>
          <p className="text-lg text-slate-600 mb-6">
            Kết nối và quản lý tất cả shop thương mại điện tử của bạn trong một nền tảng duy nhất.
          </p>

          {/* Platform Icons */}
          <div className="flex items-center gap-3 mb-8">
            {PLATFORMS.map((platform, index) => (
              <div
                key={index}
                className={`relative flex items-center justify-center w-12 h-12 rounded-xl ${platform.bgColor} ${platform.color} transition-transform hover:scale-110 cursor-pointer`}
                title={platform.name}
              >
                <platform.icon />
                {!platform.available && (
                  <span className="absolute -top-1 -right-1 text-[10px] bg-slate-500 text-white px-1.5 py-0.5 rounded-full font-medium">
                    Soon
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {FEATURES.map((feature, index) => (
              <div key={index} className="flex items-start gap-4 p-4 bg-white/60 rounded-xl border border-slate-100">
                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 flex-shrink-0">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{feature.title}</h3>
                  <p className="text-sm text-slate-600">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Side - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md">
          <div className="text-center mb-8 lg:hidden">
            <img src="/logo_betacom.png" alt="BETACOM" className="w-20 h-20 rounded-2xl shadow-xl shadow-orange-500/30 mb-4 object-contain mx-auto" />
            <h1 className="text-3xl font-bold text-red-500">BETACOM</h1>
          </div>

          <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100">
            <h2 className="text-xl font-semibold text-slate-800 mb-6 text-center">Đăng nhập</h2>

            {(error || localError) && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error || localError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Mật khẩu</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-red-600 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Đang xử lý...</span>
                  </>
                ) : (
                  <span>Đăng nhập</span>
                )}
              </button>
            </form>
          </div>

          <div className="text-center mt-6">
            <p className="text-xs text-slate-400">
              Hỗ trợ <span className="font-medium text-orange-500">Shopee</span> · <span className="font-medium text-blue-600">Lazada</span> · <span className="font-medium text-slate-600">TikTok</span> · <span className="font-medium text-blue-500">Facebook</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

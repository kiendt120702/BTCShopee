import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';

// Pages
import AuthPage from '@/pages/AuthPage';
import AuthCallback from '@/pages/AuthCallback';
import DashboardLayout from '@/layouts/DashboardLayout';
import DashboardPage from '@/pages/DashboardPage';
import FlashSalePage from '@/pages/FlashSalePage';
import FlashSaleSchedulePage from '@/pages/FlashSaleSchedulePage';
import AdsPage from '@/pages/AdsPage';
import AdsKeywordsPage from '@/pages/AdsKeywordsPage';
import KeywordTrackingPage from '@/pages/KeywordTrackingPage';
import AccountHealthPage from '@/pages/AccountHealthPage';
import ProfilePage from '@/pages/ProfilePage';
import ProfileShopsPage from '@/pages/ProfileShopsPage';
import NotFoundPage from '@/pages/NotFoundPage';

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              {/* Public routes */}
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/auth/callback" element={<AuthCallback />} />

              {/* Protected routes with Dashboard layout */}
              <Route path="/" element={<DashboardLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="flash-sale" element={<FlashSalePage />} />
                <Route path="flash-sale/schedule" element={<FlashSaleSchedulePage />} />
                <Route path="ads" element={<AdsPage />} />
                <Route path="ads/keywords" element={<AdsKeywordsPage />} />
                <Route path="ads/tracking" element={<KeywordTrackingPage />} />
                <Route path="account-health" element={<AccountHealthPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="profile/shops" element={<ProfileShopsPage />} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

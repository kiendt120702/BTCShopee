/**
 * Lazada OAuth Callback - Xử lý callback từ Lazada OAuth
 */

import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLazadaAuth } from '@/contexts/LazadaAuthContext';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Global flag để ngăn chặn việc xử lý callback nhiều lần (quan trọng!)
// Authorization code của Lazada chỉ được sử dụng 1 lần
const processedCodes = new Set<string>();

export default function LazadaCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { handleCallback } = useLazadaAuth();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const processedRef = useRef(false);

  useEffect(() => {
    // Đợi auth load xong trước khi xử lý callback
    if (authLoading) return;

    // Tránh xử lý nhiều lần - check cả ref và state
    if (processedRef.current) return;

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    console.log('[LAZADA-CALLBACK] Processing:', {
      code: code?.substring(0, 20) + '...',
      errorParam,
      alreadyProcessed: code ? processedCodes.has(code) : false
    });

    // Kiểm tra nếu code đã được xử lý (global check)
    if (code && processedCodes.has(code)) {
      console.log('[LAZADA-CALLBACK] Code already processed, skipping');
      return;
    }

    const processCallback = async () => {
      if (errorParam) {
        const errorMsg = errorDescription || `Lazada authorization failed: ${errorParam}`;
        setError(errorMsg);
        toast({
          title: 'Kết nối Lazada thất bại',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      if (!code) {
        const errorMsg = 'Thiếu mã xác thực từ Lazada';
        setError(errorMsg);
        toast({
          title: 'Kết nối thất bại',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      // Kiểm tra user đã đăng nhập chưa
      if (!isAuthenticated) {
        const errorMsg = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
        setError(errorMsg);
        toast({
          title: 'Phiên đăng nhập hết hạn',
          description: 'Vui lòng đăng nhập lại để tiếp tục',
          variant: 'destructive',
        });
        return;
      }

      // QUAN TRỌNG: Đánh dấu code đã được xử lý TRƯỚC khi gọi API
      // để tránh race condition khi React re-render
      processedRef.current = true;
      processedCodes.add(code);
      setIsProcessing(true);

      try {
        console.log('[LAZADA-CALLBACK] Calling handleCallback with code...');
        const result = await handleCallback(code);
        console.log('[LAZADA-CALLBACK] handleCallback result:', result);

        if (result) {
          setSuccess(true);
          toast({
            title: 'Kết nối thành công!',
            description: 'Shop Lazada đã được liên kết với tài khoản của bạn.',
          });

          // Redirect sau 2 giây
          setTimeout(() => {
            navigate('/lazada/shops?refresh=' + Date.now(), { replace: true });
          }, 2000);
        } else {
          throw new Error('Failed to connect Lazada shop');
        }
      } catch (err) {
        console.error('[LAZADA-CALLBACK] Error:', err);
        // Không reset processedRef vì code đã hết hạn sau khi dùng
        const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
        setError(errorMessage);

        toast({
          title: 'Kết nối thất bại',
          description: errorMessage,
          variant: 'destructive',
        });
      } finally {
        setIsProcessing(false);
      }
    };

    processCallback();
  }, [searchParams, handleCallback, navigate, authLoading, isAuthenticated]);

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Kết nối thành công!</h1>
          <p className="text-slate-600 mb-4">Shop Lazada đã được liên kết với tài khoản của bạn.</p>
          <p className="text-sm text-slate-500">Đang chuyển hướng...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Xác thực thất bại</h1>
          <p className="text-slate-600 mb-4">{error}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => navigate('/lazada/shops')}>
              Quay lại
            </Button>
            <Button
              className="bg-blue-500 hover:bg-blue-600"
              onClick={() => {
                processedRef.current = false;
                setError(null);
                navigate('/lazada/shops');
              }}
            >
              Thử lại
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <Spinner className="h-12 w-12 mx-auto mb-4 text-blue-500" />
        <p className="text-slate-600">Đang xác thực với Lazada...</p>
      </div>
    </div>
  );
}

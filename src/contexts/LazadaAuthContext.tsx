/**
 * Lazada Authentication Context
 * Quản lý trạng thái xác thực và shop selection cho Lazada
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  LazadaShop,
  LazadaAppInfo,
  getAuthUrl,
  getAccessToken,
  refreshToken,
  getUserShops,
  addShopMember,
  LAZADA_CONFIG,
} from '@/lib/lazada/client';

interface LazadaAuthContextType {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  currentShop: LazadaShop | null;
  shops: LazadaShop[];
  error: string | null;

  // Actions
  login: (appInfo?: LazadaAppInfo, region?: string) => Promise<void>;
  handleCallback: (code: string, region?: string, appInfo?: LazadaAppInfo) => Promise<boolean>;
  logout: () => void;
  refresh: () => Promise<boolean>;
  switchShop: (sellerId: number) => Promise<boolean>;
  loadShops: () => Promise<void>;
}

const LazadaAuthContext = createContext<LazadaAuthContextType | undefined>(undefined);

const LAZADA_STORAGE_KEYS = {
  CURRENT_SHOP: 'lazada_current_shop',
  APP_INFO: 'lazada_app_info',
};

export function LazadaAuthProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [currentShop, setCurrentShop] = useState<LazadaShop | null>(null);
  const [shops, setShops] = useState<LazadaShop[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!currentShop?.access_token;

  /**
   * Load danh sách shops của user
   */
  const loadShops = useCallback(async () => {
    if (!user?.id) {
      setShops([]);
      setCurrentShop(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const userShops = await getUserShops(user.id);
      setShops(userShops);

      // Restore current shop from localStorage
      const savedShopId = localStorage.getItem(LAZADA_STORAGE_KEYS.CURRENT_SHOP);
      if (savedShopId) {
        const savedShop = userShops.find((s) => s.seller_id.toString() === savedShopId);
        if (savedShop) {
          setCurrentShop(savedShop);
        } else if (userShops.length > 0) {
          // Fallback to first shop
          setCurrentShop(userShops[0]);
          localStorage.setItem(LAZADA_STORAGE_KEYS.CURRENT_SHOP, userShops[0].seller_id.toString());
        }
      } else if (userShops.length > 0) {
        // Default to first shop
        setCurrentShop(userShops[0]);
        localStorage.setItem(LAZADA_STORAGE_KEYS.CURRENT_SHOP, userShops[0].seller_id.toString());
      }
    } catch (err) {
      console.error('[LAZADA] Error loading shops:', err);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  /**
   * Login - redirect to Lazada OAuth
   */
  const login = useCallback(
    async (appInfo?: LazadaAppInfo, region: string = LAZADA_CONFIG.DEFAULT_REGION) => {
      try {
        setError(null);

        // Save app info for callback
        if (appInfo) {
          localStorage.setItem(LAZADA_STORAGE_KEYS.APP_INFO, JSON.stringify(appInfo));
        }

        // Get auth URL from edge function
        const { auth_url } = await getAuthUrl(LAZADA_CONFIG.CALLBACK_URL, region, appInfo);

        // Redirect to Lazada OAuth page
        window.location.href = auth_url;
      } catch (err) {
        console.error('[LAZADA] Login error:', err);
        setError((err as Error).message);
        throw err;
      }
    },
    []
  );

  /**
   * Handle OAuth callback
   */
  const handleCallback = useCallback(
    async (
      code: string,
      region: string = LAZADA_CONFIG.DEFAULT_REGION,
      appInfo?: LazadaAppInfo
    ): Promise<boolean> => {
      console.log('[LAZADA-CONTEXT] handleCallback called with code:', code?.substring(0, 20) + '...');

      if (!user?.id) {
        console.error('[LAZADA-CONTEXT] User not authenticated');
        setError('User not authenticated');
        return false;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Get saved app info if not provided
        let finalAppInfo = appInfo;
        if (!finalAppInfo) {
          const savedAppInfo = localStorage.getItem(LAZADA_STORAGE_KEYS.APP_INFO);
          if (savedAppInfo) {
            finalAppInfo = JSON.parse(savedAppInfo);
            localStorage.removeItem(LAZADA_STORAGE_KEYS.APP_INFO);
            console.log('[LAZADA-CONTEXT] Using saved app info');
          }
        }

        // Exchange code for token
        console.log('[LAZADA-CONTEXT] Calling getAccessToken...');
        const result = await getAccessToken(code, region, finalAppInfo);
        console.log('[LAZADA-CONTEXT] getAccessToken result:', {
          success: result.success,
          error: result.error,
          message: result.message,
          user_id: result.user_id,
          hasAccessToken: !!result.access_token
        });

        if (!result.success || result.error) {
          const errorMsg = result.message || result.error || 'Failed to get access token';
          console.error('[LAZADA-CONTEXT] Token exchange failed:', errorMsg);
          setError(errorMsg);
          return false;
        }

        // Get the shop that was just created/updated
        console.log('[LAZADA-CONTEXT] Fetching shop for seller_id:', result.user_id);
        const { data: shop, error: shopError } = await supabase
          .from('apilazada_shops')
          .select('*')
          .eq('seller_id', result.user_id)
          .single();

        console.log('[LAZADA-CONTEXT] Shop fetch result:', { shop: shop?.id, error: shopError });

        if (shop) {
          // Add current user as shop member
          console.log('[LAZADA-CONTEXT] Adding shop member...');
          await addShopMember(shop.id, user.id);

          // Update state
          setCurrentShop(shop);
          localStorage.setItem(LAZADA_STORAGE_KEYS.CURRENT_SHOP, shop.seller_id.toString());

          // Reload shops list
          await loadShops();
          console.log('[LAZADA-CONTEXT] Callback completed successfully');
        } else {
          console.error('[LAZADA-CONTEXT] Shop not found after token exchange');
        }

        return true;
      } catch (err) {
        console.error('[LAZADA-CONTEXT] Callback error:', err);
        setError((err as Error).message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [user?.id, loadShops]
  );

  /**
   * Logout - clear current shop state
   */
  const logout = useCallback(() => {
    setCurrentShop(null);
    localStorage.removeItem(LAZADA_STORAGE_KEYS.CURRENT_SHOP);
    setError(null);
  }, []);

  /**
   * Refresh access token
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!currentShop?.refresh_token) {
      setError('No refresh token available');
      return false;
    }

    try {
      const result = await refreshToken(
        currentShop.refresh_token,
        currentShop.seller_id,
        currentShop.region
      );

      if (!result.success || result.error) {
        setError(result.error || 'Failed to refresh token');
        return false;
      }

      // Reload shop data
      const { data: updatedShop } = await supabase
        .from('apilazada_shops')
        .select('*')
        .eq('seller_id', currentShop.seller_id)
        .single();

      if (updatedShop) {
        setCurrentShop(updatedShop);
      }

      return true;
    } catch (err) {
      console.error('[LAZADA] Refresh error:', err);
      setError((err as Error).message);
      return false;
    }
  }, [currentShop]);

  /**
   * Switch to a different shop
   */
  const switchShop = useCallback(
    async (sellerId: number): Promise<boolean> => {
      const shop = shops.find((s) => s.seller_id === sellerId);
      if (!shop) {
        setError('Shop not found');
        return false;
      }

      setCurrentShop(shop);
      localStorage.setItem(LAZADA_STORAGE_KEYS.CURRENT_SHOP, sellerId.toString());
      setError(null);
      return true;
    },
    [shops]
  );

  // Load shops on mount and when user changes
  useEffect(() => {
    loadShops();
  }, [loadShops]);

  // Subscribe to shop changes
  useEffect(() => {
    if (!currentShop?.seller_id) return;

    const channel = supabase
      .channel(`lazada_shop_${currentShop.seller_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'apilazada_shops',
          filter: `seller_id=eq.${currentShop.seller_id}`,
        },
        (payload) => {
          console.log('[LAZADA] Shop updated:', payload);
          setCurrentShop(payload.new as LazadaShop);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentShop?.seller_id]);

  const value: LazadaAuthContextType = {
    isAuthenticated,
    isLoading,
    currentShop,
    shops,
    error,
    login,
    handleCallback,
    logout,
    refresh,
    switchShop,
    loadShops,
  };

  return <LazadaAuthContext.Provider value={value}>{children}</LazadaAuthContext.Provider>;
}

export function useLazadaAuth() {
  const context = useContext(LazadaAuthContext);
  if (context === undefined) {
    throw new Error('useLazadaAuth must be used within a LazadaAuthProvider');
  }
  return context;
}

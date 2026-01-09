/**
 * Shopee Authentication Hook
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getStoredToken,
  storeToken,
  clearToken,
  isSupabaseConfigured,
  getAuthorizationUrl,
  authenticateWithCode,
  refreshToken,
  isConfigValid,
} from '@/lib/shopee';
import type { AccessToken } from '@/lib/shopee';
import { saveUserShop, getUserShops } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

interface ShopInfo {
  shop_id: number;
  shop_name: string | null;
  shop_logo: string | null;
  region: string | null;
  is_active: boolean;
}

interface PartnerInfo {
  partner_id: number;
  partner_key: string;
  partner_name?: string;
  partner_created_by?: string;
}

interface UseShopeeAuthReturn {
  token: AccessToken | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  useBackend: boolean;
  error: string | null;
  user: { id: string; email?: string } | null;
  shops: ShopInfo[];
  selectedShopId: number | null;
  login: (callbackUrl?: string, partnerAccountId?: string, partnerInfo?: PartnerInfo) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  handleCallback: (code: string, shopId?: number, partnerAccountId?: string) => Promise<void>;
  switchShop: (shopId: number) => Promise<void>;
}

const DEFAULT_CALLBACK =
  import.meta.env.VITE_SHOPEE_CALLBACK_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : 'https://apishopeenextjs.vercel.app/auth/callback');

export function useShopeeAuth(): UseShopeeAuthReturn {
  const [token, setToken] = useState<AccessToken | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<number | null>(null);

  const useBackend = isSupabaseConfigured();
  const isConfigured = isConfigValid() || useBackend;
  const isAuthenticated = !!token && !error;

  const loadTokenFromSource = useCallback(async (userId?: string, targetShopId?: number) => {
    try {
      let tokenLoaded = false;
      let localShopId: number | null = null;

      // Only load from localStorage if NOT switching to a specific shop
      if (!targetShopId) {
        const storedToken = await getStoredToken();
        if (storedToken?.shop_id && storedToken?.access_token) {
          setToken(storedToken);
          setSelectedShopId(storedToken.shop_id);
          localShopId = storedToken.shop_id;
          tokenLoaded = true;
        }
      }

      if (userId) {
        const userShops = await getUserShops(userId);

        if (userShops && userShops.length > 0) {
          const shopInfoList: ShopInfo[] = userShops
            .filter((shop): shop is typeof shop & { shop_id: number } => typeof shop.shop_id === 'number')
            .map((shop) => ({
              shop_id: shop.shop_id,
              shop_name: shop.shop_name ?? null,
              shop_logo: shop.shop_logo ?? null,
              region: shop.region ?? null,
              is_active: true
            }));
          setShops(shopInfoList);

          // If switching to specific shop, always load that shop's token
          // If not switching and already loaded from localStorage, skip
          if (!targetShopId && tokenLoaded) {
            return true;
          }

          const shopToLoadId = targetShopId || localShopId || userShops[0]?.shop_id;
          
          if (shopToLoadId) {
            const { data: shopData } = await supabase
              .from('apishopee_shops')
              .select('shop_id, access_token, refresh_token, expired_at, merchant_id')
              .eq('shop_id', shopToLoadId)
              .single();

            if (shopData?.access_token) {
              const dbToken: AccessToken = {
                access_token: shopData.access_token,
                refresh_token: shopData.refresh_token,
                shop_id: shopData.shop_id,
                expired_at: shopData.expired_at,
                expire_in: 14400,
                merchant_id: shopData.merchant_id,
              };

              await storeToken(dbToken);
              setToken(dbToken);
              setSelectedShopId(shopData.shop_id);
              return true;
            }
          }
        }
      }
      return tokenLoaded;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let initialLoadDone = false;

    async function initLoad() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted) {
          if (session?.user) {
            setUser({ id: session.user.id, email: session.user.email });
            await loadTokenFromSource(session.user.id);
          }
        }
      } catch {
        // ignore init error
      } finally {
        if (mounted) {
          setIsLoading(false);
          initialLoadDone = true;
        }
      }
    }

    initLoad();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        if (event === 'INITIAL_SESSION') return;
        if (event === 'TOKEN_REFRESHED') return;
        if (!initialLoadDone) return;

        if (event === 'SIGNED_IN' && session?.user) {
          const currentUserId = user?.id;
          if (currentUserId !== session.user.id || !token) {
            setUser({ id: session.user.id, email: session.user.email });
            await loadTokenFromSource(session.user.id);
          }
        } else if (event === 'SIGNED_OUT') {
          setToken(null);
          setUser(null);
          setShops([]);
          setSelectedShopId(null);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTokenFromSource]);

  const login = useCallback(
    async (callbackUrl = DEFAULT_CALLBACK, partnerAccountId?: string, partnerInfo?: PartnerInfo) => {
      if (!isConfigured && !partnerInfo) {
        setError('SDK not configured. Please provide partner credentials.');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (partnerInfo) {
          sessionStorage.setItem('shopee_partner_info', JSON.stringify(partnerInfo));
        }

        const authUrl = await getAuthorizationUrl(callbackUrl, partnerAccountId, partnerInfo);
        window.location.href = authUrl;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get auth URL');
        setIsLoading(false);
      }
    },
    [isConfigured]
  );

  const handleCallback = useCallback(
    async (code: string, shopId?: number, partnerAccountId?: string) => {
      setIsLoading(true);
      setError(null);

      const partnerInfoStr = sessionStorage.getItem('shopee_partner_info');
      const partnerInfo = partnerInfoStr ? JSON.parse(partnerInfoStr) : null;

      try {
        const newToken = await authenticateWithCode(code, shopId, partnerAccountId, partnerInfo);

        await storeToken(newToken);
        setToken(newToken);

        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && newToken.shop_id && newToken.access_token && newToken.refresh_token) {
            await saveUserShop(
              user.id,
              newToken.shop_id,
              newToken.access_token,
              newToken.refresh_token,
              newToken.expired_at || Date.now() + 4 * 60 * 60 * 1000,
              newToken.merchant_id,
              undefined,
              partnerInfo
            );

            console.log('[AUTH] Shop and token saved to database');

            // Wait for shop info to be fetched - this is important for UI display
            try {
              const { data, error } = await supabase.functions.invoke('apishopee-shop', {
                body: { action: 'get-full-info', shop_id: newToken.shop_id, force_refresh: true },
              });
              
              if (error) {
                console.warn('[AUTH] Failed to fetch shop info:', error);
              } else {
                console.log('[AUTH] Shop info fetched successfully:', data?.shop_name);
              }
            } catch (err) {
              console.warn('[AUTH] Error fetching shop info:', err);
            }
          }
        } catch (err) {
          console.warn('[AUTH] Error saving shop to database:', err);
        }

        sessionStorage.removeItem('shopee_partner_info');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await clearToken();
      setToken(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to logout');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!token?.refresh_token) {
      setError('No refresh token available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newToken = await refreshToken(token.refresh_token, token.shop_id, token.merchant_id);

      await storeToken(newToken);
      setToken(newToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh token');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const switchShop = useCallback(async (shopId: number) => {
    if (!user?.id) {
      setError('User not authenticated');
      return;
    }

    if (shopId === selectedShopId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await loadTokenFromSource(user.id, shopId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch shop');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, selectedShopId, loadTokenFromSource]);

  return {
    token,
    isAuthenticated,
    isLoading,
    isConfigured,
    useBackend,
    error,
    user,
    shops,
    selectedShopId,
    login,
    logout,
    refresh,
    handleCallback,
    switchShop,
  };
}

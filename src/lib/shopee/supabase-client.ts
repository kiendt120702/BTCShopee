/**
 * Shopee API Client via Supabase Edge Functions
 * Gọi backend API để xử lý Shopee authentication
 */

import { supabase, isSupabaseConfigured } from '../supabase';
import type { AccessToken } from './types';

export { isSupabaseConfigured };

interface PartnerInfo {
  partner_id: number;
  partner_key: string;
  partner_name?: string;
  partner_created_by?: string;
}

/**
 * Lấy URL xác thực OAuth từ backend
 * @param redirectUri - URL callback sau khi authorize
 * @param partnerAccountId - (deprecated) ID của partner account
 * @param partnerInfo - Partner credentials trực tiếp
 */
export async function getAuthorizationUrl(
  redirectUri: string,
  partnerAccountId?: string,
  partnerInfo?: PartnerInfo
): Promise<string> {
  console.log('[Shopee] getAuthorizationUrl called');
  console.log('[Shopee] redirect_uri:', redirectUri);
  console.log('[Shopee] partnerInfo:', partnerInfo ? { 
    partner_id: partnerInfo.partner_id, 
    partner_key: partnerInfo.partner_key?.substring(0, 10) + '...',
    partner_name: partnerInfo.partner_name 
  } : null);

  try {
    console.log('[Shopee] Invoking apishopee-auth Edge Function...');
    console.log('[Shopee] Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30) + '...');
    
    // Add timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout after 30s')), 30000);
    });

    const invokePromise = supabase.functions.invoke('apishopee-auth', {
      body: {
        action: 'get-auth-url',
        redirect_uri: redirectUri,
        partner_info: partnerInfo,
      },
    });

    console.log('[Shopee] Waiting for Edge Function response...');
    const { data, error } = await Promise.race([invokePromise, timeoutPromise]) as { data: unknown; error: unknown };

    console.log('[Shopee] Edge Function response received:', { data, error });

    if (error) {
      console.error('[Shopee] Edge Function error:', error);
      throw new Error((error as Error).message || 'Failed to get auth URL from Edge Function');
    }

    if (!data) {
      console.error('[Shopee] No data returned from Edge Function');
      throw new Error('No response data from server');
    }

    const responseData = data as { error?: string; message?: string; auth_url?: string };

    if (responseData.error) {
      console.error('[Shopee] Server returned error:', responseData.error, responseData.message);
      throw new Error(responseData.message || responseData.error || 'Server error');
    }

    if (!responseData.auth_url) {
      console.error('[Shopee] No auth_url in response:', data);
      throw new Error(responseData.message || 'No auth URL returned from server');
    }

    console.log('[Shopee] Got auth_url:', responseData.auth_url.substring(0, 100) + '...');
    return responseData.auth_url;
  } catch (err) {
    console.error('[Shopee] getAuthorizationUrl exception:', err);
    throw err;
  }
}

/**
 * Đổi code lấy access token
 * @param code - Authorization code từ callback
 * @param shopId - Shop ID (optional)
 * @param partnerAccountId - (deprecated) ID của partner account
 * @param partnerInfo - Partner credentials trực tiếp
 */
export async function authenticateWithCode(
  code: string,
  shopId?: number,
  partnerAccountId?: string,
  partnerInfo?: PartnerInfo
): Promise<AccessToken> {
  console.log('[Shopee] authenticateWithCode called:', { code: code.substring(0, 10) + '...', shopId, partnerInfo });

  const { data, error } = await supabase.functions.invoke('apishopee-auth', {
    body: {
      action: 'get-token',
      code,
      shop_id: shopId,
      partner_info: partnerInfo,
    },
  });

  console.log('[Shopee] authenticateWithCode response:', { data, error });

  if (error) {
    throw new Error(error.message || 'Failed to authenticate');
  }

  if (data.error) {
    throw new Error(data.message || data.error);
  }

  // Đảm bảo shop_id có giá trị (lấy từ param nếu API không trả về)
  const token: AccessToken = {
    ...data,
    shop_id: data.shop_id || shopId,
  };

  console.log('[Shopee] Final token:', { shop_id: token.shop_id, has_access_token: !!token.access_token });

  return token;
}

/**
 * Refresh access token
 */
export async function refreshToken(
  currentRefreshToken: string,
  shopId?: number,
  merchantId?: number
): Promise<AccessToken> {
  const { data, error } = await supabase.functions.invoke('apishopee-auth', {
    body: {
      action: 'refresh-token',
      refresh_token: currentRefreshToken,
      shop_id: shopId,
      merchant_id: merchantId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to refresh token');
  }

  if (data.error) {
    throw new Error(data.message || data.error);
  }

  return data as AccessToken;
}

/**
 * Lấy token đã lưu từ database
 */
export async function getStoredTokenFromDB(shopId: number): Promise<AccessToken | null> {
  const { data, error } = await supabase.functions.invoke('apishopee-auth', {
    body: { action: 'get-stored-token', shop_id: shopId },
  });

  if (error || data?.error) {
    return null;
  }

  return data as AccessToken;
}

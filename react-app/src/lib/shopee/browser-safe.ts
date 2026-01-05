/**
 * Browser-safe Shopee SDK wrapper
 */

import type { AccessToken } from './types';
import { LocalStorageTokenStorage } from './storage/local-storage';

export const isServer = typeof window === 'undefined';
export const isBrowser = !isServer;

export const SHOPEE_CONFIG = {
  partner_id: Number(import.meta.env.VITE_SHOPEE_PARTNER_ID) || 0,
  partner_key: import.meta.env.VITE_SHOPEE_PARTNER_KEY || '',
  shop_id: Number(import.meta.env.VITE_SHOPEE_SHOP_ID) || undefined,
  callback_url: import.meta.env.VITE_SHOPEE_CALLBACK_URL || 'https://apishopeenextjs.vercel.app/auth/callback',
};

export enum ShopeeRegion {
  GLOBAL = 'GLOBAL',
  SG = 'SG',
  MY = 'MY',
  TH = 'TH',
  VN = 'VN',
  PH = 'PH',
  ID = 'ID',
  TW = 'TW',
  BR = 'BR',
  MX = 'MX',
  CO = 'CO',
  CL = 'CL',
  PL = 'PL',
}

const BASE_URLS: Record<string, string> = {
  GLOBAL: 'https://partner.shopeemobile.com',
  SANDBOX: 'https://partner.test-stable.shopeemobile.com',
};

const tokenStorage = new LocalStorageTokenStorage();

export function isConfigValid(): boolean {
  return SHOPEE_CONFIG.partner_id > 0 && SHOPEE_CONFIG.partner_key.length > 0;
}

export function getAuthorizationUrl(redirectUri?: string): string {
  const callback = redirectUri || SHOPEE_CONFIG.callback_url;
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/shop/auth_partner';

  const baseUrl = BASE_URLS.GLOBAL;
  const params = new URLSearchParams({
    partner_id: SHOPEE_CONFIG.partner_id.toString(),
    timestamp: timestamp.toString(),
    redirect: callback,
  });

  return `${baseUrl}${path}?${params.toString()}`;
}

export async function getStoredToken(): Promise<AccessToken | null> {
  return await tokenStorage.get();
}

export async function storeToken(token: AccessToken): Promise<void> {
  await tokenStorage.store(token);
}

export async function clearToken(): Promise<void> {
  await tokenStorage.clear();
}

export async function isTokenValid(bufferMinutes = 5): Promise<boolean> {
  const token = await getStoredToken();

  if (!token) return false;
  if (!token.expired_at) return true;

  const now = Date.now();
  const bufferMs = bufferMinutes * 60 * 1000;

  return now < token.expired_at - bufferMs;
}

export async function authenticateWithCode(
  code: string,
  shopId?: number
): Promise<AccessToken> {
  console.warn('[Shopee] authenticateWithCode requires backend implementation');
  console.log('[Shopee] Received code:', code, 'shopId:', shopId);

  const mockToken: AccessToken = {
    access_token: 'mock_access_token_' + Date.now(),
    refresh_token: 'mock_refresh_token_' + Date.now(),
    expire_in: 14400,
    expired_at: Date.now() + 14400 * 1000,
    shop_id: shopId,
    request_id: 'mock_request_' + Date.now(),
  };

  await storeToken(mockToken);
  return mockToken;
}

export async function refreshToken(
  shopId?: number,
  merchantId?: number
): Promise<AccessToken> {
  console.warn('[Shopee] refreshToken requires backend implementation');

  const currentToken = await getStoredToken();

  const newToken: AccessToken = {
    access_token: 'mock_refreshed_token_' + Date.now(),
    refresh_token: currentToken?.refresh_token || 'mock_refresh_' + Date.now(),
    expire_in: 14400,
    expired_at: Date.now() + 14400 * 1000,
    shop_id: shopId || currentToken?.shop_id,
    merchant_id: merchantId,
    request_id: 'mock_request_' + Date.now(),
  };

  await storeToken(newToken);
  return newToken;
}

export async function handleOAuthCallback(
  searchParams: URLSearchParams
): Promise<AccessToken> {
  const code = searchParams.get('code');
  const shopId = searchParams.get('shop_id');

  if (!code) {
    throw new Error('Missing authorization code in callback');
  }

  return await authenticateWithCode(
    code,
    shopId ? Number(shopId) : undefined
  );
}

/**
 * Shopee SDK Configuration
 */

import { ShopeeSDK } from '@congminh1254/shopee-sdk';
import { createAutoStorage, type StorageType } from './storage';

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

export const SHOPEE_CONFIG = {
  partner_id: Number(import.meta.env.VITE_SHOPEE_PARTNER_ID) || 0,
  partner_key: import.meta.env.VITE_SHOPEE_PARTNER_KEY || '',
  region: ShopeeRegion.VN,
  shop_id: Number(import.meta.env.VITE_SHOPEE_SHOP_ID) || undefined,
};

export const SHOPEE_BASE_URL = {
  PRODUCTION: undefined,
  SANDBOX: 'https://partner.test-stable.shopeemobile.com',
};

let currentStorageType: StorageType = 'localStorage';

export function isConfigValid(): boolean {
  return SHOPEE_CONFIG.partner_id > 0 && SHOPEE_CONFIG.partner_key.length > 0;
}

export function setStorageType(type: StorageType): void {
  currentStorageType = type;
  resetShopeeSDK();
}

export function createShopeeSDK(useSandbox = false): ShopeeSDK {
  const config = {
    partner_id: SHOPEE_CONFIG.partner_id,
    partner_key: SHOPEE_CONFIG.partner_key,
    shop_id: SHOPEE_CONFIG.shop_id,
    base_url: useSandbox ? SHOPEE_BASE_URL.SANDBOX : undefined,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = createAutoStorage(SHOPEE_CONFIG.shop_id) as any;

  return new ShopeeSDK(config, storage);
}

let sdkInstance: ShopeeSDK | null = null;

export function getShopeeSDK(useSandbox = false): ShopeeSDK {
  if (!sdkInstance) {
    sdkInstance = createShopeeSDK(useSandbox);
  }
  return sdkInstance;
}

export function resetShopeeSDK(): void {
  sdkInstance = null;
}

export function getStorageType(): StorageType {
  return currentStorageType;
}

export type { StorageType };

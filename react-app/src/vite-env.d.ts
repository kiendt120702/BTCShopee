/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_SHOPEE_PARTNER_ID: string
  readonly VITE_SHOPEE_PARTNER_KEY: string
  readonly VITE_SHOPEE_SHOP_ID: string
  readonly VITE_SHOPEE_CALLBACK_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

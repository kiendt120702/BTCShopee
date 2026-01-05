-- Migration: Setup Auto Token Refresh Cron Job
-- Tự động refresh token cho tất cả shops sắp hết hạn

-- ============================================
-- PART 1: Ensure token_refresh_logs table exists
-- ============================================

-- Table đã được tạo trong migration trước, nhưng đảm bảo có đủ columns
ALTER TABLE IF EXISTS public.apishopee_token_refresh_logs
ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.apishopee_shops(id),
ADD COLUMN IF NOT EXISTS shopee_shop_id bigint,
ADD COLUMN IF NOT EXISTS success boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS error_message text,
ADD COLUMN IF NOT EXISTS old_token_expired_at bigint,
ADD COLUMN IF NOT EXISTS new_token_expired_at bigint,
ADD COLUMN IF NOT EXISTS refresh_source text DEFAULT 'auto' CHECK (refresh_source IN ('auto', 'manual', 'api')),
ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_token_refresh_logs_shop_id ON public.apishopee_token_refresh_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_token_refresh_logs_created_at ON public.apishopee_token_refresh_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_token_refresh_logs_success ON public.apishopee_token_refresh_logs(success);

-- ============================================
-- PART 2: Create helper function to check token expiry
-- ============================================

CREATE OR REPLACE FUNCTION public.get_shops_needing_token_refresh(threshold_hours integer DEFAULT 3)
RETURNS TABLE (
  id uuid,
  shop_id bigint,
  shop_name text,
  expired_at bigint,
  hours_until_expiry numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ms bigint := EXTRACT(EPOCH FROM NOW()) * 1000;
  threshold_ms bigint := threshold_hours * 60 * 60 * 1000;
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.shop_id,
    s.shop_name,
    s.expired_at,
    ROUND(((s.expired_at - now_ms) / 1000.0 / 60.0 / 60.0)::numeric, 2) as hours_until_expiry
  FROM public.apishopee_shops s
  WHERE s.refresh_token IS NOT NULL
    AND s.partner_id IS NOT NULL
    AND s.partner_key IS NOT NULL
    AND (
      s.expired_at IS NULL 
      OR s.expired_at < (now_ms + threshold_ms)
    )
  ORDER BY s.expired_at ASC NULLS FIRST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shops_needing_token_refresh TO authenticated, service_role;

-- ============================================
-- PART 3: Create function to call Edge Function
-- ============================================

-- Note: pg_net extension is required for HTTP calls from PostgreSQL
-- Enable it in Supabase Dashboard > Database > Extensions > pg_net

CREATE OR REPLACE FUNCTION public.trigger_token_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  service_key text;
  response jsonb;
BEGIN
  -- Get Supabase URL from environment (set in Supabase Dashboard > Settings > API)
  -- Note: This requires pg_net extension and proper configuration
  
  -- For now, just return info about shops needing refresh
  -- The actual refresh should be triggered by external cron (e.g., GitHub Actions, Vercel Cron)
  
  SELECT jsonb_agg(jsonb_build_object(
    'shop_id', shop_id,
    'shop_name', shop_name,
    'hours_until_expiry', hours_until_expiry
  ))
  INTO response
  FROM public.get_shops_needing_token_refresh(3);
  
  RETURN COALESCE(response, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_token_refresh TO service_role;

-- ============================================
-- PART 4: Setup pg_cron job (if extension is enabled)
-- ============================================

-- Check if pg_cron is available and create job
-- This runs every hour to check and refresh tokens
DO $$
BEGIN
  -- Check if pg_cron extension exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove existing job if any
    PERFORM cron.unschedule('auto-refresh-shopee-tokens');
    
    -- Schedule new job - runs every hour at minute 0
    -- This just marks which shops need refresh
    -- Actual refresh is done by Edge Function called externally
    PERFORM cron.schedule(
      'auto-refresh-shopee-tokens',
      '0 * * * *',  -- Every hour at minute 0
      $$SELECT public.trigger_token_refresh()$$
    );
    
    RAISE NOTICE 'pg_cron job scheduled for token refresh';
  ELSE
    RAISE NOTICE 'pg_cron extension not available. Use external cron service to call shopee-token-refresh Edge Function.';
  END IF;
END $$;

-- ============================================
-- PART 5: Create view for monitoring
-- ============================================

CREATE OR REPLACE VIEW public.token_refresh_status AS
SELECT 
  s.id,
  s.shop_id,
  s.shop_name,
  s.expired_at,
  CASE 
    WHEN s.expired_at IS NULL THEN 'unknown'
    WHEN s.expired_at < EXTRACT(EPOCH FROM NOW()) * 1000 THEN 'expired'
    WHEN s.expired_at < (EXTRACT(EPOCH FROM NOW()) * 1000 + 3 * 60 * 60 * 1000) THEN 'expiring_soon'
    ELSE 'valid'
  END as token_status,
  CASE 
    WHEN s.expired_at IS NULL THEN NULL
    ELSE ROUND(((s.expired_at - EXTRACT(EPOCH FROM NOW()) * 1000) / 1000.0 / 60.0 / 60.0)::numeric, 2)
  END as hours_until_expiry,
  to_timestamp(s.expired_at / 1000) as expires_at_datetime,
  s.token_updated_at,
  (
    SELECT COUNT(*) 
    FROM public.apishopee_token_refresh_logs l 
    WHERE l.shop_id = s.id AND l.created_at > NOW() - INTERVAL '24 hours'
  ) as refresh_attempts_24h,
  (
    SELECT l.success 
    FROM public.apishopee_token_refresh_logs l 
    WHERE l.shop_id = s.id 
    ORDER BY l.created_at DESC 
    LIMIT 1
  ) as last_refresh_success
FROM public.apishopee_shops s
WHERE s.refresh_token IS NOT NULL;

GRANT SELECT ON public.token_refresh_status TO authenticated;

COMMENT ON VIEW public.token_refresh_status IS 'View để monitor trạng thái token của các shops';

-- ============================================
-- PART 6: Documentation
-- ============================================

COMMENT ON FUNCTION public.get_shops_needing_token_refresh IS 
'Lấy danh sách shops cần refresh token (sắp hết hạn trong X giờ tới)';

COMMENT ON FUNCTION public.trigger_token_refresh IS 
'Trigger refresh token - trả về danh sách shops cần refresh. 
Actual refresh được thực hiện bởi Edge Function shopee-token-refresh';

/*
HƯỚNG DẪN SỬ DỤNG:

1. Deploy Edge Function:
   supabase functions deploy shopee-token-refresh

2. Setup External Cron (chọn 1 trong các cách sau):

   A. GitHub Actions (khuyến nghị):
      - Tạo workflow chạy mỗi giờ
      - Gọi: POST https://<project>.supabase.co/functions/v1/shopee-token-refresh
      - Header: Authorization: Bearer <service_role_key>

   B. Vercel Cron:
      - Tạo API route gọi Edge Function
      - Config cron trong vercel.json

   C. Supabase pg_cron + pg_net:
      - Enable pg_net extension
      - Tạo function gọi HTTP đến Edge Function

3. Monitor:
   SELECT * FROM token_refresh_status;
   SELECT * FROM apishopee_token_refresh_logs ORDER BY created_at DESC LIMIT 20;

4. Manual refresh specific shop:
   POST https://<project>.supabase.co/functions/v1/shopee-token-refresh
   Body: { "shop_id": 123456789 }
*/

-- Migration: Keyword Tracking System
-- Tạo các bảng để theo dõi từ khóa và lịch sử volume

-- 1. Bảng cache sản phẩm (để không phải load từ API mỗi lần)
CREATE TABLE IF NOT EXISTS public.apishopee_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL,
  item_name TEXT,
  item_sku TEXT,
  item_status TEXT, -- NORMAL, BANNED, DELETED, etc.
  category_id BIGINT,
  price NUMERIC,
  stock INTEGER DEFAULT 0,
  sold INTEGER DEFAULT 0,
  rating NUMERIC,
  image_url TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  attributes JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop_id, item_id)
);

-- 2. Bảng theo dõi từ khóa
CREATE TABLE IF NOT EXISTS public.apishopee_keyword_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  item_id BIGINT, -- Sản phẩm liên quan (optional)
  item_name TEXT,
  quality_score NUMERIC, -- Điểm chất lượng từ Shopee (0-10)
  suggested_bid NUMERIC, -- Giá bid đề xuất
  latest_volume INTEGER, -- Volume mới nhất
  latest_volume_date DATE, -- Ngày cập nhật volume
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop_id, keyword, item_id)
);

-- 3. Bảng lịch sử volume từ khóa theo ngày
CREATE TABLE IF NOT EXISTS public.apishopee_keyword_volume_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id UUID NOT NULL REFERENCES public.apishopee_keyword_tracking(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  volume_date DATE NOT NULL,
  search_volume INTEGER NOT NULL DEFAULT 0,
  quality_score NUMERIC,
  suggested_bid NUMERIC,
  competition_level TEXT, -- low, medium, high
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tracking_id, volume_date)
);

-- 4. Indexes cho performance
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON public.apishopee_products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_item_id ON public.apishopee_products(item_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.apishopee_products(item_status);

CREATE INDEX IF NOT EXISTS idx_keyword_tracking_shop_id ON public.apishopee_keyword_tracking(shop_id);
CREATE INDEX IF NOT EXISTS idx_keyword_tracking_keyword ON public.apishopee_keyword_tracking(keyword);
CREATE INDEX IF NOT EXISTS idx_keyword_tracking_active ON public.apishopee_keyword_tracking(is_active);

CREATE INDEX IF NOT EXISTS idx_keyword_volume_tracking_id ON public.apishopee_keyword_volume_history(tracking_id);
CREATE INDEX IF NOT EXISTS idx_keyword_volume_date ON public.apishopee_keyword_volume_history(volume_date);
CREATE INDEX IF NOT EXISTS idx_keyword_volume_shop_keyword ON public.apishopee_keyword_volume_history(shop_id, keyword);

-- 5. RLS Policies
ALTER TABLE public.apishopee_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_keyword_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_keyword_volume_history ENABLE ROW LEVEL SECURITY;

-- Products policies
CREATE POLICY "products_select_policy" ON public.apishopee_products
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_products.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "products_insert_policy" ON public.apishopee_products
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_products.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "products_update_policy" ON public.apishopee_products
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_products.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "products_delete_policy" ON public.apishopee_products
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_products.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- Keyword tracking policies
CREATE POLICY "keyword_tracking_select_policy" ON public.apishopee_keyword_tracking
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_keyword_tracking.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "keyword_tracking_insert_policy" ON public.apishopee_keyword_tracking
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_keyword_tracking.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "keyword_tracking_update_policy" ON public.apishopee_keyword_tracking
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_keyword_tracking.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "keyword_tracking_delete_policy" ON public.apishopee_keyword_tracking
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_keyword_tracking.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- Volume history policies
CREATE POLICY "keyword_volume_select_policy" ON public.apishopee_keyword_volume_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_keyword_volume_history.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

CREATE POLICY "keyword_volume_insert_policy" ON public.apishopee_keyword_volume_history
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_keyword_volume_history.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- 6. Service role bypass policies (cho Edge Functions)
CREATE POLICY "products_service_role" ON public.apishopee_products
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "keyword_tracking_service_role" ON public.apishopee_keyword_tracking
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "keyword_volume_service_role" ON public.apishopee_keyword_volume_history
  FOR ALL USING (auth.role() = 'service_role');

-- 7. Trigger để tự động cập nhật updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.apishopee_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_keyword_tracking_updated_at
  BEFORE UPDATE ON public.apishopee_keyword_tracking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Comments
COMMENT ON TABLE public.apishopee_products IS 'Cache sản phẩm từ Shopee API';
COMMENT ON TABLE public.apishopee_keyword_tracking IS 'Từ khóa đang theo dõi';
COMMENT ON TABLE public.apishopee_keyword_volume_history IS 'Lịch sử volume từ khóa theo ngày';

COMMENT ON COLUMN public.apishopee_keyword_tracking.quality_score IS 'Điểm chất lượng từ Shopee (0-10)';
COMMENT ON COLUMN public.apishopee_keyword_tracking.suggested_bid IS 'Giá bid đề xuất (VNĐ)';
COMMENT ON COLUMN public.apishopee_keyword_tracking.latest_volume IS 'Lượt tìm kiếm mới nhất';

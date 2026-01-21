-- Migration: Create orders tables for Shopee orders sync
-- Logic:
-- A. Initial Load (lần đầu): Lấy đơn hàng 30 ngày gần nhất
-- B. Periodic Sync (20 phút): Kiểm tra đơn hàng mới hoặc cập nhật

-- =====================================================
-- 1. Bảng lưu đơn hàng từ Shopee
-- =====================================================
CREATE TABLE IF NOT EXISTS apishopee_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Shop info
  shop_id BIGINT NOT NULL,

  -- Order identifiers
  order_sn TEXT NOT NULL,
  booking_sn TEXT,

  -- Order status
  order_status TEXT NOT NULL,
  pending_terms TEXT[] DEFAULT '{}',
  pending_description TEXT[] DEFAULT '{}',

  -- Financial info
  currency TEXT,
  cod BOOLEAN DEFAULT false,
  total_amount DECIMAL(15,2),
  estimated_shipping_fee DECIMAL(15,2),
  actual_shipping_fee DECIMAL(15,2),
  actual_shipping_fee_confirmed BOOLEAN DEFAULT false,
  reverse_shipping_fee DECIMAL(15,2),
  order_chargeable_weight_gram INT,

  -- Timestamps (Unix timestamp)
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL,
  pay_time BIGINT,
  ship_by_date BIGINT,
  pickup_done_time BIGINT,

  -- Buyer info
  buyer_user_id BIGINT,
  buyer_username TEXT,
  buyer_cpf_id TEXT,
  region TEXT,

  -- Recipient address (JSONB for flexibility)
  recipient_address JSONB,

  -- Shipping info
  shipping_carrier TEXT,
  checkout_shipping_carrier TEXT,
  days_to_ship INT,
  fulfillment_flag TEXT,
  goods_to_declare BOOLEAN DEFAULT false,
  split_up BOOLEAN DEFAULT false,

  -- Payment info
  payment_method TEXT,
  payment_info JSONB DEFAULT '[]'::jsonb,

  -- Items and Packages (JSONB - denormalized for performance)
  item_list JSONB DEFAULT '[]'::jsonb,
  package_list JSONB DEFAULT '[]'::jsonb,

  -- Cancellation info
  cancel_by TEXT,
  cancel_reason TEXT,
  buyer_cancel_reason TEXT,

  -- Other info
  message_to_seller TEXT,
  note TEXT,
  note_update_time BIGINT,
  invoice_data JSONB,
  dropshipper TEXT,
  dropshipper_phone TEXT,
  return_request_due_date BIGINT,
  edt_from BIGINT,
  edt_to BIGINT,
  advance_package BOOLEAN DEFAULT false,
  is_buyer_shop_collection BOOLEAN DEFAULT false,
  buyer_proof_of_collection TEXT[] DEFAULT '{}',
  hot_listing_order BOOLEAN DEFAULT false,

  -- Prescription info (for specific markets)
  prescription_images TEXT[] DEFAULT '{}',
  prescription_check_status INT,
  pharmacist_name TEXT,
  prescription_approval_time BIGINT,
  prescription_rejection_time BIGINT,

  -- Raw response for debugging
  raw_response JSONB,

  -- Metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: mỗi shop chỉ có 1 record cho mỗi order_sn
  UNIQUE(shop_id, order_sn)
);

-- Indexes for query performance
CREATE INDEX idx_orders_shop_id ON apishopee_orders(shop_id);
CREATE INDEX idx_orders_create_time ON apishopee_orders(create_time DESC);
CREATE INDEX idx_orders_update_time ON apishopee_orders(update_time DESC);
CREATE INDEX idx_orders_status ON apishopee_orders(order_status);
CREATE INDEX idx_orders_shop_status ON apishopee_orders(shop_id, order_status);
CREATE INDEX idx_orders_shop_create_time ON apishopee_orders(shop_id, create_time DESC);

-- =====================================================
-- 2. Bảng theo dõi trạng thái sync orders
-- =====================================================
CREATE TABLE IF NOT EXISTS apishopee_orders_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  shop_id BIGINT NOT NULL UNIQUE,

  -- Sync status
  is_syncing BOOLEAN DEFAULT false,
  is_initial_sync_done BOOLEAN DEFAULT false,

  -- Timestamps
  last_sync_at TIMESTAMPTZ,
  last_sync_update_time BIGINT, -- update_time của order mới nhất khi sync

  -- Progress tracking
  total_synced INT DEFAULT 0,
  new_orders INT DEFAULT 0,
  updated_orders INT DEFAULT 0,

  -- Error tracking
  last_error TEXT,
  error_count INT DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_sync_shop ON apishopee_orders_sync_status(shop_id);

-- =====================================================
-- 3. Enable RLS
-- =====================================================
ALTER TABLE apishopee_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_orders_sync_status ENABLE ROW LEVEL SECURITY;

-- Policy: User có thể xem orders của shop mà họ là member
CREATE POLICY "Users can view orders of their shops" ON apishopee_orders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_orders.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- Policy: Service role có full access (cho edge functions)
CREATE POLICY "Service role has full access to orders" ON apishopee_orders
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to orders sync status" ON apishopee_orders_sync_status
  FOR ALL
  USING (auth.role() = 'service_role');

-- Policy: Users can view sync status of their shops
CREATE POLICY "Users can view orders sync status of their shops" ON apishopee_orders_sync_status
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_orders_sync_status.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- =====================================================
-- 4. Trigger update updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_orders_updated_at
  BEFORE UPDATE ON apishopee_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();

CREATE TRIGGER trigger_orders_sync_updated_at
  BEFORE UPDATE ON apishopee_orders_sync_status
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();

-- =====================================================
-- 5. Enable Realtime for orders table
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE apishopee_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE apishopee_orders_sync_status;

-- =====================================================
-- 6. Comments
-- =====================================================
COMMENT ON TABLE apishopee_orders IS 'Lưu trữ đơn hàng từ Shopee API';
COMMENT ON TABLE apishopee_orders_sync_status IS 'Theo dõi trạng thái sync orders cho mỗi shop';
COMMENT ON COLUMN apishopee_orders_sync_status.is_initial_sync_done IS 'True nếu đã hoàn thành initial load đơn hàng 30 ngày';
COMMENT ON COLUMN apishopee_orders_sync_status.last_sync_update_time IS 'update_time của order mới nhất, dùng để phát hiện thay đổi';

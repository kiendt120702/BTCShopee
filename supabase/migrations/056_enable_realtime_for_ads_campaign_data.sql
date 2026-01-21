-- Migration: Enable Realtime for apishopee_ads_campaign_data
-- Description: Cho phép UI tự động cập nhật khi campaign data thay đổi
-- Date: 2026-01-20

-- Enable REPLICA IDENTITY FULL để Realtime có thể broadcast full row data
ALTER TABLE apishopee_ads_campaign_data REPLICA IDENTITY FULL;

-- Comment
COMMENT ON TABLE apishopee_ads_campaign_data IS 'Cache thông tin Campaigns - Realtime enabled để UI auto-update';

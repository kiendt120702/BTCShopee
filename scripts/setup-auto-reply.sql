-- =====================================================
-- Script: Setup Auto-Reply System
-- Mục đích: Setup initial data và test auto-reply system
-- =====================================================

-- =====================================================
-- 1. Example: Insert default auto-reply config cho 1 shop
-- =====================================================
-- Thay 123456 bằng shop_id thực tế của bạn

INSERT INTO apishopee_auto_reply_config (
  shop_id,
  enabled,
  reply_templates,
  auto_reply_schedule,
  reply_delay_minutes,
  only_reply_unreplied,
  min_rating_to_reply
)
VALUES (
  123456, -- Thay bằng shop_id của bạn
  true,
  '{
    "5": [
      "Cảm ơn bạn đã tin tưởng và ủng hộ shop! Chúc bạn luôn vui vẻ và hạnh phúc! ❤️",
      "Rất vui khi sản phẩm làm bạn hài lòng! Mong được phục vụ bạn lần sau! 🌟",
      "Cảm ơn đánh giá 5 sao của bạn! Shop sẽ luôn nỗ lực để mang đến sản phẩm tốt nhất!"
    ],
    "4": [
      "Cảm ơn bạn đã đánh giá! Shop sẽ cố gắng cải thiện để phục vụ bạn tốt hơn nữa.",
      "Rất vui khi được phục vụ bạn! Mong nhận được nhiều góp ý từ bạn.",
      "Cảm ơn phản hồi của bạn! Shop sẽ nỗ lực hơn nữa để đạt 5 sao!"
    ],
    "3": [
      "Cảm ơn đánh giá của bạn. Shop sẽ cải thiện chất lượng để phục vụ bạn tốt hơn.",
      "Rất tiếc vì chưa làm bạn hài lòng hoàn toàn. Shop sẽ cố gắng cải thiện!",
      "Cảm ơn góp ý của bạn! Shop ghi nhận và sẽ nâng cao chất lượng dịch vụ."
    ],
    "2": [
      "Shop xin lỗi vì trải nghiệm chưa tốt. Vui lòng inbox để shop hỗ trợ bạn tốt hơn.",
      "Rất tiếc vì sản phẩm chưa đáp ứng được kỳ vọng của bạn. Shop sẽ cải thiện ngay.",
      "Shop xin lỗi và mong được cơ hội phục vụ bạn tốt hơn lần sau!"
    ],
    "1": [
      "Shop rất xin lỗi! Vui lòng inbox ngay để shop hỗ trợ và giải quyết vấn đề cho bạn.",
      "Shop xin lỗi vì trải nghiệm không tốt. Vui lòng liên hệ để shop hỗ trợ bồi thường.",
      "Rất xin lỗi bạn! Shop cam kết sẽ xử lý và đền bù thỏa đáng cho bạn."
    ]
  }'::jsonb,
  '*/30 * * * *',  -- Cron: mỗi 30 phút
  60,              -- Delay: 60 phút
  true,            -- Chỉ reply reviews chưa có reply
  null             -- Reply tất cả các mức sao
)
ON CONFLICT (shop_id)
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  reply_templates = EXCLUDED.reply_templates,
  auto_reply_schedule = EXCLUDED.auto_reply_schedule,
  reply_delay_minutes = EXCLUDED.reply_delay_minutes,
  only_reply_unreplied = EXCLUDED.only_reply_unreplied,
  min_rating_to_reply = EXCLUDED.min_rating_to_reply,
  updated_at = NOW();

-- =====================================================
-- 2. Test: Random chọn template
-- =====================================================
-- Test random template cho 5 sao (chạy nhiều lần để thấy random)
SELECT get_random_reply_template(123456, 5) as reply_5_star;
SELECT get_random_reply_template(123456, 4) as reply_4_star;
SELECT get_random_reply_template(123456, 3) as reply_3_star;
SELECT get_random_reply_template(123456, 2) as reply_2_star;
SELECT get_random_reply_template(123456, 1) as reply_1_star;

-- =====================================================
-- 3. Test: Lấy reviews cần auto-reply
-- =====================================================
-- Xem có bao nhiêu reviews cần auto-reply
SELECT * FROM get_reviews_need_auto_reply(123456, 100);

-- Count theo rating
SELECT
  rating_star,
  COUNT(*) as count
FROM get_reviews_need_auto_reply(123456, 1000)
GROUP BY rating_star
ORDER BY rating_star DESC;

-- =====================================================
-- 4. Check cấu hình hiện tại
-- =====================================================
SELECT
  shop_id,
  enabled,
  auto_reply_schedule,
  reply_delay_minutes,
  only_reply_unreplied,
  min_rating_to_reply,
  created_at,
  updated_at
FROM apishopee_auto_reply_config
ORDER BY shop_id;

-- Check templates
SELECT
  shop_id,
  enabled,
  jsonb_array_length(reply_templates->'5') as count_5_star,
  jsonb_array_length(reply_templates->'4') as count_4_star,
  jsonb_array_length(reply_templates->'3') as count_3_star,
  jsonb_array_length(reply_templates->'2') as count_2_star,
  jsonb_array_length(reply_templates->'1') as count_1_star
FROM apishopee_auto_reply_config;

-- =====================================================
-- 5. Monitor: Check logs
-- =====================================================
-- Logs gần nhất
SELECT
  shop_id,
  comment_id,
  rating_star,
  reply_text,
  template_index,
  status,
  error_message,
  replied_at
FROM apishopee_auto_reply_logs
ORDER BY replied_at DESC
LIMIT 50;

-- Thống kê theo status
SELECT
  status,
  COUNT(*) as count,
  COUNT(DISTINCT shop_id) as unique_shops
FROM apishopee_auto_reply_logs
GROUP BY status;

-- Thống kê theo rating star
SELECT
  rating_star,
  status,
  COUNT(*) as count
FROM apishopee_auto_reply_logs
GROUP BY rating_star, status
ORDER BY rating_star DESC, status;

-- =====================================================
-- 6. Monitor: Check job status
-- =====================================================
SELECT
  shop_id,
  is_running,
  last_run_at,
  next_run_at,
  total_replied,
  last_batch_replied,
  last_batch_failed,
  last_batch_skipped,
  last_error,
  error_count,
  consecutive_errors
FROM apishopee_auto_reply_job_status
ORDER BY shop_id;

-- =====================================================
-- 7. Monitor: Check cron job
-- =====================================================
-- Xem cron job
SELECT * FROM cron.job WHERE jobname = 'auto-reply-reviews-job';

-- Lịch sử chạy gần nhất
SELECT
  jobid,
  runid,
  job_pid,
  status,
  return_message,
  start_time,
  end_time,
  (end_time - start_time) as duration
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auto-reply-reviews-job')
ORDER BY start_time DESC
LIMIT 20;

-- =====================================================
-- 8. Utilities: Reset/Clean data
-- =====================================================

-- Disable auto-reply cho 1 shop
-- UPDATE apishopee_auto_reply_config SET enabled = false WHERE shop_id = 123456;

-- Xóa logs cũ (> 30 ngày)
-- DELETE FROM apishopee_auto_reply_logs WHERE created_at < NOW() - INTERVAL '30 days';

-- Reset job status cho 1 shop
-- UPDATE apishopee_auto_reply_job_status
-- SET
--   is_running = false,
--   last_error = null,
--   error_count = 0,
--   consecutive_errors = 0
-- WHERE shop_id = 123456;

-- =====================================================
-- 9. Analytics: Performance metrics
-- =====================================================

-- Success rate trong 24h
SELECT
  COUNT(*) FILTER (WHERE status = 'success') as success_count,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
  COUNT(*) FILTER (WHERE status = 'skipped') as skipped_count,
  COUNT(*) as total,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'success')::numeric / NULLIF(COUNT(*), 0) * 100,
    2
  ) as success_rate
FROM apishopee_auto_reply_logs
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- Top shops có nhiều auto-reply nhất (7 ngày)
SELECT
  shop_id,
  COUNT(*) as total_replies,
  COUNT(*) FILTER (WHERE status = 'success') as success,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'success')::numeric / NULLIF(COUNT(*), 0) * 100,
    2
  ) as success_rate
FROM apishopee_auto_reply_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY shop_id
ORDER BY total_replies DESC
LIMIT 10;

-- Template usage distribution
SELECT
  shop_id,
  rating_star,
  template_index,
  COUNT(*) as usage_count
FROM apishopee_auto_reply_logs
WHERE status = 'success'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY shop_id, rating_star, template_index
ORDER BY shop_id, rating_star, template_index;

-- Hourly auto-reply trend (24h)
SELECT
  date_trunc('hour', replied_at) as hour,
  COUNT(*) as total_replies,
  COUNT(*) FILTER (WHERE status = 'success') as success
FROM apishopee_auto_reply_logs
WHERE replied_at >= NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- =====================================================
-- 10. Troubleshooting: Common issues
-- =====================================================

-- Shops có consecutive errors > 3
SELECT
  shop_id,
  last_error,
  consecutive_errors,
  error_count,
  last_run_at
FROM apishopee_auto_reply_job_status
WHERE consecutive_errors > 3
ORDER BY consecutive_errors DESC;

-- Reviews chưa được reply sau 2 giờ (có thể có vấn đề)
SELECT
  r.shop_id,
  r.comment_id,
  r.rating_star,
  r.comment,
  r.create_time,
  (EXTRACT(EPOCH FROM NOW()) - r.create_time) / 3600 as hours_ago
FROM apishopee_reviews r
WHERE r.reply_text IS NULL
  AND r.create_time <= EXTRACT(EPOCH FROM NOW() - INTERVAL '2 hours')
  AND EXISTS (
    SELECT 1 FROM apishopee_auto_reply_config c
    WHERE c.shop_id = r.shop_id
    AND c.enabled = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM apishopee_auto_reply_logs l
    WHERE l.shop_id = r.shop_id
    AND l.comment_id = r.comment_id
  )
ORDER BY r.create_time
LIMIT 20;

-- =====================================================
-- 11. Example: Update templates cho 1 shop
-- =====================================================
/*
-- Cập nhật templates mới
UPDATE apishopee_auto_reply_config
SET
  reply_templates = '{
    "5": [
      "Template mới 1 cho 5 sao",
      "Template mới 2 cho 5 sao",
      "Template mới 3 cho 5 sao"
    ],
    "4": [...],
    "3": [...],
    "2": [...],
    "1": [...]
  }'::jsonb,
  updated_at = NOW()
WHERE shop_id = 123456;
*/

-- =====================================================
-- 12. Example: Change schedule
-- =====================================================
/*
-- Đổi sang chạy mỗi 15 phút
UPDATE apishopee_auto_reply_config
SET
  auto_reply_schedule = '*/15 * * * *',
  updated_at = NOW()
WHERE shop_id = 123456;

-- Đổi sang chạy mỗi giờ
UPDATE apishopee_auto_reply_config
SET
  auto_reply_schedule = '0 * * * *',
  updated_at = NOW()
WHERE shop_id = 123456;

-- Chạy vào 9h, 12h, 15h, 18h mỗi ngày
UPDATE apishopee_auto_reply_config
SET
  auto_reply_schedule = '0 9,12,15,18 * * *',
  updated_at = NOW()
WHERE shop_id = 123456;
*/

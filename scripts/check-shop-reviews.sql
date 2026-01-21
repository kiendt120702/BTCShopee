-- Kiểm tra đánh giá của shop Hibena (ID: 144364758)

-- 1. Tổng số đánh giá
SELECT COUNT(*) as total_reviews
FROM apishopee_reviews
WHERE shop_id = 144364758;

-- 2. Thống kê theo rating
SELECT
  rating_star,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM apishopee_reviews
WHERE shop_id = 144364758
GROUP BY rating_star
ORDER BY rating_star DESC;

-- 3. Số đánh giá đã/chưa trả lời
SELECT
  CASE
    WHEN reply_text IS NOT NULL THEN 'Đã trả lời'
    ELSE 'Chưa trả lời'
  END as reply_status,
  COUNT(*) as count
FROM apishopee_reviews
WHERE shop_id = 144364758
GROUP BY reply_status;

-- 4. Sync status
SELECT
  is_syncing,
  is_initial_sync_done,
  last_sync_at,
  total_synced,
  last_error
FROM apishopee_reviews_sync_status
WHERE shop_id = 144364758;

-- 5. Top 5 đánh giá gần nhất
SELECT
  comment_id,
  rating_star,
  comment,
  buyer_username,
  create_time,
  reply_text,
  synced_at
FROM apishopee_reviews
WHERE shop_id = 144364758
ORDER BY create_time DESC
LIMIT 5;

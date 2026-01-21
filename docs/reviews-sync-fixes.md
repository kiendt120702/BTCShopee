# Reviews Sync Function - Fixes & Improvements

## Vấn đề gặp phải

Function đồng bộ đánh giá (`apishopee-reviews-sync`) đang gặp lỗi 2xx khi:
1. Đồng bộ thủ công từ UI
2. Tự động đồng bộ qua cron job (30 phút/lần)

## Nguyên nhân

### 1. Thiếu kiểm tra response từ Shopee API
- Không kiểm tra `null/undefined` khi gọi API
- Không xử lý khi API trả về structure không đúng
- Thiếu fallback khi có lỗi

### 2. Infinite loop risk
- Không có limit số page khi fetch comments
- Có thể bị stuck nếu API không trả về `more: false`

### 3. Cron job configuration issues
- Hardcoded Supabase URL
- Thiếu Authorization header
- Timeout quá ngắn (2 phút) cho initial sync
- Không check trạng thái `is_syncing` → có thể duplicate sync

### 4. Race condition
- Frontend và cron job có thể gọi sync cùng lúc
- Không có proper locking mechanism

## Các fix đã implement

### 1. Edge Function Improvements

#### File: `supabase/functions/apishopee-reviews-sync/index.ts`

**a) Thêm validation cho API response:**
```typescript
// Kiểm tra kết quả trả về
if (!result) {
  console.error('[REVIEWS-SYNC] API returned null/undefined');
  throw new Error('API returned invalid response');
}

// Kiểm tra cấu trúc response
if (!result.response) {
  console.warn('[REVIEWS-SYNC] API returned no response object');
  return { comments: [], nextCursor: '', more: false };
}
```

**b) Thêm safety limits để tránh infinite loop:**
```typescript
const MAX_PAGES = 100; // Safety limit cho replied comments
const MAX_PAGES = 200; // Safety limit cho all comments
```

**c) Better error handling trong fetchAllRepliedComments:**
```typescript
try {
  // Fetch logic
} catch (error) {
  console.error('[REVIEWS-SYNC] Error fetching replied comments:', error);
  // Return partial data instead of failing completely
  return repliedMap;
}
```

### 2. Cron Job Improvements

#### File: `supabase/migrations/052_fix_reviews_sync_cron_job.sql`

**a) Dynamic URL configuration:**
```sql
-- Lấy URL từ settings thay vì hardcode
function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/apishopee-reviews-sync';
```

**b) Thêm Authorization header:**
```sql
headers := jsonb_build_object(
  'Content-Type', 'application/json',
  'Authorization', 'Bearer ' || COALESCE(anon_key, '')
)
```

**c) Tăng timeout lên 5 phút:**
```sql
timeout_milliseconds := 300000  -- 5 phút
```

**d) Check trạng thái sync trước khi gọi:**
```sql
WHERE s.access_token IS NOT NULL
  AND s.status = 'active'
  AND (rs.is_syncing IS NULL OR rs.is_syncing = false)
```

**e) Better error handling:**
```sql
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to sync reviews for shop %: %', shop_record.shop_id, SQLERRM;
  -- Continue với shop tiếp theo thay vì fail toàn bộ
END;
```

## Testing

### 1. Test script
Sử dụng script test để kiểm tra:
```bash
npx tsx scripts/test-reviews-sync.ts <shop_id>
```

Script sẽ:
- ✅ Lấy sync status
- ✅ Lấy stats hiện tại
- ✅ Test call API Shopee (get comments)
- ⚠️ Trigger sync (commented out - uncomment khi cần test)

### 2. Manual testing từ UI
1. Vào trang Reviews
2. Click "Đồng bộ Shopee"
3. Kiểm tra:
   - Loading state hiển thị đúng
   - Progress được update realtime
   - Không có lỗi 2xx
   - Data được sync đầy đủ

### 3. Kiểm tra cron job
```sql
-- Xem danh sách cron jobs
SELECT * FROM cron.job WHERE jobname = 'reviews-sync-job';

-- Xem logs của cron job (nếu có extension pg_cron)
SELECT * FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'reviews-sync-job')
ORDER BY start_time DESC
LIMIT 10;

-- Test manual trigger cron job
SELECT sync_all_shops_reviews();
```

## Deployment Checklist

- [x] Update Edge Function code
- [x] Deploy Edge Function: `npx supabase functions deploy apishopee-reviews-sync --no-verify-jwt`
- [x] Create migration file: `052_fix_reviews_sync_cron_job.sql`
- [x] Apply migration: `npx supabase db push`
- [x] Create test script: `scripts/test-reviews-sync.ts`
- [ ] Test thủ công từ UI
- [ ] Kiểm tra logs sau khi cron job chạy
- [ ] Monitor trong 24h để đảm bảo stable

## Configuration cần thiết

### Environment Variables (nếu sử dụng dynamic URL)
Để cron job hoạt động với dynamic URL, cần set:

```sql
-- Set trong PostgreSQL
ALTER DATABASE postgres SET app.settings.supabase_url = 'https://ohlwhhxhgpotlwfgqhhu.supabase.co';
ALTER DATABASE postgres SET app.settings.supabase_anon_key = 'your-anon-key';
```

Hoặc fallback về hardcoded URL nếu không set.

## Monitoring

### Metrics cần theo dõi:
1. **Error rate**: Số lượng lỗi 2xx/4xx/5xx
2. **Sync success rate**: % shops sync thành công
3. **Sync duration**: Thời gian trung bình mỗi sync
4. **Reviews synced**: Số lượng reviews được sync mỗi lần

### Logs cần xem:
```sql
-- Sync status của các shops
SELECT
  shop_id,
  is_syncing,
  is_initial_sync_done,
  last_sync_at,
  total_synced,
  last_error
FROM apishopee_reviews_sync_status
ORDER BY last_sync_at DESC;

-- Reviews stats
SELECT
  shop_id,
  COUNT(*) as total_reviews,
  AVG(rating_star) as avg_rating,
  COUNT(CASE WHEN reply_text IS NOT NULL THEN 1 END) as replied_count
FROM apishopee_reviews
GROUP BY shop_id;
```

## Rollback Plan

Nếu gặp vấn đề sau khi deploy:

1. **Rollback Edge Function:**
   ```bash
   git checkout HEAD~1 supabase/functions/apishopee-reviews-sync/index.ts
   npx supabase functions deploy apishopee-reviews-sync --no-verify-jwt
   ```

2. **Rollback Migration:**
   ```sql
   -- Revert về version cũ của function
   -- Copy code từ migration 047
   ```

3. **Tắm tạm thời cron job:**
   ```sql
   SELECT cron.unschedule('reviews-sync-job');
   ```

## Next Steps

1. ✅ Monitor logs trong 24h đầu
2. ⚠️ Thêm retry logic cho failed syncs
3. ⚠️ Implement exponential backoff cho rate limiting
4. ⚠️ Thêm alerting khi sync fail liên tục
5. ⚠️ Dashboard để xem sync health của tất cả shops

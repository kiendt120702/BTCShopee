# Hệ Thống Tự Động Trả Lời Đánh Giá Shopee

## Tổng Quan

Hệ thống tự động trả lời đánh giá sản phẩm từ Shopee với các tính năng:

✅ **Cấu hình linh hoạt**: 3 câu trả lời mặc định cho mỗi mức sao (1-5 sao)
✅ **Random thông minh**: Tự động random chọn 1 trong 3 câu để tránh spam
✅ **Schedule tùy chỉnh**: Cho phép set thời gian tự động reply
✅ **Delay time**: Chờ X phút sau khi có review mới thì mới reply
✅ **Filter thông minh**: Chỉ reply reviews chưa có reply, hoặc rating >= X sao
✅ **Batch processing**: Xử lý tối đa 100 reviews/lần (theo limit Shopee API)
✅ **Logging đầy đủ**: Track tất cả lịch sử auto-reply

---

## Kiến Trúc Hệ Thống

### Database Schema

#### 1. `apishopee_auto_reply_config`
Bảng cấu hình auto-reply cho mỗi shop:

```sql
- shop_id: ID của shop
- enabled: Bật/tắt auto-reply
- reply_templates: JSON chứa 3 câu trả lời cho mỗi mức sao
  {
    "5": ["Câu 1", "Câu 2", "Câu 3"],
    "4": ["Câu 1", "Câu 2", "Câu 3"],
    "3": ["Câu 1", "Câu 2", "Câu 3"],
    "2": ["Câu 1", "Câu 2", "Câu 3"],
    "1": ["Câu 1", "Câu 2", "Câu 3"]
  }
- auto_reply_schedule: Cron expression (vd: "*/30 * * * *" = mỗi 30 phút)
- reply_delay_minutes: Chờ X phút sau khi có review mới (default: 60)
- only_reply_unreplied: Chỉ reply reviews chưa có reply (default: true)
- min_rating_to_reply: Chỉ reply rating >= X sao (null = reply tất cả)
```

#### 2. `apishopee_auto_reply_logs`
Lịch sử auto-reply:

```sql
- shop_id, comment_id, rating_star
- reply_text: Câu trả lời đã gửi
- template_index: Index của template (0, 1, hoặc 2)
- status: pending | success | failed | skipped
- error_message: Lỗi nếu có
- api_response: Response từ Shopee API
```

#### 3. `apishopee_auto_reply_job_status`
Trạng thái job auto-reply:

```sql
- shop_id
- is_running: Job đang chạy hay không
- last_run_at, next_run_at
- total_replied: Tổng số đã reply
- last_batch_replied/failed/skipped: Số lượng batch cuối
- last_error: Lỗi cuối cùng
```

### Edge Functions

#### `apishopee-auto-reply`
Edge function xử lý auto-reply với các actions:

- **`process`**: Xử lý auto-reply cho 1 shop
- **`get-config`**: Lấy config auto-reply
- **`get-logs`**: Lấy lịch sử auto-reply
- **`get-status`**: Lấy trạng thái job

### Cron Job

Cron job chạy mỗi 30 phút (có thể config):
```sql
SELECT cron.schedule(
  'auto-reply-reviews-job',
  '*/30 * * * *',
  $$ SELECT process_all_auto_reply_jobs(); $$
);
```

---

## Deployment

### Bước 1: Apply Migrations

```bash
# Apply migration tạo tables và functions
npx supabase db push

# Hoặc apply từng migration
npx supabase migration up
```

### Bước 2: Deploy Edge Function

```bash
# Deploy edge function
npx supabase functions deploy apishopee-auto-reply --no-verify-jwt
```

### Bước 3: Enable pg_net Extension (nếu chưa có)

```sql
CREATE EXTENSION IF NOT EXISTS pg_net;
```

### Bước 4: Set Database Config (cho pg_net)

**Option 1: Sử dụng Supabase Dashboard**
- Vào Settings > Database > Custom Postgres Config
- Thêm:
  ```
  app.settings.supabase_url = https://your-project.supabase.co
  app.settings.supabase_service_key = your-service-role-key
  ```

**Option 2: Chạy SQL trực tiếp**
```sql
ALTER DATABASE postgres
SET app.settings.supabase_url = 'https://your-project.supabase.co';

ALTER DATABASE postgres
SET app.settings.supabase_service_key = 'your-service-role-key';
```

⚠️ **Lưu ý**: Service key rất quan trọng, cần bảo mật tốt!

### Bước 5: Verify Cron Job

```sql
-- Kiểm tra cron job đã được tạo chưa
SELECT * FROM cron.job WHERE jobname = 'auto-reply-reviews-job';

-- Xem lịch sử chạy
SELECT * FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auto-reply-reviews-job')
ORDER BY start_time DESC
LIMIT 10;
```

---

## Cách Sử Dụng

### 1. Cấu Hình Auto-Reply cho Shop

```typescript
// Insert/Update config
const { data, error } = await supabase
  .from('apishopee_auto_reply_config')
  .upsert({
    shop_id: 123456,
    enabled: true,
    reply_templates: {
      "5": [
        "Cảm ơn bạn đã tin tưởng và ủng hộ shop! ❤️",
        "Rất vui khi bạn hài lòng với sản phẩm! 🌟",
        "Cảm ơn đánh giá 5 sao của bạn! Chúc bạn mua sắm vui vẻ!"
      ],
      "4": [
        "Cảm ơn bạn đã đánh giá! Shop sẽ cố gắng cải thiện hơn nữa.",
        "Rất vui khi được phục vụ bạn! Mong được đồng hành cùng bạn.",
        "Cảm ơn phản hồi của bạn! Shop sẽ nỗ lực hơn nữa!"
      ],
      "3": [
        "Cảm ơn đánh giá của bạn. Shop sẽ cải thiện để phục vụ bạn tốt hơn.",
        "Rất tiếc vì chưa làm bạn hài lòng hoàn toàn. Shop sẽ cố gắng!",
        "Cảm ơn góp ý! Shop ghi nhận và sẽ cải thiện."
      ],
      "2": [
        "Shop xin lỗi vì trải nghiệm chưa tốt. Vui lòng inbox để shop hỗ trợ bạn.",
        "Rất tiếc vì sản phẩm chưa đáp ứng kỳ vọng. Shop sẽ cải thiện.",
        "Shop xin lỗi và mong được cơ hội phục vụ bạn tốt hơn!"
      ],
      "1": [
        "Shop rất xin lỗi! Vui lòng inbox để shop hỗ trợ và giải quyết vấn đề.",
        "Shop xin lỗi vì trải nghiệm không tốt. Vui lòng liên hệ để shop hỗ trợ.",
        "Rất xin lỗi bạn! Shop cam kết sẽ xử lý và đền bù thỏa đáng."
      ]
    },
    auto_reply_schedule: '*/30 * * * *',  // Mỗi 30 phút
    reply_delay_minutes: 60,               // Chờ 1 giờ
    only_reply_unreplied: true,
    min_rating_to_reply: null             // Reply tất cả
  }, { onConflict: 'shop_id' });
```

### 2. Trigger Auto-Reply Manually (Test)

```typescript
// Gọi edge function để test
const { data, error } = await supabase.functions.invoke('apishopee-auto-reply', {
  body: {
    action: 'process',
    shop_id: 123456
  }
});

console.log(data);
// {
//   success: true,
//   replied: 5,
//   failed: 0,
//   skipped: 2
// }
```

### 3. Xem Logs

```typescript
// Lấy logs
const { data: logs } = await supabase
  .from('apishopee_auto_reply_logs')
  .select('*')
  .eq('shop_id', 123456)
  .order('created_at', { ascending: false })
  .limit(50);

console.log(logs);
```

### 4. Xem Trạng Thái Job

```typescript
const { data: status } = await supabase
  .from('apishopee_auto_reply_job_status')
  .select('*')
  .eq('shop_id', 123456)
  .single();

console.log(status);
// {
//   is_running: false,
//   last_run_at: "2025-01-20T10:30:00Z",
//   total_replied: 150,
//   last_batch_replied: 5,
//   ...
// }
```

---

## Testing

### Test 1: Kiểm tra function get_random_reply_template

```sql
-- Insert config test
INSERT INTO apishopee_auto_reply_config (shop_id, enabled, reply_templates)
VALUES (
  999999,
  true,
  '{
    "5": ["Câu 1 cho 5 sao", "Câu 2 cho 5 sao", "Câu 3 cho 5 sao"],
    "4": ["Câu 1 cho 4 sao", "Câu 2 cho 4 sao", "Câu 3 cho 4 sao"]
  }'::jsonb
);

-- Test random template cho 5 sao (chạy nhiều lần để thấy random)
SELECT get_random_reply_template(999999, 5);
SELECT get_random_reply_template(999999, 5);
SELECT get_random_reply_template(999999, 5);
```

### Test 2: Kiểm tra function get_reviews_need_auto_reply

```sql
-- Lấy reviews cần auto-reply
SELECT * FROM get_reviews_need_auto_reply(999999, 10);
```

### Test 3: Test Edge Function

```bash
# Test local với Supabase CLI
npx supabase functions serve apishopee-auto-reply

# Gọi API test
curl -X POST http://localhost:54321/functions/v1/apishopee-auto-reply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "action": "get-config",
    "shop_id": 999999
  }'
```

---

## Monitoring & Troubleshooting

### 1. Check Cron Job Execution

```sql
-- Xem lịch sử chạy cron job
SELECT
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auto-reply-reviews-job')
ORDER BY start_time DESC
LIMIT 20;
```

### 2. Check Error Logs

```sql
-- Shops có nhiều lỗi
SELECT
  shop_id,
  last_error,
  error_count,
  consecutive_errors,
  last_run_at
FROM apishopee_auto_reply_job_status
WHERE error_count > 0
ORDER BY consecutive_errors DESC;
```

### 3. Statistics

```sql
-- Thống kê auto-reply
SELECT
  status,
  COUNT(*) as count,
  COUNT(DISTINCT shop_id) as shops
FROM apishopee_auto_reply_logs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Top shops có nhiều auto-reply nhất
SELECT
  shop_id,
  COUNT(*) as total_replies,
  COUNT(*) FILTER (WHERE status = 'success') as success,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM apishopee_auto_reply_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY shop_id
ORDER BY total_replies DESC
LIMIT 10;
```

---

## Best Practices

### 1. Cấu Hình Reply Templates

✅ **Nên**:
- Viết câu trả lời tự nhiên, chân thành
- Đa dạng hóa 3 câu để tránh lặp lại
- Phù hợp với từng mức sao (5 sao = cảm ơn, 1 sao = xin lỗi + hỗ trợ)
- Giữ độ dài vừa phải (50-200 ký tự)

❌ **Không nên**:
- Copy paste giống hệt nhau
- Quá dài dòng hoặc quá ngắn
- Sử dụng từ ngữ không phù hợp

### 2. Reply Delay Time

- **60 phút**: Cân bằng giữa nhanh chóng và tự nhiên (khuyến nghị)
- **30 phút**: Nhanh, nhưng có thể bị nghi ngờ tự động
- **120+ phút**: An toàn hơn, nhưng chậm

### 3. Monitoring

- Kiểm tra logs hàng ngày
- Theo dõi tỷ lệ success/failed
- Nếu consecutive_errors > 5: cần kiểm tra ngay

### 4. Security

- **KHÔNG** hardcode service key trong code
- Sử dụng RLS policies
- Chỉ owner/admin mới được config auto-reply

---

## FAQ

**Q: Có thể set schedule khác nhau cho mỗi shop không?**
A: Hiện tại cron job chạy chung cho tất cả shops mỗi 30 phút. Để tùy chỉnh riêng, cần modify function `process_all_auto_reply_jobs()` để check `auto_reply_schedule` của từng shop.

**Q: Làm sao để tạm dừng auto-reply cho 1 shop?**
A: Set `enabled = false` trong config của shop đó.

**Q: Hệ thống có reply lại review đã reply thủ công không?**
A: Không, nếu `only_reply_unreplied = true` (default). Nếu muốn reply lại, set = false.

**Q: Tối đa bao nhiêu reviews được reply mỗi lần?**
A: 100 reviews (limit của Shopee API). Nếu có nhiều hơn, sẽ được xử lý ở lần chạy tiếp theo.

**Q: Shopee API có giới hạn rate limit không?**
A: Có. Shopee thường limit ~5-10 requests/giây. Hệ thống đã tích hợp retry khi token hết hạn.

---

## Roadmap

- [ ] UI để cấu hình auto-reply trực quan
- [ ] Support schedule riêng cho từng shop
- [ ] Template với biến động (tên buyer, tên sản phẩm)
- [ ] A/B testing templates
- [ ] AI-powered reply suggestions
- [ ] Multi-language support
- [ ] Dashboard analytics

---

## Support

Nếu gặp vấn đề, vui lòng:
1. Check logs trong `apishopee_auto_reply_logs`
2. Check job status trong `apishopee_auto_reply_job_status`
3. Check cron job execution trong `cron.job_run_details`
4. Liên hệ team dev nếu cần hỗ trợ thêm

**Happy Auto-Replying! 🚀**

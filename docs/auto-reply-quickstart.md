# Auto-Reply System - Quick Start Guide

## 🚀 Deployment trong 5 phút

### Bước 1: Apply Migrations

```bash
npx supabase db push
```

Migrations sẽ tạo:
- ✅ 3 bảng: `apishopee_auto_reply_config`, `apishopee_auto_reply_logs`, `apishopee_auto_reply_job_status`
- ✅ 2 functions: `get_random_reply_template()`, `get_reviews_need_auto_reply()`
- ✅ RLS policies
- ✅ Cron job tự động chạy mỗi 30 phút

### Bước 2: Deploy Edge Function

```bash
npx supabase functions deploy apishopee-auto-reply --no-verify-jwt
```

### Bước 3: Setup Config (quan trọng!)

```sql
-- Enable pg_net extension
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Set database config (cần service role key)
ALTER DATABASE postgres
SET app.settings.supabase_url = 'https://your-project.supabase.co';

ALTER DATABASE postgres
SET app.settings.supabase_service_key = 'your-service-role-key';
```

### Bước 4: Cấu hình Auto-Reply cho Shop

Chạy SQL trong `scripts/setup-auto-reply.sql` hoặc:

```sql
INSERT INTO apishopee_auto_reply_config (shop_id, enabled, reply_templates)
VALUES (
  YOUR_SHOP_ID,
  true,
  '{
    "5": ["Cảm ơn bạn!", "Rất vui!", "Tuyệt vời!"],
    "4": ["Cảm ơn!", "Shop sẽ cải thiện!", "Rất vui!"],
    "3": ["Cảm ơn góp ý!", "Shop sẽ cải thiện!", "Xin lỗi!"],
    "2": ["Xin lỗi!", "Vui lòng inbox!", "Shop sẽ hỗ trợ!"],
    "1": ["Rất xin lỗi!", "Vui lòng inbox ngay!", "Shop sẽ đền bù!"]
  }'::jsonb
);
```

### Bước 5: Test

```bash
# Test edge function
curl -X POST https://your-project.supabase.co/functions/v1/apishopee-auto-reply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -d '{"action": "process", "shop_id": YOUR_SHOP_ID}'
```

---

## 📊 Monitoring

### Check Logs
```sql
SELECT * FROM apishopee_auto_reply_logs
ORDER BY created_at DESC LIMIT 50;
```

### Check Status
```sql
SELECT * FROM apishopee_auto_reply_job_status;
```

### Check Cron Job
```sql
SELECT * FROM cron.job WHERE jobname = 'auto-reply-reviews-job';

SELECT * FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auto-reply-reviews-job')
ORDER BY start_time DESC LIMIT 10;
```

---

## ⚙️ Configuration Options

### Cấu hình chính

```sql
-- Delay time: Chờ 60 phút sau khi có review mới
reply_delay_minutes: 60

-- Chỉ reply reviews chưa có reply
only_reply_unreplied: true

-- Chỉ reply rating >= 3 sao (null = reply tất cả)
min_rating_to_reply: 3

-- Cron schedule: mỗi 30 phút
auto_reply_schedule: '*/30 * * * *'
```

### Update config

```sql
UPDATE apishopee_auto_reply_config
SET
  reply_delay_minutes = 120,        -- Đổi thành 2 giờ
  min_rating_to_reply = 3,          -- Chỉ reply >= 3 sao
  auto_reply_schedule = '*/15 * * * *'  -- Chạy mỗi 15 phút
WHERE shop_id = YOUR_SHOP_ID;
```

---

## 🔧 Troubleshooting

### 1. Cron job không chạy?

```sql
-- Check job exists
SELECT * FROM cron.job WHERE jobname = 'auto-reply-reviews-job';

-- Check recent runs
SELECT * FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auto-reply-reviews-job')
ORDER BY start_time DESC;
```

### 2. Không có reviews được reply?

```sql
-- Check có reviews nào cần reply không
SELECT * FROM get_reviews_need_auto_reply(YOUR_SHOP_ID, 10);

-- Check config enabled
SELECT * FROM apishopee_auto_reply_config WHERE shop_id = YOUR_SHOP_ID;

-- Check job errors
SELECT * FROM apishopee_auto_reply_job_status WHERE shop_id = YOUR_SHOP_ID;
```

### 3. API errors?

```sql
-- Check error logs
SELECT * FROM apishopee_auto_reply_logs
WHERE status = 'failed'
ORDER BY created_at DESC;

-- Check consecutive errors
SELECT * FROM apishopee_auto_reply_job_status
WHERE consecutive_errors > 0;
```

---

## 📚 Tài liệu đầy đủ

Xem [docs/auto-reply-system.md](./auto-reply-system.md) để biết thêm chi tiết về:
- Kiến trúc hệ thống
- Best practices
- Advanced configuration
- Analytics queries
- FAQ

---

## 🎯 Các tính năng chính

✅ **Cấu hình linh hoạt**: 3 câu trả lời cho mỗi mức sao (1-5)
✅ **Random thông minh**: Tự động random chọn 1 trong 3 câu
✅ **Batch processing**: Xử lý tối đa 100 reviews/lần
✅ **Delay time**: Chờ X phút sau khi có review
✅ **Smart filtering**: Chỉ reply reviews chưa có reply, hoặc rating >= X sao
✅ **Cron scheduling**: Tự động chạy theo lịch
✅ **Full logging**: Track tất cả lịch sử auto-reply
✅ **Error handling**: Auto-retry khi token hết hạn

---

**Happy Auto-Replying! 🚀**

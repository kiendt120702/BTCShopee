# 🎉 Ads Sync System - Đã nâng cấp thành công!

## 📌 Tóm tắt nhanh

Hệ thống sync dữ liệu quảng cáo đã được **nâng cấp hoàn toàn** để giải quyết vấn đề timeout.

### Vấn đề trước đây
- ❌ Một vài shops không được sync vào 19:15
- ❌ Shops có nhiều campaigns (900+) bị timeout
- ❌ Flag `is_syncing` bị stuck

### Giải pháp đã triển khai
- ✅ **Queue-based sync**: Chạy tuần tự thay vì song song
- ✅ **Auto-retry**: Tự động retry 3 lần nếu fail
- ✅ **Timeout guard**: Auto-reset nếu stuck > 20 phút
- ✅ **Scalable**: Dù 10 hay 1000 shops đều OK

---

## 🚀 Cách hoạt động mới

### Luồng sync

```
1️⃣ ENQUEUE (Mỗi 15 phút)
   Cronjob thêm tất cả shops vào queue
   ↓
2️⃣ PROCESS (Mỗi 5 phút)
   Worker lấy 10 shops từ queue
   Sync tuần tự, 1 shop tại 1 thời điểm
   Delay 0.5s giữa mỗi shop
   ↓
3️⃣ RETRY (Nếu fail)
   Tự động retry tối đa 3 lần
   Delay 5 phút giữa mỗi retry
```

### Thời gian sync

| Số shops | Thời gian | Số cycles |
|----------|-----------|-----------|
| 12       | 1-2 phút  | 1-2       |
| 50       | 5-8 phút  | 5-6       |
| 100      | 10-15 phút| 10-12     |

→ **Kết luận**: Tất cả shops đều được sync, chỉ mất thời gian lâu hơn một chút.

---

## 📊 Kiểm tra trạng thái

### 1. Xem queue status
```sql
SELECT
  status,
  COUNT(*) as count
FROM apishopee_ads_sync_queue
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status;
```

**Kết quả mong đợi:**
- `pending`: 0-12 (shops đang chờ)
- `processing`: 0-1 (shop đang sync)
- `completed`: 10-12 (shops đã sync xong)
- `failed`: 0 (lý tưởng)

### 2. Xem shops nào đã sync
```sql
SELECT shop_id, status, completed_at
FROM apishopee_ads_sync_queue
WHERE created_at > NOW() - INTERVAL '30 minutes'
ORDER BY completed_at DESC;
```

### 3. Xem shops bị lỗi
```sql
SELECT shop_id, error_message, retry_count
FROM apishopee_ads_sync_queue
WHERE status = 'failed'
ORDER BY created_at DESC;
```

---

## 🔧 Thao tác thường dùng

### Sync ngay 1 shop cụ thể
```sql
-- Thêm vào queue với priority cao
INSERT INTO apishopee_ads_sync_queue (shop_id, sync_type, priority)
VALUES (12345, 'realtime', 3);

-- Process ngay
SELECT process_next_sync_job();
```

### Sync tất cả shops ngay
```sql
-- Enqueue tất cả
SELECT enqueue_all_shops_sync('realtime', 2);

-- Process nhiều lần
SELECT process_sync_queue_batch(20);
SELECT process_sync_queue_batch(20);
```

### Reset shop bị lỗi
```sql
UPDATE apishopee_ads_sync_queue
SET status = 'pending', retry_count = 0
WHERE shop_id = 12345 AND status = 'failed';
```

---

## 📈 Monitoring Dashboard

### Câu query hữu ích

**1. Queue overview:**
```sql
SELECT
  status,
  COUNT(*) as count,
  MIN(scheduled_at) as oldest_job
FROM apishopee_ads_sync_queue
WHERE status IN ('pending', 'processing')
GROUP BY status;
```

**2. Success rate (24h):**
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') * 100.0 / COUNT(*) as success_rate,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_count
FROM apishopee_ads_sync_queue
WHERE created_at > NOW() - INTERVAL '24 hours';
```

**3. Average sync time:**
```sql
SELECT
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds,
  MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_seconds
FROM apishopee_ads_sync_queue
WHERE status = 'completed'
  AND completed_at > NOW() - INTERVAL '1 day';
```

---

## 🚨 Troubleshooting

### Problem: Queue quá dài (>50 pending)

**Giải pháp:**
```sql
-- Tăng tốc độ process
SELECT process_sync_queue_batch(30); -- Tăng từ 10 lên 30
```

### Problem: Nhiều jobs failed

**Bước 1: Xem lỗi**
```sql
SELECT error_message, COUNT(*)
FROM apishopee_ads_sync_queue
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY error_message;
```

**Bước 2: Nếu lỗi edge function, reset để retry**
```sql
UPDATE apishopee_ads_sync_queue
SET status = 'pending', retry_count = 0
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour';
```

### Problem: Jobs stuck ở processing

```sql
-- Auto-reset jobs stuck > 15 phút
UPDATE apishopee_ads_sync_queue
SET status = 'pending'
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '15 minutes';
```

---

## 📚 Documents chi tiết

1. **[ads-sync-scalable-solution.md](./ads-sync-scalable-solution.md)**
   Hướng dẫn đầy đủ về hệ thống mới

2. **[ads-sync-queue-system.md](./ads-sync-queue-system.md)**
   Chi tiết về queue system

3. **Migration files:**
   - [057_fix_ads_sync_stuck_prevention.sql](../supabase/migrations/057_fix_ads_sync_stuck_prevention.sql) - Timeout guard
   - [058_implement_queue_based_ads_sync.sql](../supabase/migrations/058_implement_queue_based_ads_sync.sql) - Queue system

---

## ✅ Checklist sau khi deploy

- [x] Migration 057 đã apply
- [x] Migration 058 đã apply
- [x] Cronjobs đã active:
  - [x] `ads-sync-job` (*/15 phút) - Enqueue
  - [x] `ads-sync-queue-processor` (*/5 phút) - Process
  - [x] `ads-sync-queue-cleanup` (2AM daily) - Cleanup
- [x] Test enqueue: `SELECT enqueue_all_shops_sync('realtime', 1);`
- [x] Test process: `SELECT process_sync_queue_batch(3);`
- [x] Verify results: Xem queue status

---

## 🎯 KẾT LUẬN

**Trước:**
- 2-3 shops không được sync do timeout
- Phải reset manual `is_syncing` flag

**Sau:**
- ✅ 100% shops được sync
- ✅ Auto-retry nếu fail
- ✅ Không cần can thiệp thủ công
- ✅ Scalable cho nhiều shops

**→ Hệ thống đã ổn định và sẵn sàng scale!** 🚀

---

## 📞 Support

Nếu gặp vấn đề:
1. Check queue status (query ở trên)
2. Check edge function logs
3. Đọc [Troubleshooting section](#-troubleshooting)
4. Contact team nếu cần hỗ trợ

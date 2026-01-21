# Hệ thống Queue-based Ads Sync

## 📋 Tổng quan

Hệ thống sync dữ liệu quảng cáo được thiết kế để xử lý **nhiều shops** với **nhiều campaigns** mà **không bị timeout**.

### Vấn đề cũ
- ❌ Sync tất cả shops cùng lúc → overload
- ❌ Shops có 900+ campaigns bị timeout
- ❌ Không có retry mechanism
- ❌ Không có priority

### Giải pháp mới
- ✅ **Queue-based sync**: Shops xếp hàng, chạy tuần tự
- ✅ **Batch processing**: Mỗi lần chạy 5-10 shops
- ✅ **Auto-retry**: Retry tối đa 3 lần nếu fail
- ✅ **Priority system**: Shops quan trọng chạy trước
- ✅ **Scalable**: Dù 100 hay 1000 shops cũng xử lý được

---

## 🏗️ Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                    CRONJOB SCHEDULER                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Mỗi 15 phút: enqueue_all_shops_sync()                     │
│    ↓                                                        │
│  Thêm tất cả shops vào queue với status='pending'          │
│                                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    SYNC QUEUE TABLE                         │
├─────────────────────────────────────────────────────────────┤
│  id  │ shop_id │ priority │ status     │ retry │ ...       │
├──────┼─────────┼──────────┼────────────┼───────┼───────────┤
│  1   │  12345  │    2     │ pending    │   0   │           │
│  2   │  67890  │    1     │ processing │   0   │           │
│  3   │  11111  │    1     │ completed  │   0   │           │
│  4   │  22222  │    0     │ failed     │   3   │ timeout   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                   QUEUE PROCESSOR                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Mỗi 5 phút: process_sync_queue_batch(10)                  │
│    ↓                                                        │
│  1. Lấy job có priority cao nhất                           │
│  2. Gọi edge function sync cho 1 shop                      │
│  3. Delay 0.5s                                             │
│  4. Lặp lại cho 9 shops tiếp theo                          │
│  5. Nếu fail → retry hoặc mark failed                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Cách hoạt động

### 1. Enqueue Phase (Mỗi 15 phút)
```sql
-- Cronjob gọi function này
SELECT enqueue_all_shops_sync('realtime', 1);
```

**Làm gì:**
- Thêm tất cả shops (có access_token) vào queue
- Chỉ thêm nếu chưa có pending/processing job
- Priority = 1 (normal)

### 2. Processing Phase (Mỗi 5 phút)
```sql
-- Worker cronjob
SELECT process_sync_queue_batch(10);
```

**Làm gì:**
- Lấy 10 jobs từ queue (ORDER BY priority DESC, scheduled_at ASC)
- Gọi edge function cho từng shop
- Mark completed/failed
- Delay 0.5s giữa mỗi job

### 3. Retry Logic
Nếu job fail:
- Retry < 3 lần → Đưa lại vào queue với delay 5 phút
- Retry = 3 lần → Mark as failed

### 4. Cleanup (Mỗi ngày 2AM)
```sql
SELECT cleanup_old_sync_queue();
```
Xóa các jobs cũ hơn 7 ngày (completed/failed)

---

## 📊 Priority Levels

| Priority | Mô tả | Khi nào dùng |
|----------|-------|--------------|
| 0 | Low | Background tasks, không quan trọng |
| 1 | Normal | Realtime sync hàng ngày |
| 2 | High | Backfill data, sync lại sau lỗi |
| 3 | Critical | VIP shops, cần sync gấp |

---

## 🎯 Sync Types

### 1. Realtime Sync
```sql
SELECT enqueue_all_shops_sync('realtime', 1);
```
- Sync ongoing campaigns
- Sync hôm nay only
- Chạy mỗi 15 phút

### 2. Backfill Day
```sql
SELECT backfill_all_shops_ads_day(0); -- Today
SELECT backfill_all_shops_ads_day(1); -- Yesterday
SELECT backfill_all_shops_ads_day(6); -- 6 days ago
```
- Sync 1 ngày cụ thể
- Sync all campaigns
- Dùng để fill missing data

### 3. Backfill Full
```sql
INSERT INTO apishopee_ads_sync_queue (shop_id, sync_type, priority)
VALUES (12345, 'backfill_full', 3);
```
- Sync toàn bộ 7 ngày
- Dùng khi thêm shop mới

---

## 📈 Monitoring

### Xem queue status
```sql
SELECT
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE retry_count > 0) as with_retries
FROM apishopee_ads_sync_queue
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status;
```

### Xem shops bị lỗi
```sql
SELECT
  shop_id,
  retry_count,
  error_message,
  scheduled_at
FROM apishopee_ads_sync_queue
WHERE status = 'failed'
ORDER BY scheduled_at DESC
LIMIT 20;
```

### Xem processing time trung bình
```sql
SELECT
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds,
  MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_seconds,
  MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_seconds
FROM apishopee_ads_sync_queue
WHERE status = 'completed'
  AND completed_at > NOW() - INTERVAL '1 day';
```

---

## 🔥 Troubleshooting

### Shop không được sync
**Kiểm tra:**
```sql
SELECT * FROM apishopee_ads_sync_queue
WHERE shop_id = 12345
ORDER BY created_at DESC
LIMIT 5;
```

**Giải pháp:**
- Nếu status = failed → Xem error_message
- Nếu không có record → Shop không có access_token
- Nếu stuck ở processing → Reset manual

### Tất cả shops đều failed
**Nguyên nhân:** Edge function có vấn đề

**Kiểm tra:**
```bash
# Xem edge function logs
```

**Giải pháp:**
- Fix edge function
- Reset queue về pending:
```sql
UPDATE apishopee_ads_sync_queue
SET status = 'pending', retry_count = 0
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour';
```

### Queue quá dài
**Kiểm tra:**
```sql
SELECT COUNT(*) FROM apishopee_ads_sync_queue
WHERE status = 'pending';
```

**Giải pháp:**
- Tăng batch size:
```sql
SELECT process_sync_queue_batch(20); -- Thay vì 10
```
- Hoặc chạy thêm worker:
```sql
-- Thêm cronjob chạy mỗi 3 phút thay vì 5 phút
```

---

## ⚙️ Configuration

### Thay đổi batch size
Mở [058_implement_queue_based_ads_sync.sql](../supabase/migrations/058_implement_queue_based_ads_sync.sql):
```sql
-- Line ~170: Thay đổi từ 10 sang 15
SELECT process_sync_queue_batch(15);
```

### Thay đổi retry count
```sql
-- Khi enqueue, set max_retries
INSERT INTO apishopee_ads_sync_queue (shop_id, sync_type, max_retries)
VALUES (12345, 'realtime', 5); -- 5 retries thay vì 3
```

### Thay đổi delay giữa jobs
File [058_implement_queue_based_ads_sync.sql](../supabase/migrations/058_implement_queue_based_ads_sync.sql):
```sql
-- Line ~140: Thay đổi từ 0.5s sang 1s
PERFORM pg_sleep(1);
```

---

## 🚀 Performance Tips

### 1. Tăng priority cho VIP shops
```sql
-- Set priority cao cho shops quan trọng
UPDATE apishopee_ads_sync_queue
SET priority = 3
WHERE shop_id IN (12345, 67890);
```

### 2. Sync nhóm shops vào giờ thấp điểm
```sql
-- Delay sync cho shops ít quan trọng
UPDATE apishopee_ads_sync_queue
SET scheduled_at = NOW() + INTERVAL '2 hours'
WHERE shop_id IN (11111, 22222);
```

### 3. Monitor và optimize
```sql
-- Tìm shops sync lâu nhất
SELECT
  shop_id,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
FROM apishopee_ads_sync_queue
WHERE status = 'completed'
  AND completed_at > NOW() - INTERVAL '7 days'
GROUP BY shop_id
ORDER BY avg_duration_seconds DESC
LIMIT 10;
```

→ Các shops này cần optimize edge function hoặc chia nhỏ campaigns hơn

---

## 📚 API Reference

### `enqueue_all_shops_sync(sync_type, priority)`
Enqueue sync jobs cho tất cả shops

**Parameters:**
- `sync_type` (text): 'realtime', 'backfill_day', 'backfill_full'
- `priority` (integer): 0-3

**Returns:** Integer (số shops được enqueue)

### `process_next_sync_job()`
Process 1 job tiếp theo trong queue

**Returns:** JSONB với thông tin job

### `process_sync_queue_batch(batch_size)`
Process N jobs liên tiếp

**Parameters:**
- `batch_size` (integer): Số jobs cần process

**Returns:** JSONB với summary

### `cleanup_old_sync_queue()`
Cleanup jobs cũ >7 ngày

**Returns:** Integer (số records đã xóa)

---

## 🎓 Best Practices

1. **Không chạy manual sync nhiều lần liên tiếp**
   - Dùng queue thay vì gọi trực tiếp edge function

2. **Monitor queue depth**
   - Nếu queue > 50 jobs → Cần tăng worker capacity

3. **Set priority đúng**
   - VIP shops = priority 3
   - Normal = priority 1
   - Background = priority 0

4. **Cleanup định kỳ**
   - Cronjob đã tự cleanup, nhưng có thể chạy thủ công nếu cần

5. **Log monitoring**
   - Check edge function logs để detect pattern timeout

---

## 📝 Migration History

- `057_fix_ads_sync_stuck_prevention.sql`: Thêm auto-reset timeout guard
- `058_implement_queue_based_ads_sync.sql`: Implement queue system (file này)

---

## 🔗 Related Files

- Queue migration: [058_implement_queue_based_ads_sync.sql](../supabase/migrations/058_implement_queue_based_ads_sync.sql)
- Edge function: [apishopee-ads-sync/index.ts](../supabase/functions/apishopee-ads-sync/index.ts)
- Original cronjob: [044_create_ads_sync_cron_job.sql](../supabase/migrations/044_create_ads_sync_cron_job.sql)

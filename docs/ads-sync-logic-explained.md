# Logic Hoạt Động Của Ads Sync System

## 📌 Tổng Quan

Hệ thống đồng bộ dữ liệu quảng cáo Shopee có **2 cơ chế**:
1. **Đồng bộ THỦ CÔNG** - User bấm button "Đồng bộ Shopee"
2. **Đồng bộ TỰ ĐỘNG** - Cronjob chạy định kỳ (queue-based system)

---

## 🔵 1. ĐỒNG BỘ THỦ CÔNG (Manual Sync)

### Luồng Hoạt Động:

```
┌─────────────────┐
│ User bấm nút    │
│ "Đồng bộ Shopee"│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Frontend: useAdsData.ts                 │
│ - syncFromAPI()                         │
│ - Gọi: supabase.functions.invoke(      │
│   'apishopee-ads-sync', {action:'sync'})│
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Edge Function: apishopee-ads-sync       │
│ - Nhận action = 'sync'                  │
│ - Set is_syncing = true                 │
│ - Gọi syncAdsData(shopId)               │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Step 1: Sync Campaigns                  │
│ ────────────────────────────────────    │
│ • Gọi GET /get_product_level_campaign_  │
│   id_list → Lấy danh sách campaign IDs  │
│ • Batch 100 campaigns/lần               │
│ • Gọi GET /get_product_level_campaign_  │
│   setting_info → Lấy chi tiết campaigns │
│ • UPSERT vào: apishopee_ads_campaign_   │
│   data                                  │
│ • Trả về: allCampaigns (TẤT CẢ)        │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Step 2: Sync Campaign Daily Performance │
│ ────────────────────────────────────    │
│ • Chỉ sync NGÀY HÔM NAY                 │
│ • Dùng TẤT CẢ campaigns (không chỉ     │
│   ongoing)                              │
│ • Batch 50 campaigns/lần                │
│ • Gọi GET /get_product_campaign_daily_  │
│   performance                           │
│ • UPSERT vào: apishopee_ads_performance_│
│   daily                                 │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Step 3: Sync Campaign Hourly Performance│
│ ────────────────────────────────────    │
│ • Chỉ sync NGÀY HÔM NAY                 │
│ • Dùng TẤT CẢ campaigns (không chỉ     │
│   ongoing)                              │
│ • Batch 50 campaigns/lần                │
│ • Gọi GET /get_product_campaign_hourly_ │
│   performance                           │
│ • UPSERT vào: apishopee_ads_performance_│
│   hourly                                │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Step 4: Sync Shop-Level Performance     │
│ ────────────────────────────────────    │
│ • Daily: Gọi GET /get_all_cpc_ads_daily_│
│   performance (7 ngày)                  │
│ • Hourly: Gọi GET /get_all_cpc_ads_     │
│   hourly_performance (hôm nay)          │
│ • Tính item_sold từ campaign-level data │
│ • UPSERT vào:                           │
│   - apishopee_ads_shop_performance_daily│
│   - apishopee_ads_shop_performance_     │
│     hourly                              │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Hoàn Thành                              │
│ ────────────────────────────────────    │
│ • Set is_syncing = false                │
│ • Update last_sync_at                   │
│ • Update total_campaigns, ongoing_      │
│   campaigns                             │
│ • Realtime: UI tự động cập nhật         │
└─────────────────────────────────────────┘
```

### Chi Tiết Kỹ Thuật:

- **File**: `supabase/functions/apishopee-ads-sync/index.ts`
- **Action**: `sync`
- **Thời gian thực thi**: ~10-50 giây (tùy số lượng campaigns)
- **Trạng thái**: Cập nhật `apishopee_ads_sync_status.is_syncing` = true/false

---

## 🟢 2. ĐỒNG BỘ TỰ ĐỘNG (Auto Sync - Queue-Based)

### Kiến Trúc Queue-Based System:

```
┌──────────────────────────────────────────┐
│ Cronjob #1: ads-sync-job                 │
│ ───────────────────────────────────      │
│ • Chạy: */15 * * * * (Mỗi 15 phút)       │
│ • Function: enqueue_all_shops_sync()     │
│ • Vai trò: PRODUCER - Tạo jobs          │
└─────────┬────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────┐
│ Database: apishopee_ads_sync_queue       │
│ ───────────────────────────────────      │
│ • Lưu trữ queue của các shop cần sync   │
│ • Status: pending, processing, completed,│
│   failed                                 │
│ • Priority: 0-3 (cao hơn = chạy trước)  │
└─────────┬────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────┐
│ Cronjob #2: ads-sync-queue-processor     │
│ ───────────────────────────────────      │
│ • Chạy: */5 * * * * (Mỗi 5 phút)         │
│ • Function: process_sync_queue_batch(10) │
│ • Vai trò: CONSUMER - Xử lý jobs        │
└─────────┬────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────┐
│ Xử Lý Tuần Tự (Sequential)              │
│ ───────────────────────────────────      │
│ • Lấy 1 job pending có priority cao nhất │
│ • Set status = processing                │
│ • Gọi Edge Function: apishopee-ads-sync  │
│   với action = 'sync'                    │
│ • Nếu thành công: status = completed     │
│ • Nếu lỗi: retry (max 3 lần)            │
│ • Delay 0.5s giữa các jobs               │
└──────────────────────────────────────────┘
```

### Chi Tiết Cronjobs:

#### Cronjob #1: Enqueue All Shops (Producer)
```sql
-- Migration: 058_implement_queue_based_ads_sync.sql (Line 312-317)
SELECT cron.schedule(
  'ads-sync-job',
  '*/15 * * * *',  -- Mỗi 15 phút
  $$SELECT enqueue_all_shops_sync('realtime', 1);$$
);
```

**Vai trò**:
- Quét tất cả shops có `access_token`
- Tạo queue job với `sync_type = 'realtime'`
- KHÔNG sync trực tiếp, chỉ enqueue
- Tránh duplicate: Chỉ tạo job nếu chưa có job pending/processing

#### Cronjob #2: Process Queue (Consumer)
```sql
-- Migration: 058_implement_queue_based_ads_sync.sql (Line 302-309)
SELECT cron.schedule(
  'ads-sync-queue-processor',
  '*/5 * * * *',  -- Mỗi 5 phút
  $$
  -- Process 10 jobs mỗi lần
  SELECT process_sync_queue_batch(10);
  $$
);
```

**Vai trò**:
- Lấy tối đa 10 jobs pending từ queue
- Xử lý tuần tự (không parallel)
- Gọi Edge Function cho mỗi job
- Retry nếu lỗi (max 3 lần)

### Luồng Xử Lý Queue:

```
1. Lúc 08:00 - ads-sync-job chạy
   ↓
2. enqueue_all_shops_sync() tạo 12 queue jobs
   ↓
3. Lúc 08:05 - ads-sync-queue-processor chạy
   ↓
4. process_sync_queue_batch(10) lấy 10 jobs
   ↓
5. Xử lý tuần tự:
   - Job 1: Shop 1373113822 → Gọi Edge Function → Thành công (8s)
   - Delay 0.5s
   - Job 2: Shop 575649209 → Gọi Edge Function → Thành công (6s)
   - Delay 0.5s
   - Job 3: Shop 532963124 → Gọi Edge Function → TIMEOUT (46s) ❌
   - Retry: Set status = pending, scheduled_at = +5 phút
   - Job 4: Shop 23426918 → Gọi Edge Function → TIMEOUT (31s) ❌
   - Retry: Set status = pending, scheduled_at = +5 phút
   - ...
   ↓
6. Lúc 08:10 - ads-sync-queue-processor chạy lại
   ↓
7. Retry Job 3 và Job 4, 2 shops còn lại xử lý tiếp
```

---

## ⚠️ VẤN ĐỀ HIỆN TẠI VỚI 2 SHOP

### Phát Hiện Vấn Đề:

**Shop ID**: 532963124, 23426918

**Triệu chứng**:
- ✅ Sync thủ công (button): **Hoạt động bình thường**
- ❌ Sync tự động (cronjob): **BỊ STUCK**

**Trạng thái hiện tại** (Lúc 13:30):
```sql
shop_id     | is_syncing | last_sync_at           | total_campaigns | ongoing_campaigns
------------|------------|------------------------|-----------------|------------------
532963124   | true       | 2026-01-20 12:00:45    | 335             | 6
23426918    | true       | 2026-01-20 12:00:38    | 917             | 12
```

**Các shop khác đã sync thành công lúc 13:20**, nhưng 2 shop này **BỊ KẸT ở 12:00**.

### Phân Tích Logs:

**Edge Function Logs** (từ `mcp__supabase__get_logs`):

```
[1768915251535] apishopee-ads-sync | POST | 546 | 46292ms  ← Shop bị TIMEOUT
[1768915511204] apishopee-ads-sync | POST | 546 | 10028ms  ← Shop bị TIMEOUT
[1768914618194] apishopee-ads-sync | POST | 502 | 16595ms  ← Bad Gateway
[1768913412838] apishopee-ads-sync | POST | 502 | 11683ms  ← Bad Gateway
[1768913285794] apishopee-ads-sync | POST | 546 | 12974ms  ← Shop bị TIMEOUT
[1768913136976] apishopee-ads-sync | POST | 546 | 31679ms  ← Shop bị TIMEOUT
```

**Mã lỗi**:
- **546** - Edge Function execution timed out (vượt 50s limit)
- **502** - Bad Gateway (server error hoặc timeout)

### Nguyên Nhân:

#### 1️⃣ **Edge Function Timeout (50 giây limit)**

Shop `23426918` có **917 campaigns**, shop `532963124` có **335 campaigns**.

**Tính toán thời gian sync**:
```
Shop 23426918 (917 campaigns):
- Step 1: Sync campaigns (917 campaigns, batch 100)
  → 10 batches × 2s = 20s
- Step 2: Sync daily performance (917 campaigns, batch 50)
  → 19 batches × 0.5s = 9.5s
- Step 3: Sync hourly performance (917 campaigns, batch 50)
  → 19 batches × 0.5s = 9.5s
- Step 4: Sync shop-level
  → ~5s

TỔNG: ~44 giây (GẦN TIMEOUT 50s)

Nếu API Shopee chậm 1 chút → VƯỢT 50s → ERROR 546
```

#### 2️⃣ **is_syncing Flag Stuck**

Khi Edge Function **timeout** hoặc **crash**:
- Line 1161-1166 (`index.ts`): Set `is_syncing = true`
- Line 1230-1237: Nếu **lỗi**, set `is_syncing = false`
- **NHƯNG** nếu **timeout 546** → Code không chạy đến catch block
- → `is_syncing` **BỊ STUCK = true**

**Migration 058** (queue processor):
```javascript
// Line 124-146: Gọi Edge Function
BEGIN
  SELECT net.http_post(
    url := 'https://...apishopee-ads-sync',
    body := request_body
  ) INTO result;

  -- Mark as completed
  UPDATE apishopee_ads_sync_queue
  SET status = 'completed'
  WHERE id = job_record.id;

EXCEPTION WHEN OTHERS THEN
  -- Retry logic
  ...
END;
```

**Vấn đề**: Nếu `net.http_post` timeout 546:
- PostgreSQL function bắt được exception
- Queue job được retry
- **NHƯNG** Edge Function không chạy đến `is_syncing = false`
- → `is_syncing` stuck = true
- → Cronjob tiếp theo **bỏ qua shop này** vì đang syncing

#### 3️⃣ **Queue Stuck Prevention Không Đủ**

Migration 057 đã thêm timeout prevention:
```sql
-- Check nếu shop stuck quá 30 phút → Reset
WHERE is_syncing = true
  AND last_sync_at < NOW() - INTERVAL '30 minutes'
```

**NHƯNG** 2 shop này:
- Stuck lúc 12:00
- Giờ là 13:30 → **ĐÃ QUÁ 30 PHÚT**
- Tại sao chưa được reset?

→ **Thiếu cronjob cleanup hoặc chưa chạy**

---

## ✅ GIẢI PHÁP ĐÃ THỰC HIỆN

### 1. Reset TrạngÁi Stuck (Khẩn Cấp)

```sql
-- Đã chạy
UPDATE apishopee_ads_sync_status
SET is_syncing = false,
    sync_progress = '{}'::jsonb
WHERE shop_id IN (532963124, 23426918);
```

**Kết quả**: 2 shop đã được reset, cronjob tiếp theo sẽ sync lại.

---

## 🔧 GIẢI PHÁP DÀI HẠN (KHUYẾN NGHỊ)

### 1️⃣ **Tăng Edge Function Timeout Limit**

Hiện tại: 50 giây
Khuyến nghị: **90-120 giây** cho shops có nhiều campaigns

**Cách thực hiện**:
- Supabase Dashboard → Edge Functions → Settings
- Hoặc sử dụng Supabase CLI config

### 2️⃣ **Tối Ưu Edge Function - Chia Nhỏ Sync**

**Thay vì sync toàn bộ trong 1 request**, chia thành **nhiều request nhỏ**:

```typescript
// Thay vì:
action = 'sync' → Sync toàn bộ (campaigns + daily + hourly + shop-level)

// Đổi thành:
action = 'sync_campaigns'        → Chỉ sync campaigns (nhanh)
action = 'sync_daily_perf'       → Chỉ sync daily performance
action = 'sync_hourly_perf'      → Chỉ sync hourly performance
action = 'sync_shop_level'       → Chỉ sync shop-level
```

Queue processor gọi **4 requests riêng** thay vì 1 request.

### 3️⃣ **Thêm Cronjob Cleanup Stuck Shops**

```sql
-- Tạo function cleanup
CREATE OR REPLACE FUNCTION cleanup_stuck_ads_sync()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  reset_count INTEGER;
BEGIN
  -- Reset shops stuck quá 30 phút
  UPDATE apishopee_ads_sync_status
  SET is_syncing = false,
      sync_progress = jsonb_build_object('step', 'timeout_reset'),
      last_sync_error = 'Auto-reset: Sync stuck for >30 minutes'
  WHERE is_syncing = true
    AND last_sync_at < NOW() - INTERVAL '30 minutes';

  GET DIAGNOSTICS reset_count = ROW_COUNT;

  RAISE NOTICE 'Reset % stuck shops', reset_count;
  RETURN reset_count;
END;
$$;

-- Tạo cronjob chạy mỗi 10 phút
SELECT cron.schedule(
  'ads-sync-stuck-cleanup',
  '*/10 * * * *',
  $$SELECT cleanup_stuck_ads_sync();$$
);
```

### 4️⃣ **Giới Hạn Batch Size Dựa Trên Số Campaigns**

```typescript
// Trong syncHourlyPerformanceForDate()
const BATCH_SIZE = campaigns.length > 500 ? 30 : 50;
// Shops nhiều campaigns → Batch nhỏ hơn → Tránh timeout
```

### 5️⃣ **Monitoring & Alerts**

Thêm monitoring để phát hiện sớm:
```sql
-- View để track stuck shops
CREATE VIEW v_stuck_ads_sync AS
SELECT
  shop_id,
  is_syncing,
  last_sync_at,
  EXTRACT(EPOCH FROM (NOW() - last_sync_at))/60 AS stuck_minutes,
  total_campaigns
FROM apishopee_ads_sync_status
WHERE is_syncing = true
  AND last_sync_at < NOW() - INTERVAL '15 minutes';
```

---

## 📊 SO SÁNH 2 CƠ CHẾ SYNC

| Tiêu Chí               | Sync Thủ Công (Button)        | Sync Tự Động (Cronjob)        |
|------------------------|------------------------------|-------------------------------|
| **Trigger**            | User bấm button              | Cronjob mỗi 15 phút           |
| **Cách gọi**           | Frontend → Edge Function     | Cronjob → Queue → Edge Function|
| **Xử lý**              | Trực tiếp, song song         | Queue-based, tuần tự          |
| **Timeout handling**   | Trả lỗi cho user             | Retry 3 lần, có thể stuck     |
| **Độ tin cậy**         | ✅ Cao (user nhìn thấy lỗi)  | ⚠️ Trung bình (có thể stuck) |
| **Performance**        | ✅ Nhanh (call trực tiếp)    | ⚠️ Chậm hơn (qua queue)      |
| **Use case**           | Sync 1 shop ngay lập tức     | Sync tất cả shops định kỳ     |

---

## 🎯 KẾT LUẬN

### Nguyên Nhân 2 Shop Không Tự Động Sync:

1. **Edge Function Timeout (546)** - Shops có quá nhiều campaigns (917 và 335) → Sync vượt 50s
2. **is_syncing Stuck** - Timeout không trigger catch block → Flag stuck = true
3. **Queue Retry Fail** - Retry 3 lần đều timeout → Job failed → Shop bị bỏ qua
4. **Thiếu Cleanup** - Chưa có cronjob reset stuck shops định kỳ

### Giải Pháp Đã Làm:

✅ Reset trạng thái stuck cho 2 shop → Cronjob tiếp theo sẽ sync lại

### Khuyến Nghị Triển Khai:

1. ⭐ **Thêm cronjob cleanup stuck shops** (mỗi 10 phút)
2. ⭐ **Chia nhỏ sync thành nhiều actions** (tránh timeout)
3. **Tăng Edge Function timeout** lên 90-120s
4. **Batch size động** dựa trên số campaigns
5. **Monitoring view** để phát hiện sớm

---

## 📝 FILES LIÊN QUAN

### Backend:
- `supabase/functions/apishopee-ads-sync/index.ts` - Edge function sync ads
- `supabase/migrations/058_implement_queue_based_ads_sync.sql` - Queue system
- `supabase/migrations/057_fix_ads_sync_stuck_prevention.sql` - Stuck prevention

### Frontend:
- `src/hooks/useAdsData.ts` - React hook fetch ads data
- `src/pages/AdsPage.tsx` - UI page hiển thị ads

### Database Tables:
- `apishopee_ads_sync_queue` - Queue jobs
- `apishopee_ads_sync_status` - Sync status per shop
- `apishopee_ads_campaign_data` - Campaign data
- `apishopee_ads_performance_daily` - Daily performance
- `apishopee_ads_performance_hourly` - Hourly performance
- `apishopee_ads_shop_performance_daily` - Shop-level daily
- `apishopee_ads_shop_performance_hourly` - Shop-level hourly

---

*Document được tạo bởi Claude Code - 2026-01-20*

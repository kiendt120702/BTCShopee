# Cơ Chế Đồng Bộ Reviews từ Shopee API

## Tổng Quan

Hệ thống có 2 cách đồng bộ reviews:
1. **Cronjob tự động** - Chạy mỗi 30 phút
2. **Sync bằng tay** - Người dùng click nút "Đồng bộ Shopee"

## Chi Tiết Cơ Chế Hoạt Động

### 1. Edge Function: `apishopee-reviews-sync`

#### A. Initial Load (Lần Đầu Tiên)

**Khi nào chạy:**
- Lần đầu tiên sync shop mới
- Khi `is_initial_sync_done = false` trong bảng `apishopee_reviews_sync_status`
- Hoặc khi user click "Đồng bộ lại toàn bộ" (với `force_initial = true`)

**Cách hoạt động:**

```
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 1: Fetch Replied Comments (comment_type = 2)          │
│  - Lấy TẤT CẢ comments đã có reply từ Shopee                │
│  - Lưu vào Map<comment_id, comment_data>                    │
│  - Giới hạn: 100 pages × 50 = 5,000 replied comments        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 2: Fetch All Comments (comment_type = 0)              │
│  - Lấy TẤT CẢ comments (while more == true)                 │
│  - Giới hạn: 200 pages × 50 = 10,000 comments               │
│  - Mỗi page: gọi API Shopee với cursor                      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 3: Merge Reply Data                                   │
│  - Với mỗi comment, check xem có trong repliedMap không     │
│  - Nếu có → merge reply_text, reply_time vào comment        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 4: Upsert vào Database                                │
│  - UPSERT với UNIQUE(shop_id, comment_id)                   │
│  - Nếu comment_id đã tồn tại → UPDATE                       │
│  - Nếu chưa tồn tại → INSERT                                │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 5: Cập nhật Sync Status                               │
│  - is_initial_sync_done = true                              │
│  - last_sync_create_time = timestamp của review mới nhất    │
│  - total_synced = tổng số reviews đã sync                   │
└─────────────────────────────────────────────────────────────┘
```

**Code tham chiếu:** [`index.ts:512-618`](../supabase/functions/apishopee-reviews-sync/index.ts#L512-L618)

#### B. Periodic Sync (Định Kỳ)

**Khi nào chạy:**
- Khi `is_initial_sync_done = true`
- Chạy bởi cronjob mỗi 30 phút
- Hoặc khi user click "Đồng bộ Shopee" (sync thường)

**Cách hoạt động:**

```
┌─────────────────────────────────────────────────────────────┐
│  ĐIỂM DỪNG (Stop Condition)                                 │
│  stopTime = last_sync_create_time - 30 ngày                 │
│  (Safety buffer để bắt các review được sửa trong 30 ngày)   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 1: Fetch Replied Comments                             │
│  - Lấy TẤT CẢ comments đã có reply (để có reply mới nhất)  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 2: Fetch Comments từ đầu (cursor = '')                │
│  - Lấy từ page đầu tiên                                     │
│  - Shopee API trả về reviews theo thứ tự MỚI → CŨ           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 3: Kiểm tra mỗi comment                               │
│  - Nếu comment.create_time < stopTime → DỪNG                │
│  - Nếu không → Thêm vào commentsToProcess                   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 4: Merge Reply Data                                   │
│  - Merge với repliedMap để có reply mới nhất                │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 5: Phân biệt New vs Updated                           │
│  - Query DB để check comment_id đã tồn tại chưa            │
│  - existingIds.has(comment_id) → Updated                    │
│  - Không có → New                                           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BƯỚC 6: Upsert vào Database                                │
│  - UPSERT tất cả (new + updated)                            │
│  - Trả về: { new_reviews: X, updated_reviews: Y }           │
└─────────────────────────────────────────────────────────────┘
```

**Code tham chiếu:** [`index.ts:625-750`](../supabase/functions/apishopee-reviews-sync/index.ts#L625-L750)

### 2. Logic Upsert Reviews

**Hàm:** `upsertReviews()` - [`index.ts:442-504`](../supabase/functions/apishopee-reviews-sync/index.ts#L442-L504)

**Cơ chế:**

1. **Lấy existing reviews** từ DB để KHÔNG ghi đè reply_text nếu đã có:
   ```typescript
   const { data: existingReviews } = await supabase
     .from('apishopee_reviews')
     .select('comment_id, reply_text, reply_time, reply_hidden')
     .eq('shop_id', shopId)
     .in('comment_id', commentIds);
   ```

2. **Logic ưu tiên reply:**
   - Nếu comment mới có reply → Dùng reply mới
   - Nếu comment mới KHÔNG có reply NHƯNG DB đã có → GIỮ reply cũ
   - Lý do: Shopee API không luôn trả về reply trong tất cả các endpoint

3. **Upsert với conflict resolution:**
   ```typescript
   await supabase
     .from('apishopee_reviews')
     .upsert(records, { onConflict: 'shop_id,comment_id' });
   ```

### 3. Cronjob Tự Động

**File:** [`047_create_reviews_sync_cron_job.sql`](../supabase/migrations/047_create_reviews_sync_cron_job.sql)

**Cách hoạt động:**

```
┌─────────────────────────────────────────────────────────────┐
│  CRONJOB: Chạy mỗi 30 phút (phút 5 và 35)                   │
│  Schedule: '5,35 * * * *'                                   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  FUNCTION: sync_all_shops_reviews()                         │
│  - Lấy tất cả shops active và KHÔNG đang sync               │
│  - Điều kiện:                                               │
│    + access_token IS NOT NULL                               │
│    + status = 'active'                                      │
│    + (is_syncing IS NULL OR is_syncing = false)            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  LOOP qua từng shop:                                        │
│  1. Gọi Edge Function với action = 'sync'                   │
│  2. Timeout: 5 phút/shop                                    │
│  3. Sleep 3 giây giữa các shop (tránh rate limit)           │
│  4. Nếu lỗi → Log warning và tiếp tục shop tiếp theo        │
└─────────────────────────────────────────────────────────────┘
```

**Đặc điểm:**
- Chạy **song song** cho nhiều shops (với delay 3s giữa mỗi shop)
- **Không block** nếu 1 shop fail
- **Auto-detect** Initial vs Periodic sync cho mỗi shop

### 4. Sync Bằng Tay từ UI

**Component:** ReviewsPanel → Hook: `useReviewsData`

**User flow:**

```
User click "Đồng bộ Shopee"
          ↓
┌─────────────────────────────────────────────────────────────┐
│  syncReviews(forceInitial = false)                          │
│  - Gọi Edge Function với:                                   │
│    + action: 'sync'                                         │
│    + shop_id: current shop                                  │
│    + user_id: current user                                  │
│    + force_initial: false (hoặc true nếu "Đồng bộ lại")    │
└─────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────┐
│  Edge Function tự động chọn mode:                           │
│  - Nếu is_initial_sync_done = false → Initial Load          │
│  - Nếu is_initial_sync_done = true → Periodic Sync          │
│  - Nếu force_initial = true → Force Initial Load            │
└─────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────┐
│  Sau khi sync xong:                                         │
│  - Invalidate React Query cache                             │
│  - Refetch reviews data                                     │
│  - Show toast với kết quả                                   │
└─────────────────────────────────────────────────────────────┘
```

**Code tham chiếu:** [`useRealtimeData.ts:426-459`](../src/hooks/useRealtimeData.ts#L426-L459)

## Giới Hạn và Safety Limits

### 1. Edge Function Limits

| Limit | Giá trị | Lý do |
|-------|---------|-------|
| MAX_PAGES (Initial) | 200 pages | 200 × 50 = **10,000 reviews** |
| MAX_PAGES (Replied) | 100 pages | 100 × 50 = **5,000 replied** |
| PAGE_SIZE | 50 | Shopee API standard |
| Rate limit delay | 500ms | Tránh bị Shopee rate limit |
| SAFETY_BUFFER_DAYS | 30 ngày | Bắt reviews được sửa trong 30 ngày |

### 2. Database Constraints

- **UNIQUE(shop_id, comment_id)** - Đảm bảo không duplicate
- **RLS Policy** - User chỉ xem reviews của shops mình có quyền
- **Indexes** - Optimize query performance (shop_id, create_time DESC)

### 3. Supabase Query Limits

- **Default limit: 1000 rows** - Đã fix bằng:
  - `.range(0, 9999)` cho query stats
  - `count: 'exact'` để lấy tổng số chính xác

## Sync Status Tracking

**Bảng:** `apishopee_reviews_sync_status`

| Field | Mô tả |
|-------|-------|
| `is_syncing` | Đang sync hay không (tránh duplicate sync) |
| `is_initial_sync_done` | Đã hoàn thành initial load chưa |
| `last_sync_at` | Thời gian sync lần cuối |
| `last_sync_create_time` | Timestamp của review mới nhất (dùng làm điểm dừng) |
| `total_synced` | Tổng số reviews đã sync |
| `last_error` | Lỗi gần nhất (nếu có) |

## Flow Tổng Hợp

### Lần Đầu Tiên (Shop Mới)

```
1. Shop được thêm vào hệ thống
2. Cronjob chạy → Phát hiện shop chưa có is_initial_sync_done
3. Chạy Initial Load:
   - Fetch tất cả replied comments
   - Fetch tất cả comments (tối đa 10,000)
   - Merge reply data
   - Upsert vào DB
   - Set is_initial_sync_done = true
```

### Lần Tiếp Theo (Periodic)

```
1. Cronjob chạy mỗi 30 phút
2. Phát hiện is_initial_sync_done = true
3. Chạy Periodic Sync:
   - Tính stopTime = last_sync_create_time - 30 ngày
   - Fetch từ đầu (reviews mới nhất)
   - Dừng khi gặp review < stopTime
   - Phân biệt new vs updated
   - Upsert vào DB
   - Update last_sync_create_time
```

## Lưu Ý Quan Trọng

### 1. KHÔNG Xóa Reviews Cũ

- Hệ thống **KHÔNG BAO GIỜ XÓA** reviews từ DB
- Chỉ **INSERT** (new) hoặc **UPDATE** (existing)
- Reviews bị xóa trên Shopee vẫn còn trong DB

### 2. Reply Text Preservation

- Nếu DB đã có reply_text, **ưu tiên giữ reply cũ**
- Chỉ update reply nếu API trả về reply mới
- Lý do: Shopee API không consistent trong việc trả về reply

### 3. Điểm Dừng 30 Ngày

- Periodic sync không lấy **TẤT CẢ** reviews
- Chỉ lấy từ đầu → dừng khi gặp review cũ hơn `last_sync - 30 ngày`
- Đủ để bắt:
  - Reviews mới
  - Reviews được edit
  - Reply mới được thêm

### 4. Rate Limiting

- **500ms** delay giữa mỗi page (Edge Function)
- **3s** delay giữa mỗi shop (Cronjob)
- Tránh bị Shopee API rate limit

## Troubleshooting

### Reviews không cập nhật

**Kiểm tra:**
1. Xem `apishopee_reviews_sync_status` - có `last_error` không?
2. Xem Supabase Edge Function logs
3. Check `is_syncing` - có bị stuck ở `true` không?

### Initial sync bị giới hạn 10,000

**Giải pháp:**
- Tăng `MAX_PAGES` trong Edge Function
- Hoặc chạy sync nhiều lần (tự động tiếp tục từ cursor)

### Reply text bị mất

**Nguyên nhân:**
- Shopee API không trả về reply trong một số endpoint
- Đã fix bằng cách giữ reply_text cũ nếu DB đã có

### Cronjob không chạy

**Kiểm tra:**
1. Xem cron.job trong Supabase
2. Check pg_cron extension enabled
3. Xem database logs

## Tóm Tắt

| Tính năng | Initial Load | Periodic Sync |
|-----------|--------------|---------------|
| **Khi nào** | Lần đầu / Force | Mỗi 30 phút |
| **Lấy bao nhiêu** | Tất cả (max 10k) | Từ đầu → stopTime |
| **Điểm dừng** | more == false | create_time < stopTime |
| **Safety buffer** | N/A | 30 ngày |
| **Xử lý duplicate** | Upsert | Upsert |
| **Tracking** | new_reviews vs updated_reviews | Yes |
| **Xóa reviews cũ** | Không | Không |

---

**Ghi chú:** Document này được tạo để hiểu rõ cơ chế sync reviews. Khi có thay đổi code, cần cập nhật document này.

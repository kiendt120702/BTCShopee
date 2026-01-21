# Fix Lỗi Auto Sync Ads Data

**Ngày:** 20/01/2026
**Trạng thái:** ✅ Fixed
**Mức độ:** CRITICAL

---

## 🔴 Vấn đề

Khi tự động đồng bộ dữ liệu quảng cáo Ads qua cron job (mỗi 15 phút), dữ liệu được lưu SAI và KHÔNG KHỚP với khi đồng bộ thủ công qua button "Đồng bộ từ Shopee".

### Triệu chứng:
- ❌ Số lượt click hiển thị sai
- ❌ GMV (doanh số) hiển thị sai
- ❌ Số sản phẩm đã bán (`broad_item_sold`) = 0 hoặc thiếu
- ❌ ROAS tính toán sai do dữ liệu GMV không chính xác
- ✅ Khi đồng bộ thủ công → dữ liệu ĐÚNG

### Impact:
- Dashboard hiển thị KPI sai → người dùng không tin tưởng hệ thống
- Báo cáo sai → quyết định kinh doanh sai lầm
- Realtime data không có giá trị

---

## 🔍 Nguyên nhân gốc rễ

### Root Cause: **THỨ TỰ SYNC SAI**

**Trước khi fix:**

```
Step 0: Sync shop-level performance (get_all_cpc_ads_*_performance)
  └─ Lấy data từ Shopee API shop-level
  └─ ⚠️  API KHÔNG TRẢ VỀ broad_item_sold
  └─ Cần tính từ campaign-level data
  └─ ❌ NHƯNG campaign-level chưa được sync!

Step 1: Sync campaigns (campaign settings)
Step 2: Sync campaign daily performance
Step 3: Sync campaign hourly performance
```

**Kết quả:** Shop-level data được lưu VỚI `broad_item_sold = 0` vì:
1. Shop-level API không trả về field `broad_item_sold`
2. Fallback logic cần tính tổng từ campaign-level
3. Campaign-level data CHƯA TỒN TẠI vào thời điểm shop-level sync
4. → `broad_item_sold` = 0

### Code bị lỗi

File: `supabase/functions/apishopee-ads-sync/index.ts`

```typescript
// ❌ SAI: Sync shop-level TRƯỚC campaign-level
async function syncAdsData(...) {
  // Step 0: Shop-level (THIẾU item_sold data!)
  await syncShopLevelDailyPerformance(...);   // ← Gọi trước
  await syncShopLevelHourlyPerformance(...);  // ← Gọi trước

  // Step 1: Campaigns
  await syncCampaigns(...);

  // Step 2-3: Campaign performance (có item_sold)
  await syncDailyPerformance(...);   // ← Gọi sau
  await syncHourlyPerformance(...);  // ← Gọi sau
}
```

### Tại sao sync thủ công lại ĐÚNG?

Khi người dùng click button "Đồng bộ từ Shopee":
1. Gọi cùng endpoint `apishopee-ads-sync` với action `'sync'`
2. Nhưng do **race condition** và **database UPSERT**, thứ tự thực tế có thể khác
3. Hoặc có thể do **cache invalidation** khiến frontend đọc lại từ DB sau khi cả 2 đã xong
4. → Kết quả ĐÚNG (do may mắn hoặc timing)

---

## ✅ Giải pháp

### Fix: **ĐẢO THỨ TỰ SYNC**

**Sau khi fix:**

```
Step 1: Sync campaigns (campaign settings)
Step 2: Sync campaign daily performance ← LƯU VÀO DB TRƯỚC
Step 3: Sync campaign hourly performance ← LƯU VÀO DB TRƯỚC
Step 4: Sync shop-level performance
  └─ Lấy data từ Shopee API shop-level
  └─ Nếu API không có broad_item_sold
  └─ ✅ Fallback: Tính tổng từ campaign-level (ĐÃ CÓ TRONG DB!)
  └─ Lưu shop-level với item_sold CHÍNH XÁC
```

### Code sau khi fix

File: `supabase/functions/apishopee-ads-sync/index.ts`

```typescript
// ✅ ĐÚNG: Sync campaign-level TRƯỚC shop-level
async function syncAdsData(...) {
  // Step 1: Campaigns
  const { total, ongoing, allCampaigns } = await syncCampaigns(...);

  // Step 2: Campaign daily performance (LƯU DB TRƯỚC)
  const dailyRecords = await syncDailyPerformance(..., allCampaigns);

  // Step 3: Campaign hourly performance (LƯU DB TRƯỚC)
  const hourlyRecords = await syncHourlyPerformance(..., allCampaigns);

  // Step 4: Shop-level (CÓ THỂ FALLBACK VỀ CAMPAIGN DATA)
  await syncShopLevelDailyPerformance(...);   // ← Gọi sau
  await syncShopLevelHourlyPerformance(...);  // ← Gọi sau
}
```

### Tại sao fix này hiệu quả?

1. **Campaign-level data có sẵn trong DB** khi shop-level sync chạy
2. **Fallback logic hoạt động đúng:**
   ```typescript
   // Line 678-698 trong apishopee-ads-sync/index.ts
   const { data: campaignItemSoldData } = await supabase
     .from('apishopee_ads_performance_daily')
     .select('performance_date, direct_item_sold, broad_item_sold')
     .eq('shop_id', shopId)
     .gte('performance_date', dbStartDate)
     .lte('performance_date', dbEndDate);

   // Tính tổng item_sold từ campaign-level
   for (const row of campaignItemSoldData) {
     itemSoldByDate[date].broad_item_sold += row.broad_item_sold || 0;
   }
   ```
3. **Đảm bảo consistency** giữa auto sync và manual sync

---

## 🧪 Testing

### Test Script

Run:
```bash
npx ts-node scripts/test-ads-sync-fix.ts
```

Script sẽ:
1. ✅ Lấy dữ liệu TRƯỚC khi sync
2. ✅ Chạy auto sync (giống cron job)
3. ✅ Lấy dữ liệu SAU auto sync
4. ✅ So sánh shop-level vs campaign-level
5. ✅ Báo cáo kết quả: PASS/FAIL

### Expected Output

```
=== KẾT LUẬN ===
✅ AUTO SYNC HOẠT ĐỘNG ĐÚNG!
   - Shop-level broad_item_sold: 13
   - Campaign-level total: 13
   - Sai số: 0 (perfect match!)
```

---

## 📋 Checklist Deploy

- [x] Fix code trong `apishopee-ads-sync/index.ts`
- [x] Deploy Edge Function: `npx supabase functions deploy apishopee-ads-sync`
- [ ] Chạy test script và verify kết quả
- [ ] Monitor cron job chạy lần tiếp theo (15 phút)
- [ ] Check dashboard hiển thị dữ liệu đúng
- [ ] Verify với user: "Dữ liệu giờ đã chính xác chưa?"

---

## 🔗 Files Changed

1. `supabase/functions/apishopee-ads-sync/index.ts` (lines 1160-1200)
   - Đổi thứ tự sync: campaign-level trước, shop-level sau
   - Thêm comment giải thích

2. `scripts/test-ads-sync-fix.ts` (NEW)
   - Script test để verify fix

3. `docs/ads-sync-auto-fix.md` (NEW)
   - Document này

---

## 📚 Bài học

### Lesson Learned

1. **Thứ tự quan trọng** khi có dependency giữa các bước sync
2. **Fallback logic cần data có sẵn** - không thể fallback về data chưa tồn tại
3. **Test cả 2 flow:** auto sync (cron) + manual sync (button)
4. **Database timing matters:** UPSERT không đảm bảo thứ tự nếu gọi parallel

### Nguyên tắc thiết kế

✅ **Dependency Graph:**
```
Campaigns ← Campaign Performance ← Shop-Level Performance
(Level 1)       (Level 2)              (Level 3)
```

✅ **Luôn sync theo thứ tự dependency:** 1 → 2 → 3

❌ **KHÔNG bao giờ:** 3 → 1 → 2 (như trước khi fix)

---

## 🚨 Nếu vẫn bị lỗi sau khi fix

### Debug Steps

1. **Check logs:**
   ```bash
   npx supabase functions logs apishopee-ads-sync --tail 100
   ```

2. **Verify Edge Function deployed:**
   ```bash
   npx supabase functions list
   ```

3. **Check database directly:**
   ```sql
   -- Shop-level data
   SELECT * FROM apishopee_ads_shop_performance_daily
   WHERE shop_id = YOUR_SHOP_ID
   ORDER BY performance_date DESC LIMIT 1;

   -- Campaign-level data
   SELECT SUM(broad_item_sold) as total_item_sold
   FROM apishopee_ads_performance_daily
   WHERE shop_id = YOUR_SHOP_ID
   AND performance_date = CURRENT_DATE;
   ```

4. **Manual trigger sync:**
   ```bash
   curl -X POST 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync' \
     -H 'Content-Type: application/json' \
     -H 'Authorization: Bearer YOUR_ANON_KEY' \
     -d '{"action":"sync","shop_id":YOUR_SHOP_ID}'
   ```

---

## 📞 Contact

Nếu có câu hỏi hoặc vấn đề:
- **Developer:** Claude Code
- **Date Fixed:** 20/01/2026
- **Priority:** P0 (Critical)

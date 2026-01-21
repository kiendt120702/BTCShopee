# 🔧 Fix Auto Sync Ads - Summary

**Status:** ✅ FIXED
**Date:** 20/01/2026
**Severity:** CRITICAL

---

## 🔴 Problem

Auto sync (cron mỗi 15 phút) lưu dữ liệu SAI:
- ❌ Clicks sai
- ❌ GMV sai
- ❌ Số sản phẩm đã bán = 0
- ❌ ROAS tính toán sai

Nhưng sync thủ công (button) lại ĐÚNG ✅

---

## 💡 Root Cause

**THỨ TỰ SYNC SAI:**

### ❌ TRƯỚC (sai):
```
1. Shop-level sync  ← Thiếu item_sold (campaign data chưa có!)
2. Campaign sync
3. Campaign performance sync
```

### ✅ SAU (đúng):
```
1. Campaign sync
2. Campaign performance sync  ← Lưu DB trước
3. Shop-level sync  ← Có thể fallback về campaign data
```

---

## 🛠️ Solution

**Đổi thứ tự sync trong `apishopee-ads-sync/index.ts`:**

```diff
- Step 0: Sync shop-level (BEFORE campaign) ❌
  Step 1: Sync campaigns ✅
  Step 2: Sync campaign daily ✅
  Step 3: Sync campaign hourly ✅
+ Step 4: Sync shop-level (AFTER campaign) ✅
```

---

## 📝 Files Changed

1. `supabase/functions/apishopee-ads-sync/index.ts`
   - Đổi thứ tự: campaign → shop (lines 1160-1200)

2. `docs/ads-sync-auto-fix.md`
   - Phân tích chi tiết root cause

3. `scripts/test-ads-sync-fix.ts`
   - Test script verify fix

---

## ✅ How to Verify

### 1. Deploy Edge Function
```bash
cd supabase
npx supabase functions deploy apishopee-ads-sync
```

### 2. Run Test Script (Optional)
```bash
npx ts-node scripts/test-ads-sync-fix.ts
```

### 3. Wait for Next Cron Run (15 min)
Check dashboard → verify data correct

### 4. Manual Sync Test
Click button "Đồng bộ từ Shopee" → should be same as auto sync

---

## 🎯 Expected Result

**Before:**
- Auto sync: `broad_item_sold = 0` ❌
- Manual sync: `broad_item_sold = 13` ✅
- **Inconsistent!**

**After:**
- Auto sync: `broad_item_sold = 13` ✅
- Manual sync: `broad_item_sold = 13` ✅
- **Consistent!** 🎉

---

## 📞 Contact

Issues? Check:
- [Full Analysis](./ads-sync-auto-fix.md)
- Logs: `npx supabase functions logs apishopee-ads-sync`

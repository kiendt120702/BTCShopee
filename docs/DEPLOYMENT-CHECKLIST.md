# 🚀 Deployment Checklist - Ads Auto Update

**Date:** 20/01/2026
**Priority:** HIGH

---

## 📋 Tasks

### ✅ 1. Fix Auto Sync Order (COMPLETED)

**Issue:** Auto sync lưu dữ liệu sai (clicks, GMV, item_sold = 0)

**Fix:** Đổi thứ tự sync: campaign → shop-level

**Files:**
- ✅ `supabase/functions/apishopee-ads-sync/index.ts`
- ✅ Deployed Edge Function

**Docs:**
- [Full Analysis](./ads-sync-auto-fix.md)
- [Summary](./ads-sync-fix-summary.md)

---

### ✅ 2. Enable Realtime Auto-Update (COMPLETED)

**Issue:** UI không tự động cập nhật sau khi auto sync → user phải F5

**Fix:** Supabase Realtime subscription

**Files:**
- ✅ `src/hooks/useAdsData.ts` - Added subscriptions
- ✅ `supabase/migrations/056_enable_realtime_for_ads_campaign_data.sql`

**Docs:**
- [Realtime Guide](./ads-realtime-auto-update.md)

---

### ⚠️ 3. Database Migration (PENDING)

**CRITICAL:** Phải chạy migration trên production!

**Steps:**

1. **Mở Supabase Dashboard:**
   - URL: https://supabase.com/dashboard/project/ohlwhhxhgpotlwfgqhhu
   - Login với account

2. **SQL Editor:**
   - Sidebar → SQL Editor
   - New query

3. **Run Migration:**
   ```sql
   -- Enable REPLICA IDENTITY FULL for campaign data table
   ALTER TABLE apishopee_ads_campaign_data REPLICA IDENTITY FULL;

   -- Verify Realtime is enabled for all Ads tables
   SELECT
     schemaname,
     tablename,
     CASE
       WHEN relreplident = 'f' THEN 'FULL (Realtime enabled)'
       WHEN relreplident = 'd' THEN 'DEFAULT (Realtime disabled)'
       ELSE 'UNKNOWN'
     END as replica_identity
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_tables t ON t.tablename = c.relname AND t.schemaname = n.nspname
   WHERE tablename IN (
     'apishopee_ads_campaign_data',
     'apishopee_ads_performance_daily',
     'apishopee_ads_performance_hourly',
     'apishopee_ads_shop_performance_daily',
     'apishopee_ads_shop_performance_hourly',
     'apishopee_ads_sync_status'
   )
   ORDER BY tablename;
   ```

4. **Verify Result:**
   - All 6 tables should show: `FULL (Realtime enabled)` ✅
   - If any shows `DEFAULT` → run migration again

**Alternative:** Copy-paste from `scripts/enable-ads-realtime.sql`

---

## 🧪 Testing

### Test 1: Auto Sync → UI Update

1. Mở dashboard Ads page
2. Đợi cron job chạy (next 15-min interval)
   - Hoặc trigger manual: click "Đồng bộ từ Shopee"
3. **Expected:** UI tự động cập nhật WITHOUT F5
4. **Check Console:** Should see realtime logs

### Test 2: Multi-Tab Sync

1. Mở 2 tabs cùng Ads page
2. Tab A: Click "Đồng bộ từ Shopee"
3. **Expected:** Tab B tự động cập nhật
4. **Result:** ✅ PASS / ❌ FAIL

### Test 3: Browser Console Logs

Press F12 → Console, should see:
```
[useAdsData] Realtime subscription active for shop 123456
[useAdsData] Daily performance changed: UPDATE
[useAdsData] Shop-level daily changed: UPDATE
```

---

## ⚠️ Rollback Plan

Nếu có vấn đề:

### Option 1: Disable Realtime subscription (code-level)

Comment out subscriptions trong `src/hooks/useAdsData.ts`:

```typescript
// useEffect(() => {
//   const channel = supabase.channel(...)
//   ...
// }, [...]);
```

### Option 2: Revert migration (DB-level)

```sql
ALTER TABLE apishopee_ads_campaign_data REPLICA IDENTITY DEFAULT;
```

---

## 📊 Monitoring

### Metrics to watch:

1. **Network traffic:**
   - WebSocket connection should be stable
   - ~5-10 KB/s idle, ~1-2 KB per event

2. **Memory usage:**
   - No memory leaks
   - Use Chrome DevTools → Memory tab

3. **User feedback:**
   - "Dashboard cập nhật tự động chưa?"
   - "Có cần F5 không?"

---

## ✅ Definition of Done

- [x] Auto sync lưu dữ liệu ĐÚNG (campaign → shop order)
- [x] Edge Function deployed
- [ ] Database migration applied on production
- [ ] UI auto-updates when cron job runs (test 15-min cycle)
- [ ] Multi-tab scenario works
- [ ] Console logs show Realtime events
- [ ] No performance issues (memory/network)
- [ ] User confirms: "Không cần F5 nữa!"

---

## 📞 Contact

Issues?
- Check: [Troubleshooting Guide](./ads-realtime-auto-update.md#troubleshooting)
- Logs: Browser Console (F12)
- Supabase: Dashboard → Logs

---

**Status:** 🟡 PENDING DATABASE MIGRATION

**Next Action:** Run migration SQL on Supabase Dashboard (see Step 3 above)

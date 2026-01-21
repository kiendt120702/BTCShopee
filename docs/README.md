# 📚 BetacomShopeeAPI - Documentation

Tài liệu hệ thống đồng bộ dữ liệu Shopee.

---

## 📂 Cấu Trúc Tài Liệu

### 🔵 Ads Sync System

#### 1. [ads-sync-logic-explained.md](./ads-sync-logic-explained.md)
**Chi tiết logic hoạt động & phân tích vấn đề**

- ✅ Logic đồng bộ thủ công (button)
- ✅ Logic đồng bộ tự động (cronjob + queue)
- ✅ Phân tích nguyên nhân shops bị stuck
- ✅ So sánh 2 cơ chế sync
- ✅ Giải pháp đã thực hiện

**Đọc file này nếu bạn muốn**:
- Hiểu cách hệ thống hoạt động
- Troubleshoot vấn đề sync
- Tìm nguyên nhân shops bị stuck

#### 2. [ads-sync-optimization-guide.md](./ads-sync-optimization-guide.md)
**Hướng dẫn sử dụng & triển khai tối ưu**

- ✅ Các tối ưu đã thực hiện
- ✅ Hướng dẫn deploy
- ✅ Monitoring & troubleshooting
- ✅ Configuration & tuning
- ✅ Emergency procedures

**Đọc file này nếu bạn muốn**:
- Deploy tối ưu lên production
- Monitor hệ thống hàng ngày
- Tune performance
- Xử lý sự cố

#### 3. [DEPLOYMENT-SUMMARY.md](./DEPLOYMENT-SUMMARY.md)
**Tóm tắt deployment & kết quả**

- ✅ Kết quả deployment
- ✅ Test results
- ✅ Performance benchmarks
- ✅ Success criteria
- ✅ Rollback plan

**Đọc file này nếu bạn muốn**:
- Xem kết quả deployment nhanh
- Verify deployment thành công
- Hiểu performance improvements

---

### 🟢 Reviews & Auto Reply System

#### [auto-reply-quickstart.md](./auto-reply-quickstart.md)
Quick start guide cho hệ thống tự động trả lời đánh giá.

#### [auto-reply-system.md](./auto-reply-system.md)
Chi tiết hệ thống auto-reply.

#### [reviews-sync-mechanism.md](./reviews-sync-mechanism.md)
Cơ chế đồng bộ reviews từ Shopee.

#### [reviews-sync-fixes.md](./reviews-sync-fixes.md)
Các fix đã thực hiện cho reviews sync.

---

### 🟡 Legacy Documents

- [ads-sync-queue-system.md](./ads-sync-queue-system.md) - Queue system cũ (superseded by optimization guide)
- [ads-sync-scalable-solution.md](./ads-sync-scalable-solution.md) - Solution cũ
- [README-ADS-SYNC-UPGRADE.md](./README-ADS-SYNC-UPGRADE.md) - Upgrade notes
- [URGENT-ENV-UPDATE-REQUIRED.md](./URGENT-ENV-UPDATE-REQUIRED.md) - Env update notes

---

## 🚀 Quick Links

### For Developers

**Hiểu hệ thống**:
1. [ads-sync-logic-explained.md](./ads-sync-logic-explained.md) - Đọc đầu tiên
2. [auto-reply-system.md](./auto-reply-system.md) - Auto-reply system
3. [reviews-sync-mechanism.md](./reviews-sync-mechanism.md) - Reviews sync

**Deployment & Operations**:
1. [ads-sync-optimization-guide.md](./ads-sync-optimization-guide.md) - Operations guide
2. [DEPLOYMENT-SUMMARY.md](./DEPLOYMENT-SUMMARY.md) - Latest deployment
3. [auto-reply-quickstart.md](./auto-reply-quickstart.md) - Auto-reply quickstart

### For DevOps

**Daily Monitoring**:
```sql
-- Check stuck shops
SELECT * FROM v_stuck_ads_sync;

-- Check queue health
SELECT * FROM v_ads_sync_queue_health;

-- Check cronjobs
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE '%ads%' OR jobname LIKE '%review%';
```

**Emergency Procedures**:
- See [ads-sync-optimization-guide.md#emergency-procedures](./ads-sync-optimization-guide.md#-emergency-procedures)

### For Product Managers

**System Status**:
- [DEPLOYMENT-SUMMARY.md](./DEPLOYMENT-SUMMARY.md) - Latest status
- Performance: 0% timeout rate ✅
- Auto recovery: <10 minutes ✅

---

## 📊 System Overview

### Components

```
┌─────────────────────────────────────────┐
│         BetacomShopeeAPI                │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Ads Sync System               │  │
│  │  - Manual sync (button)          │  │
│  │  - Auto sync (cronjob + queue)   │  │
│  │  - Dynamic batch size            │  │
│  │  - Auto cleanup stuck shops      │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Reviews Sync System            │  │
│  │  - Incremental sync              │  │
│  │  - Auto reply (cronjob)          │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Monitoring & Analytics         │  │
│  │  - Stuck shops detection         │  │
│  │  - Queue health monitoring       │  │
│  │  - Performance metrics           │  │
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

### Technologies

- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Frontend**: React + TypeScript
- **Scheduling**: pg_cron
- **API**: Shopee Partner API v2
- **Realtime**: Supabase Realtime

---

## 🔧 Configuration Files

### Database Migrations
- `supabase/migrations/058_implement_queue_based_ads_sync.sql` - Queue system
- `supabase/migrations/059_add_stuck_shops_cleanup.sql` - Auto cleanup ✅
- `supabase/migrations/060_optimize_queue_processor.sql` - Queue optimization

### Edge Functions
- `supabase/functions/apishopee-ads-sync/` - Ads sync worker ✅
- `supabase/functions/apishopee-reviews-sync/` - Reviews sync worker
- `supabase/functions/apishopee-auto-reply/` - Auto-reply worker

### Frontend Hooks
- `src/hooks/useAdsData.ts` - Ads data with Realtime ✅
- `src/hooks/useRealtimeData.ts` - Realtime subscriptions ✅
- `src/hooks/useAutoReply.ts` - Auto-reply management

---

## 📈 Recent Updates

### 2026-01-20: Ads Sync Optimization ✅

**Changes**:
- ✅ Auto cleanup stuck shops (every 10 min)
- ✅ Dynamic batch size (30-50 based on campaigns)
- ✅ Split sync strategy for large shops (>500 campaigns)
- ✅ Monitoring views (v_stuck_ads_sync, v_ads_sync_queue_health)
- ✅ Edge Function v21 deployed

**Results**:
- 0% timeout rate (from 40%)
- Auto recovery from stuck state
- No manual intervention needed

**Docs**:
- [ads-sync-logic-explained.md](./ads-sync-logic-explained.md)
- [ads-sync-optimization-guide.md](./ads-sync-optimization-guide.md)
- [DEPLOYMENT-SUMMARY.md](./DEPLOYMENT-SUMMARY.md)

---

## 🆘 Troubleshooting

### Shops Stuck in Sync?
1. Check: `SELECT * FROM v_stuck_ads_sync;`
2. Auto cleanup runs every 10 minutes
3. Manual fix: `UPDATE apishopee_ads_sync_status SET is_syncing = false WHERE shop_id = <id>;`

### Reviews Not Syncing?
1. Check: `SELECT * FROM apishopee_reviews_sync_status WHERE shop_id = <id>;`
2. See: [reviews-sync-fixes.md](./reviews-sync-fixes.md)

### Auto Reply Not Working?
1. Check: `SELECT * FROM apishopee_auto_reply_config WHERE shop_id = <id>;`
2. See: [auto-reply-quickstart.md](./auto-reply-quickstart.md)

---

## 📞 Support

**For technical issues**:
- Check relevant documentation first
- Review Edge Function logs: `npx supabase functions logs <function-name>`
- Check database logs: `SELECT * FROM pg_stat_statements;`

**For questions**:
- Contact DevOps team
- Review system architecture in docs

---

## 🔗 External Resources

- [Shopee Open API Documentation](https://open.shopee.com/documents)
- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL pg_cron](https://github.com/citusdata/pg_cron)

---

*Last updated: 2026-01-20*
*Maintained by: Development Team*

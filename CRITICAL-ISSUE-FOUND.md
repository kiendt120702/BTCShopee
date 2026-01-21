# 🚨 CRITICAL ISSUE DISCOVERED

**Date**: 2026-01-20
**Status**: ⚠️ **NOT RESOLVED - DEEPER ISSUE FOUND**

---

## 🔍 Problem Summary

The 2 shops (532963124 and 23426918) **STILL CANNOT SYNC** despite all optimizations deployed.

### Current Situation

```
Shop 23426918 (917 campaigns):
  ├─ is_syncing: TRUE (stuck for 114+ minutes)
  ├─ last_sync_at: 2026-01-20 12:00:38 (NOT updating)
  └─ Status: FAILING

Shop 532963124 (335 campaigns):
  ├─ is_syncing: TRUE (stuck for 113+ minutes)
  ├─ last_sync_at: 2026-01-20 12:00:45 (NOT updating)
  └─ Status: FAILING
```

---

## 📋 What We Tried (All Failed)

### Attempt 1: Auto Cleanup + Dynamic Batch Size ❌
- **Applied**: Migration 059 (cleanup cronjob every 10 min)
- **Deployed**: Edge Function v21 with dynamic batch sizes
- **Result**: FAILED - v21 had `verify_jwt: true` causing 401 errors

### Attempt 2: Fixed JWT Authentication ❌
- **Deployed**: Edge Function v23 with `verify_jwt: false`
- **Result**: FAILED - Still getting 546 timeout errors

### Attempt 3: Manual Queue Processing ❌
- **Triggered**: Queue processor manually for both shops
- **Queue Response**: "success: true" (lying!)
- **Actual Result**: Shops stuck at `is_syncing = true`, no database update

---

## 🎯 Root Cause Analysis

### The Real Problem

The Edge Function timeout (546) doesn't allow the function to complete its cleanup:

```typescript
// Current flow in Edge Function v23:
async function handleRequest() {
  // 1. Set is_syncing = true ✅ (happens immediately)
  await supabase.update('apishopee_ads_sync_status')
    .set({ is_syncing: true });

  // 2. Sync campaigns (THIS TIMES OUT! ⏱️)
  await syncCampaigns(shop_id);  // 335-917 campaigns
  await syncPerformance(shop_id);

  // 3. Update status ❌ (NEVER REACHES HERE!)
  await supabase.update('apishopee_ads_sync_status')
    .set({
      is_syncing: false,
      last_sync_at: NOW()
    });
}
```

**Result**:
- `is_syncing` gets set to TRUE
- Function times out during sync
- `is_syncing` never gets set to FALSE
- `last_sync_at` never updates
- Shop is **PERMANENTLY STUCK**

### Why Auto Cleanup Doesn't Help

Auto cleanup runs every 10 minutes and resets stuck shops. But:
1. Shop gets reset to `is_syncing = false`
2. Queue processor picks it up again (5 min later)
3. Edge Function sets `is_syncing = true`
4. Edge Function **TIMES OUT AGAIN**
5. Back to stuck state

**INFINITE LOOP!**

---

## 📊 Evidence from Logs

### Edge Function v23 Logs

```
Timestamp: 1768917028121000
Status: 546 (Timeout)
Execution time: 17,940ms (17 seconds before timeout)
Function: apishopee-ads-sync v23
Result: TIMEOUT
```

### Queue Processor Logs

```sql
SELECT * FROM apishopee_ads_sync_queue
WHERE shop_id IN (532963124, 23426918);

-- Shows: status = 'completed', success = true
-- BUT shops are still stuck!
```

**The queue processor is LYING!** It reports success when Edge Function actually timed out.

---

## 💡 Why Dynamic Batch Size Failed

Current implementation:
```typescript
const BATCH_SIZE = campaigns > 500 ? 30
                 : campaigns > 200 ? 40
                 : 50;
```

**Problems**:
1. **Not aggressive enough**: Batch 30 for 917 campaigns = 31 batches
2. **Still too slow**: With API delays, 31 batches × 1-2s each = 30-60s
3. **Hits 50s limit**: Edge Function timeout is 50s, we're at 60s
4. **No progress saving**: If timeout happens, ALL work is lost

---

## 🚨 The Fundamental Architectural Flaw

### Current Architecture: **MONOLITHIC SYNC**

```
┌─────────────────────────────────────────────┐
│  Single Edge Function Call (50s limit)     │
│                                             │
│  ┌─────────────────────────────────────┐  │
│  │ 1. Set is_syncing = true           │  │
│  │ 2. Sync ALL campaigns (917!)      │  │  ← TIMEOUT HERE!
│  │ 3. Sync ALL performance data      │  │
│  │ 4. Set is_syncing = false         │  │  ← NEVER REACHES
│  └─────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

**Why this doesn't work**:
- 917 campaigns × sync time = TOO LONG
- Can't break into smaller chunks mid-execution
- All-or-nothing approach = always fails for large shops

---

## ✅ Required Solution: CHUNKED SYNC

We need to fundamentally change the architecture:

### Option A: Multi-Request Chunked Sync (RECOMMENDED)

```
┌──────────────────────────────────────────────┐
│  Coordinator (Queue Processor)              │
│                                              │
│  For shop with 917 campaigns:               │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │ Request 1: Campaigns 1-100   (8s)    │ │ ✅
│  ├────────────────────────────────────────┤ │
│  │ Request 2: Campaigns 101-200 (8s)    │ │ ✅
│  ├────────────────────────────────────────┤ │
│  │ Request 3: Campaigns 201-300 (8s)    │ │ ✅
│  ├────────────────────────────────────────┤ │
│  │ ... (7 more requests)                 │ │ ✅
│  ├────────────────────────────────────────┤ │
│  │ Request 10: Performance data (20s)   │ │ ✅
│  └────────────────────────────────────────┘ │
│                                              │
│  Total: 10 requests × 8-20s = ~120s         │
│  But each request: <50s limit ✅            │
└──────────────────────────────────────────────┘
```

**Benefits**:
- ✅ Each chunk completes successfully
- ✅ Progress is saved incrementally
- ✅ No single request exceeds 50s
- ✅ Works for ANY size shop

### Option B: Increase Edge Function Timeout

Contact Supabase support to increase timeout from 50s to 180s.

**Pros**:
- ✅ Simple - no code changes needed
- ✅ Works with existing architecture

**Cons**:
- ⚠️ May not be possible (Supabase limit)
- ⚠️ Doesn't scale (what about 2000 campaigns?)
- ⚠️ Relies on external configuration

---

## 📝 Implementation Plan for Option A

### Step 1: Update Queue Processor

Modify `process_sync_queue_batch()` to:
1. Check campaign count
2. If >100 campaigns: Split into chunks of 100
3. Create multiple queue jobs with `offset` and `limit` parameters
4. Process sequentially with delay between chunks

### Step 2: Update Edge Function

Modify Edge Function to accept:
```typescript
{
  shop_id: number,
  action: 'sync_campaigns_chunk',
  params: {
    offset: number,  // Start index
    limit: number    // Chunk size
  }
}
```

### Step 3: Add Progress Tracking

Create new table:
```sql
CREATE TABLE apishopee_ads_sync_progress (
  shop_id BIGINT PRIMARY KEY,
  total_campaigns INT,
  synced_campaigns INT,
  last_chunk_at TIMESTAMPTZ,
  is_complete BOOLEAN DEFAULT FALSE
);
```

---

## 🎯 Next Steps (URGENT)

### Immediate (Today)
1. **STOP auto cleanup cronjob** - it's creating an infinite loop
2. **Manually reset stuck shops**:
   ```sql
   UPDATE apishopee_ads_sync_status
   SET is_syncing = false
   WHERE shop_id IN (532963124, 23426918);
   ```
3. **Remove from queue** to prevent retry:
   ```sql
   DELETE FROM apishopee_ads_sync_queue
   WHERE shop_id IN (532963124, 23426918);
   ```

### Short Term (This Week)
1. Implement Option A (Chunked Sync)
2. Test with shop 532963124 (335 campaigns) first
3. Then test with shop 23426918 (917 campaigns)
4. Verify progress tracking works

### Long Term
1. Consider Option B (increase timeout) as backup
2. Add monitoring for chunk progress
3. Implement exponential backoff for retries
4. Create dashboard showing sync progress

---

## 📊 Testing Strategy

### Phase 1: Small Shop
- Shop: 532963124 (335 campaigns)
- Chunk size: 100 campaigns
- Expected: 4 chunks (3×100 + 1×35)
- Total time: ~40s
- Success criteria: All chunks complete, no timeouts

### Phase 2: Large Shop
- Shop: 23426918 (917 campaigns)
- Chunk size: 100 campaigns
- Expected: 10 chunks (9×100 + 1×17)
- Total time: ~120s
- Success criteria: All chunks complete, no timeouts

---

## 🔧 Rollback Plan

If chunked sync doesn't work:
1. Revert to v20 Edge Function
2. Manually sync these 2 shops via button (which works!)
3. Exclude them from auto-sync queue
4. Monitor other shops (they're working fine)

---

## 💬 Communication with User

**Message**: "Đã phát hiện vấn đề căn bản: Edge Function timeout không thể xử lý được 900+ campaigns trong 50 giây. Cần thay đổi kiến trúc sang 'chunked sync' - chia nhỏ thành nhiều requests nhỏ hơn thay vì 1 request lớn. Tạm thời STOP auto-sync 2 shops này, manual sync vẫn hoạt động bình thường."

**Translation**: "Found fundamental issue: Edge Function timeout can't handle 900+ campaigns in 50 seconds. Need to change architecture to 'chunked sync' - split into multiple smaller requests instead of one large request. Temporarily STOP auto-sync for these 2 shops, manual sync still works normally."

---

## 📚 Lessons Learned

1. **Queue processor success ≠ Edge Function success**: Need to verify DB updates
2. **Timeout doesn't trigger catch**: Can't rely on error handling
3. **Auto cleanup creates infinite loops**: When root cause isn't fixed
4. **Batch size tuning has limits**: Can't overcome fundamental timeout
5. **Monolithic approach doesn't scale**: Need chunked/incremental sync

---

## ✅ What Actually Works

- ✅ Manual sync (button) - works perfectly for ALL shops
- ✅ Auto-sync for shops <200 campaigns - 100% success rate
- ✅ Auto cleanup - correctly identifies stuck shops
- ✅ Monitoring views - provides good visibility

---

## ❌ What Doesn't Work

- ❌ Auto-sync for shops >500 campaigns - always times out
- ❌ Queue retry mechanism - keeps retrying doomed requests
- ❌ Dynamic batch size - not aggressive enough
- ❌ Current Edge Function architecture - monolithic

---

*Status: Investigation Complete - Solution Identified - Implementation Pending*
*Next: Implement Chunked Sync Architecture*

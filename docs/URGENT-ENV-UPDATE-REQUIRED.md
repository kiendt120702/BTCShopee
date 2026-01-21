# ⚠️ URGENT: Environment Variable Update Required

## Issue

Frontend đang connect tới Supabase project **CŨ**:
```
ohlwwhxhgpotlwfgqhhu.supabase.co
```

Nhưng hệ thống Auto-Reply đã được deploy vào project **MỚI**:
```
tjzeskxkqvjbowikzqpv.supabase.co
```

## Fix Ngay

### Option 1: Update Frontend để dùng project MỚI (Recommended)

Cập nhật file `.env.local`:

```bash
# OLD
VITE_SUPABASE_URL=https://ohlwhhxhgpotlwfgqhhu.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9obHdoaHhoZ3BvdGx3ZmdxaGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODU2MTcsImV4cCI6MjA4Mzc2MTYxN30.-fs_1Q_5kVQJdLBPWNoWJMIfch8i4jcupRu7tWpsaEU

# NEW
VITE_SUPABASE_URL=https://tjzeskxkqvjbowikzqpv.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqemVza3hrcXZqYm93aWt6cXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMjg0MjcsImV4cCI6MjA2NTkwNDQyN30.T-AV2KidsjI9c1Y7ue4Rk8PxSbG_ZImh7J0uCAz3qGk
```

Sau đó **RESTART** dev server:
```bash
npm run dev
```

### Option 2: Deploy Auto-Reply vào project CŨ

Nếu bạn muốn giữ project cũ, cần:

1. Switch Supabase CLI tới project cũ
2. Re-run tất cả deployment commands
3. Apply migrations và deploy edge function

**Nhưng không khuyến khích** vì project mới (`tjzeskxkqvjbowikzqpv`) đã có đầy đủ data.

## Errors Hiện Tại

Khi dùng project cũ, bạn sẽ thấy errors:

```
404: apishopee_auto_reply_config not found
404: apishopee_auto_reply_logs not found
404: apishopee_auto_reply_job_status not found
```

Vì các bảng này chỉ có ở project MỚI.

## Recommended Action

✅ **Update `.env.local` ngay bây giờ** và restart server.

Sau đó test lại trang `/reviews/auto-reply` - mọi thứ sẽ hoạt động!

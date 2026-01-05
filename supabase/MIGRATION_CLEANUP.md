# Migration Cleanup Guide

## Vấn đề hiện tại

Thư mục migrations có một số vấn đề:
1. **Duplicate migration numbers**: 
   - `012_add_user_shops_constraint.sql` và `012_cleanup_unused_tables.sql`
   - `017_consolidate_schema.sql`, `017_consolidate_schema_rollback.sql`, `017_fix_shops_expire_in.sql`
   - `024_fix_partner_accounts_policies.sql` và `024_integrate_partner_accounts.sql`

2. **Rollback files không cần thiết**: `017_consolidate_schema_rollback.sql`

## Khuyến nghị

### Option 1: Giữ nguyên (Nếu đã deploy production)
Nếu các migrations đã được apply trên production, KHÔNG nên rename hoặc xóa files.
Supabase tracks migrations bằng filename, thay đổi sẽ gây lỗi.

### Option 2: Consolidate (Chỉ cho development/staging)

Nếu chưa deploy production, có thể:

1. **Reset local database**:
```bash
supabase db reset
```

2. **Tạo migration mới consolidate tất cả**:
```bash
supabase migration new consolidated_schema
```

3. **Copy schema từ production** (nếu có):
```bash
supabase db dump -f supabase/migrations/001_consolidated_schema.sql
```

4. **Xóa các migrations cũ** và chỉ giữ file consolidated

### Migrations mới đã thêm

Các migrations sau đã được tạo để fix security issues:

- `033_fix_security_issues.sql` - Fix SECURITY DEFINER views, tạo extensions schema
- `034_fix_remaining_functions_search_path.sql` - Fix search_path cho các functions
- `035_auth_security_settings.sql` - Documentation cho auth settings

## Cách apply migrations

```bash
# Local development
supabase db reset

# Production (cẩn thận!)
supabase db push
```

## Lưu ý quan trọng

1. **LUÔN backup database trước khi apply migrations**
2. **Test trên staging trước khi apply production**
3. **Leaked Password Protection** cần enable trong Dashboard:
   - Supabase Dashboard > Authentication > Settings > Enable Leaked Password Protection
4. **OTP Expiry** cần configure trong Dashboard nếu config.toml không work:
   - Dashboard > Authentication > Email > OTP Expiry = 300 (5 minutes)

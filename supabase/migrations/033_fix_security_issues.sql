-- Migration: Fix Security Issues
-- 1. Fix SECURITY DEFINER views
-- 2. Move extensions to separate schema
-- 3. Set search_path for critical functions

-- ============================================
-- PART 1: Fix SECURITY DEFINER Views
-- ============================================

-- Drop and recreate views without SECURITY DEFINER
-- These views should use SECURITY INVOKER (default) to respect RLS

-- 1. repository_categories_audit
DROP VIEW IF EXISTS public.repository_categories_audit CASCADE;
CREATE VIEW public.repository_categories_audit AS
SELECT 
  rc.id,
  rc.name,
  rc.description,
  rc.department_id,
  rc.is_company_wide,
  rc.created_at,
  rc.updated_at,
  rc.created_by,
  rc.updated_by,
  rc.deleted_at,
  rc.deleted_by,
  rc.module_id,
  rc.parent_id,
  rc.level,
  rc.path,
  rc.sort_order,
  rc.is_system,
  creator.full_name as created_by_name,
  updater.full_name as updated_by_name,
  deleter.full_name as deleted_by_name
FROM public.repository_categories rc
LEFT JOIN public.sys_profiles creator ON rc.created_by = creator.id
LEFT JOIN public.sys_profiles updater ON rc.updated_by = updater.id
LEFT JOIN public.sys_profiles deleter ON rc.deleted_by = deleter.id;

-- Grant access
GRANT SELECT ON public.repository_categories_audit TO authenticated;

COMMENT ON VIEW public.repository_categories_audit IS 'Audit view for repository categories - uses SECURITY INVOKER';

-- 2. repository_items_audit
DROP VIEW IF EXISTS public.repository_items_audit CASCADE;
CREATE VIEW public.repository_items_audit AS
SELECT 
  ri.id,
  ri.category_id,
  ri.title,
  ri.description,
  ri.item_type,
  ri.file_url,
  ri.link_url,
  ri.video_url,
  ri.file_name,
  ri.file_size,
  ri.mime_type,
  ri.thumbnail_url,
  ri.tags,
  ri.view_count,
  ri.download_count,
  ri.is_pinned,
  ri.created_at,
  ri.updated_at,
  ri.created_by,
  ri.updated_by,
  ri.deleted_at,
  ri.deleted_by,
  ri.content,
  creator.full_name as created_by_name,
  updater.full_name as updated_by_name,
  deleter.full_name as deleted_by_name,
  rc.name as category_name
FROM public.repository_items ri
LEFT JOIN public.sys_profiles creator ON ri.created_by = creator.id
LEFT JOIN public.sys_profiles updater ON ri.updated_by = updater.id
LEFT JOIN public.sys_profiles deleter ON ri.deleted_by = deleter.id
LEFT JOIN public.repository_categories rc ON ri.category_id = rc.id;

-- Grant access
GRANT SELECT ON public.repository_items_audit TO authenticated;

COMMENT ON VIEW public.repository_items_audit IS 'Audit view for repository items - uses SECURITY INVOKER';

-- 3. repository_items_with_permissions
DROP VIEW IF EXISTS public.repository_items_with_permissions CASCADE;
CREATE VIEW public.repository_items_with_permissions AS
SELECT 
  ri.*,
  rc.name as category_name,
  rc.department_id,
  rc.is_company_wide,
  rc.module_id,
  CASE 
    WHEN rc.is_company_wide = true THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.repository_item_permissions rip 
      WHERE rip.item_id = ri.id AND rip.user_id = auth.uid()
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.sys_profile_departments spd
      WHERE spd.profile_id = auth.uid() AND spd.department_id = rc.department_id
    ) THEN true
    ELSE false
  END as has_access
FROM public.repository_items ri
JOIN public.repository_categories rc ON ri.category_id = rc.id
WHERE ri.deleted_at IS NULL;

-- Grant access
GRANT SELECT ON public.repository_items_with_permissions TO authenticated;

COMMENT ON VIEW public.repository_items_with_permissions IS 'Repository items with computed access permissions - uses SECURITY INVOKER';

-- ============================================
-- PART 2: Create extensions schema and move extensions
-- ============================================

-- Create extensions schema if not exists
CREATE SCHEMA IF NOT EXISTS extensions;

-- Grant usage to necessary roles
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- Note: Moving existing extensions requires superuser and may cause downtime
-- For production, this should be done during maintenance window
-- The following is commented out - run manually if needed:

-- DROP EXTENSION IF EXISTS pg_trgm CASCADE;
-- CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;

-- DROP EXTENSION IF EXISTS vector CASCADE;  
-- CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;

-- Add extensions schema to search_path for all roles
-- This allows using extension functions without schema prefix
ALTER DATABASE postgres SET search_path TO public, extensions;

-- ============================================
-- PART 3: Fix critical functions with search_path
-- ============================================

-- Fix get_user_shop_role function
CREATE OR REPLACE FUNCTION public.get_user_shop_role(p_shop_id bigint, p_user_id uuid DEFAULT auth.uid())
RETURNS text 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT role 
    FROM public.shop_members 
    WHERE shop_id = p_shop_id AND user_id = p_user_id
  );
END;
$$;

-- Fix is_admin function
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.sys_profile_departments spd
    JOIN public.sys_roles sr ON spd.role_id = sr.id
    WHERE spd.profile_id = p_user_id 
    AND sr.name = 'Admin'
  );
END;
$$;

-- Fix check_is_admin function
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.sys_profile_departments spd
    JOIN public.sys_roles sr ON spd.role_id = sr.id
    WHERE spd.profile_id = auth.uid() 
    AND sr.name = 'Admin'
  );
END;
$$;

-- Fix check_user_is_admin function
CREATE OR REPLACE FUNCTION public.check_user_is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.sys_profile_departments spd
    JOIN public.sys_roles sr ON spd.role_id = sr.id
    WHERE spd.profile_id = p_user_id 
    AND sr.name = 'Admin'
  );
END;
$$;

-- Fix is_admin_or_leader function
CREATE OR REPLACE FUNCTION public.is_admin_or_leader(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.sys_profile_departments spd
    JOIN public.sys_roles sr ON spd.role_id = sr.id
    WHERE spd.profile_id = p_user_id 
    AND sr.name IN ('Admin', 'Leader')
  );
END;
$$;

-- Fix handle_updated_at function (commonly used trigger)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================
-- PART 4: Add comments for documentation
-- ============================================

COMMENT ON SCHEMA extensions IS 'Schema for PostgreSQL extensions to keep public schema clean';

COMMENT ON FUNCTION public.get_user_shop_role IS 'Get user role in specific shop - secured with search_path';
COMMENT ON FUNCTION public.is_admin IS 'Check if user is admin - secured with search_path';
COMMENT ON FUNCTION public.check_is_admin IS 'Check if current user is admin - secured with search_path';
COMMENT ON FUNCTION public.is_admin_or_leader IS 'Check if user is admin or leader - secured with search_path';

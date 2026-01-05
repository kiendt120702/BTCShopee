-- Migration: Fix remaining functions with search_path
-- This migration adds SET search_path = public to critical functions

-- ============================================
-- Authentication & Authorization Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.check_user_module_access(p_user_id uuid, p_module_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin
  IF public.is_admin(p_user_id) THEN
    RETURN true;
  END IF;
  
  -- Check direct enrollment
  IF EXISTS (
    SELECT 1 FROM public.edu_module_enrollments
    WHERE user_id = p_user_id AND module_id = p_module_id
  ) THEN
    RETURN true;
  END IF;
  
  -- Check department access
  IF EXISTS (
    SELECT 1 
    FROM public.edu_module_department_access mda
    JOIN public.sys_profile_departments spd ON mda.department_id = spd.department_id
    WHERE mda.module_id = p_module_id 
    AND spd.profile_id = p_user_id
    AND mda.is_active = true
  ) THEN
    RETURN true;
  END IF;
  
  -- Check individual access
  IF EXISTS (
    SELECT 1 FROM public.edu_module_individual_access
    WHERE module_id = p_module_id 
    AND user_id = p_user_id
    AND access_level = 'granted'
    AND is_active = true
  ) THEN
    RETURN true;
  END IF;
  
  -- Check if module is public
  IF EXISTS (
    SELECT 1 FROM public.edu_module_access_policies
    WHERE module_id = p_module_id AND access_type = 'public'
  ) THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_module_access(p_module_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.check_user_module_access(auth.uid(), p_module_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_user_enrolled_in_module(p_user_id uuid, p_module_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.edu_module_enrollments
    WHERE user_id = p_user_id AND module_id = p_module_id
  );
END;
$$;

-- ============================================
-- Learning Session Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.start_learning_session(p_lesson_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  -- Close any existing active sessions for this user/lesson
  UPDATE public.edu_learning_sessions
  SET is_active = false, ended_at = now()
  WHERE user_id = v_user_id AND lesson_id = p_lesson_id AND is_active = true;
  
  -- Create new session
  INSERT INTO public.edu_learning_sessions (user_id, lesson_id, is_active)
  VALUES (v_user_id, p_lesson_id, true)
  RETURNING id INTO v_session_id;
  
  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_learning_session(p_session_id uuid, p_seconds integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.edu_learning_sessions
  SET 
    total_seconds = total_seconds + p_seconds,
    last_activity_at = now(),
    updated_at = now()
  WHERE id = p_session_id AND user_id = auth.uid() AND is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_learning_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.edu_learning_sessions
  SET 
    is_active = false,
    ended_at = now(),
    updated_at = now()
  WHERE id = p_session_id AND user_id = auth.uid();
END;
$$;

-- ============================================
-- Lesson Progress Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.update_lesson_progress(
  p_lesson_id uuid,
  p_watch_time integer,
  p_position real,
  p_duration real
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  INSERT INTO public.edu_watch_progress (user_id, lesson_id, total_watch_time, last_position, video_duration)
  VALUES (v_user_id, p_lesson_id, p_watch_time, p_position, p_duration)
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    total_watch_time = GREATEST(edu_watch_progress.total_watch_time, EXCLUDED.total_watch_time),
    last_position = EXCLUDED.last_position,
    video_duration = COALESCE(EXCLUDED.video_duration, edu_watch_progress.video_duration),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_lesson_completed(p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  UPDATE public.edu_watch_progress
  SET 
    is_completed = true,
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
  WHERE user_id = v_user_id AND lesson_id = p_lesson_id;
END;
$$;

-- ============================================
-- Module Enrollment Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.enroll_in_module(p_module_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  -- Check if already enrolled
  SELECT id INTO v_enrollment_id
  FROM public.edu_module_enrollments
  WHERE user_id = v_user_id AND module_id = p_module_id;
  
  IF v_enrollment_id IS NOT NULL THEN
    RETURN v_enrollment_id;
  END IF;
  
  -- Check if user has access
  IF NOT public.check_user_module_access(v_user_id, p_module_id) THEN
    RAISE EXCEPTION 'User does not have access to this module';
  END IF;
  
  -- Create enrollment
  INSERT INTO public.edu_module_enrollments (user_id, module_id, access_source)
  VALUES (v_user_id, p_module_id, 'self_enroll')
  RETURNING id INTO v_enrollment_id;
  
  RETURN v_enrollment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unenroll_from_module(p_module_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.edu_module_enrollments
  WHERE user_id = auth.uid() AND module_id = p_module_id;
END;
$$;

-- ============================================
-- Repository Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.increment_repository_view_count(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.repository_items
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_repository_download_count(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.repository_items
  SET download_count = COALESCE(download_count, 0) + 1
  WHERE id = p_item_id;
END;
$$;

-- ============================================
-- Offline Schedule Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.register_for_schedule(p_schedule_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registration_id uuid;
  v_user_id uuid := auth.uid();
  v_current_count integer;
  v_max_participants integer;
BEGIN
  -- Get schedule info
  SELECT max_participants INTO v_max_participants
  FROM public.edu_offline_schedules
  WHERE id = p_schedule_id AND status = 'scheduled';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found or not available';
  END IF;
  
  -- Check current registration count
  SELECT COUNT(*) INTO v_current_count
  FROM public.edu_offline_registrations
  WHERE schedule_id = p_schedule_id AND attendance_status != 'cancelled';
  
  IF v_max_participants IS NOT NULL AND v_current_count >= v_max_participants THEN
    RAISE EXCEPTION 'Schedule is full';
  END IF;
  
  -- Check if already registered
  SELECT id INTO v_registration_id
  FROM public.edu_offline_registrations
  WHERE schedule_id = p_schedule_id AND user_id = v_user_id;
  
  IF v_registration_id IS NOT NULL THEN
    -- Reactivate if cancelled
    UPDATE public.edu_offline_registrations
    SET attendance_status = 'registered'
    WHERE id = v_registration_id AND attendance_status = 'cancelled';
    RETURN v_registration_id;
  END IF;
  
  -- Create registration
  INSERT INTO public.edu_offline_registrations (schedule_id, user_id, attendance_status)
  VALUES (p_schedule_id, v_user_id, 'registered')
  RETURNING id INTO v_registration_id;
  
  RETURN v_registration_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_schedule_registration(p_schedule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.edu_offline_registrations
  SET attendance_status = 'cancelled'
  WHERE schedule_id = p_schedule_id AND user_id = auth.uid();
END;
$$;

-- ============================================
-- Test Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.check_user_test_permission(p_user_id uuid, p_config_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin
  IF public.is_admin(p_user_id) THEN
    RETURN true;
  END IF;
  
  -- Check explicit permission
  IF EXISTS (
    SELECT 1 FROM public.edu_test_permissions
    WHERE config_id = p_config_id AND user_id = p_user_id
  ) THEN
    RETURN true;
  END IF;
  
  -- Check if user is enrolled in the module
  RETURN EXISTS (
    SELECT 1 
    FROM public.edu_test_configs tc
    JOIN public.edu_module_enrollments me ON tc.module_id = me.module_id
    WHERE tc.id = p_config_id AND me.user_id = p_user_id
  );
END;
$$;

-- ============================================
-- Announcement Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.toggle_announcement_pin(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.announcements
  SET is_pinned = NOT is_pinned, updated_at = now()
  WHERE id = p_announcement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_announcement_hide(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.announcements
  SET is_hidden = NOT is_hidden, updated_at = now()
  WHERE id = p_announcement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_announcement_permanently(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete related records first
  DELETE FROM public.announcement_attachments WHERE announcement_id = p_announcement_id;
  DELETE FROM public.announcement_confirmations WHERE announcement_id = p_announcement_id;
  DELETE FROM public.announcement_likes WHERE announcement_id = p_announcement_id;
  DELETE FROM public.sys_lark_notification_log WHERE announcement_id = p_announcement_id;
  
  -- Delete announcement
  DELETE FROM public.announcements WHERE id = p_announcement_id;
END;
$$;

-- ============================================
-- Grant permissions
-- ============================================

GRANT EXECUTE ON FUNCTION public.check_user_module_access TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_module_access TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_enrolled_in_module TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_learning_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_learning_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_learning_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lesson_progress TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_lesson_completed TO authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_in_module TO authenticated;
GRANT EXECUTE ON FUNCTION public.unenroll_from_module TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_repository_view_count TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_repository_download_count TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_schedule TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_schedule_registration TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_test_permission TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_announcement_pin TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_announcement_hide TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_announcement_permanently TO authenticated;

COMMENT ON MIGRATION IS 'Fix remaining functions with search_path for security';

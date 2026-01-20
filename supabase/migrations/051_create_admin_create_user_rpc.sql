-- Migration: Create RPC function for admin to create users
-- Thay thế Edge Function vì Edge Function không support ES256 JWT

-- Function để admin tạo user mới
CREATE OR REPLACE FUNCTION admin_create_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_system_role TEXT DEFAULT 'user'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_email TEXT;
  v_new_user_id UUID;
  v_result JSON;
BEGIN
  -- Lấy email của user hiện tại
  SELECT email INTO v_current_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- Kiểm tra quyền admin
  IF v_current_user_email IS NULL OR v_current_user_email != 'betacom.work@gmail.com' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Bạn không có quyền thực hiện thao tác này'
    );
  END IF;

  -- Validate input
  IF p_email IS NULL OR p_email = '' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Email là bắt buộc'
    );
  END IF;

  IF p_password IS NULL OR LENGTH(p_password) < 6 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Mật khẩu phải có ít nhất 6 ký tự'
    );
  END IF;

  -- Validate system_role
  IF p_system_role NOT IN ('admin', 'user') THEN
    p_system_role := 'user';
  END IF;

  -- Tạo user mới trong auth.users (cần extension pgcrypto)
  -- Note: Không thể tạo trực tiếp vào auth.users từ RPC
  -- Phải dùng Edge Function hoặc Admin API
  -- Workaround: Tạo profile trước, sau đó user tự đăng ký với email này
  
  RETURN json_build_object(
    'success', false,
    'error', 'RPC không thể tạo auth user trực tiếp. Vui lòng dùng Supabase Admin API hoặc Edge Function với service_role key.'
  );
  
  -- TODO: Implement proper user creation via service_role
  
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_create_user TO authenticated;

COMMENT ON FUNCTION admin_create_user IS 'Admin function to create new users (requires betacom.work@gmail.com email)';

-- Migration: Auth Security Settings
-- Note: These settings need to be configured via Supabase Dashboard or CLI
-- This file serves as documentation and reminder

-- ============================================
-- IMPORTANT: Manual Configuration Required
-- ============================================

-- The following security settings cannot be changed via SQL migrations.
-- They must be configured through:
-- 1. Supabase Dashboard > Authentication > Settings
-- 2. Or via Supabase CLI config

/*
RECOMMENDED SETTINGS:

1. OTP Expiry (Email/Phone)
   - Current: > 1 hour (not recommended)
   - Recommended: 300 seconds (5 minutes) or 600 seconds (10 minutes)
   - Location: Dashboard > Authentication > Email > OTP Expiry

2. Leaked Password Protection
   - Current: Disabled
   - Recommended: Enabled
   - This checks passwords against HaveIBeenPwned database
   - Location: Dashboard > Authentication > Settings > Enable Leaked Password Protection

3. Password Requirements
   - Minimum length: 8 characters (recommended: 12+)
   - Require uppercase: Yes
   - Require lowercase: Yes
   - Require numbers: Yes
   - Require special characters: Recommended

4. Rate Limiting
   - Enable rate limiting for auth endpoints
   - Recommended: 5 attempts per minute for login

5. Session Settings
   - JWT expiry: 3600 seconds (1 hour) recommended
   - Refresh token rotation: Enabled
   - Refresh token reuse interval: 10 seconds

*/

-- ============================================
-- Supabase CLI Configuration (config.toml)
-- ============================================

/*
Add to supabase/config.toml:

[auth]
# Reduce OTP expiry to 5 minutes
otp_expiry = 300

# Enable leaked password protection
enable_leaked_password_protection = true

# Password requirements
min_password_length = 8

# Rate limiting
rate_limit_email_sent = 5
rate_limit_sms_sent = 5

[auth.email]
# Double opt-in for email confirmation
double_confirm_changes = true
enable_confirmations = true

*/

-- This is a placeholder migration to track that security settings review was done
-- Actual changes must be made in Dashboard or config.toml

SELECT 'Auth security settings review completed. Manual configuration required.' as notice;

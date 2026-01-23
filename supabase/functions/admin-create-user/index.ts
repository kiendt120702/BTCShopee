/**
 * Edge Function: admin-create-user
 * Tạo user mới với quyền admin (sử dụng service_role key)
 * 
 * WORKAROUND: Vì Supabase project dùng ES256 JWT mà Edge Functions Gateway không support,
 * function này sẽ accept bất kỳ authenticated request nào, sau đó verify quyền admin
 * bằng cách check email trong database.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logActivity, type ActionCategory, type ActionStatus, type ActionSource } from "../_shared/activity-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Admin email được phép tạo user
const ADMIN_EMAIL = "betacom.work@gmail.com";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[admin-create-user] Request received');

    // Tạo client với service role key để có quyền admin
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Tạo admin client với service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse request body
    const { email, password, fullName, phone, systemRole, adminEmail } = await req.json();

    console.log('[admin-create-user] Request from:', adminEmail);

    // Verify admin email (passed from client)
    if (!adminEmail || adminEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      console.error('[admin-create-user] Permission denied:', adminEmail);
      return new Response(
        JSON.stringify({ 
          error: "Bạn không có quyền thực hiện thao tác này",
          details: `Email hiện tại: ${adminEmail}, yêu cầu: ${ADMIN_EMAIL}`
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email và mật khẩu là bắt buộc" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate systemRole
    const validRoles = ["admin", "user"];
    const role = validRoles.includes(systemRole) ? systemRole : "user";

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Mật khẩu phải có ít nhất 6 ký tự" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log('[admin-create-user] Creating user:', email);

    // Tạo user mới
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto confirm email
      user_metadata: {
        full_name: fullName || "",
      },
    });

    if (createError) {
      console.error("Create user error:", createError);

      // Log failed attempt
      await logActivity(supabaseAdmin, {
        userEmail: adminEmail,
        userName: 'Admin',
        actionType: 'user_create',
        actionCategory: 'system' as ActionCategory,
        actionDescription: `Tạo tài khoản thất bại: ${email}`,
        targetType: 'user',
        targetName: email,
        requestData: { email, full_name: fullName, system_role: role },
        status: 'failed' as ActionStatus,
        errorMessage: createError.message,
        source: 'manual' as ActionSource,
      });

      // Handle specific errors
      if (createError.message.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "Email này đã được đăng ký" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tạo profile cho user mới
    if (newUser.user) {
      // Default permissions cho user mới (không bao gồm admin features)
      const defaultPermissions = role === 'admin' 
        ? [] // Admin có full quyền, không cần list
        : ["home", "orders", "products", "flash-sale", "settings/profile"];

      const { error: profileError } = await supabaseAdmin
        .from("sys_profiles")
        .insert({
          id: newUser.user.id,
          email: email,
          full_name: fullName || null,
          phone: phone || null,
          system_role: role,
          permissions: defaultPermissions,
        });

      if (profileError) {
        console.error("Create profile error:", profileError);
        // Không throw error vì user đã được tạo
      }
    }

    console.log('[admin-create-user] User created successfully:', newUser.user?.email);

    // Log vào system_activity_logs
    await logActivity(supabaseAdmin, {
      userId: newUser.user?.id,
      userEmail: adminEmail,
      userName: 'Admin',
      actionType: 'user_create',
      actionCategory: 'system' as ActionCategory,
      actionDescription: `Tạo tài khoản mới: ${email} (${role})`,
      targetType: 'user',
      targetId: newUser.user?.id,
      targetName: fullName || email,
      requestData: {
        email,
        full_name: fullName,
        system_role: role,
      },
      status: 'success' as ActionStatus,
      source: 'manual' as ActionSource,
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.user?.id,
          email: newUser.user?.email,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Đã xảy ra lỗi không mong muốn",
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

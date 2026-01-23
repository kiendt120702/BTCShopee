/**
 * Supabase Edge Function: Shopee Ads Budget Scheduler
 * Tự động điều chỉnh ngân sách quảng cáo theo lịch
 *
 * Actions:
 * - create: Tạo cấu hình lịch ngân sách mới
 * - update: Cập nhật cấu hình
 * - delete: Xóa cấu hình
 * - list: Xem danh sách cấu hình
 * - logs: Xem lịch sử thay đổi
 * - process: Xử lý điều chỉnh ngân sách (gọi bởi cron mỗi giờ)
 * - run-now: Test chạy ngay một schedule
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logActivity, getShopInfo, type ActionCategory, type ActionStatus, type ActionSource } from '../_shared/activity-logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SHOPEE_HOST = 'https://partner.shopeemobile.com';

// HMAC-SHA256 using Web Crypto API
async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Lấy shop credentials từ database
async function getShopCredentials(supabase: ReturnType<typeof createClient>, shopId: number) {
  const { data: shop, error } = await supabase
    .from('apishopee_shops')
    .select('access_token, partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (error || !shop) {
    throw new Error(`Shop ${shopId} not found`);
  }

  return shop;
}

// Gọi Shopee API để thay đổi ngân sách
async function editCampaignBudget(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  campaignId: number,
  adType: 'auto' | 'manual',
  budget: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const shop = await getShopCredentials(supabase, shopId);
    const { access_token, partner_id, partner_key } = shop;

    if (!access_token || !partner_id || !partner_key) {
      return { success: false, error: 'Thiếu thông tin xác thực shop (access_token/partner_id/partner_key)' };
    }

    const apiPath = adType === 'manual'
      ? '/api/v2/ads/edit_manual_product_ads'
      : '/api/v2/ads/edit_auto_product_ads';

    const timestamp = Math.floor(Date.now() / 1000);
    const baseString = `${partner_id}${apiPath}${timestamp}${access_token}${shopId}`;
    const sign = await hmacSha256(partner_key, baseString);

    const queryParams = new URLSearchParams();
    queryParams.set('partner_id', partner_id.toString());
    queryParams.set('timestamp', timestamp.toString());
    queryParams.set('access_token', access_token);
    queryParams.set('shop_id', shopId.toString());
    queryParams.set('sign', sign);

    const url = `${SHOPEE_HOST}${apiPath}?${queryParams.toString()}`;

    const body = {
      reference_id: `scheduler-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      campaign_id: campaignId,
      edit_action: 'change_budget',
      budget: budget,
    };

    console.log(`[ads-scheduler] Editing campaign ${campaignId} (${adType}) budget to ${budget}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    console.log(`[ads-scheduler] Shopee API response:`, JSON.stringify(result));

    // Kiểm tra lỗi từ Shopee API
    if (result.error && result.error !== '' && result.error !== '-') {
      const errorCode = result.error;
      const errorMsg = result.message || result.error;
      
      // Map các error code phổ biến sang tiếng Việt
      const errorMessages: Record<string, string> = {
        'error_auth': 'Lỗi xác thực - Token hết hạn hoặc không hợp lệ',
        'error_param': 'Tham số không hợp lệ',
        'error_permission': 'Không có quyền thực hiện thao tác này',
        'error_server': 'Lỗi server Shopee',
        'error_not_found': 'Không tìm thấy chiến dịch',
        'ads.error_budget_too_low': 'Ngân sách quá thấp (tối thiểu 100.000đ)',
        'ads.error_budget_too_high': 'Ngân sách vượt quá giới hạn cho phép',
        'ads.error_campaign_not_found': 'Không tìm thấy chiến dịch quảng cáo',
        'ads.error_campaign_status': 'Trạng thái chiến dịch không cho phép thay đổi ngân sách',
      };

      const friendlyError = errorMessages[errorCode] || `${errorMsg} (code: ${errorCode})`;
      return { success: false, error: friendlyError };
    }

    // Kiểm tra response có data không
    if (!result.response) {
      return { success: false, error: 'Shopee API không trả về dữ liệu response' };
    }

    return { success: true };
  } catch (err) {
    const errorMessage = (err as Error).message;
    console.error(`[ads-scheduler] Error editing campaign ${campaignId}:`, errorMessage);
    return { success: false, error: `Lỗi hệ thống: ${errorMessage}` };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, shop_id, ...params } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    switch (action) {
      // Tạo cấu hình lịch ngân sách mới (hoặc update nếu đã tồn tại)
      case 'create': {
        const { campaign_id, campaign_name, ad_type, hour_start, hour_end, minute_start, minute_end, budget, days_of_week, specific_dates } = params;

        if (!shop_id || !campaign_id || !ad_type || hour_start === undefined || hour_end === undefined || !budget) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing required fields' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Dùng upsert để tự động update nếu đã tồn tại schedule với cùng shop_id, campaign_id, hour_start, minute_start
        const { data, error } = await supabase
          .from('apishopee_scheduled_ads_budget')
          .upsert({
            shop_id,
            campaign_id,
            campaign_name: campaign_name || null,
            ad_type,
            hour_start,
            hour_end,
            minute_start: minute_start ?? 0,
            minute_end: minute_end ?? 0,
            budget,
            days_of_week: days_of_week || null,
            specific_dates: specific_dates || null,
            is_active: true,
          }, {
            onConflict: 'shop_id,campaign_id,hour_start,minute_start',
            ignoreDuplicates: false, // Update nếu đã tồn tại
          })
          .select()
          .single();

        return new Response(
          JSON.stringify({ success: !error, schedule: data, error: error?.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Cập nhật cấu hình
      case 'update': {
        const { schedule_id, ...updateData } = params;

        if (!schedule_id || !shop_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'schedule_id and shop_id are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Remove undefined values
        const cleanData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(updateData)) {
          if (value !== undefined) {
            cleanData[key] = value;
          }
        }

        const { data, error } = await supabase
          .from('apishopee_scheduled_ads_budget')
          .update(cleanData)
          .eq('id', schedule_id)
          .eq('shop_id', shop_id)
          .select()
          .single();

        return new Response(
          JSON.stringify({ success: !error, schedule: data, error: error?.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Xóa cấu hình
      case 'delete': {
        const { schedule_id } = params;

        if (!schedule_id || !shop_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'schedule_id and shop_id are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabase
          .from('apishopee_scheduled_ads_budget')
          .delete()
          .eq('id', schedule_id)
          .eq('shop_id', shop_id);

        return new Response(
          JSON.stringify({ success: !error, error: error?.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Xem danh sách cấu hình
      case 'list': {
        let query = supabase
          .from('apishopee_scheduled_ads_budget')
          .select('*')
          .eq('shop_id', shop_id)
          .order('campaign_id')
          .order('hour_start');

        if (params.campaign_id) {
          query = query.eq('campaign_id', params.campaign_id);
        }

        const { data, error } = await query;

        return new Response(
          JSON.stringify({ success: !error, schedules: data || [], error: error?.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Xem lịch sử thay đổi
      case 'logs': {
        let query = supabase
          .from('apishopee_ads_budget_logs')
          .select('*')
          .eq('shop_id', shop_id)
          .order('executed_at', { ascending: false })
          .limit(params.limit || 50);

        if (params.campaign_id) {
          query = query.eq('campaign_id', params.campaign_id);
        }

        const { data, error } = await query;

        return new Response(
          JSON.stringify({ success: !error, logs: data || [], error: error?.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Xử lý điều chỉnh ngân sách (gọi bởi cron mỗi 30 phút)
      case 'process': {
        // Chuyển sang timezone Việt Nam (UTC+7)
        const now = new Date();
        const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const currentHour = vnTime.getHours();
        const currentMinute = vnTime.getMinutes();
        const currentDay = vnTime.getDay(); // 0 = Sunday
        const today = vnTime.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Tính tổng phút từ 00:00 để so sánh chính xác
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        console.log(`[ads-scheduler] Processing at ${currentHour}:${currentMinute.toString().padStart(2, '0')} (${currentTotalMinutes} mins), day ${currentDay}, date ${today}`);

        // Lấy tất cả cấu hình active
        // Sẽ filter chính xác theo phút ở bước sau
        const { data: schedules, error: scheduleError } = await supabase
          .from('apishopee_scheduled_ads_budget')
          .select('*')
          .eq('is_active', true);

        if (scheduleError) {
          return new Response(
            JSON.stringify({ success: false, error: scheduleError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Lọc theo thời gian chính xác (giờ + phút) và ngày
        const applicableSchedules = (schedules || []).filter((s: any) => {
          // Tính tổng phút cho start và end
          const startMinutes = s.hour_start * 60 + (s.minute_start || 0);
          const endMinutes = s.hour_end * 60 + (s.minute_end || 0);
          
          // Kiểm tra thời gian hiện tại có nằm trong khoảng không
          // Cron chạy mỗi 30 phút (phút 0 và 30), nên chỉ chạy schedule khi:
          // - Schedule start time khớp với thời điểm cron hiện tại (cùng khung 30 phút)
          // Ví dụ: schedule 10:30, cron 10:30 -> OK, cron 11:00 -> SKIP
          
          // Xác định khung 30 phút hiện tại (0-29 hoặc 30-59)
          const currentSlotStart = currentHour * 60 + (currentMinute < 30 ? 0 : 30);
          const currentSlotEnd = currentSlotStart + 30;
          
          // Schedule chỉ được chạy nếu start time nằm trong khung 30 phút hiện tại
          const isScheduleStartInCurrentSlot = startMinutes >= currentSlotStart && startMinutes < currentSlotEnd;
          
          // Và thời gian hiện tại vẫn trong khoảng schedule (chưa qua end time)
          const isBeforeEndTime = currentTotalMinutes < endMinutes;
          
          console.log(`[ads-scheduler] Schedule ${s.campaign_id}: start=${startMinutes}, end=${endMinutes}, slot=${currentSlotStart}-${currentSlotEnd}, inSlot=${isScheduleStartInCurrentSlot}, beforeEnd=${isBeforeEndTime}`);
          
          if (!isScheduleStartInCurrentSlot || !isBeforeEndTime) {
            return false;
          }
          
          // Nếu có specific_dates, kiểm tra ngày hôm nay
          if (s.specific_dates && s.specific_dates.length > 0) {
            return s.specific_dates.includes(today);
          }
          // Nếu có days_of_week, kiểm tra ngày trong tuần
          if (s.days_of_week && s.days_of_week.length > 0 && s.days_of_week.length < 7) {
            return s.days_of_week.includes(currentDay);
          }
          // Mặc định áp dụng tất cả các ngày (hàng ngày)
          return true;
        });

        console.log(`[ads-scheduler] Found ${applicableSchedules.length} applicable schedules`);

        const results: Array<{schedule_id: string; campaign_id: number; budget: number; success: boolean; error?: string}> = [];

        for (const schedule of applicableSchedules) {
          const startTime = Date.now();
          const shopInfo = await getShopInfo(supabase, schedule.shop_id);

          const result = await editCampaignBudget(
            supabase,
            schedule.shop_id,
            schedule.campaign_id,
            schedule.ad_type as 'auto' | 'manual',
            schedule.budget
          );

          const durationMs = Date.now() - startTime;

          // Log kết quả vào bảng cũ (backward compatible)
          await supabase.from('apishopee_ads_budget_logs').insert({
            shop_id: schedule.shop_id,
            campaign_id: schedule.campaign_id,
            campaign_name: schedule.campaign_name,
            schedule_id: schedule.id,
            new_budget: schedule.budget,
            status: result.success ? 'success' : 'failed',
            error_message: result.error || null,
          });

          // Log vào system_activity_logs
          await logActivity(supabase, {
            shopId: schedule.shop_id,
            shopName: shopInfo.shopName || undefined,
            actionType: 'ads_budget_update',
            actionCategory: 'ads' as ActionCategory,
            actionDescription: `Cập nhật ngân sách chiến dịch "${schedule.campaign_name || schedule.campaign_id}" thành ${schedule.budget.toLocaleString()}đ`,
            targetType: 'campaign',
            targetId: schedule.campaign_id.toString(),
            targetName: schedule.campaign_name || `Campaign ${schedule.campaign_id}`,
            requestData: {
              schedule_id: schedule.id,
              ad_type: schedule.ad_type,
              old_budget: schedule.old_budget,
              new_budget: schedule.budget,
              hour_start: schedule.hour_start,
              hour_end: schedule.hour_end,
            },
            responseData: result.success ? { success: true } : undefined,
            status: (result.success ? 'success' : 'failed') as ActionStatus,
            errorMessage: result.error,
            source: 'scheduled' as ActionSource,
            durationMs,
          });

          results.push({
            schedule_id: schedule.id,
            campaign_id: schedule.campaign_id,
            budget: schedule.budget,
            success: result.success,
            error: result.error,
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            processed: results.length,
            hour: currentHour,
            minute: currentMinute,
            day: currentDay,
            date: today,
            results,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Test: Chạy ngay cho một schedule cụ thể
      case 'run-now': {
        const { schedule_id } = params;

        if (!schedule_id || !shop_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'schedule_id and shop_id are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: schedule, error: scheduleError } = await supabase
          .from('apishopee_scheduled_ads_budget')
          .select('*')
          .eq('id', schedule_id)
          .eq('shop_id', shop_id)
          .single();

        if (scheduleError || !schedule) {
          return new Response(
            JSON.stringify({ success: false, error: 'Schedule not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const startTime = Date.now();
        const shopInfo = await getShopInfo(supabase, shop_id);

        const result = await editCampaignBudget(
          supabase,
          shop_id,
          schedule.campaign_id,
          schedule.ad_type as 'auto' | 'manual',
          schedule.budget
        );

        const durationMs = Date.now() - startTime;

        // Log kết quả vào bảng cũ
        await supabase.from('apishopee_ads_budget_logs').insert({
          shop_id,
          campaign_id: schedule.campaign_id,
          campaign_name: schedule.campaign_name,
          schedule_id: schedule.id,
          new_budget: schedule.budget,
          status: result.success ? 'success' : 'failed',
          error_message: result.error || null,
        });

        // Log vào system_activity_logs (manual run)
        await logActivity(supabase, {
          shopId: shop_id,
          shopName: shopInfo.shopName || undefined,
          actionType: 'ads_budget_update',
          actionCategory: 'ads' as ActionCategory,
          actionDescription: `[Manual] Cập nhật ngân sách chiến dịch "${schedule.campaign_name || schedule.campaign_id}" thành ${schedule.budget.toLocaleString()}đ`,
          targetType: 'campaign',
          targetId: schedule.campaign_id.toString(),
          targetName: schedule.campaign_name || `Campaign ${schedule.campaign_id}`,
          requestData: {
            schedule_id: schedule.id,
            ad_type: schedule.ad_type,
            new_budget: schedule.budget,
            trigger: 'run-now',
          },
          status: (result.success ? 'success' : 'failed') as ActionStatus,
          errorMessage: result.error,
          source: 'manual' as ActionSource,
          durationMs,
        });

        return new Response(
          JSON.stringify({
            success: result.success,
            error: result.error,
            campaign_id: schedule.campaign_id,
            budget: schedule.budget,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Invalid action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (err) {
    console.error('[ads-scheduler] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

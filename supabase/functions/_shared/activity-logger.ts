/**
 * Activity Logger - Shared utility for Edge Functions
 * Ghi logs hoạt động vào system_activity_logs table
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type ActionCategory = 'ads' | 'reviews' | 'flash_sale' | 'orders' | 'products' | 'system' | 'auth';
export type ActionStatus = 'pending' | 'success' | 'failed' | 'cancelled';
export type ActionSource = 'manual' | 'scheduled' | 'auto' | 'webhook' | 'api';

export interface LogActivityParams {
  // Who
  userId?: string;
  userEmail?: string;
  userName?: string;

  // What shop
  shopId?: number;
  shopName?: string;

  // What action
  actionType: string;
  actionCategory: ActionCategory;
  actionDescription: string;

  // Target details
  targetType?: string;
  targetId?: string;
  targetName?: string;

  // Data
  requestData?: Record<string, unknown>;
  responseData?: Record<string, unknown>;

  // Status
  status?: ActionStatus;
  errorMessage?: string;
  errorCode?: string;

  // Timing
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;

  // Source
  source?: ActionSource;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Get Supabase client với service role key
 */
export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Ghi một activity log vào database
 */
export async function logActivity(
  supabase: SupabaseClient,
  params: LogActivityParams
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('system_activity_logs')
      .insert({
        user_id: params.userId || null,
        user_email: params.userEmail || null,
        user_name: params.userName || null,
        shop_id: params.shopId || null,
        shop_name: params.shopName || null,
        action_type: params.actionType,
        action_category: params.actionCategory,
        action_description: params.actionDescription,
        target_type: params.targetType || null,
        target_id: params.targetId || null,
        target_name: params.targetName || null,
        request_data: params.requestData || null,
        response_data: params.responseData || null,
        status: params.status || 'pending',
        error_message: params.errorMessage || null,
        error_code: params.errorCode || null,
        started_at: params.startedAt?.toISOString() || new Date().toISOString(),
        completed_at: params.completedAt?.toISOString() || null,
        duration_ms: params.durationMs || null,
        source: params.source || 'auto',
        ip_address: params.ipAddress || null,
        user_agent: params.userAgent || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ACTIVITY-LOG] Error logging activity:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[ACTIVITY-LOG] Error logging activity:', err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Cập nhật status của một activity log
 */
export async function updateActivityStatus(
  supabase: SupabaseClient,
  logId: string,
  status: ActionStatus,
  options?: {
    errorMessage?: string;
    errorCode?: string;
    responseData?: Record<string, unknown>;
    completedAt?: Date;
    durationMs?: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (options?.errorMessage) updateData.error_message = options.errorMessage;
    if (options?.errorCode) updateData.error_code = options.errorCode;
    if (options?.responseData) updateData.response_data = options.responseData;
    if (options?.completedAt) updateData.completed_at = options.completedAt.toISOString();
    if (options?.durationMs !== undefined) updateData.duration_ms = options.durationMs;

    // Auto set completed_at if status is final
    if ((status === 'success' || status === 'failed' || status === 'cancelled') && !options?.completedAt) {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('system_activity_logs')
      .update(updateData)
      .eq('id', logId);

    if (error) {
      console.error('[ACTIVITY-LOG] Error updating activity status:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('[ACTIVITY-LOG] Error updating activity status:', err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Helper class để track một activity từ đầu đến cuối
 */
export class ActivityTracker {
  private logId: string | null = null;
  private startTime: Date;
  private params: LogActivityParams;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient, params: LogActivityParams) {
    this.supabase = supabase;
    this.params = params;
    this.startTime = new Date();
  }

  /**
   * Bắt đầu tracking - tạo log với status pending
   */
  async start(): Promise<string | null> {
    const result = await logActivity(this.supabase, {
      ...this.params,
      status: 'pending',
      startedAt: this.startTime,
    });

    if (result.success && result.id) {
      this.logId = result.id;
      return result.id;
    }

    return null;
  }

  /**
   * Đánh dấu thành công
   */
  async success(responseData?: Record<string, unknown>): Promise<void> {
    if (!this.logId) return;

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.startTime.getTime();

    await updateActivityStatus(this.supabase, this.logId, 'success', {
      responseData,
      completedAt,
      durationMs,
    });
  }

  /**
   * Đánh dấu thất bại
   */
  async fail(errorMessage: string, errorCode?: string, responseData?: Record<string, unknown>): Promise<void> {
    if (!this.logId) return;

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.startTime.getTime();

    await updateActivityStatus(this.supabase, this.logId, 'failed', {
      errorMessage,
      errorCode,
      responseData,
      completedAt,
      durationMs,
    });
  }

  /**
   * Get the log ID
   */
  getLogId(): string | null {
    return this.logId;
  }
}

/**
 * Quick helper để log một action đã hoàn thành
 */
export async function logCompletedActivity(
  supabase: SupabaseClient,
  params: LogActivityParams & { status: 'success' | 'failed' }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const now = new Date();
  return logActivity(supabase, {
    ...params,
    startedAt: params.startedAt || now,
    completedAt: params.completedAt || now,
  });
}

/**
 * Lấy thông tin shop để log
 */
export async function getShopInfo(
  supabase: SupabaseClient,
  shopId: number
): Promise<{ shopName: string | null }> {
  try {
    const { data } = await supabase
      .from('apishopee_shops')
      .select('shop_name')
      .eq('shop_id', shopId)
      .single();

    return { shopName: data?.shop_name || null };
  } catch {
    return { shopName: null };
  }
}

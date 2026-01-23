/**
 * Activity Logger - Utility để ghi logs hoạt động vào hệ thống
 * Sử dụng trong các edge functions và frontend
 */

import { supabase } from './supabase';

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
  actionType: string; // e.g., 'ads_budget_update', 'auto_reply_send', 'flash_sale_register'
  actionCategory: ActionCategory;
  actionDescription: string; // Human readable, e.g., "Cập nhật ngân sách chiến dịch ABC từ 100k lên 200k"

  // Target details
  targetType?: string; // e.g., 'campaign', 'review', 'flash_sale', 'order'
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
 * Ghi một activity log vào database
 */
export async function logActivity(params: LogActivityParams): Promise<{ success: boolean; id?: string; error?: string }> {
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
        source: params.source || 'manual',
        ip_address: params.ipAddress || null,
        user_agent: params.userAgent || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error logging activity:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    console.error('Error logging activity:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Cập nhật status của một activity log
 */
export async function updateActivityStatus(
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
      console.error('Error updating activity status:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Error updating activity status:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Helper class để track một activity từ đầu đến cuối
 */
export class ActivityTracker {
  private logId: string | null = null;
  private startTime: Date;
  private params: LogActivityParams;

  constructor(params: LogActivityParams) {
    this.params = params;
    this.startTime = new Date();
  }

  /**
   * Bắt đầu tracking - tạo log với status pending
   */
  async start(): Promise<string | null> {
    const result = await logActivity({
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

    await updateActivityStatus(this.logId, 'success', {
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

    await updateActivityStatus(this.logId, 'failed', {
      errorMessage,
      errorCode,
      responseData,
      completedAt,
      durationMs,
    });
  }

  /**
   * Đánh dấu đã hủy
   */
  async cancel(reason?: string): Promise<void> {
    if (!this.logId) return;

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.startTime.getTime();

    await updateActivityStatus(this.logId, 'cancelled', {
      errorMessage: reason,
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
 * Quick helper để log một action đã hoàn thành (thành công hoặc thất bại)
 */
export async function logCompletedActivity(
  params: LogActivityParams & {
    status: 'success' | 'failed';
  }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const now = new Date();
  return logActivity({
    ...params,
    startedAt: params.startedAt || now,
    completedAt: params.completedAt || now,
  });
}

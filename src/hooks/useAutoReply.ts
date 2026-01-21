/**
 * Hook: useAutoReply
 * Quản lý auto-reply configuration, logs, và status
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

export interface AutoReplyConfig {
  id?: string;
  shop_id: number;
  enabled: boolean;
  reply_templates: {
    '1': string[];
    '2': string[];
    '3': string[];
    '4': string[];
    '5': string[];
  };
  auto_reply_schedule: string;
  reply_delay_minutes: number;
  only_reply_unreplied: boolean;
  min_rating_to_reply: number | null;
  batch_size: number;
  created_at?: string;
  updated_at?: string;
}

export interface AutoReplyLog {
  id: string;
  shop_id: number;
  comment_id: number;
  rating_star: number;
  reply_text: string;
  template_index: number;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  error_message?: string;
  api_response?: any;
  replied_at: string;
  created_at: string;
}

export interface AutoReplyJobStatus {
  id: string;
  shop_id: number;
  is_running: boolean;
  last_run_at?: string;
  next_run_at?: string;
  total_replied: number;
  last_batch_replied: number;
  last_batch_failed: number;
  last_batch_skipped: number;
  last_error?: string;
  error_count: number;
  consecutive_errors: number;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_REPLY_TEMPLATES = {
  '5': [
    'Cảm ơn bạn đã tin tưởng và ủng hộ shop! Chúc bạn luôn vui vẻ và hạnh phúc! ❤️',
    'Rất vui khi sản phẩm làm bạn hài lòng! Mong được phục vụ bạn lần sau! 🌟',
    'Cảm ơn đánh giá 5 sao của bạn! Shop sẽ luôn nỗ lực để mang đến sản phẩm tốt nhất!',
  ],
  '4': [
    'Cảm ơn bạn đã đánh giá! Shop sẽ cố gắng cải thiện để phục vụ bạn tốt hơn nữa.',
    'Rất vui khi được phục vụ bạn! Mong nhận được nhiều góp ý từ bạn.',
    'Cảm ơn phản hồi của bạn! Shop sẽ nỗ lực hơn nữa để đạt 5 sao!',
  ],
  '3': [
    'Cảm ơn đánh giá của bạn. Shop sẽ cải thiện chất lượng để phục vụ bạn tốt hơn.',
    'Rất tiếc vì chưa làm bạn hài lòng hoàn toàn. Shop sẽ cố gắng cải thiện!',
    'Cảm ơn góp ý của bạn! Shop ghi nhận và sẽ nâng cao chất lượng dịch vụ.',
  ],
  '2': [
    'Shop xin lỗi vì trải nghiệm chưa tốt. Vui lòng inbox để shop hỗ trợ bạn tốt hơn.',
    'Rất tiếc vì sản phẩm chưa đáp ứng được kỳ vọng của bạn. Shop sẽ cải thiện ngay.',
    'Shop xin lỗi và mong được cơ hội phục vụ bạn tốt hơn lần sau!',
  ],
  '1': [
    'Shop rất xin lỗi! Vui lòng inbox ngay để shop hỗ trợ và giải quyết vấn đề cho bạn.',
    'Shop xin lỗi vì trải nghiệm không tốt. Vui lòng liên hệ để shop hỗ trợ bồi thường.',
    'Rất xin lỗi bạn! Shop cam kết sẽ xử lý và đền bù thỏa đáng cho bạn.',
  ],
};

export function useAutoReply(shopId: number | null) {
  const { toast } = useToast();
  const [config, setConfig] = useState<AutoReplyConfig | null>(null);
  const [jobStatus, setJobStatus] = useState<AutoReplyJobStatus | null>(null);
  const [logs, setLogs] = useState<AutoReplyLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch config
  const fetchConfig = async () => {
    if (!shopId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('apishopee_auto_reply_config')
        .select('*')
        .eq('shop_id', shopId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      setConfig(data || null);
    } catch (error: any) {
      console.error('Error fetching auto-reply config:', error);
      toast({
        title: 'Lỗi',
        description: 'Không thể tải cấu hình auto-reply',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch job status
  const fetchJobStatus = async () => {
    if (!shopId) return;

    try {
      const { data, error } = await supabase
        .from('apishopee_auto_reply_job_status')
        .select('*')
        .eq('shop_id', shopId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      setJobStatus(data || null);
    } catch (error: any) {
      console.error('Error fetching job status:', error);
    }
  };

  // Fetch logs
  const fetchLogs = async (limit = 50) => {
    if (!shopId) return;

    try {
      const { data, error } = await supabase
        .from('apishopee_auto_reply_logs')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      setLogs(data || []);
    } catch (error: any) {
      console.error('Error fetching logs:', error);
    }
  };

  // Save config
  const saveConfig = async (newConfig: Partial<AutoReplyConfig>) => {
    if (!shopId) return false;

    try {
      setSaving(true);

      const configToSave = {
        shop_id: shopId,
        ...newConfig,
      };

      const { error } = await supabase
        .from('apishopee_auto_reply_config')
        .upsert(configToSave, { onConflict: 'shop_id' });

      if (error) throw error;

      toast({
        title: 'Thành công',
        description: 'Đã lưu cấu hình auto-reply',
      });

      // Refresh config
      await fetchConfig();
      return true;
    } catch (error: any) {
      console.error('Error saving config:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể lưu cấu hình',
        variant: 'destructive',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Toggle enabled
  const toggleEnabled = async (enabled: boolean) => {
    return saveConfig({ enabled });
  };

  // Trigger manual process
  const triggerProcess = async () => {
    if (!shopId) return false;

    try {
      setSaving(true);

      const { data, error } = await supabase.functions.invoke('apishopee-auto-reply', {
        body: {
          action: 'process',
          shop_id: shopId,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: 'Thành công',
          description: `Đã reply ${data.replied} đánh giá, ${data.failed} lỗi, ${data.skipped} bỏ qua`,
        });

        // Refresh status and logs
        await fetchJobStatus();
        await fetchLogs();
        return true;
      } else {
        throw new Error(data.error || 'Process failed');
      }
    } catch (error: any) {
      console.error('Error triggering process:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể chạy auto-reply',
        variant: 'destructive',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    if (shopId) {
      fetchConfig();
      fetchJobStatus();
      fetchLogs();
    }
  }, [shopId]);

  // Setup realtime subscription for logs
  useEffect(() => {
    if (!shopId) return;

    const channel = supabase
      .channel(`auto-reply-logs-${shopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_auto_reply_logs',
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          fetchLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shopId]);

  // Setup realtime subscription for job status
  useEffect(() => {
    if (!shopId) return;

    const channel = supabase
      .channel(`auto-reply-status-${shopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_auto_reply_job_status',
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          fetchJobStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shopId]);

  return {
    config,
    jobStatus,
    logs,
    loading,
    saving,
    saveConfig,
    toggleEnabled,
    triggerProcess,
    refreshConfig: fetchConfig,
    refreshJobStatus: fetchJobStatus,
    refreshLogs: fetchLogs,
  };
}

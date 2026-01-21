/**
 * Supabase Edge Function: Shopee Auto Reply Comments
 * Tự động trả lời đánh giá sản phẩm dựa vào cấu hình
 *
 * Features:
 * - Cấu hình 3 câu trả lời cho mỗi mức sao (1-5 sao)
 * - Random chọn 1 câu trả lời
 * - Batch reply tối đa 100 comments/lần
 * - Track logs và status
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Config
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Constants
const MAX_BATCH_SIZE = 100; // Shopee API limit: 1-100
const REPLY_API_PATH = '/api/v2/product/reply_comment';

// ==================== INTERFACES ====================

interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

interface AutoReplyConfig {
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
}

interface ReviewToReply {
  comment_id: number;
  rating_star: number;
  create_time: number;
  comment: string;
}

interface ReplyCommentRequest {
  comment_id: number;
  comment: string;
}

interface ReplyCommentResponse {
  error?: string;
  message?: string;
  response?: {
    result_list: {
      comment_id: number;
      fail_error?: string;
      fail_message?: string;
    }[];
  };
  request_id?: string;
}

// ==================== HELPER FUNCTIONS ====================

async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<PartnerCredentials> {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (data?.partner_id && data?.partner_key) {
    return { partnerId: data.partner_id, partnerKey: data.partner_key };
  }
  return { partnerId: DEFAULT_PARTNER_ID, partnerKey: DEFAULT_PARTNER_KEY };
}

async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    return await fetch(proxyUrl, options);
  }
  return await fetch(targetUrl, options);
}

function createSignature(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken = '',
  shopId = 0
): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;

  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

async function refreshAccessToken(
  credentials: PartnerCredentials,
  refreshToken: string,
  shopId: number
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp);

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${credentials.partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      partner_id: credentials.partnerId,
      shop_id: shopId,
    }),
  });

  return await response.json();
}

async function saveToken(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  token: Record<string, unknown>
) {
  await supabase.from('apishopee_shops').upsert(
    {
      shop_id: shopId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expire_in: token.expire_in,
      expired_at: Date.now() + (token.expire_in as number) * 1000,
      token_updated_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id' }
  );
}

async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  const { data, error } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at')
    .eq('shop_id', shopId)
    .single();

  if (!error && data?.access_token) {
    return data;
  }
  throw new Error('Token not found. Please authenticate first.');
}

// ==================== SHOPEE API FUNCTIONS ====================

async function callShopeeReplyAPI(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  commentList: ReplyCommentRequest[]
): Promise<ReplyCommentResponse> {
  const makeRequest = async (accessToken: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createSignature(
      credentials.partnerKey,
      credentials.partnerId,
      REPLY_API_PATH,
      timestamp,
      accessToken,
      shopId
    );

    const params = new URLSearchParams({
      partner_id: credentials.partnerId.toString(),
      timestamp: timestamp.toString(),
      access_token: accessToken,
      shop_id: shopId.toString(),
      sign: sign,
    });

    const url = `${SHOPEE_BASE_URL}${REPLY_API_PATH}?${params.toString()}`;
    console.log('[AUTO-REPLY] Calling reply API with', commentList.length, 'comments');

    const response = await fetchWithProxy(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_list: commentList }),
    });

    return await response.json();
  };

  let result = await makeRequest(token.access_token);

  // Auto-retry khi token hết hạn
  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[AUTO-REPLY] Token expired, refreshing...');
    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);

    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

// ==================== AUTO REPLY FUNCTIONS ====================

/**
 * Lấy config auto-reply cho shop
 */
async function getAutoReplyConfig(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<AutoReplyConfig | null> {
  const { data } = await supabase
    .from('apishopee_auto_reply_config')
    .select('*')
    .eq('shop_id', shopId)
    .eq('enabled', true)
    .single();

  return data;
}

/**
 * Random chọn 1 reply template
 */
function getRandomReplyTemplate(templates: string[]): { text: string; index: number } | null {
  if (!templates || templates.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * templates.length);
  return {
    text: templates[randomIndex],
    index: randomIndex,
  };
}

/**
 * Lấy danh sách reviews cần auto-reply
 */
async function getReviewsNeedAutoReply(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  limit: number = MAX_BATCH_SIZE
): Promise<ReviewToReply[]> {
  const { data, error } = await supabase.rpc('get_reviews_need_auto_reply', {
    p_shop_id: shopId,
    p_limit: limit,
  });

  if (error) {
    console.error('[AUTO-REPLY] Error getting reviews:', error);
    return [];
  }

  return data || [];
}

/**
 * Log auto-reply result
 */
async function logAutoReply(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  commentId: number,
  ratingStar: number,
  replyText: string,
  templateIndex: number,
  status: 'pending' | 'success' | 'failed' | 'skipped',
  errorMessage?: string,
  apiResponse?: unknown
) {
  await supabase.from('apishopee_auto_reply_logs').insert({
    shop_id: shopId,
    comment_id: commentId,
    rating_star: ratingStar,
    reply_text: replyText,
    template_index: templateIndex,
    status: status,
    error_message: errorMessage || null,
    api_response: apiResponse || null,
  });
}

/**
 * Update review với reply text
 */
async function updateReviewReply(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  commentId: number,
  replyText: string
) {
  await supabase
    .from('apishopee_reviews')
    .update({
      reply_text: replyText,
      reply_time: Math.floor(Date.now() / 1000),
      reply_hidden: false,
    })
    .eq('shop_id', shopId)
    .eq('comment_id', commentId);
}

/**
 * Update job status
 */
async function updateJobStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  updates: {
    is_running?: boolean;
    last_run_at?: string;
    total_replied?: number;
    last_batch_replied?: number;
    last_batch_failed?: number;
    last_batch_skipped?: number;
    last_error?: string | null;
    error_count?: number;
    consecutive_errors?: number;
  }
) {
  await supabase
    .from('apishopee_auto_reply_job_status')
    .upsert(
      {
        shop_id: shopId,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' }
    );
}

/**
 * Main auto-reply logic
 */
async function processAutoReply(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string }
): Promise<{
  success: boolean;
  replied: number;
  failed: number;
  skipped: number;
  error?: string;
}> {
  console.log('[AUTO-REPLY] Starting auto-reply for shop:', shopId);

  let totalReplied = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  try {
    // 1. Lấy config
    const config = await getAutoReplyConfig(supabase, shopId);
    if (!config || !config.enabled) {
      console.log('[AUTO-REPLY] Auto-reply not enabled for shop:', shopId);
      return { success: false, replied: 0, failed: 0, skipped: 0, error: 'Auto-reply not enabled' };
    }

    // 2. Lấy reviews cần reply (với batch_size từ config)
    const batchSize = config.batch_size || MAX_BATCH_SIZE;
    const reviews = await getReviewsNeedAutoReply(supabase, shopId, batchSize);
    console.log(`[AUTO-REPLY] Found ${reviews.length} reviews to process (batch size: ${batchSize})`);

    if (reviews.length === 0) {
      return { success: true, replied: 0, failed: 0, skipped: 0 };
    }

    // 3. Prepare reply list
    const replyRequests: ReplyCommentRequest[] = [];
    const replyMap = new Map<number, { text: string; index: number; rating: number }>();

    for (const review of reviews) {
      const templates = config.reply_templates[review.rating_star.toString() as keyof typeof config.reply_templates];

      if (!templates || templates.length === 0) {
        console.log(`[AUTO-REPLY] No template for ${review.rating_star} stars, skipping comment ${review.comment_id}`);
        await logAutoReply(
          supabase,
          shopId,
          review.comment_id,
          review.rating_star,
          '',
          -1,
          'skipped',
          `No template configured for ${review.rating_star} stars`
        );
        totalSkipped++;
        continue;
      }

      const replyTemplate = getRandomReplyTemplate(templates);
      if (!replyTemplate) {
        totalSkipped++;
        continue;
      }

      replyRequests.push({
        comment_id: review.comment_id,
        comment: replyTemplate.text,
      });

      replyMap.set(review.comment_id, {
        text: replyTemplate.text,
        index: replyTemplate.index,
        rating: review.rating_star,
      });
    }

    if (replyRequests.length === 0) {
      console.log('[AUTO-REPLY] No valid replies to send');
      return { success: true, replied: 0, failed: 0, skipped: totalSkipped };
    }

    // 4. Call Shopee API (batch tối đa 100)
    console.log(`[AUTO-REPLY] Sending ${replyRequests.length} replies to Shopee API`);
    const apiResult = await callShopeeReplyAPI(
      supabase,
      credentials,
      shopId,
      token,
      replyRequests
    );

    // 5. Process results
    if (apiResult.error) {
      console.error('[AUTO-REPLY] API Error:', apiResult.message || apiResult.error);

      // Log all as failed
      for (const req of replyRequests) {
        const replyInfo = replyMap.get(req.comment_id);
        if (replyInfo) {
          await logAutoReply(
            supabase,
            shopId,
            req.comment_id,
            replyInfo.rating,
            replyInfo.text,
            replyInfo.index,
            'failed',
            apiResult.message || apiResult.error,
            apiResult
          );
        }
        totalFailed++;
      }

      return {
        success: false,
        replied: 0,
        failed: totalFailed,
        skipped: totalSkipped,
        error: apiResult.message || apiResult.error,
      };
    }

    // 6. Process individual results
    const resultList = apiResult.response?.result_list || [];

    for (const result of resultList) {
      const replyInfo = replyMap.get(result.comment_id);
      if (!replyInfo) continue;

      if (result.fail_error || result.fail_message) {
        // Failed
        console.log(`[AUTO-REPLY] Failed to reply comment ${result.comment_id}:`, result.fail_message);
        await logAutoReply(
          supabase,
          shopId,
          result.comment_id,
          replyInfo.rating,
          replyInfo.text,
          replyInfo.index,
          'failed',
          result.fail_message || result.fail_error,
          result
        );
        totalFailed++;
      } else {
        // Success
        console.log(`[AUTO-REPLY] Successfully replied comment ${result.comment_id}`);
        await logAutoReply(
          supabase,
          shopId,
          result.comment_id,
          replyInfo.rating,
          replyInfo.text,
          replyInfo.index,
          'success',
          undefined,
          result
        );

        // Update review in database
        await updateReviewReply(supabase, shopId, result.comment_id, replyInfo.text);

        totalReplied++;
      }
    }

    console.log(`[AUTO-REPLY] Completed. Replied: ${totalReplied}, Failed: ${totalFailed}, Skipped: ${totalSkipped}`);
    return {
      success: true,
      replied: totalReplied,
      failed: totalFailed,
      skipped: totalSkipped,
    };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[AUTO-REPLY] Error:', errorMessage);
    return {
      success: false,
      replied: totalReplied,
      failed: totalFailed,
      skipped: totalSkipped,
      error: errorMessage,
    };
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result;

    switch (action) {
      case 'process': {
        // Process auto-reply for a shop
        await updateJobStatus(supabase, shop_id, {
          is_running: true,
          last_run_at: new Date().toISOString(),
        });

        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);

        const processResult = await processAutoReply(supabase, credentials, shop_id, token);

        // Update job status
        const { data: currentStatus } = await supabase
          .from('apishopee_auto_reply_job_status')
          .select('total_replied, consecutive_errors')
          .eq('shop_id', shop_id)
          .single();

        const totalReplied = (currentStatus?.total_replied || 0) + processResult.replied;
        const consecutiveErrors = processResult.success ? 0 : (currentStatus?.consecutive_errors || 0) + 1;

        await updateJobStatus(supabase, shop_id, {
          is_running: false,
          total_replied: totalReplied,
          last_batch_replied: processResult.replied,
          last_batch_failed: processResult.failed,
          last_batch_skipped: processResult.skipped,
          last_error: processResult.error || null,
          error_count: processResult.error ? (currentStatus?.consecutive_errors || 0) + 1 : undefined,
          consecutive_errors: consecutiveErrors,
        });

        result = {
          success: processResult.success,
          replied: processResult.replied,
          failed: processResult.failed,
          skipped: processResult.skipped,
          error: processResult.error,
        };
        break;
      }

      case 'get-config': {
        // Get auto-reply config
        const config = await getAutoReplyConfig(supabase, shop_id);
        result = { success: true, config };
        break;
      }

      case 'get-logs': {
        // Get auto-reply logs
        const { limit = 50, offset = 0, status } = body;

        let query = supabase
          .from('apishopee_auto_reply_logs')
          .select('*')
          .eq('shop_id', shop_id)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) {
          query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) throw error;
        result = { success: true, logs: data };
        break;
      }

      case 'get-status': {
        // Get job status
        const { data } = await supabase
          .from('apishopee_auto_reply_job_status')
          .select('*')
          .eq('shop_id', shop_id)
          .single();

        result = { success: true, status: data };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Use: process, get-config, get-logs, get-status' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[AUTO-REPLY] Error:', error);
    return new Response(
      JSON.stringify({
        error: (error as Error).message,
        success: false,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

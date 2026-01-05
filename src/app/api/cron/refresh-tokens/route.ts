/**
 * API Route: Auto Refresh Shopee Tokens
 * 
 * Endpoint này được gọi bởi Vercel Cron hoặc external cron service
 * để tự động refresh token cho tất cả shops sắp hết hạn
 * 
 * Cron schedule: Mỗi giờ (0 * * * *)
 */

import { NextRequest, NextResponse } from 'next/server';

// Verify cron secret to prevent unauthorized access
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  try {
    // Verify authorization
    const authHeader = request.headers.get('authorization');
    
    // Check for Vercel Cron secret or custom auth
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
      // Also check for Vercel's internal cron header
      const isVercelCron = request.headers.get('x-vercel-cron') === '1';
      if (!isVercelCron) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Missing Supabase configuration' },
        { status: 500 }
      );
    }

    // Call the Edge Function
    const response = await fetch(
      `${supabaseUrl}/functions/v1/shopee-token-refresh`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({}),
      }
    );

    const result = await response.json();

    console.log('[CRON] Token refresh result:', {
      success: result.success,
      processed: result.processed,
      success_count: result.success_count,
      failed_count: result.failed_count,
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error('[CRON] Token refresh error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}

// Vercel Cron config
export const runtime = 'edge';
export const maxDuration = 60; // 60 seconds timeout

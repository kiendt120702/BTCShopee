/**
 * Script để kiểm tra số lượng đánh giá của shop
 * Usage: npx tsx scripts/check-shop-reviews.ts <shop_id>
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkShopReviews(shopId: number) {
  console.log('🔍 Kiểm tra đánh giá shop:', shopId);
  console.log('='.repeat(50));

  // 1. Tổng số đánh giá
  const { count: totalReviews, error: countError } = await supabase
    .from('apishopee_reviews')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId);

  if (countError) {
    console.error('❌ Lỗi:', countError);
    return;
  }

  console.log(`📊 Tổng số đánh giá: ${totalReviews}`);
  console.log('');

  // 2. Thống kê theo rating
  const { data: reviews, error: reviewsError } = await supabase
    .from('apishopee_reviews')
    .select('rating_star, reply_text, create_time')
    .eq('shop_id', shopId);

  if (reviewsError) {
    console.error('❌ Lỗi lấy reviews:', reviewsError);
    return;
  }

  if (!reviews || reviews.length === 0) {
    console.log('⚠️ Chưa có đánh giá nào trong database');
    return;
  }

  // Rating counts
  const ratingCounts: Record<number, number> = {};
  let repliedCount = 0;

  reviews.forEach(r => {
    ratingCounts[r.rating_star] = (ratingCounts[r.rating_star] || 0) + 1;
    if (r.reply_text) repliedCount++;
  });

  console.log('⭐ Thống kê theo rating:');
  [5, 4, 3, 2, 1].forEach(star => {
    const count = ratingCounts[star] || 0;
    const percentage = ((count / reviews.length) * 100).toFixed(1);
    const stars = '★'.repeat(star);
    console.log(`  ${stars} (${star} sao): ${count} (${percentage}%)`);
  });
  console.log('');

  // 3. Đã/chưa trả lời
  const notRepliedCount = reviews.length - repliedCount;
  console.log('💬 Trả lời:');
  console.log(`  ✅ Đã trả lời: ${repliedCount} (${((repliedCount / reviews.length) * 100).toFixed(1)}%)`);
  console.log(`  ⏳ Chưa trả lời: ${notRepliedCount} (${((notRepliedCount / reviews.length) * 100).toFixed(1)}%)`);
  console.log('');

  // 4. Điểm trung bình
  const avgRating = reviews.reduce((sum, r) => sum + r.rating_star, 0) / reviews.length;
  console.log(`📈 Điểm trung bình: ${avgRating.toFixed(2)} / 5.0`);
  console.log('');

  // 5. Sync status
  const { data: syncStatus } = await supabase
    .from('apishopee_reviews_sync_status')
    .select('*')
    .eq('shop_id', shopId)
    .single();

  if (syncStatus) {
    console.log('🔄 Trạng thái đồng bộ:');
    console.log(`  Đang sync: ${syncStatus.is_syncing ? 'Có' : 'Không'}`);
    console.log(`  Initial sync done: ${syncStatus.is_initial_sync_done ? 'Có' : 'Không'}`);
    console.log(`  Lần cuối sync: ${syncStatus.last_sync_at ? new Date(syncStatus.last_sync_at).toLocaleString('vi-VN') : 'Chưa sync'}`);
    console.log(`  Tổng đã sync: ${syncStatus.total_synced || 0}`);
    if (syncStatus.last_error) {
      console.log(`  ⚠️ Lỗi cuối: ${syncStatus.last_error}`);
    }
  } else {
    console.log('⚠️ Chưa có thông tin sync status');
  }

  console.log('');
  console.log('='.repeat(50));
}

// Run
const shopId = parseInt(process.argv[2]) || 144364758; // Default to Hibena
checkShopReviews(shopId).catch(console.error);

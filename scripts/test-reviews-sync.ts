/**
 * Script để test reviews sync function
 * Usage: npx tsx scripts/test-reviews-sync.ts <shop_id>
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testReviewsSync(shopId: number) {
  console.log('🔍 Testing Reviews Sync Function...');
  console.log(`Shop ID: ${shopId}`);
  console.log('---');

  // 1. Get sync status
  console.log('1️⃣ Getting sync status...');
  const statusRes = await supabase.functions.invoke('apishopee-reviews-sync', {
    body: { action: 'status', shop_id: shopId },
  });

  if (statusRes.error) {
    console.error('❌ Error getting status:', statusRes.error);
    return;
  }

  console.log('✅ Sync Status:', JSON.stringify(statusRes.data, null, 2));
  console.log('---');

  // 2. Get current stats
  console.log('2️⃣ Getting current stats...');
  const statsRes = await supabase.functions.invoke('apishopee-reviews-sync', {
    body: { action: 'get-stats', shop_id: shopId },
  });

  if (statsRes.error) {
    console.error('❌ Error getting stats:', statsRes.error);
  } else {
    console.log('✅ Current Stats:', JSON.stringify(statsRes.data, null, 2));
  }
  console.log('---');

  // 3. Test get comments from API (raw)
  console.log('3️⃣ Testing API call to get comments...');
  const commentsRes = await supabase.functions.invoke('apishopee-reviews-sync', {
    body: {
      action: 'get-comments',
      shop_id: shopId,
      comment_type: 0, // All comments
      page_size: 5,
    },
  });

  if (commentsRes.error) {
    console.error('❌ Error getting comments:', commentsRes.error);
  } else {
    console.log('✅ API Response:', JSON.stringify(commentsRes.data, null, 2));
  }
  console.log('---');

  // 4. Trigger sync (optional - uncomment để test)
  /*
  console.log('4️⃣ Triggering sync...');
  const syncRes = await supabase.functions.invoke('apishopee-reviews-sync', {
    body: {
      action: 'sync',
      shop_id: shopId,
      force_initial: false,
    },
  });

  if (syncRes.error) {
    console.error('❌ Error syncing:', syncRes.error);
  } else {
    console.log('✅ Sync Result:', JSON.stringify(syncRes.data, null, 2));
  }
  */

  console.log('---');
  console.log('✅ Test completed!');
}

// Run test
const shopId = parseInt(process.argv[2]);
if (!shopId) {
  console.error('❌ Please provide shop_id as argument');
  console.log('Usage: npx tsx scripts/test-reviews-sync.ts <shop_id>');
  process.exit(1);
}

testReviewsSync(shopId).catch(console.error);

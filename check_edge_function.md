# Các bước kiểm tra vấn đề

## 1. Kiểm tra Edge Function đã deploy chưa

Chạy lệnh:
```bash
npx supabase functions deploy apishopee-ads-sync
```

Hoặc check version hiện tại:
```bash
curl https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-ads-sync \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

## 2. Kiểm tra logs của cronjob

Vào Supabase Dashboard:
- URL: https://supabase.com/dashboard/project/ohlwhhxhgpotlwfgqhhu
- Sidebar → Logs → Edge Functions
- Filter: apishopee-ads-sync
- Xem logs gần nhất (15 phút trước)

## 3. Tìm dòng log này:

**Nếu thấy dòng này → CODE MỚI (ĐÚNG):**
```
[ADS-SYNC] Step 2: Sync daily performance - TẤT CẢ CAMPAIGNS (giống sync thủ công)
```

**Nếu thấy dòng này → CODE CŨ (SAI):**
```
[ADS-SYNC] === SHOP-LEVEL PERFORMANCE ===
```
(xuất hiện TRƯỚC "Step 1: Sync campaigns")

## 4. Kiểm tra thứ tự log messages

**CODE ĐÚNG (thứ tự mới):**
1. Step 1: Sync campaigns
2. Step 2: Sync daily performance - TẤT CẢ CAMPAIGNS
3. Step 3: Sync hourly performance - TẤT CẢ CAMPAIGNS  
4. Step 4: Sync shop-level performance

**CODE SAI (thứ tự cũ):**
1. === SHOP-LEVEL PERFORMANCE ===
2. Step 1: Sync campaigns
3. Step 2: Sync daily performance

## 5. Nếu vẫn chạy code CŨ

Deploy lại edge function:
```bash
cd d:\Betacom\BetacomShopeeAPI
npx supabase functions deploy apishopee-ads-sync --project-ref ohlwhhxhgpotlwfgqhhu
```

Hoặc nếu không có supabase CLI:
- Vào Dashboard → Edge Functions
- Chọn apishopee-ads-sync
- Click "Deploy" với code mới nhất

# 🔒 Hướng dẫn khắc phục lỗ hổng bảo mật Supabase Token

## ⚠️ Vấn đề
GitHub đã phát hiện **Supabase Personal Access Tokens** bị lộ trong git history của repository này.

## 🚨 Các token bị lộ:
1. Project: `omgvvnqwroypavmpwbup.supabase.co`
2. Project: `ohlwhhxhgpotlwfgqhhu.supabase.co`
3. Project: `tjzeskxkqvjbowikzqpv.supabase.co`

---

## ✅ Các bước khắc phục (QUAN TRỌNG - làm theo thứ tự)

### **Bước 1: Revoke tokens ngay lập tức** ⏰

1. Truy cập [Supabase Dashboard](https://supabase.com/dashboard)
2. Chọn project của bạn
3. Vào **Settings → API**
4. Click **"Reset"** hoặc **"Regenerate"** cho:
   - `anon` key (public)
   - `service_role` key (nếu có bị lộ)
5. Lưu lại các key mới

### **Bước 2: Cập nhật biến môi trường local**

Tạo file `.env.local` (đã được gitignore):

```bash
# Supabase - SỬ DỤNG TOKEN MỚI từ Dashboard
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-new-anon-key-here

# Shopee (optional)
VITE_SHOPEE_PARTNER_ID=
VITE_SHOPEE_PARTNER_KEY=
VITE_SHOPEE_CALLBACK_URL=http://localhost:5173/auth/callback
```

⚠️ **KHÔNG BAO GIỜ commit file `.env.local` hoặc `.env`!**

### **Bước 3: Xóa secrets khỏi git history**

#### Option A: Sử dụng script tự động (Khuyến nghị)

```bash
# Cài đặt git-filter-repo
pip install git-filter-repo
# hoặc trên macOS:
brew install git-filter-repo

# Chạy script
chmod +x remove-secrets.sh
./remove-secrets.sh
```

#### Option B: Thủ công với BFG Repo-Cleaner

```bash
# Cài đặt BFG
brew install bfg

# Tạo file chứa secrets cần xóa
cat > secrets.txt << 'EOF'
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZ3Z2bnF3cm95cGF2bXB3YnVwIg==
omgvvnqwroypavmpwbup.supabase.co
ohlwhhxhgpotlwfgqhhu.supabase.co
tjzeskxkqvjbowikzqpv.supabase.co
EOF

# Chạy BFG
bfg --replace-text secrets.txt

# Cleanup
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### **Bước 4: Force push lên GitHub**

```bash
# Backup trước khi force push (an toàn hơn)
git clone --mirror . ../BTCShopee-backup

# Force push
git push origin --force --all
git push origin --force --tags
```

### **Bước 5: Thông báo team members**

Tất cả collaborators cần:

```bash
# Xóa repo cũ
rm -rf BTCShopee

# Clone lại từ đầu
git clone https://github.com/kiendt120702/BTCShopee.git
```

### **Bước 6: Cập nhật Supabase Edge Functions**

Nếu bạn có Edge Functions sử dụng `SUPABASE_SERVICE_ROLE_KEY`:

```bash
# Cập nhật secrets trên Supabase
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-new-service-role-key

# Redeploy functions
supabase functions deploy
```

### **Bước 7: Xác nhận trên GitHub**

1. Vào email từ GitHub về "Secrets detected"
2. Click vào các link để review
3. Sau khi xử lý xong, click **"Dismiss alert"** hoặc **"Mark as resolved"**

---

## 🛡️ Phòng ngừa trong tương lai

### 1. **Luôn sử dụng biến môi trường**

```typescript
// ✅ ĐÚNG
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ❌ SAI - KHÔNG BAO GIỜ hardcode
const supabaseUrl = 'https://xxx.supabase.co';
const supabaseKey = 'eyJhbGci...';
```

### 2. **Kiểm tra .gitignore**

Đảm bảo file `.gitignore` có:

```
.env
.env.local
.env.*.local
*.env
```

### 3. **Sử dụng pre-commit hooks**

Cài đặt [git-secrets](https://github.com/awslabs/git-secrets):

```bash
brew install git-secrets

# Setup cho repo
git secrets --install
git secrets --register-aws
git secrets --add 'eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*'
```

### 4. **Scan trước khi commit**

```bash
# Cài đặt gitleaks
brew install gitleaks

# Scan repo
gitleaks detect --source . --verbose
```

---

## 📋 Checklist

- [ ] Revoke tất cả tokens cũ trên Supabase Dashboard
- [ ] Tạo tokens mới
- [ ] Cập nhật `.env.local` với tokens mới
- [ ] Xóa secrets khỏi git history
- [ ] Force push lên GitHub
- [ ] Thông báo team clone lại repo
- [ ] Cập nhật Supabase Edge Functions (nếu có)
- [ ] Dismiss alerts trên GitHub
- [ ] Cài đặt git-secrets hoặc gitleaks
- [ ] Test lại ứng dụng với tokens mới

---

## 🆘 Cần trợ giúp?

- [Supabase Security Best Practices](https://supabase.com/docs/guides/platform/going-into-prod#security)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [Git Filter Repo](https://github.com/newren/git-filter-repo)

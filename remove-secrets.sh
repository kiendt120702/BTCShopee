#!/bin/bash

# Script để xóa secrets khỏi git history
# Sử dụng git filter-repo (cần cài đặt: pip install git-filter-repo)

echo "⚠️  CẢNH BÁO: Script này sẽ rewrite git history!"
echo "Đảm bảo bạn đã backup repository trước khi chạy."
echo ""
read -p "Bạn có chắc muốn tiếp tục? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Đã hủy."
    exit 0
fi

# Kiểm tra git filter-repo đã cài chưa
if ! command -v git-filter-repo &> /dev/null; then
    echo "❌ git-filter-repo chưa được cài đặt"
    echo "Cài đặt bằng: pip install git-filter-repo"
    echo "Hoặc: brew install git-filter-repo (trên macOS)"
    exit 1
fi

echo "🔧 Đang xóa secrets khỏi git history..."

# Tạo file chứa các pattern cần xóa
cat > /tmp/secrets-to-remove.txt << 'EOF'
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZ3Z2bnF3cm95cGF2bXB3YnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNzI2MjQsImV4cCI6MjA4MDg0ODYyNH0.7ykFYPTivbBni2HtnaSct2tAKDs9_kNNWTVulii1sIE
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9obHdoaHhoZ3BvdGx3ZmdxaGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODU2MTcsImV4cCI6MjA4Mzc2MTYxN30.-fs_1Q_5kVQJdLBPWNoWJMIfch8i4jcupRu7tWpsaEU
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqemVza3hrcXZqYm93aWt6cXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMjg0MjcsImV4cCI6MjA2NTkwNDQyN30.T-AV2KidsjI9c1Y7ue4Rk8PxSbG_ZImh7J0uCAz3qGk
https://omgvvnqwroypavmpwbup.supabase.co
https://ohlwhhxhgpotlwfgqhhu.supabase.co
https://tjzeskxkqvjbowikzqpv.supabase.co
EOF

# Sử dụng git filter-repo để replace secrets
git filter-repo --replace-text /tmp/secrets-to-remove.txt --force

echo "✅ Đã xóa secrets khỏi git history"
echo ""
echo "⚠️  LƯU Ý QUAN TRỌNG:"
echo "1. Repository đã được rewrite, bạn cần force push:"
echo "   git push origin --force --all"
echo ""
echo "2. Tất cả collaborators cần clone lại repository:"
echo "   git clone <repo-url>"
echo ""
echo "3. Đừng quên revoke các token cũ trên Supabase Dashboard!"

# Cleanup
rm /tmp/secrets-to-remove.txt

/**
 * Ads Keywords Page - Tra cứu từ khóa đề xuất
 */

import { useState, useEffect, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/ui/data-table';

interface KeywordData {
  keyword: string;
  search_volume?: number;
  suggested_bid?: number;
  quality_score?: number;
}

interface ProductItem {
  item_id: number;
  item_name: string;
  image?: string;
  item_status?: string;
}

export default function AdsKeywordsPage() {
  const { toast } = useToast();
  const { token, isAuthenticated, isLoading } = useShopeeAuth();
  
  const [keywords, setKeywords] = useState<KeywordData[]>([]);
  const [keywordItemId, setKeywordItemId] = useState('');
  const [inputKeyword, setInputKeyword] = useState('');
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [trackedKeywords, setTrackedKeywords] = useState<string[]>([]);

  const formatPrice = (p: number) => new Intl.NumberFormat('vi-VN').format(p) + 'đ';
  const formatNumber = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

  useEffect(() => {
    if (isAuthenticated && token?.shop_id) {
      loadProducts();
      loadTrackedKeywords();
    } else {
      // Clear data when shop changes or user logs out
      setProducts([]);
      setKeywords([]);
      setTrackedKeywords([]);
      setKeywordItemId('');
    }
  }, [isAuthenticated, token?.shop_id]);

  const loadTrackedKeywords = async () => {
    if (!token?.shop_id) return;
    try {
      const { data } = await supabase.functions.invoke('shopee-keyword', {
        body: { action: 'get-tracking-list', shop_id: token.shop_id },
      });
      if (data?.response) {
        setTrackedKeywords(data.response.map((t: { keyword: string }) => t.keyword.toLowerCase()));
      }
    } catch { /* ignore */ }
  };

  const loadProducts = async () => {
    if (!token?.shop_id) return;
    setProductsLoading(true);
    try {
      const { data: cached, error: cacheError } = await supabase.functions.invoke('shopee-keyword', {
        body: { action: 'get-cached-products', shop_id: token.shop_id, limit: 500 },
      });
      
      if (!cacheError && cached?.response?.length > 0) {
        setProducts(cached.response.map((p: { item_id: number; item_name: string; image_url?: string; item_status?: string }) => ({
          item_id: p.item_id,
          item_name: p.item_name,
          image: p.image_url,
          item_status: p.item_status,
        })));
        return;
      }

      let allItemIds: number[] = [];
      let offset = 0;
      let hasNextPage = true;
      
      while (hasNextPage && offset < 500) {
        const { data: listData, error: listError } = await supabase.functions.invoke('shopee-product', {
          body: { action: 'get-item-list', shop_id: token.shop_id, page_size: 100, offset, item_status: ['NORMAL'] },
        });
        if (listError) break;
        const items = listData?.response?.item || [];
        allItemIds = [...allItemIds, ...items.map((i: { item_id: number }) => i.item_id)];
        hasNextPage = listData?.response?.has_next_page || false;
        offset = listData?.response?.next_offset || offset + 100;
      }
      
      if (allItemIds.length === 0) { setProducts([]); return; }

      const allProducts: ProductItem[] = [];
      for (let i = 0; i < allItemIds.length; i += 50) {
        const batchIds = allItemIds.slice(i, i + 50);
        const { data: infoData } = await supabase.functions.invoke('shopee-product', {
          body: { action: 'get-item-base-info', shop_id: token.shop_id, item_id_list: batchIds },
        });
        const itemList = infoData?.response?.item_list || [];
        allProducts.push(...itemList.map((item: { item_id: number; item_name: string; image?: { image_url_list?: string[] }; item_status?: string }) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          image: item.image?.image_url_list?.[0],
          item_status: item.item_status,
        })));
      }
      setProducts(allProducts);
    } catch { /* ignore */ } 
    finally { setProductsLoading(false); }
  };

  const loadKeywords = async () => {
    if (!token?.shop_id || !keywordItemId) {
      toast({ title: 'Vui lòng chọn sản phẩm' });
      return;
    }
    setKeywordLoading(true);
    try {
      const params: Record<string, unknown> = {
        action: 'get-recommended-keyword-list',
        shop_id: token.shop_id,
        item_id: Number(keywordItemId),
        save_history: true,
        item_name: selectedProduct?.item_name,
      };
      if (inputKeyword.trim()) params.input_keyword = inputKeyword.trim();

      const { data, error } = await supabase.functions.invoke('shopee-keyword', { body: params });
      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }

      const keywordList = data?.response?.suggested_keyword_list || [];
      setKeywords(keywordList);
      toast({ title: 'Thành công', description: `Tìm thấy ${keywordList.length} từ khóa đề xuất` });
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally { setKeywordLoading(false); }
  };

  const addToTracking = async (kw: KeywordData) => {
    if (!token?.shop_id) return;
    try {
      const { error } = await supabase.functions.invoke('shopee-keyword', {
        body: {
          action: 'add-tracking',
          shop_id: token.shop_id,
          keyword: kw.keyword,
          item_id: keywordItemId ? Number(keywordItemId) : null,
          item_name: selectedProduct?.item_name || null,
          quality_score: kw.quality_score,
          suggested_bid: kw.suggested_bid,
          search_volume: kw.search_volume,
        },
      });
      if (error) throw error;
      toast({ title: 'Đã thêm vào theo dõi', description: kw.keyword });
      setTrackedKeywords(prev => [...prev, kw.keyword.toLowerCase()]);
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const search = productSearch.toLowerCase();
    return products.filter(p => p.item_name.toLowerCase().includes(search) || p.item_id.toString().includes(search));
  }, [products, productSearch]);

  const selectedProduct = useMemo(() => {
    if (!keywordItemId) return null;
    return products.find(p => p.item_id.toString() === keywordItemId);
  }, [products, keywordItemId]);

  const isKeywordTracked = (keyword: string) => {
    return trackedKeywords.includes(keyword.toLowerCase());
  };

  const keywordColumns: ColumnDef<KeywordData>[] = useMemo(() => [
    {
      accessorKey: 'keyword',
      header: 'Từ khóa',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">{row.original.keyword}</span>
          {isKeywordTracked(row.original.keyword) && (
            <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Đang theo dõi</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'search_volume',
      header: 'Lượt tìm kiếm',
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm text-slate-600">
          {row.original.search_volume ? formatNumber(row.original.search_volume) : '-'}
        </span>
      ),
    },
    {
      accessorKey: 'suggested_bid',
      header: 'Giá đề xuất',
      size: 110,
      cell: ({ row }) => (
        <span className="text-sm font-semibold text-orange-500">
          {row.original.suggested_bid ? formatPrice(row.original.suggested_bid) : '-'}
        </span>
      ),
    },
    {
      accessorKey: 'quality_score',
      header: 'Điểm CL',
      size: 80,
      cell: ({ row }) => {
        const score = row.original.quality_score;
        if (!score) return <span className="text-xs text-slate-400">-</span>;
        const color = score >= 7 ? 'text-green-600' : score >= 4 ? 'text-yellow-600' : 'text-red-600';
        return <span className={cn("text-sm font-bold", color)}>{score}/10</span>;
      },
    },
    {
      id: 'actions',
      header: '',
      size: 80,
      cell: ({ row }) => (
        <Button
          size="sm"
          variant={isKeywordTracked(row.original.keyword) ? "outline" : "default"}
          onClick={() => addToTracking(row.original)}
          disabled={isKeywordTracked(row.original.keyword)}
          className="h-7 text-xs"
        >
          {isKeywordTracked(row.original.keyword) ? '✓' : '+ Theo dõi'}
        </Button>
      ),
    },
  ], [trackedKeywords]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Đang tải...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Vui lòng đăng nhập để sử dụng tính năng này</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden p-4 space-y-4">
      {/* Search Controls */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 whitespace-nowrap w-20">Sản phẩm:</span>
          <div className="flex-1 relative">
            <button
              type="button"
              onClick={() => setShowProductDropdown(!showProductDropdown)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 border rounded-lg text-left text-sm",
                "hover:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500",
                selectedProduct ? "bg-white" : "bg-gray-50"
              )}
            >
              {selectedProduct ? (
                <>
                  {selectedProduct.image && (
                    <img src={selectedProduct.image} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className="truncate font-medium text-gray-700 text-sm">{selectedProduct.item_name}</p>
                    <p className="text-xs text-gray-400">ID: {selectedProduct.item_id}</p>
                  </div>
                </>
              ) : (
                <span className="text-gray-400">
                  {productsLoading ? 'Đang tải sản phẩm...' : 'Chọn sản phẩm'}
                </span>
              )}
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showProductDropdown && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-80 overflow-hidden">
                <div className="p-2 border-b sticky top-0 bg-white">
                  <Input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Tìm theo tên hoặc ID..."
                    className="text-sm"
                    autoFocus
                  />
                </div>
                <div className="overflow-y-auto max-h-60">
                  {productsLoading ? (
                    <div className="p-4 text-center text-gray-500 text-sm">Đang tải...</div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 text-sm">
                      {products.length === 0 ? 'Chưa có sản phẩm' : 'Không tìm thấy'}
                    </div>
                  ) : (
                    filteredProducts.map(p => (
                      <button
                        key={p.item_id}
                        type="button"
                        onClick={() => {
                          setKeywordItemId(p.item_id.toString());
                          setShowProductDropdown(false);
                          setProductSearch('');
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 hover:bg-orange-50 text-left",
                          keywordItemId === p.item_id.toString() && "bg-orange-50"
                        )}
                      >
                        {p.image ? (
                          <img src={p.image} alt="" className="w-10 h-10 object-cover rounded" />
                        ) : (
                          <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center">
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate">{p.item_name}</p>
                          <p className="text-xs text-gray-400">ID: {p.item_id}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
                {products.length > 0 && (
                  <div className="p-2 border-t bg-gray-50 text-xs text-gray-500 text-center">
                    {products.length} sản phẩm
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 whitespace-nowrap w-20">Từ khóa:</span>
          <Input
            type="text"
            value={inputKeyword}
            onChange={(e) => setInputKeyword(e.target.value)}
            placeholder="Nhập từ khóa để lọc kết quả (tùy chọn)"
            className="flex-1"
          />
          <Button onClick={loadKeywords} disabled={keywordLoading || !keywordItemId} className="bg-orange-500 hover:bg-orange-600 flex-shrink-0">
            {keywordLoading ? 'Đang tải...' : 'Tìm từ khóa'}
          </Button>
        </div>

        <p className="text-xs text-gray-400">
          Chọn sản phẩm để lấy danh sách từ khóa đề xuất. Nhấn "+ Theo dõi" để theo dõi volume từ khóa.
        </p>
      </div>

      {/* Keywords Table */}
      <div className="bg-white rounded-lg border overflow-hidden flex-1">
        <DataTable
          columns={keywordColumns}
          data={keywords}
          loading={keywordLoading}
          loadingMessage="Đang tìm từ khóa..."
          emptyMessage="Chọn sản phẩm và nhấn Tìm từ khóa"
          pageSize={20}
        />
      </div>
    </div>
  );
}

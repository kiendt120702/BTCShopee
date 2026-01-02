"use client";

import FlashSalePanel from "@/components/panels/FlashSalePanel";
import { useShopeeAuth } from "@/hooks/useShopeeAuth";
import ConnectShopBanner from "@/components/shop/ConnectShopBanner";

export default function FlashSalePage() {
    const { token, isLoading, login: connectShopee, error: shopeeError } = useShopeeAuth();
    const isShopConnected = !!token?.shop_id;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 text-sm">Đang tải...</p>
                </div>
            </div>
        );
    }

    if (!isShopConnected) {
        return (
            <ConnectShopBanner
                onConnect={connectShopee}
                error={shopeeError}
                canConnect={true}
            />
        );
    }

    return <FlashSalePanel />;
}

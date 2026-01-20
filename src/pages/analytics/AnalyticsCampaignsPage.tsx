
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AnalyticsCampaignsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">Phân tích Chiến dịch</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Tổng quan Chiến dịch</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Chức năng đang phát triển...</p>
                </CardContent>
            </Card>
        </div>
    );
}

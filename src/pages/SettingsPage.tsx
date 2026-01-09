/**
 * Settings Page - Cài đặt hệ thống với tabs
 */

import { useState } from 'react';
import { Settings, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import ShopManagementPanel from '@/components/profile/ShopManagementPanel';

type TabKey = 'shops';

interface Tab {
  key: TabKey;
  title: string;
  icon: typeof Store;
}

const tabs: Tab[] = [
  { key: 'shops', title: 'Quản lý Shop', icon: Store },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('shops');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-br from-slate-600 to-slate-800 rounded-lg">
          <Settings className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cài đặt</h1>
          <p className="text-sm text-slate-500">Quản lý thông tin và cài đặt hệ thống</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="border-b border-slate-200">
          <nav className="flex gap-1 p-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all',
                    isActive
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.title}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'shops' && <ShopManagementPanel />}
        </div>
      </div>
    </div>
  );
}

# Implementation Plan: Flash Sale

## Overview

Triển khai chức năng Flash Sale theo thứ tự: Database → Edge Functions → Hooks → UI Components. Mỗi task được thiết kế để có thể test độc lập và build incrementally.

## Tasks

- [x] 1. Tạo Database Schema
  - [x] 1.1 Tạo migration cho bảng `apishopee_flash_sale_data`
    - Columns: id, shop_id, user_id, flash_sale_id, timeslot_id, status, start_time, end_time, enabled_item_count, item_count, type, remindme_count, click_count, raw_response, synced_at
    - Unique constraint: (shop_id, flash_sale_id)
    - Indexes: shop_id, user_id, type
    - Enable RLS policies
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 1.2 Tạo migration cho bảng `apishopee_sync_status`
    - Columns: id, shop_id, user_id, campaigns_synced_at, flash_sales_synced_at, is_syncing, last_sync_error, sync_progress, updated_at
    - Unique constraint: (shop_id, user_id)
    - Enable RLS policies
    - _Requirements: 11.4, 11.5_

- [x] 2. Tạo Flash Sale Utility Functions
  - [x] 2.1 Tạo file `src/lib/shopee/flash-sale/types.ts`
    - Define FlashSale, FlashSaleItem, FlashSaleItemModel, SyncStatus, TimeSlot interfaces
    - Define FlashSaleStatus, FlashSaleType types
    - Define STATUS_COLORS, TYPE_ICONS, TYPE_PRIORITY constants
    - _Requirements: 2.6, 2.7_

  - [x] 2.2 Tạo file `src/lib/shopee/flash-sale/utils.ts`
    - Implement `filterFlashSales(sales, filterType)` function
    - Implement `sortFlashSalesByPriority(sales)` function
    - Implement `paginateFlashSales(sales, page, itemsPerPage)` function
    - Implement `isDataStale(lastSyncedAt, staleMinutes)` function
    - Implement `getStatusColor(status)` function
    - Implement `getTypeIcon(type)` function
    - Implement `getErrorMessage(errorCode)` function
    - _Requirements: 1.6, 2.3, 2.4, 2.5, 2.6, 2.7, 12.1, 12.2_

  - [x] 2.3 Write property tests for utility functions
    - **Property 2: Staleness Detection**
    - **Property 3: Filter Logic Correctness**
    - **Property 4: Sort Priority Correctness**
    - **Property 5: Pagination Correctness**
    - **Property 6: UI Status and Type Mapping**
    - **Validates: Requirements 1.6, 2.3, 2.4, 2.5, 2.6, 2.7**

- [x] 3. Tạo Edge Function: apishopee-flash-sale
  - [x] 3.1 Tạo file `supabase/functions/apishopee-flash-sale/index.ts`
    - Setup CORS headers và Supabase client
    - Implement `getPartnerCredentials()` function (copy từ shopee-shop)
    - Implement `getTokenWithAutoRefresh()` function (copy từ shopee-shop)
    - Implement `callShopeeAPIWithRetry()` function (copy từ shopee-shop)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 3.2 Implement action handlers trong apishopee-flash-sale
    - `get-time-slots`: Call `/api/v2/shop_flash_sale/get_time_slot_id`
    - `create-flash-sale`: Call `/api/v2/shop_flash_sale/create_shop_flash_sale`
    - `get-flash-sale`: Call `/api/v2/shop_flash_sale/get_shop_flash_sale`
    - `get-flash-sale-list`: Call `/api/v2/shop_flash_sale/get_shop_flash_sale_list`
    - `update-flash-sale`: Call `/api/v2/shop_flash_sale/update_shop_flash_sale`
    - `delete-flash-sale`: Call `/api/v2/shop_flash_sale/delete_shop_flash_sale`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 7.1_

  - [x] 3.3 Implement item management actions
    - `add-items`: Call `/api/v2/shop_flash_sale/add_shop_flash_sale_items`
    - `get-items`: Call `/api/v2/shop_flash_sale/get_shop_flash_sale_items`
    - `update-items`: Call `/api/v2/shop_flash_sale/update_shop_flash_sale_items`
    - `delete-items`: Call `/api/v2/shop_flash_sale/delete_shop_flash_sale_items`
    - `get-criteria`: Call `/api/v2/shop_flash_sale/get_item_criteria`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2_

- [x] 4. Checkpoint - Test Edge Function
  - Deploy và test apishopee-flash-sale với các actions cơ bản
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Tạo Edge Function: apishopee-sync-worker
  - [x] 5.1 Tạo file `supabase/functions/apishopee-sync-worker/index.ts`
    - Setup CORS headers và Supabase client
    - Reuse token management functions từ apishopee-flash-sale
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 5.2 Implement sync-flash-sale-data action
    - Fetch Flash Sales từ Shopee API với pagination
    - Delete existing data cho shop_id
    - Insert new Flash Sale data vào `apishopee_flash_sale_data`
    - Update `apishopee_sync_status` với timestamp
    - Handle errors và update last_sync_error
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 5.3 Write property test for sync data integrity
    - **Property 1: Sync Data Integrity**
    - **Validates: Requirements 1.2, 1.3, 1.4**

- [x] 6. Checkpoint - Test Sync Worker
  - Deploy và test apishopee-sync-worker
  - Verify data được lưu đúng vào database
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Tạo React Hooks
  - [x] 7.1 Tạo file `src/hooks/useSyncData.ts`
    - Implement hook với options: shopId, userId, autoSyncOnMount, syncType, staleMinutes
    - Return: isSyncing, lastSyncedAt, lastError, isStale, triggerSync, syncStatus
    - Call apishopee-sync-worker edge function
    - Implement stale data detection
    - _Requirements: 1.1, 1.5, 1.6_

  - [x] 7.2 Tạo file `src/hooks/useRealtimeData.ts`
    - Implement generic hook với options: tableName, shopId, userId, orderBy, orderAsc
    - Return: data, loading, error, refetch
    - Setup Supabase Realtime subscription
    - Auto-refetch on database changes
    - _Requirements: 2.2_

- [x] 8. Tạo FlashSalePanel Component
  - [x] 8.1 Tạo file `src/components/panels/FlashSalePanel.tsx`
    - Setup component với props: shopId, userId
    - Integrate useSyncData và useRealtimeData hooks
    - Implement filter state và filter UI (All, Upcoming, Ongoing, Expired)
    - Implement pagination state và pagination UI
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 8.2 Implement Flash Sale list display
    - Display columns: ID, Time Slot, Status, Start Time, End Time, Item Count, Type
    - Apply sort by priority (Ongoing > Upcoming > Expired)
    - Apply status colors và type icons
    - _Requirements: 2.1, 2.4, 2.6, 2.7_

  - [x] 8.3 Implement Flash Sale actions
    - Sync button với loading state
    - Delete Flash Sale với confirmation dialog
    - Validate deletion only for Upcoming type
    - Show toast notifications cho success/error
    - _Requirements: 1.1, 7.1, 7.2, 7.3, 7.4, 12.1_

  - [x] 8.4 Write property test for deletion validation
    - **Property 9: Deletion Type Validation**
    - **Validates: Requirements 7.3**

- [x] 9. Checkpoint - Test UI Component
  - Test FlashSalePanel với real data
  - Verify filter, sort, pagination hoạt động đúng
  - Verify sync và delete actions
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Tạo Flash Sale Detail và Item Management
  - [x] 10.1 Tạo file `src/components/panels/FlashSaleDetailPanel.tsx`
    - Display Flash Sale details
    - List items trong Flash Sale
    - _Requirements: 5.1, 5.2, 8.4_

  - [x] 10.2 Implement Add Items dialog
    - Form để thêm items với variants hoặc không variants
    - Validate item structure trước khi submit
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 10.3 Implement Update/Delete Items
    - Edit item price và stock
    - Delete items từ Flash Sale
    - _Requirements: 8.5, 8.6_

  - [x] 10.4 Write property test for item request structure
    - **Property 10: Item Request Structure Validation**
    - **Validates: Requirements 8.2, 8.3**

- [x] 11. Tạo Create Flash Sale Flow
  - [x] 11.1 Tạo file `src/components/panels/CreateFlashSalePanel.tsx`
    - Fetch và display available time slots
    - Select time slot và create Flash Sale
    - Handle errors (already exist, not meet criteria)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

  - [x] 11.2 Write property tests for time slot và creation response
    - **Property 7: Time Slot Response Structure**
    - **Property 8: Flash Sale Creation Response**
    - **Validates: Requirements 3.4, 4.2**

- [x] 12. Final Integration và Error Handling
  - [x] 12.1 Implement comprehensive error handling
    - Map all known error codes to user-friendly messages
    - Display errors via toast notifications
    - Handle token refresh failures
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 12.2 Write property test for error response format
    - **Property 12: Error Response Format**
    - **Validates: Requirements 12.1, 12.2, 12.3**

  - [x] 12.3 Write property test for token refresh
    - **Property 11: Token Refresh Round Trip**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [x] 13. Final Checkpoint
  - Run all tests
  - Verify complete flow: Sync → View → Create → Update → Delete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property-based tests are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Edge Functions follow existing pattern từ `shopee-shop/index.ts`
- Database tables follow naming convention với prefix `apishopee_`

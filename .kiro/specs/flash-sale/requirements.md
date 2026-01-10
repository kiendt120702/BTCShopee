# Requirements Document

## Introduction

Chức năng Flash Sale cho phép người dùng quản lý các chương trình Flash Sale trên Shopee thông qua ứng dụng. Hệ thống bao gồm đồng bộ dữ liệu từ Shopee API, hiển thị realtime trên UI, và các thao tác CRUD (tạo, xem, cập nhật, xóa) Flash Sale cùng với quản lý sản phẩm trong Flash Sale.

## Glossary

- **Flash_Sale_System**: Hệ thống quản lý Flash Sale tổng thể
- **Flash_Sale_Panel**: Component UI chính hiển thị danh sách Flash Sale
- **Sync_Worker**: Edge Function xử lý đồng bộ dữ liệu từ Shopee
- **Flash_Sale_API**: Edge Function xử lý các actions trực tiếp với Shopee API
- **Time_Slot**: Khung giờ khả dụng để tạo Flash Sale
- **Flash_Sale**: Chương trình khuyến mãi Flash Sale trên Shopee
- **Flash_Sale_Item**: Sản phẩm trong một Flash Sale
- **Token_Manager**: Module quản lý và tự động refresh access token

## Requirements

### Requirement 1: Đồng bộ dữ liệu Flash Sale

**User Story:** As a shop owner, I want to sync Flash Sale data from Shopee, so that I can view all my Flash Sales in the application.

#### Acceptance Criteria

1. WHEN a user clicks the "Sync" button, THE Sync_Worker SHALL fetch all Flash Sales from Shopee API endpoint `/api/v2/shop_flash_sale/get_shop_flash_sale_list`
2. WHEN sync completes successfully, THE Sync_Worker SHALL store Flash Sale data in `apishopee_flash_sale_data` table with fields: flash_sale_id, timeslot_id, status, start_time, end_time, enabled_item_count, item_count, type, remindme_count, click_count, raw_response, synced_at
3. WHEN sync starts, THE Sync_Worker SHALL delete existing Flash Sale data for the shop before inserting new data
4. WHEN sync completes, THE Sync_Worker SHALL update `apishopee_sync_status` table with `flash_sales_synced_at` timestamp
5. IF sync fails due to API error, THEN THE Sync_Worker SHALL return error message and set `last_sync_error` in sync status
6. WHEN data is older than 5 minutes, THE Flash_Sale_System SHALL mark it as stale and suggest re-sync

### Requirement 2: Hiển thị danh sách Flash Sale

**User Story:** As a shop owner, I want to view my Flash Sales with filtering and pagination, so that I can easily manage them.

#### Acceptance Criteria

1. THE Flash_Sale_Panel SHALL display Flash Sales in a list with columns: ID, Time Slot, Status, Start Time, End Time, Item Count, Type
2. WHEN Flash Sale data changes in database, THE Flash_Sale_Panel SHALL automatically update via Supabase Realtime subscription
3. THE Flash_Sale_Panel SHALL provide filter options by type: All (0), Upcoming (1), Ongoing (2), Expired (3)
4. THE Flash_Sale_Panel SHALL sort Flash Sales by priority: Ongoing (highest) > Upcoming > Expired (lowest)
5. THE Flash_Sale_Panel SHALL paginate results with 20 items per page
6. WHEN displaying status, THE Flash_Sale_Panel SHALL show: Deleted (0) as Gray, Enabled (1) as Green, Disabled (2) as Yellow, Rejected (3) as Red
7. WHEN displaying type, THE Flash_Sale_Panel SHALL show: Upcoming (1) with ⏳ icon, Ongoing (2) with 🔥 icon, Expired (3) with ✓ icon

### Requirement 3: Lấy Time Slots khả dụng

**User Story:** As a shop owner, I want to see available time slots, so that I can create Flash Sales for specific time periods.

#### Acceptance Criteria

1. WHEN user requests time slots, THE Flash_Sale_API SHALL call Shopee API `/api/v2/shop_flash_sale/get_time_slot_id`
2. THE Flash_Sale_API SHALL accept optional parameters: start_time and end_time (Unix timestamps)
3. IF end_time is not provided, THE Flash_Sale_API SHALL default to 30 days from current time
4. THE Flash_Sale_API SHALL return list of time slots with: timeslot_id, start_time, end_time

### Requirement 4: Tạo Flash Sale mới

**User Story:** As a shop owner, I want to create a new Flash Sale, so that I can run promotional campaigns.

#### Acceptance Criteria

1. WHEN user creates Flash Sale with valid timeslot_id, THE Flash_Sale_API SHALL call Shopee API `/api/v2/shop_flash_sale/create_shop_flash_sale`
2. WHEN Flash Sale is created successfully, THE Flash_Sale_API SHALL return flash_sale_id and status (default: 2 - disabled)
3. IF Flash Sale already exists for the time slot, THEN THE Flash_Sale_API SHALL return error `shop_flash_sale_already_exist`
4. IF shop does not meet criteria, THEN THE Flash_Sale_API SHALL return error `shop_flash_sale.not_meet_shop_criteria`

### Requirement 5: Xem chi tiết Flash Sale

**User Story:** As a shop owner, I want to view Flash Sale details, so that I can see all information about a specific Flash Sale.

#### Acceptance Criteria

1. WHEN user requests Flash Sale details, THE Flash_Sale_API SHALL call Shopee API `/api/v2/shop_flash_sale/get_shop_flash_sale`
2. THE Flash_Sale_API SHALL return complete Flash Sale information including items, status, and statistics

### Requirement 6: Cập nhật trạng thái Flash Sale

**User Story:** As a shop owner, I want to enable or disable a Flash Sale, so that I can control when it is active.

#### Acceptance Criteria

1. WHEN user updates Flash Sale status, THE Flash_Sale_API SHALL call Shopee API `/api/v2/shop_flash_sale/update_shop_flash_sale`
2. THE Flash_Sale_API SHALL allow toggling between enabled (1) and disabled (2) status
3. IF Flash Sale is not upcoming or enabled, THEN THE Flash_Sale_API SHALL return error `shop_flash_sale_is_not_enabled_or_upcoming`

### Requirement 7: Xóa Flash Sale

**User Story:** As a shop owner, I want to delete a Flash Sale, so that I can remove unwanted campaigns.

#### Acceptance Criteria

1. WHEN user deletes Flash Sale, THE Flash_Sale_API SHALL call Shopee API `/api/v2/shop_flash_sale/delete_shop_flash_sale`
2. WHEN deletion succeeds on Shopee, THE Flash_Sale_System SHALL also delete the record from local database
3. THE Flash_Sale_System SHALL only allow deletion of Upcoming (type=1) Flash Sales
4. IF user attempts to delete Ongoing or Expired Flash Sale, THEN THE Flash_Sale_System SHALL show error message

### Requirement 8: Quản lý sản phẩm trong Flash Sale

**User Story:** As a shop owner, I want to add, update, and remove products from Flash Sales, so that I can manage promotional items.

#### Acceptance Criteria

1. WHEN user adds items to Flash Sale, THE Flash_Sale_API SHALL call Shopee API `/api/v2/shop_flash_sale/add_shop_flash_sale_items`
2. FOR items with variants, THE Flash_Sale_API SHALL accept: item_id, purchase_limit, and models array with model_id, input_promo_price, stock
3. FOR items without variants, THE Flash_Sale_API SHALL accept: item_id, purchase_limit, item_input_promo_price, item_stock
4. WHEN user requests item list, THE Flash_Sale_API SHALL call `/api/v2/shop_flash_sale/get_shop_flash_sale_items`
5. WHEN user updates items, THE Flash_Sale_API SHALL call `/api/v2/shop_flash_sale/update_shop_flash_sale_items`
6. WHEN user deletes items, THE Flash_Sale_API SHALL call `/api/v2/shop_flash_sale/delete_shop_flash_sale_items`
7. IF item count exceeds 50, THEN THE Flash_Sale_API SHALL return error `shop_flash_sale_exceed_max_item_limit`

### Requirement 9: Lấy tiêu chí sản phẩm

**User Story:** As a shop owner, I want to check product criteria, so that I can ensure products meet Flash Sale requirements.

#### Acceptance Criteria

1. WHEN user requests item criteria, THE Flash_Sale_API SHALL call Shopee API `/api/v2/shop_flash_sale/get_item_criteria`
2. THE Flash_Sale_API SHALL return discount requirements and eligibility criteria for products

### Requirement 10: Tự động refresh Token

**User Story:** As a system, I want to automatically refresh expired tokens, so that API calls don't fail due to authentication issues.

#### Acceptance Criteria

1. WHEN access token is expired or expiring within 5 minutes, THE Token_Manager SHALL automatically refresh using refresh_token
2. WHEN token refresh succeeds, THE Token_Manager SHALL save new tokens to `apishopee_shops` table
3. IF API call fails with `error_auth` or `Invalid access_token`, THEN THE Token_Manager SHALL refresh token and retry the API call once
4. WHEN token is refreshed, THE Token_Manager SHALL update: access_token, refresh_token, expired_at, token_updated_at

### Requirement 11: Database Schema cho Flash Sale

**User Story:** As a developer, I want proper database tables, so that Flash Sale data can be stored and queried efficiently.

#### Acceptance Criteria

1. THE Flash_Sale_System SHALL create table `apishopee_flash_sale_data` with columns: id, shop_id, user_id, flash_sale_id, timeslot_id, status, start_time, end_time, enabled_item_count, item_count, type, remindme_count, click_count, raw_response, synced_at
2. THE Flash_Sale_System SHALL create unique constraint on (shop_id, flash_sale_id)
3. THE Flash_Sale_System SHALL create indexes on shop_id, user_id, and type columns
4. THE Flash_Sale_System SHALL create table `apishopee_sync_status` with columns: id, shop_id, user_id, campaigns_synced_at, flash_sales_synced_at, is_syncing, last_sync_error, sync_progress, updated_at
5. THE Flash_Sale_System SHALL create unique constraint on (shop_id, user_id) for sync_status table

### Requirement 12: Error Handling

**User Story:** As a user, I want clear error messages, so that I can understand and resolve issues.

#### Acceptance Criteria

1. WHEN Shopee API returns error, THE Flash_Sale_System SHALL display user-friendly error message via toast notification
2. THE Flash_Sale_System SHALL handle common errors: `shop_flash_sale_already_exist`, `shop_flash_sale.not_meet_shop_criteria`, `shop_flash_sale_exceed_max_item_limit`, `shop_flash_sale_is_not_enabled_or_upcoming`, `shop_flash_sale_in_holiday_mode`
3. WHEN Edge Function encounters error, THE Flash_Sale_System SHALL return HTTP 200 with error in body to allow frontend to read error details
4. IF token refresh fails, THEN THE Flash_Sale_System SHALL prompt user to re-authenticate

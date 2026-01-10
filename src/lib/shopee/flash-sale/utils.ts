/**
 * Flash Sale Utility Functions
 * Filter, sort, pagination, and mapping utilities
 */

import {
  FlashSale,
  FlashSaleStatus,
  FlashSaleType,
  FilterType,
  STATUS_COLORS,
  STATUS_LABELS,
  TYPE_ICONS,
  TYPE_LABELS,
  TYPE_PRIORITY,
  STALE_MINUTES,
  ITEMS_PER_PAGE,
  ERROR_MESSAGES,
} from './types';

// ==================== FILTER FUNCTIONS ====================

/**
 * Filter Flash Sales by type
 * @param sales - Array of Flash Sales
 * @param filterType - Filter type ('0' = all, '1' = upcoming, '2' = ongoing, '3' = expired)
 * @returns Filtered array of Flash Sales
 */
export function filterFlashSales(
  sales: FlashSale[],
  filterType: FilterType
): FlashSale[] {
  if (filterType === '0') {
    return sales;
  }
  const typeNumber = Number(filterType) as FlashSaleType;
  return sales.filter((sale) => sale.type === typeNumber);
}

// ==================== SORT FUNCTIONS ====================

/**
 * Sort Flash Sales by priority (Ongoing > Upcoming > Expired)
 * @param sales - Array of Flash Sales
 * @returns Sorted array of Flash Sales
 */
export function sortFlashSalesByPriority(sales: FlashSale[]): FlashSale[] {
  return [...sales].sort((a, b) => {
    const priorityA = TYPE_PRIORITY[a.type] ?? 99;
    const priorityB = TYPE_PRIORITY[b.type] ?? 99;
    return priorityA - priorityB;
  });
}

/**
 * Sort Flash Sales by start time (newest first)
 * @param sales - Array of Flash Sales
 * @param ascending - Sort ascending if true, descending if false
 * @returns Sorted array of Flash Sales
 */
export function sortFlashSalesByStartTime(
  sales: FlashSale[],
  ascending = false
): FlashSale[] {
  return [...sales].sort((a, b) => {
    return ascending
      ? a.start_time - b.start_time
      : b.start_time - a.start_time;
  });
}

// ==================== PAGINATION FUNCTIONS ====================

/**
 * Paginate Flash Sales
 * @param sales - Array of Flash Sales
 * @param page - Current page number (1-indexed)
 * @param itemsPerPage - Number of items per page
 * @returns Paginated array of Flash Sales
 */
export function paginateFlashSales(
  sales: FlashSale[],
  page: number,
  itemsPerPage: number = ITEMS_PER_PAGE
): FlashSale[] {
  const startIndex = (page - 1) * itemsPerPage;
  return sales.slice(startIndex, startIndex + itemsPerPage);
}

/**
 * Calculate total pages
 * @param totalItems - Total number of items
 * @param itemsPerPage - Number of items per page
 * @returns Total number of pages
 */
export function calculateTotalPages(
  totalItems: number,
  itemsPerPage: number = ITEMS_PER_PAGE
): number {
  return Math.ceil(totalItems / itemsPerPage);
}

/**
 * Get pagination info
 * @param sales - Array of Flash Sales
 * @param page - Current page number (1-indexed)
 * @param itemsPerPage - Number of items per page
 * @returns Pagination info object
 */
export function getPaginationInfo(
  sales: FlashSale[],
  page: number,
  itemsPerPage: number = ITEMS_PER_PAGE
): {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
} {
  const totalItems = sales.length;
  const totalPages = calculateTotalPages(totalItems, itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

  return {
    currentPage: page,
    totalPages,
    totalItems,
    startIndex,
    endIndex,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

// ==================== STALENESS DETECTION ====================

/**
 * Check if data is stale (older than threshold)
 * @param lastSyncedAt - ISO timestamp of last sync
 * @param staleMinutes - Staleness threshold in minutes
 * @returns true if data is stale
 */
export function isDataStale(
  lastSyncedAt: string | null,
  staleMinutes: number = STALE_MINUTES
): boolean {
  if (!lastSyncedAt) {
    return true;
  }

  const lastSync = new Date(lastSyncedAt);
  const now = new Date();
  const diffMs = now.getTime() - lastSync.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  return diffMinutes > staleMinutes;
}

/**
 * Get time since last sync in human-readable format
 * @param lastSyncedAt - ISO timestamp of last sync
 * @returns Human-readable time string (Vietnamese)
 */
export function getTimeSinceSync(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) {
    return 'Chưa đồng bộ';
  }

  const lastSync = new Date(lastSyncedAt);
  const now = new Date();
  const diffMs = now.getTime() - lastSync.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) {
    return 'Vừa xong';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} phút trước`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} giờ trước`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ngày trước`;
}

// ==================== UI MAPPING FUNCTIONS ====================

/**
 * Get status color for UI display
 * @param status - Flash Sale status code
 * @returns Color string
 */
export function getStatusColor(status: FlashSaleStatus): string {
  return STATUS_COLORS[status] ?? 'gray';
}

/**
 * Get status label for UI display
 * @param status - Flash Sale status code
 * @returns Label string (Vietnamese)
 */
export function getStatusLabel(status: FlashSaleStatus): string {
  return STATUS_LABELS[status] ?? 'Không xác định';
}

/**
 * Get type icon for UI display
 * @param type - Flash Sale type code
 * @returns Icon string
 */
export function getTypeIcon(type: FlashSaleType): string {
  return TYPE_ICONS[type] ?? '?';
}

/**
 * Get type label for UI display
 * @param type - Flash Sale type code
 * @returns Label string (Vietnamese)
 */
export function getTypeLabel(type: FlashSaleType): string {
  return TYPE_LABELS[type] ?? 'Không xác định';
}

// ==================== ERROR HANDLING ====================

/**
 * Get user-friendly error message
 * @param errorCode - Error code from Shopee API
 * @returns User-friendly error message (Vietnamese)
 */
export function getErrorMessage(errorCode: string): string {
  // Check for exact match
  if (ERROR_MESSAGES[errorCode]) {
    return ERROR_MESSAGES[errorCode];
  }

  // Check for partial match (e.g., error message contains the code)
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (errorCode.includes(code) || code.includes(errorCode)) {
      return message;
    }
  }

  // Default error message
  return `Đã xảy ra lỗi: ${errorCode}`;
}

// ==================== TIME FORMATTING ====================

/**
 * Format Unix timestamp to readable date string
 * @param timestamp - Unix timestamp (seconds)
 * @returns Formatted date string
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format time range for display
 * @param startTime - Start Unix timestamp (seconds)
 * @param endTime - End Unix timestamp (seconds)
 * @returns Formatted time range string
 */
export function formatTimeRange(startTime: number, endTime: number): string {
  const start = new Date(startTime * 1000);
  const end = new Date(endTime * 1000);

  const startStr = start.toLocaleString('vi-VN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const endStr = end.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${startStr} - ${endStr}`;
}

// ==================== VALIDATION FUNCTIONS ====================

/**
 * Check if Flash Sale can be deleted (only Upcoming type)
 * @param flashSale - Flash Sale object
 * @returns true if can be deleted
 */
export function canDeleteFlashSale(flashSale: FlashSale): boolean {
  return flashSale.type === 1; // Only Upcoming can be deleted
}

/**
 * Check if Flash Sale can be edited
 * @param flashSale - Flash Sale object
 * @returns true if can be edited
 */
export function canEditFlashSale(flashSale: FlashSale): boolean {
  // Can only edit Upcoming or Enabled flash sales
  return flashSale.type === 1 || (flashSale.type === 2 && flashSale.status === 1);
}

/**
 * Validate Flash Sale item structure
 * @param item - Flash Sale item
 * @returns Validation result with error message if invalid
 */
export function validateFlashSaleItem(item: {
  item_id?: number;
  purchase_limit?: number;
  models?: Array<{ model_id?: number; input_promo_price?: number; stock?: number }>;
  item_input_promo_price?: number;
  item_stock?: number;
}): { valid: boolean; error?: string } {
  if (!item.item_id) {
    return { valid: false, error: 'item_id is required' };
  }

  if (item.purchase_limit === undefined || item.purchase_limit < 0) {
    return { valid: false, error: 'purchase_limit must be >= 0' };
  }

  // Check if it's a variant item or non-variant item
  const hasModels = item.models && item.models.length > 0;
  const hasItemPrice = item.item_input_promo_price !== undefined;

  if (hasModels) {
    // Validate variant item
    for (const model of item.models!) {
      if (!model.model_id) {
        return { valid: false, error: 'model_id is required for variant items' };
      }
      if (model.input_promo_price === undefined || model.input_promo_price <= 0) {
        return { valid: false, error: 'input_promo_price must be > 0' };
      }
      if (model.stock === undefined || model.stock < 0) {
        return { valid: false, error: 'stock must be >= 0' };
      }
    }
  } else if (hasItemPrice) {
    // Validate non-variant item
    if (item.item_input_promo_price! <= 0) {
      return { valid: false, error: 'item_input_promo_price must be > 0' };
    }
    if (item.item_stock === undefined || item.item_stock < 0) {
      return { valid: false, error: 'item_stock must be >= 0' };
    }
  } else {
    return { valid: false, error: 'Either models or item_input_promo_price is required' };
  }

  return { valid: true };
}

// ==================== COMBINED UTILITIES ====================

/**
 * Process Flash Sales for display (filter, sort, paginate)
 * @param sales - Array of Flash Sales
 * @param filterType - Filter type
 * @param page - Current page
 * @param itemsPerPage - Items per page
 * @returns Processed Flash Sales with pagination info
 */
export function processFlashSalesForDisplay(
  sales: FlashSale[],
  filterType: FilterType,
  page: number,
  itemsPerPage: number = ITEMS_PER_PAGE
): {
  data: FlashSale[];
  pagination: ReturnType<typeof getPaginationInfo>;
} {
  // 1. Filter
  const filtered = filterFlashSales(sales, filterType);

  // 2. Sort by priority
  const sorted = sortFlashSalesByPriority(filtered);

  // 3. Get pagination info before slicing
  const pagination = getPaginationInfo(sorted, page, itemsPerPage);

  // 4. Paginate
  const data = paginateFlashSales(sorted, page, itemsPerPage);

  return { data, pagination };
}

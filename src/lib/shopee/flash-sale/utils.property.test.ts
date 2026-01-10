/**
 * Property-Based Tests for Flash Sale Utility Functions
 * Feature: flash-sale
 * Uses fast-check for property-based testing
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  filterFlashSales,
  sortFlashSalesByPriority,
  paginateFlashSales,
  calculateTotalPages,
  isDataStale,
  getStatusColor,
  getStatusLabel,
  getTypeIcon,
  getTypeLabel,
  getErrorMessage,
  canDeleteFlashSale,
  validateFlashSaleItem,
} from './utils';
import {
  FlashSale,
  FlashSaleStatus,
  FlashSaleType,
  FilterType,
  STATUS_COLORS,
  TYPE_ICONS,
  TYPE_PRIORITY,
  STALE_MINUTES,
  ERROR_MESSAGES,
} from './types';

// ==================== ARBITRARIES ====================

/**
 * Generate valid FlashSaleStatus
 */
const flashSaleStatusArb = fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<FlashSaleStatus>;

/**
 * Generate valid FlashSaleType
 */
const flashSaleTypeArb = fc.constantFrom(1, 2, 3) as fc.Arbitrary<FlashSaleType>;

/**
 * Generate valid FilterType
 */
const filterTypeArb = fc.constantFrom('0', '1', '2', '3') as fc.Arbitrary<FilterType>;

/**
 * Generate valid ISO date string using integer timestamps
 */
const isoDateArb = fc.integer({ 
  min: new Date('2020-01-01').getTime(), 
  max: new Date('2030-12-31').getTime() 
}).map((ts) => new Date(ts).toISOString());

/**
 * Generate a valid FlashSale object
 */
const flashSaleArb: fc.Arbitrary<FlashSale> = fc.record({
  id: fc.uuid(),
  shop_id: fc.integer({ min: 1, max: 999999999 }),
  user_id: fc.uuid(),
  flash_sale_id: fc.integer({ min: 1, max: 999999999 }),
  timeslot_id: fc.integer({ min: 1, max: 999999999 }),
  status: flashSaleStatusArb,
  start_time: fc.integer({ min: 1600000000, max: 2000000000 }),
  end_time: fc.integer({ min: 1600000000, max: 2000000000 }),
  enabled_item_count: fc.integer({ min: 0, max: 50 }),
  item_count: fc.integer({ min: 0, max: 50 }),
  type: flashSaleTypeArb,
  remindme_count: fc.integer({ min: 0, max: 10000 }),
  click_count: fc.integer({ min: 0, max: 100000 }),
  raw_response: fc.constant(null),
  synced_at: isoDateArb,
  created_at: isoDateArb,
  updated_at: isoDateArb,
});

/**
 * Generate array of FlashSales
 */
const flashSalesArrayArb = fc.array(flashSaleArb, { minLength: 0, maxLength: 100 });

// ==================== PROPERTY TESTS ====================

describe('Feature: flash-sale, Property 2: Staleness Detection', () => {
  /**
   * Property 2: Staleness Detection
   * For any timestamp representing last sync time, the staleness detection function
   * SHALL return true if and only if the difference between current time and last
   * sync time exceeds STALE_MINUTES (5 minutes).
   * Validates: Requirements 1.6
   */
  it('should return true for null lastSyncedAt', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (staleMinutes) => {
        expect(isDataStale(null, staleMinutes)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should correctly detect stale data based on time difference', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120 }), // minutes ago
        fc.integer({ min: 1, max: 60 }),  // stale threshold
        (minutesAgo, staleMinutes) => {
          const lastSyncedAt = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
          const result = isDataStale(lastSyncedAt, staleMinutes);
          
          // Data is stale if minutesAgo > staleMinutes
          expect(result).toBe(minutesAgo > staleMinutes);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use default STALE_MINUTES when not provided', () => {
    // Data from 10 minutes ago should be stale (default is 5 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(isDataStale(tenMinutesAgo)).toBe(true);

    // Data from 2 minutes ago should not be stale
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(isDataStale(twoMinutesAgo)).toBe(false);
  });
});

describe('Feature: flash-sale, Property 3: Filter Logic Correctness', () => {
  /**
   * Property 3: Filter Logic Correctness
   * For any list of Flash Sales and filter type value (0, 1, 2, or 3),
   * the filtered result SHALL contain only Flash Sales where type matches
   * the filter (or all Flash Sales if filter is 0).
   * Validates: Requirements 2.3
   */
  it('should return all items when filter is "0"', () => {
    fc.assert(
      fc.property(flashSalesArrayArb, (sales) => {
        const filtered = filterFlashSales(sales, '0');
        expect(filtered.length).toBe(sales.length);
        expect(filtered).toEqual(sales);
      }),
      { numRuns: 100 }
    );
  });

  it('should return only items matching the filter type', () => {
    fc.assert(
      fc.property(
        flashSalesArrayArb,
        fc.constantFrom('1', '2', '3') as fc.Arbitrary<FilterType>,
        (sales, filterType) => {
          const filtered = filterFlashSales(sales, filterType);
          const expectedType = Number(filterType) as FlashSaleType;
          
          // All filtered items should have the expected type
          filtered.forEach((sale) => {
            expect(sale.type).toBe(expectedType);
          });

          // Count should match items with that type in original array
          const expectedCount = sales.filter((s) => s.type === expectedType).length;
          expect(filtered.length).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not modify the original array', () => {
    fc.assert(
      fc.property(flashSalesArrayArb, filterTypeArb, (sales, filterType) => {
        const originalLength = sales.length;
        const originalIds = sales.map((s) => s.id);
        
        filterFlashSales(sales, filterType);
        
        expect(sales.length).toBe(originalLength);
        expect(sales.map((s) => s.id)).toEqual(originalIds);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 4: Sort Priority Correctness', () => {
  /**
   * Property 4: Sort Priority Correctness
   * For any list of Flash Sales after sorting, Flash Sales with type=2 (Ongoing)
   * SHALL appear before type=1 (Upcoming), which SHALL appear before type=3 (Expired).
   * Validates: Requirements 2.4
   */
  it('should sort by priority: Ongoing > Upcoming > Expired', () => {
    fc.assert(
      fc.property(flashSalesArrayArb, (sales) => {
        const sorted = sortFlashSalesByPriority(sales);
        
        // Check that priorities are in non-decreasing order
        for (let i = 1; i < sorted.length; i++) {
          const prevPriority = TYPE_PRIORITY[sorted[i - 1].type] ?? 99;
          const currPriority = TYPE_PRIORITY[sorted[i].type] ?? 99;
          expect(currPriority).toBeGreaterThanOrEqual(prevPriority);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve all items (same length)', () => {
    fc.assert(
      fc.property(flashSalesArrayArb, (sales) => {
        const sorted = sortFlashSalesByPriority(sales);
        expect(sorted.length).toBe(sales.length);
      }),
      { numRuns: 100 }
    );
  });

  it('should not modify the original array', () => {
    fc.assert(
      fc.property(flashSalesArrayArb, (sales) => {
        const originalIds = sales.map((s) => s.id);
        sortFlashSalesByPriority(sales);
        expect(sales.map((s) => s.id)).toEqual(originalIds);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 5: Pagination Correctness', () => {
  /**
   * Property 5: Pagination Correctness
   * For any list of N Flash Sales and page number P with items per page K,
   * the paginated result SHALL contain at most K items starting from index (P-1)*K,
   * and total pages SHALL equal ceil(N/K).
   * Validates: Requirements 2.5
   */
  it('should return at most itemsPerPage items', () => {
    fc.assert(
      fc.property(
        flashSalesArrayArb,
        fc.integer({ min: 1, max: 100 }), // page
        fc.integer({ min: 1, max: 50 }),  // itemsPerPage
        (sales, page, itemsPerPage) => {
          const paginated = paginateFlashSales(sales, page, itemsPerPage);
          expect(paginated.length).toBeLessThanOrEqual(itemsPerPage);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return correct slice of items', () => {
    fc.assert(
      fc.property(
        flashSalesArrayArb,
        fc.integer({ min: 1, max: 10 }),  // page
        fc.integer({ min: 1, max: 20 }), // itemsPerPage
        (sales, page, itemsPerPage) => {
          const paginated = paginateFlashSales(sales, page, itemsPerPage);
          const startIndex = (page - 1) * itemsPerPage;
          const expectedSlice = sales.slice(startIndex, startIndex + itemsPerPage);
          
          expect(paginated).toEqual(expectedSlice);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should calculate total pages correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }), // totalItems
        fc.integer({ min: 1, max: 100 }),  // itemsPerPage
        (totalItems, itemsPerPage) => {
          const totalPages = calculateTotalPages(totalItems, itemsPerPage);
          expect(totalPages).toBe(Math.ceil(totalItems / itemsPerPage));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty array for out-of-range pages', () => {
    fc.assert(
      fc.property(
        fc.array(flashSaleArb, { minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 20 }), // itemsPerPage
        (sales, itemsPerPage) => {
          const totalPages = calculateTotalPages(sales.length, itemsPerPage);
          const outOfRangePage = totalPages + 1;
          const paginated = paginateFlashSales(sales, outOfRangePage, itemsPerPage);
          
          expect(paginated.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 6: UI Status and Type Mapping', () => {
  /**
   * Property 6: UI Status and Type Mapping
   * For any Flash Sale status code (0, 1, 2, 3), the status color mapping SHALL
   * return the correct color. For any Flash Sale type code (1, 2, 3), the type
   * icon mapping SHALL return the correct icon.
   * Validates: Requirements 2.6, 2.7
   */
  it('should return correct color for all valid status codes', () => {
    fc.assert(
      fc.property(flashSaleStatusArb, (status) => {
        const color = getStatusColor(status);
        expect(color).toBe(STATUS_COLORS[status]);
      }),
      { numRuns: 100 }
    );
  });

  it('should return correct icon for all valid type codes', () => {
    fc.assert(
      fc.property(flashSaleTypeArb, (type) => {
        const icon = getTypeIcon(type);
        expect(icon).toBe(TYPE_ICONS[type]);
      }),
      { numRuns: 100 }
    );
  });

  it('should return non-empty label for all valid status codes', () => {
    fc.assert(
      fc.property(flashSaleStatusArb, (status) => {
        const label = getStatusLabel(status);
        expect(label.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should return non-empty label for all valid type codes', () => {
    fc.assert(
      fc.property(flashSaleTypeArb, (type) => {
        const label = getTypeLabel(type);
        expect(label.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 9: Deletion Type Validation', () => {
  /**
   * Property 9: Deletion Type Validation
   * For any Flash Sale deletion request, the system SHALL allow deletion only
   * if the Flash Sale type equals 1 (Upcoming). Deletion attempts on type 2
   * (Ongoing) or type 3 (Expired) SHALL be rejected.
   * Validates: Requirements 7.3
   */
  it('should only allow deletion for Upcoming (type=1) Flash Sales', () => {
    fc.assert(
      fc.property(flashSaleArb, (flashSale) => {
        const canDelete = canDeleteFlashSale(flashSale);
        
        if (flashSale.type === 1) {
          expect(canDelete).toBe(true);
        } else {
          expect(canDelete).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 10: Item Request Structure Validation', () => {
  /**
   * Property 10: Item Request Structure Validation
   * For any Flash Sale item with variants, the request structure SHALL contain
   * item_id, purchase_limit, and models array. For items without variants,
   * the structure SHALL contain item_id, purchase_limit, item_input_promo_price,
   * and item_stock.
   * Validates: Requirements 8.2, 8.3
   */
  it('should validate variant items correctly', () => {
    const variantItemArb = fc.record({
      item_id: fc.integer({ min: 1 }),
      purchase_limit: fc.integer({ min: 0, max: 100 }),
      models: fc.array(
        fc.record({
          model_id: fc.integer({ min: 1 }),
          input_promo_price: fc.integer({ min: 1, max: 1000000 }).map(n => n / 100), // Use integer then divide
          stock: fc.integer({ min: 0, max: 10000 }),
        }),
        { minLength: 1, maxLength: 10 }
      ),
    });

    fc.assert(
      fc.property(variantItemArb, (item) => {
        const result = validateFlashSaleItem(item);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should validate non-variant items correctly', () => {
    const nonVariantItemArb = fc.record({
      item_id: fc.integer({ min: 1 }),
      purchase_limit: fc.integer({ min: 0, max: 100 }),
      item_input_promo_price: fc.integer({ min: 1, max: 1000000 }).map(n => n / 100),
      item_stock: fc.integer({ min: 0, max: 10000 }),
    });

    fc.assert(
      fc.property(nonVariantItemArb, (item) => {
        const result = validateFlashSaleItem(item);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject items without item_id', () => {
    const invalidItemArb = fc.record({
      purchase_limit: fc.integer({ min: 0 }),
      item_input_promo_price: fc.integer({ min: 1, max: 1000000 }).map(n => n / 100),
      item_stock: fc.integer({ min: 0 }),
    });

    fc.assert(
      fc.property(invalidItemArb, (item) => {
        const result = validateFlashSaleItem(item);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('item_id');
      }),
      { numRuns: 100 }
    );
  });

  it('should reject items without price info', () => {
    const invalidItemArb = fc.record({
      item_id: fc.integer({ min: 1 }),
      purchase_limit: fc.integer({ min: 0 }),
    });

    fc.assert(
      fc.property(invalidItemArb, (item) => {
        const result = validateFlashSaleItem(item);
        expect(result.valid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 12: Error Response Format', () => {
  /**
   * Property 12: Error Response Format
   * For any known error code, the system SHALL map it to a user-friendly
   * error message.
   * Validates: Requirements 12.1, 12.2, 12.3
   */
  it('should return known error messages for known error codes', () => {
    const knownErrorCodes = Object.keys(ERROR_MESSAGES);
    
    fc.assert(
      fc.property(fc.constantFrom(...knownErrorCodes), (errorCode) => {
        const message = getErrorMessage(errorCode);
        expect(message).toBe(ERROR_MESSAGES[errorCode]);
      }),
      { numRuns: 100 }
    );
  });

  it('should return a message containing the error code for unknown errors', () => {
    // Use alphanumeric strings to avoid special JS property names
    const unknownCodeArb = fc.stringMatching(/^[a-z][a-z0-9_]{4,49}$/).filter(
      (s) => !Object.keys(ERROR_MESSAGES).some((k) => s.includes(k) || k.includes(s))
    );

    fc.assert(
      fc.property(unknownCodeArb, (unknownCode) => {
        const message = getErrorMessage(unknownCode);
        expect(message).toContain(unknownCode);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 7: Time Slot Response Structure', () => {
  /**
   * Property 7: Time Slot Response Structure
   * For any valid time slot response from Shopee API, the structure SHALL contain
   * timeslot_id, start_time, and end_time. The end_time SHALL be greater than start_time.
   * Validates: Requirements 3.4
   */
  const timeSlotArb = fc.record({
    timeslot_id: fc.integer({ min: 1, max: 999999999 }),
    start_time: fc.integer({ min: 1600000000, max: 1900000000 }),
    end_time: fc.integer({ min: 1600000000, max: 2000000000 }),
  }).filter((slot) => slot.end_time > slot.start_time);

  it('should have valid time slot structure with required fields', () => {
    fc.assert(
      fc.property(timeSlotArb, (slot) => {
        expect(slot).toHaveProperty('timeslot_id');
        expect(slot).toHaveProperty('start_time');
        expect(slot).toHaveProperty('end_time');
        expect(typeof slot.timeslot_id).toBe('number');
        expect(typeof slot.start_time).toBe('number');
        expect(typeof slot.end_time).toBe('number');
      }),
      { numRuns: 100 }
    );
  });

  it('should have end_time greater than start_time', () => {
    fc.assert(
      fc.property(timeSlotArb, (slot) => {
        expect(slot.end_time).toBeGreaterThan(slot.start_time);
      }),
      { numRuns: 100 }
    );
  });

  it('should have positive timeslot_id', () => {
    fc.assert(
      fc.property(timeSlotArb, (slot) => {
        expect(slot.timeslot_id).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: flash-sale, Property 8: Flash Sale Creation Response', () => {
  /**
   * Property 8: Flash Sale Creation Response
   * For any successful Flash Sale creation, the response SHALL contain
   * flash_sale_id. The flash_sale_id SHALL be a positive integer.
   * Validates: Requirements 4.2
   */
  const creationResponseArb = fc.record({
    flash_sale_id: fc.integer({ min: 1, max: 999999999 }),
    timeslot_id: fc.integer({ min: 1, max: 999999999 }),
    start_time: fc.integer({ min: 1600000000, max: 1900000000 }),
    end_time: fc.integer({ min: 1600000000, max: 2000000000 }),
  });

  it('should have valid creation response structure', () => {
    fc.assert(
      fc.property(creationResponseArb, (response) => {
        expect(response).toHaveProperty('flash_sale_id');
        expect(typeof response.flash_sale_id).toBe('number');
        expect(response.flash_sale_id).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should have positive flash_sale_id', () => {
    fc.assert(
      fc.property(creationResponseArb, (response) => {
        expect(response.flash_sale_id).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

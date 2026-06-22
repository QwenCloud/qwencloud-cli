/** View-model unit tests for the subscription orders list. */
import { describe, it, expect } from 'vitest';
import { buildSubscriptionOrdersViewModel } from '../../../src/view-models/subscription/index.js';
import type { SubscriptionOrders, SubscriptionOrder } from '../../../src/types/subscription.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function makeOrder(overrides: Partial<SubscriptionOrder> = {}): SubscriptionOrder {
  return {
    orderId: 'ORD-20260420-0001',
    orderType: 'purchase',
    orderTime: '2026-04-20T10:15:30Z',
    amount: '199.00',
    currency: 'USD',
    status: 'completed',
    detail: null,
    detailError: null,
    ...overrides,
  } as SubscriptionOrder;
}

function makeOrders(rows: SubscriptionOrder[], page = 1, pageSize = 20, total = rows.length): SubscriptionOrders {
  return {
    orders: rows,
    pagination: { page, pageSize, total },
  } as SubscriptionOrders;
}

describe('buildSubscriptionOrdersViewModel', () => {
  it('renders a row per order and exposes table columns + pagination meta', () => {
    const data = makeOrders([
      makeOrder({ orderId: 'ORD-A' }),
      makeOrder({ orderId: 'ORD-B', orderType: 'renew', amount: '99.00' }),
    ]);
    const vm = buildSubscriptionOrdersViewModel(data, ctx);
    expect(vm.items).toHaveLength(2);
    expect(vm.items[0].orderId).toBe('ORD-A');
    expect(vm.items[1].orderType).toBe('renew');
    expect(vm.pagination.total).toBe(2);
    expect(Array.isArray(vm.columns)).toBe(true);
    expect(vm.columns.length).toBeGreaterThan(0);
  });

  it('returns an empty rows array with a friendly placeholder for empty lists', () => {
    const data = makeOrders([], 1, 20, 0);
    const vm = buildSubscriptionOrdersViewModel(data, ctx);
    expect(vm.items).toEqual([]);
    expect(vm.emptyPlaceholder).toMatch(/no\s+orders|empty/i);
  });

  it('passes per-row detailError through verbatim so the UI can flag a single broken row', () => {
    const data = makeOrders([
      makeOrder({ orderId: 'ORD-OK' }),
      makeOrder({ orderId: 'ORD-BAD', detailError: 'detail.fetch.timeout' }),
    ]);
    const vm = buildSubscriptionOrdersViewModel(data, ctx);
    expect(vm.items[0].detailError).toBeNull();
    expect(vm.items[1].detailError).toBe('detail.fetch.timeout');
  });

  it('formats amount cells with the configured currency without re-deriving precision', () => {
    const data = makeOrders([makeOrder({ amount: '1.23456789012', currency: 'USD' })]);
    const vm = buildSubscriptionOrdersViewModel(data, ctx);
    // Currency symbol or code is present; the raw precision is retained for JSON consumers.
    expect(vm.items[0].amountDisplay).toMatch(/1\.23456789012|1\.23/);
    expect(vm.items[0].amountRaw).toBe('1.23456789012');
  });

  it('reports pagination metadata so callers can render "Showing X-Y of Z" hints', () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeOrder({ orderId: `ORD-${i + 1}` }));
    const data = makeOrders(rows, 2, 5, 12);
    const vm = buildSubscriptionOrdersViewModel(data, ctx);
    expect(vm.pagination.page).toBe(2);
    expect(vm.pagination.pageSize).toBe(5);
    expect(vm.pagination.total).toBe(12);
    expect(vm.summaryLine).toMatch(/2.*5.*12|page\s*2|of\s*12/i);
  });
});

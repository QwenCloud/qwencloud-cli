/**
 * UI render tests for the SubscriptionOrders table.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { SubscriptionOrdersInk } from '../../src/ui/SubscriptionOrders.js';
import { buildSubscriptionOrdersViewModel } from '../../src/view-models/subscription/index.js';
import type {
  SubscriptionOrders,
  SubscriptionOrder,
} from '../../src/types/subscription.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function makeOrder(overrides: Partial<SubscriptionOrder> = {}): SubscriptionOrder {
  return {
    orderId: 'ORD-A',
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

function makeOrders(rows: SubscriptionOrder[], total = rows.length): SubscriptionOrders {
  return {
    orders: rows,
    pagination: { page: 1, pageSize: 20, total },
  } as SubscriptionOrders;
}

describe('SubscriptionOrders (rendered)', () => {
  it('renders one visible row per order with id and amount', () => {
    const vm = buildSubscriptionOrdersViewModel(
      makeOrders([makeOrder({ orderId: 'ORD-A' }), makeOrder({ orderId: 'ORD-B', amount: '99.00' })]),
      ctx,
    );
    const out = frame(<SubscriptionOrdersInk vm={vm} />);
    expect(out).toContain('ORD-A');
    expect(out).toContain('ORD-B');
    expect(out).toContain('199');
    expect(out).toContain('99');
  });

  it('renders a friendly placeholder for an empty list', () => {
    const vm = buildSubscriptionOrdersViewModel(makeOrders([], 0), ctx);
    const out = frame(<SubscriptionOrdersInk vm={vm} />);
    expect(out.toLowerCase()).toMatch(/no\s+orders|empty|—/);
  });

  it('flags rows with detailError so the user can see the partial failure', () => {
    const vm = buildSubscriptionOrdersViewModel(
      makeOrders([
        makeOrder({ orderId: 'ORD-OK' }),
        makeOrder({ orderId: 'ORD-BAD', detailError: 'detail.fetch.timeout' }),
      ]),
      ctx,
    );
    const out = frame(<SubscriptionOrdersInk vm={vm} />);
    expect(out).toContain('ORD-OK');
    expect(out).toContain('ORD-BAD');
    // Some visual indicator (asterisk/exclamation/text) flags the bad row.
    expect(out).toMatch(/ORD-BAD.*[!*⚠]|detail|error/i);
  });

  it('renders pagination summary line', () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeOrder({ orderId: `ORD-${i + 1}` }));
    const vm = buildSubscriptionOrdersViewModel(
      { orders: rows, pagination: { page: 2, pageSize: 5, total: 12 } } as SubscriptionOrders,
      ctx,
    );
    const out = frame(<SubscriptionOrdersInk vm={vm} />);
    expect(out).toMatch(/12|of\s*12|page\s*2/i);
  });
});

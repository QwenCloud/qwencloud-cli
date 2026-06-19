/**
 * View-model unit tests for the billing breakdown table.
 */
import { describe, it, expect } from 'vitest';
import { buildBillingBreakdownViewModel } from '../../../src/view-models/billing/index.js';
import type { ConsumeBreakdown } from '../../../src/types/billing-extra.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function makeBreakdown(overrides: Partial<ConsumeBreakdown> = {}): ConsumeBreakdown {
  return {
    groupBy: 'model',
    period: { from: '2026-04-01', to: '2026-04-30' },
    rows: [
      { groupKey: 'qwen-plus', groupLabel: 'qwen-plus', amount: '12.00' },
      { groupKey: 'qwen-max', groupLabel: 'qwen-max', amount: '8.00' },
    ],
    totalRows: 2,
    totalAmount: '20.00',
    currency: 'USD',
    ...overrides,
  } as ConsumeBreakdown;
}

describe('buildBillingBreakdownViewModel', () => {
  it('produces a table view model with rows and a totals row', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(), ctx);
    expect(vm.items).toHaveLength(2);
    expect(vm.total.amount).toBe('20');
  });

  it('emits a "Showing top X / Y" notice when truncation occurs', () => {
    const vm = buildBillingBreakdownViewModel(
      makeBreakdown({
        rows: Array.from({ length: 5 }, (_, i) => ({
          groupKey: `m-${i}`,
          groupLabel: `m-${i}`,
          amount: '1.00',
        })),
        totalRows: 20,
      }),
      ctx,
    );
    expect(vm.truncationNotice).toMatch(/showing top 5 \/ 20/i);
  });

  it('omits the truncation notice when no truncation occurred', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(), ctx);
    expect(vm.truncationNotice).toBeNull();
  });

  it('uses an api-key column header when group-by=api-key', () => {
    const vm = buildBillingBreakdownViewModel(
      makeBreakdown({ groupBy: 'api-key' }),
      ctx,
    );
    expect(vm.columns[0].header.toLowerCase()).toContain('api');
    expect(vm.columns.some(c => c.header === 'Amount')).toBe(true);
  });

  it('renders an em-dash for zero-amount rows', () => {
    const vm = buildBillingBreakdownViewModel(
      makeBreakdown({
        rows: [{ groupKey: 'free', groupLabel: 'Free Tier', amount: '0' }],
        totalAmount: '0',
      }),
      ctx,
    );
    expect(vm.items[0].cells.amount).toBe('—');
  });

  it('returns an empty rows array unchanged', () => {
    const vm = buildBillingBreakdownViewModel(
      makeBreakdown({ rows: [], totalRows: 0, totalAmount: '0' }),
      ctx,
    );
    expect(vm.items).toEqual([]);
    expect(vm.total.amount).toBe('—');
  });
});

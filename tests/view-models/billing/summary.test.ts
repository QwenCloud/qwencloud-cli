/**
 * View-model unit tests for the billing summary card.
 */
import { describe, it, expect } from 'vitest';
import { buildBillingSummaryViewModel } from '../../../src/view-models/billing/index.js';
import type { SettleBillSummary } from '../../../src/types/billing-extra.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function makeSummary(overrides: Partial<SettleBillSummary> = {}): SettleBillSummary {
  return {
    period: { from: '2026-04', to: '2026-04' },
    cycles: [
      {
        billingCycle: '2026-04',
        pretaxAmount: '100.00',
        tax: '10.00',
        aftertaxAmount: '110.00',
      },
    ],
    totals: {
      pretaxAmount: '100.00',
      tax: '10.00',
      aftertaxAmount: '110.00',
    },
    currency: 'USD',
    ...overrides,
  } as SettleBillSummary;
}

describe('buildBillingSummaryViewModel', () => {
  it('exposes the three total amount fields verbatim', () => {
    const vm = buildBillingSummaryViewModel(makeSummary(), ctx);
    expect(vm.totals.pretaxAmount).toBe('100.00');
    expect(vm.totals.tax).toBe('10.00');
    expect(vm.totals.aftertaxAmount).toBe('110.00');
  });

  it('sums cycles via string-precision math (avoids 0.1+0.2 drift)', () => {
    const vm = buildBillingSummaryViewModel(
      makeSummary({
        cycles: [
          {
            billingCycle: '2026-04',
            pretaxAmount: '0.1',
            tax: '0',
            aftertaxAmount: '0.1',
          },
          {
            billingCycle: '2026-05',
            pretaxAmount: '0.2',
            tax: '0',
            aftertaxAmount: '0.2',
          },
        ],
        totals: undefined as unknown as SettleBillSummary['totals'],
      }),
      ctx,
    );
    expect(vm.totals.pretaxAmount).toBe('0.3');
    expect(vm.totals.aftertaxAmount).toBe('0.3');
    expect(vm.totals.tax).toBe('0');
  });

  it('returns one cycle entry per billing cycle in order', () => {
    const vm = buildBillingSummaryViewModel(
      makeSummary({
        cycles: [
          {
            billingCycle: '2026-04',
            pretaxAmount: '10',
            tax: '1',
            aftertaxAmount: '11',
          },
          {
            billingCycle: '2026-05',
            pretaxAmount: '20',
            tax: '2',
            aftertaxAmount: '22',
          },
        ],
      }),
      ctx,
    );
    expect(vm.cycles.map((c) => c.billingCycle)).toEqual(['2026-04', '2026-05']);
  });

  it('renders an empty cycle list with zero totals', () => {
    const vm = buildBillingSummaryViewModel(
      makeSummary({
        cycles: [],
        totals: {
          pretaxAmount: '0',
          tax: '0',
          aftertaxAmount: '0',
        },
      }),
      ctx,
    );
    expect(vm.cycles).toEqual([]);
  });

  it('reads currency from the view context', () => {
    const vm = buildBillingSummaryViewModel(makeSummary(), { ...ctx, currency: 'CNY' });
    expect(vm.currency).toBe('CNY');
  });

  it('preserves zero-amount fields without converting them to em-dash', () => {
    const vm = buildBillingSummaryViewModel(makeSummary(), ctx);
    expect(vm.totals.aftertaxAmount).toBe('110.00');
  });
});

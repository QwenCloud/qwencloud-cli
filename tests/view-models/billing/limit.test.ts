/**
 * View-model unit tests for the billing limit card.
 */
import { describe, it, expect } from 'vitest';
import { buildBillingLimitViewModel } from '../../../src/view-models/billing/index.js';
import type { UsageLimit } from '../../../src/types/billing-extra.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function makeLimit(overrides: Partial<UsageLimit> = {}): UsageLimit {
  return {
    status: 'normal',
    limitAmount: '1000.00',
    currency: 'USD',
    alertThreshold: '80',
    ...overrides,
  } as UsageLimit;
}

describe('buildBillingLimitViewModel', () => {
  it('returns the three card fields in display order', () => {
    const vm = buildBillingLimitViewModel(makeLimit(), ctx);
    expect(vm.fields.map((f) => f.label)).toEqual([
      'Status',
      'Limit',
      'Alert threshold',
    ]);
  });

  it('reads the currency symbol from the view context', () => {
    const vm = buildBillingLimitViewModel(makeLimit(), { ...ctx, currency: 'CNY' });
    const limitField = vm.fields.find((f) => f.label === 'Limit');
    expect(limitField?.value).toMatch(/CNY|¥/);
  });

  it('formats a 0 alert threshold as "0%" rather than em-dash', () => {
    const vm = buildBillingLimitViewModel(makeLimit({ alertThreshold: '0' }), ctx);
    const t = vm.fields.find((f) => f.label === 'Alert threshold');
    expect(t?.value).toMatch(/^0(\.0+)?%$/);
  });

  it('uses em-dash for a null limit amount', () => {
    const vm = buildBillingLimitViewModel(makeLimit({ limitAmount: null }), ctx);
    const limitField = vm.fields.find((f) => f.label === 'Limit');
    expect(limitField?.value).toContain('—');
  });


});

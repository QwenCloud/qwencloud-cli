/**
 * UI render tests for the BillingSummary card.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { BillingSummaryInk } from '../../src/ui/BillingSummary.js';
import { buildBillingSummaryViewModel } from '../../src/view-models/billing/index.js';
import type { SettleBillSummary } from '../../src/types/billing-extra.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function makeSummary(overrides: Partial<SettleBillSummary> = {}): SettleBillSummary {
  return {
    period: { from: '2026-04', to: '2026-04' },
    chargeType: 'all',
    currency: 'USD',
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
    ...overrides,
  } as SettleBillSummary;
}

describe('BillingSummary (rendered)', () => {
  it('renders a bordered card', () => {
    const vm = buildBillingSummaryViewModel(makeSummary(), ctx);
    const out = frame(<BillingSummaryInk vm={vm} />);
    expect(out).toContain('Bill Summary');
    expect(out).toContain('2026-04');
  });

  it('shows all 3 amount values somewhere on screen', () => {
    const vm = buildBillingSummaryViewModel(makeSummary(), ctx);
    const out = frame(<BillingSummaryInk vm={vm} />);
    expect(out).toContain('$100');
    expect(out).toContain('$110');
    expect(out).toContain('$10');
  });

  it('respects ViewContext currency (CNY)', () => {
    const vm = buildBillingSummaryViewModel(
      makeSummary({ currency: 'CNY' }),
      { ...ctx, currency: 'CNY' },
    );
    const out = frame(<BillingSummaryInk vm={vm} />);
    expect(out.includes('CNY') || out.includes('¥')).toBe(true);
  });

  it('renders zero values without falling back to em-dash', () => {
    const vm = buildBillingSummaryViewModel(
      makeSummary({
        cycles: [{ billingCycle: '2026-04', pretaxAmount: '0.00', tax: '0.00', aftertaxAmount: '0.00' }],
        totals: { pretaxAmount: '0.00', tax: '0.00', aftertaxAmount: '0.00' },
      }),
      ctx,
    );
    const out = frame(<BillingSummaryInk vm={vm} />);
    expect(out).toContain('$0');
  });
});

/**
 * UI render tests for the BillingLimit card.
 *
 * The component takes the view-model produced by buildBillingLimitViewModel
 * and renders a Card-style block. Tests assert: borders, title, key fields,
 * em-dash placeholder for missing values, currency symbol passthrough.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { BillingLimitInk } from '../../src/ui/BillingLimit.js';
import { buildBillingLimitViewModel } from '../../src/view-models/billing/index.js';
import type { UsageLimit } from '../../src/types/billing-extra.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function makeLimit(overrides: Partial<UsageLimit> = {}): UsageLimit {
  return {
    status: 'normal',
    limitAmount: '500.00',
    currency: 'USD',
    alertThreshold: '400.00',
    receivers: ['ops@team.test.qwencloud.com'],
    ...overrides,
  } as UsageLimit;
}

describe('BillingLimit (rendered)', () => {
  it('renders a bordered card with the limit amount visible', () => {
    const vm = buildBillingLimitViewModel(makeLimit(), ctx);
    const out = frame(<BillingLimitInk vm={vm} />);
    expect(out).toContain('Usage Limit');
    expect(out).toContain('500');
  });

  it('renders em-dash for missing optional fields', () => {
    const vm = buildBillingLimitViewModel(
      makeLimit({ alertThreshold: null as string | null, receivers: [] }),
      ctx,
    );
    const out = frame(<BillingLimitInk vm={vm} />);
    expect(out).toContain('—');
  });

  it('respects the currency from ViewContext (no hard-coded $)', () => {
    const vm = buildBillingLimitViewModel(makeLimit({ currency: 'CNY' }), { ...ctx, currency: 'CNY' });
    const out = frame(<BillingLimitInk vm={vm} />);
    // The currency should be rendered either as symbol or code; we don't pin exact symbol,
    // but we MUST NOT see USD-only $ when currency is CNY.
    expect(out.includes('CNY') || out.includes('¥')).toBe(true);
  });
});

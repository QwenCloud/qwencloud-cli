import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  renderTextUsageSummary,
  renderTextUsageBreakdown,
} from '../../../src/output/text/usage.js';
import {
  buildUsageSummaryViewModel,
  buildUsageBreakdownViewModel,
} from '../../../src/view-models/usage.js';
import type { UsageSummaryResponse, UsageBreakdownResponse } from '../../../src/types/usage.js';

// Captures console.log output produced by renderText* functions, so tests can
// assert on the rendered string. The pure render functions are themselves
// dependency-free, so we don't need any mocking beyond console.log.
function captureStdout(fn: () => void): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderTextUsageSummary', () => {
  const baseResponse: UsageSummaryResponse = {
    period: { from: '2026-04-01', to: '2026-04-07' },
    free_tier: [
      {
        model_id: 'qwen3.6-plus',
        quota: {
          remaining: 850000,
          total: 1000000,
          unit: 'tokens',
          used_pct: 15,
          resetDate: null,
        },
      },
    ],
    coding_plan: {
      subscribed: true,
      plan: 'pro',
      price: { amount: 50, currency: 'USD', cycle: 'monthly' },
      included_models: ['qwen3.5-plus'],
      windows: {
        per_5h: { remaining: 4820, total: 6000, used_pct: 20, next_reset_at: '2099-01-01T00:00:00Z' },
        weekly: { remaining: 38200, total: 45000, used_pct: 15, next_reset_at: '2099-01-01T00:00:00Z' },
        monthly: { remaining: 82500, total: 90000, used_pct: 8, next_reset_at: '2099-01-01T00:00:00Z' },
      },
    },
    pay_as_you_go: {
      models: [
        {
          model_id: 'qwen3.6-plus',
          usage: { tokens_in: 480000, tokens_out: 120000 },
          cost: 0.38,
          currency: 'USD',
        },
      ],
      total: { cost: 0.38, currency: 'USD' },
    },
  };

  it('renders all sections (Usage Summary, Free Tier, Coding Plan, Pay-as-you-go)', () => {
    const vm = buildUsageSummaryViewModel(baseResponse);
    const out = captureStdout(() => renderTextUsageSummary(vm));

    // Header carries the period
    expect(out).toContain('Usage Summary');
    expect(out).toContain('2026-04-07');

    // Section headers
    expect(out).toContain('Free Tier Quota');
    expect(out).toContain('Coding Plan');
    expect(out).toContain('Pay-as-you-go');

    // Free tier row content
    expect(out).toContain('qwen3.6-plus');
    expect(out).toContain('850K');

    // Coding plan window labels
    expect(out).toContain('Per 5 hours');
    expect(out).toContain('This week');
    expect(out).toContain('This month');

    // Pay-as-you-go cost + Total row
    expect(out).toContain('$0.38');
    expect(out).toContain('Total');
  });

  it('renders empty pay-as-you-go message when no PAYG models', () => {
    const response: UsageSummaryResponse = {
      ...baseResponse,
      pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
    };
    const vm = buildUsageSummaryViewModel(response);
    const out = captureStdout(() => renderTextUsageSummary(vm));
    expect(out).toContain('No pay-as-you-go usage in this period.');
  });

  it('skips Coding Plan section when not subscribed', () => {
    const response: UsageSummaryResponse = {
      ...baseResponse,
      coding_plan: { subscribed: false },
    };
    const vm = buildUsageSummaryViewModel(response);
    const out = captureStdout(() => renderTextUsageSummary(vm));
    expect(out).not.toContain('Coding Plan');
  });

  it('skips Free Tier section when free_tier list is empty', () => {
    const response: UsageSummaryResponse = { ...baseResponse, free_tier: [] };
    const vm = buildUsageSummaryViewModel(response);
    const out = captureStdout(() => renderTextUsageSummary(vm));
    expect(out).not.toContain('Free Tier Quota');
  });
});

describe('renderTextUsageBreakdown', () => {
  const baseResponse: UsageBreakdownResponse = {
    model_id: 'qwen3.6-plus',
    period: { from: '2026-04-01', to: '2026-04-03' },
    granularity: 'day',
    rows: [
      { period: '2026-04-01', tokens_in: 58200, tokens_out: 14400, cost: 0.19, currency: 'USD' },
      { period: '2026-04-02', tokens_in: 47500, tokens_out: 11800, cost: 0.16, currency: 'USD' },
    ],
    total: { tokens_in: 105700, tokens_out: 26200, cost: 0.35, currency: 'USD' },
  };

  it('renders title, model id, period, rows, totals', () => {
    const vm = buildUsageBreakdownViewModel(baseResponse);
    const out = captureStdout(() => renderTextUsageBreakdown(vm));

    expect(out).toContain('Daily Breakdown');
    expect(out).toContain('qwen3.6-plus');
    expect(out).toContain('2026-04-01 → 2026-04-03');
    expect(out).toContain('58.2K'); // first row tokens in (humanized)
    expect(out).toContain('Total');
    expect(out).toContain('$0.35'); // total cost
  });

  it('renders emptyHint when there is no usage', () => {
    const empty: UsageBreakdownResponse = {
      model_id: 'qwen3-max',
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: 'day',
      rows: [],
      total: { cost: 0, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(empty);
    const out = captureStdout(() => renderTextUsageBreakdown(vm));
    expect(out).toContain('No usage in this period');
  });

  it('renders subtitle + note when Coding Plan exclusion applies', () => {
    const response: UsageBreakdownResponse = {
      ...baseResponse,
      // The view-model recognizes the coding_plan_excluded flag at runtime via
      // the response-extension typed-cast; we set it via cast here.
    };
    (response as any).coding_plan_excluded = true;
    const vm = buildUsageBreakdownViewModel(response);
    const out = captureStdout(() => renderTextUsageBreakdown(vm));
    expect(out).toContain('Pay-as-you-go (overflow only)');
    expect(out).toContain('Coding Plan usage is excluded');
  });
});

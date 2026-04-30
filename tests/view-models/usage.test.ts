import { describe, it, expect } from 'vitest';
import {
  buildUsageSummaryViewModel,
  buildUsageBreakdownViewModel,
} from '../../src/view-models/usage.js';
import type { UsageSummaryResponse, UsageBreakdownResponse } from '../../src/types/usage.js';

describe('buildUsageSummaryViewModel', () => {
  const mockResponse: UsageSummaryResponse = {
    period: { from: '2026-04-01', to: '2026-04-07' },
    free_tier: [
      {
        model_id: 'qwen3.6-plus',
        quota: { remaining: 850000, total: 1000000, unit: 'tokens', used_pct: 15, resetDate: null },
      },
      {
        model_id: 'wan2.6-t2i',
        quota: { remaining: 38, total: 50, unit: 'images', used_pct: 24, resetDate: null },
      },
      {
        model_id: 'qwen3.5-omni-plus',
        quota: null,
      },
    ],
    coding_plan: {
      subscribed: true,
      plan: 'pro',
      price: { amount: 50, currency: 'USD', cycle: 'monthly' },
      included_models: ['qwen3.5-plus', 'qwen3-max', 'kimi-k2.5'],
      windows: {
        per_5h: { remaining: 4820, total: 6000, used_pct: 20, next_reset_at: '2026-04-07T15:24:00Z' },
        weekly: { remaining: 38200, total: 45000, used_pct: 15, next_reset_at: '2026-04-13T16:00:00Z' },
        monthly: { remaining: 82500, total: 90000, used_pct: 8, next_reset_at: '2026-05-01T16:00:00Z' },
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
        {
          model_id: 'wan2.6-t2i',
          usage: { images: 45 },
          cost: 1.35,
          currency: 'USD',
        },
      ],
      total: { cost: 1.73, currency: 'USD' },
    },
  };

  it('builds view model with all sections', () => {
    const vm = buildUsageSummaryViewModel(mockResponse);

    expect(vm.period).toBe('2026-04-07');

    // Free Tier
    expect(vm.freeTier).toBeDefined();
    expect(vm.freeTier!.rows).toHaveLength(3);
    // Sorted by remaining% ascending (most urgent first)
    // wan2.6-t2i: used_pct=24 → remaining=76% comes before qwen3.6-plus: remaining=85%
    expect(vm.freeTier!.rows[0]).toMatchObject({
      modelId: 'wan2.6-t2i',
      remaining: '38 img',
      total: '50 img',
      progressBar: { percentage: 76, mode: 'remaining', label: '76%' },
      isFreeOnly: false,
    });
    expect(vm.freeTier!.rows[1]).toMatchObject({
      modelId: 'qwen3.6-plus',
      remaining: '850K tok',
      total: '1M tok',
      progressBar: { percentage: 85, mode: 'remaining', label: '85%' },
      isFreeOnly: false,
    });
    // isFreeOnly models (null quota) are sorted last
    expect(vm.freeTier!.rows[2]).toMatchObject({
      modelId: 'qwen3.5-omni-plus',
      isFreeOnly: true,
    });
    expect(vm.freeTier!.footer).toBe('3 models with free tier');

    // Coding Plan
    expect(vm.codingPlan).toBeDefined();
    expect(vm.codingPlan!.planName).toBe('PRO');
    expect(vm.codingPlan!.price).toBe('$50/mo');
    expect(vm.codingPlan!.windows).toHaveLength(3);
    expect(vm.codingPlan!.windows[0].usedPct).toBe(20);

    // Pay-as-you-go
    expect(vm.payAsYouGo).toBeDefined();
    expect(vm.payAsYouGo!.rows).toHaveLength(2);
    // Sorted by cost descending: wan2.6-t2i ($1.35) first, qwen3.6-plus ($0.38) second
    expect(vm.payAsYouGo!.rows[0].usage).toContain('img');
    expect(vm.payAsYouGo!.rows[1].usage).toContain('in');
    expect(vm.payAsYouGo!.rows[1].usage).toContain('out tok');
    expect(vm.payAsYouGo!.total.cost).toBe('$1.73');
  });

  it('skips coding plan when not subscribed', () => {
    const response = { ...mockResponse, coding_plan: { subscribed: false } };
    const vm = buildUsageSummaryViewModel(response as any);
    expect(vm.codingPlan).toBeUndefined();
  });

  it('handles empty pay-as-you-go', () => {
    const response = {
      ...mockResponse,
      pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
    };
    const vm = buildUsageSummaryViewModel(response);
    expect(vm.payAsYouGo!.isEmpty).toBe(true);
  });

  it('PAYG usage: collapses to single "X tok" when only tokens_in is present', () => {
    // Mirrors the real upstream behavior: API doesn't split in/out, so
    // tokens_out is missing/0. Without the collapse, the cell shows "—".
    const response = {
      ...mockResponse,
      pay_as_you_go: {
        models: [
          { model_id: 'qwen3.6-plus', usage: { tokens_in: 9_500_000 }, cost: 4.83, currency: 'USD' },
        ],
        total: { cost: 4.83, currency: 'USD' },
      },
    };
    const vm = buildUsageSummaryViewModel(response);
    expect(vm.payAsYouGo!.rows[0].usage).toBe('9.5M tok');
  });

  it('PAYG usage: keeps "in · out" format when tokens_out > 0 (forward-compat)', () => {
    const response = {
      ...mockResponse,
      pay_as_you_go: {
        models: [
          { model_id: 'future-llm', usage: { tokens_in: 1000, tokens_out: 500 }, cost: 0.10, currency: 'USD' },
        ],
        total: { cost: 0.10, currency: 'USD' },
      },
    };
    const vm = buildUsageSummaryViewModel(response);
    expect(vm.payAsYouGo!.rows[0].usage).toBe('1K in · 500 out tok');
  });
});

describe('buildUsageBreakdownViewModel', () => {
  const mockResponse: UsageBreakdownResponse = {
    model_id: 'qwen3.6-plus',
    period: { from: '2026-04-01', to: '2026-04-07' },
    granularity: 'day',
    rows: [
      { period: '2026-04-01', tokens_in: 58200, tokens_out: 14400, cost: 0.19, currency: 'USD' },
      { period: '2026-04-02', tokens_in: 47500, tokens_out: 11800, cost: 0.16, currency: 'USD' },
    ],
    total: { tokens_in: 105700, tokens_out: 26200, cost: 0.35, currency: 'USD' },
  };

  it('builds breakdown view model for token-based model', () => {
    const vm = buildUsageBreakdownViewModel(mockResponse);

    expect(vm.title).toBe('Daily Breakdown');
    expect(vm.modelId).toBe('qwen3.6-plus');
    expect(vm.period).toBe('2026-04-01 → 2026-04-07');
    expect(vm.rows).toHaveLength(2);
    expect(vm.columns).toHaveLength(4); // Date, Tokens (in), Tokens (out), Cost

    expect(vm.rows[0].cells.tokensIn).toBe('58.2K');
    expect(vm.rows[0].cells.tokensOut).toBe('14.4K');
    expect(vm.rows[0].cells.cost).toBe('$0.19');

    expect(vm.total.cells.cost).toBe('$0.35');
  });

  it('marks today row correctly', () => {
    const today = new Date().toISOString().slice(0, 10);
    const response: UsageBreakdownResponse = {
      ...mockResponse,
      rows: [{ period: today, tokens_in: 50000, tokens_out: 10000, cost: 0.10, currency: 'USD' }],
      total: { tokens_in: 50000, tokens_out: 10000, cost: 0.10, currency: 'USD' },
    };

    const vm = buildUsageBreakdownViewModel(response);
    expect(vm.rows[0].isToday).toBe(true);
  });

  it('changes title based on granularity', () => {
    const monthResponse = { ...mockResponse, granularity: 'month' as const };
    const vm = buildUsageBreakdownViewModel(monthResponse);
    expect(vm.title).toBe('Monthly Breakdown');

    const quarterResponse = { ...mockResponse, granularity: 'quarter' as const };
    const vm2 = buildUsageBreakdownViewModel(quarterResponse);
    expect(vm2.title).toBe('Quarterly Breakdown');
  });

  it('marks isEmpty and adds emptyHint when there are no rows', () => {
    const emptyResponse: UsageBreakdownResponse = {
      model_id: 'qwen3-max',
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: 'day',
      rows: [],
      total: { cost: 0, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(emptyResponse);
    expect(vm.isEmpty).toBe(true);
    expect(vm.emptyHint).toBe('No usage in this period — try a wider --period.');
    expect(vm.rows).toHaveLength(0);
  });

  it('does not set emptyHint when rows exist', () => {
    const vm = buildUsageBreakdownViewModel(mockResponse);
    expect(vm.isEmpty).toBe(false);
    expect(vm.emptyHint).toBeUndefined();
  });

  it('adapts columns for image-based billing', () => {
    const imageResponse: any = {
      model_id: 'qwen-image-2.0-pro',
      period: { from: '2026-04-01', to: '2026-04-03' },
      granularity: 'day',
      rows: [
        { period: '2026-04-01', usage: { images: 20 }, cost: 0.60, currency: 'USD' },
      ],
      total: { usage: { images: 20 }, cost: 0.60, currency: 'USD' },
    };

    const vm = buildUsageBreakdownViewModel(imageResponse);
    const colKeys = vm.columns.map(c => c.key);
    expect(colKeys).toContain('images');
    expect(colKeys).not.toContain('tokensIn');
  });

  it('uses billingUnitOverride to pick headers regardless of row content', () => {
    // Mimics the real-world bug: image model returned with empty rows OR
    // rows that only carry tokens_in: 0 / tokens_out: 0. Without the override,
    // headers would default to "Tokens (in/out)".
    const response: UsageBreakdownResponse = {
      model_id: 'qwen-image-2.0-pro',
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: 'day',
      rows: [],
      total: { cost: 0, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(response, { billingUnitOverride: 'images' });
    const colKeys = vm.columns.map(c => c.key);
    expect(colKeys).toEqual(['period', 'images', 'cost']);
    expect(vm.total.cells.images).toBe('0');
    expect(vm.total.cells.tokensIn).toBeUndefined();
  });

  it('reads non-token totals from response.total.usage', () => {
    const response: UsageBreakdownResponse = {
      model_id: 'wan2.6-r2v',
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: 'day',
      rows: [
        { period: '2026-04-01', usage: { seconds: 10 }, cost: 0.50, currency: 'USD' },
      ],
      total: { usage: { seconds: 10 }, cost: 0.50, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(response, { billingUnitOverride: 'seconds' });
    // The numeric value from summary (10 sec) must round-trip into breakdown.
    expect(vm.total.cells.seconds).toBe('10');
    expect(vm.rows[0].cells.seconds).toBe('10');
  });

  it('collapses to single "Tokens" column when no row carries tokens_out', () => {
    // The upstream billing API doesn't split in/out, so tokens_out is always 0.
    // Auto-collapse to a single column to avoid the misleading "0" output column.
    const response: UsageBreakdownResponse = {
      model_id: 'qwen3.6-plus',
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: 'day',
      rows: [
        { period: '2026-04-18', tokens_in: 5_800_000, cost: 2.93, currency: 'USD' },
      ],
      total: { tokens_in: 5_800_000, cost: 2.93, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(response, { billingUnitOverride: 'tokens' });
    const colKeys = vm.columns.map((c) => c.key);
    expect(colKeys).toEqual(['period', 'tokens', 'cost']);
    expect(vm.rows[0].cells.tokens).toBe('5.8M');
    expect(vm.rows[0].cells.tokensIn).toBeUndefined();
    expect(vm.total.cells.tokens).toBe('5.8M');
    expect(vm.total.cells.tokensOut).toBeUndefined();
  });

  it('keeps two-column "Tokens (in/out)" when any row carries tokens_out > 0', () => {
    // Forward-compatible: when the upstream API eventually splits in/out, the
    // existing two-column layout kicks in automatically without a code change.
    const response: UsageBreakdownResponse = {
      model_id: 'future-llm',
      period: { from: '2026-04-01', to: '2026-04-07' },
      granularity: 'day',
      rows: [
        { period: '2026-04-01', tokens_in: 58200, tokens_out: 14400, cost: 0.19, currency: 'USD' },
      ],
      total: { tokens_in: 58200, tokens_out: 14400, cost: 0.19, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(response);
    const colKeys = vm.columns.map((c) => c.key);
    expect(colKeys).toEqual(['period', 'tokensIn', 'tokensOut', 'cost']);
    expect(vm.rows[0].cells.tokensIn).toBe('58.2K');
    expect(vm.rows[0].cells.tokensOut).toBe('14.4K');
    expect(vm.rows[0].cells.tokens).toBeUndefined();
  });

  it('empty token model collapses to single column with 0', () => {
    const response: UsageBreakdownResponse = {
      model_id: 'qwen3-max',
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: 'day',
      rows: [],
      total: { cost: 0, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(response, { billingUnitOverride: 'tokens' });
    const colKeys = vm.columns.map((c) => c.key);
    expect(colKeys).toEqual(['period', 'tokens', 'cost']);
    expect(vm.total.cells.tokens).toBe('0');
  });

  it('billingUnitOverride=seconds builds Duration column for video/audio models', () => {
    const response: UsageBreakdownResponse = {
      model_id: 'wan2.7-r2v',
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: 'day',
      rows: [],
      total: { cost: 0, currency: 'USD' },
    };
    const vm = buildUsageBreakdownViewModel(response, { billingUnitOverride: 'seconds' });
    const colKeys = vm.columns.map(c => c.key);
    expect(colKeys).toContain('seconds');
    expect(colKeys).not.toContain('tokensIn');
    expect(vm.total.cells.seconds).toBe('0');
  });
});

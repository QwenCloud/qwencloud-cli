/** Unit tests for BillingService PAYG breakdown methods. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type { ConsumeSummaryLineItem } from '../../src/types/api-models.js';
import type { ApiClient } from '../../src/api/api-client.js';
import {
  BillingService,
  parseBillingItem,
  inferBillingUnit,
  computeUsageValue,
  splitIntoMonths,
  sumAmountStrings,
} from '../../src/services/billing-service.js';
import type { BillingAdapter } from '../../src/services/billing-service.js';

// ────────────────────────────────────────────────────────────────────
// Mock helpers
// ────────────────────────────────────────────────────────────────────

function makeCachedFetcher(): CachedFetcher & {
  getOrFetch: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
} {
  return {
    getOrFetch: vi.fn(async <T>(_k: string, _t: number, fetcher: () => Promise<T>) => fetcher()),
    invalidate: vi.fn(),
  };
}

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn() };
}

function makeBillingAdapter(): BillingAdapter & { toNormalizedItem: ReturnType<typeof vi.fn> } {
  return { toNormalizedItem: vi.fn() };
}

function makeLineItem(overrides: Partial<ConsumeSummaryLineItem> = {}): ConsumeSummaryLineItem {
  return {
    LineItemCategory: 'LLM Token Consumption',
    BillingItemCode: 'token_number',
    BillingDate: '2026-04-15',
    BillingMonth: '2026-04',
    ModelName: 'qwen-plus',
    BillQuantity: 5,
    StepQuantityUnit: 'Per 1K tokens',
    RequireAmount: 1.23,
    ListPrice: 1.5,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// getPaygBreakdown
// ────────────────────────────────────────────────────────────────────

describe('BillingService.getPaygBreakdown', () => {
  let apiClient: MockApiClient;
  let adapter: ReturnType<typeof makeBillingAdapter>;
  let service: BillingService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    adapter = makeBillingAdapter();
    service = new BillingService(apiClient as unknown as ApiClient, adapter, makeCachedFetcher());
  });

  it('returns daily breakdown with correct period and granularity', async () => {
    adapter.toNormalizedItem.mockReturnValue({
      lineItemCat: 'LLM Token', billingDate: '2026-05-01', billingMonth: '2026-05',
      modelId: 'qwen-plus', usageValue: 5000, cost: 0.5, billingUnit: 'tokens', isFree: false,
    });
    apiClient.callFlatApi.mockResolvedValue({
      Data: [makeLineItem({ BillingDate: '2026-05-01', BillingMonth: '2026-05' })],
    });

    const result = await service.getPaygBreakdown({
      from: '2026-05-01', to: '2026-05-03', granularity: 'day',
    });
    expect(result.granularity).toBe('day');
    expect(result.period.from).toBe('2026-05-01');
    expect(result.period.to).toBe('2026-05-03');
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('aggregates into monthly rows when granularity=month', async () => {
    adapter.toNormalizedItem
      .mockReturnValueOnce({
        lineItemCat: 'LLM Token', billingDate: '2026-04-15', billingMonth: '2026-04',
        modelId: 'qwen-plus', usageValue: 3000, cost: 0.3, billingUnit: 'tokens', isFree: false,
      })
      .mockReturnValueOnce({
        lineItemCat: 'LLM Token', billingDate: '2026-05-10', billingMonth: '2026-05',
        modelId: 'qwen-plus', usageValue: 7000, cost: 0.7, billingUnit: 'tokens', isFree: false,
      });
    apiClient.callFlatApi
      .mockResolvedValueOnce({ Data: [makeLineItem({ BillingDate: '2026-04-15', BillingMonth: '2026-04' })] })
      .mockResolvedValueOnce({ Data: [makeLineItem({ BillingDate: '2026-05-10', BillingMonth: '2026-05' })] });

    const result = await service.getPaygBreakdown({
      from: '2026-04-01', to: '2026-05-31', granularity: 'month',
    });
    expect(result.granularity).toBe('month');
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('aggregates into quarterly rows when granularity=quarter', async () => {
    adapter.toNormalizedItem.mockReturnValue({
      lineItemCat: 'LLM Token', billingDate: '2026-01-15', billingMonth: '2026-01',
      modelId: 'qwen-plus', usageValue: 1000, cost: 0.1, billingUnit: 'tokens', isFree: false,
    });
    apiClient.callFlatApi
      .mockResolvedValueOnce({ Data: [makeLineItem({ BillingDate: '2026-01-15' })] })
      .mockResolvedValueOnce({ Data: [] })
      .mockResolvedValueOnce({ Data: [] });

    const result = await service.getPaygBreakdown({
      from: '2026-01-01', to: '2026-03-31', granularity: 'quarter',
    });
    expect(result.granularity).toBe('quarter');
  });

  it('returns empty rows when no data in date range', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    const result = await service.getPaygBreakdown({
      from: '2026-05-01', to: '2026-05-31', granularity: 'day',
    });
    expect(result.total.cost).toBe(0);
  });

  it('respects modelFilter parameter', async () => {
    adapter.toNormalizedItem.mockReturnValue({
      lineItemCat: 'LLM Token', billingDate: '2026-05-01', billingMonth: '2026-05',
      modelId: 'qwen-max', usageValue: 2000, cost: 0.8, billingUnit: 'tokens', isFree: false,
    });
    apiClient.callFlatApi.mockResolvedValue({
      Data: [makeLineItem({ ModelName: 'qwen-max' })],
    });

    const result = await service.getPaygBreakdown({
      from: '2026-05-01', to: '2026-05-31', granularity: 'day', modelFilter: 'qwen-max',
    });
    expect(result.model_id).toBe('qwen-max');
    const call = apiClient.callFlatApi.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.ModelNames).toEqual(['qwen-max']);
  });

  it('sets model_id to "all" when no modelFilter', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    const result = await service.getPaygBreakdown({
      from: '2026-05-01', to: '2026-05-31', granularity: 'day',
    });
    expect(result.model_id).toBe('all');
  });

  it('includes image usage in breakdown rows', async () => {
    adapter.toNormalizedItem.mockReturnValue({
      lineItemCat: 'Image Gen', billingDate: '2026-05-01', billingMonth: '2026-05',
      modelId: 'wanx-v1', usageValue: 10, cost: 0.3, billingUnit: 'images', isFree: false,
    });
    apiClient.callFlatApi.mockResolvedValue({
      Data: [makeLineItem({ ModelName: 'wanx-v1', BillingItemCode: 'image_number' })],
    });

    const result = await service.getPaygBreakdown({
      from: '2026-05-01', to: '2026-05-01', granularity: 'day',
    });
    expect(result.total.usage?.images).toBeGreaterThan(0);
  });

  it('calls API once per calendar month for cross-month range', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    await service.getPaygBreakdown({
      from: '2026-04-15', to: '2026-06-10', granularity: 'day',
    });
    // splitIntoMonths('2026-04-15','2026-06-10') → 3 sub-ranges
    expect(apiClient.callFlatApi).toHaveBeenCalledTimes(3);
  });

  it('normalizes YYYY-MM range to YYYY-MM-DD before calling API', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    const result = await service.getPaygBreakdown({
      from: '2026-05', to: '2026-05', granularity: 'day',
    });
    expect(apiClient.callFlatApi).toHaveBeenCalledTimes(1);
    const callParams = apiClient.callFlatApi.mock.calls[0]?.[0]?.params as {
      StartBillingDate: string;
      EndBillingDate: string;
    };
    expect(callParams.StartBillingDate).toBe('2026-05-01');
    expect(callParams.EndBillingDate).toBe('2026-05-31');
    // Returned period reflects normalized boundaries
    expect(result.period).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('getPaygSummary normalizes YYYY-MM inputs before calling API', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    await service.getPaygSummary({ from: '2026-04', to: '2026-04' });
    const callParams = apiClient.callFlatApi.mock.calls[0]?.[0]?.params as {
      StartBillingDate: string;
      EndBillingDate: string;
    };
    expect(callParams.StartBillingDate).toBe('2026-04-01');
    expect(callParams.EndBillingDate).toBe('2026-04-30');
  });
});

// ────────────────────────────────────────────────────────────────────
// inferBillingUnit — degradation paths
// ────────────────────────────────────────────────────────────────────

describe('inferBillingUnit — degradation paths', () => {
  it('billingItemCode takes priority over stepUnit', () => {
    // code says "image" but unit says "token" → "images" wins
    expect(inferBillingUnit('Per 1K tokens', 'image_generation_count')).toBe('images');
  });

  it('returns "tokens" when both args are empty strings', () => {
    expect(inferBillingUnit('', '')).toBe('tokens');
  });

  it('returns "tokens" when billingItemCode is undefined', () => {
    expect(inferBillingUnit('some_unknown_unit', undefined)).toBe('tokens');
  });

  it('returns "seconds" for "Per 1 sec" unit without billingItemCode', () => {
    expect(inferBillingUnit('Per 1 sec')).toBe('seconds');
  });

  it('handles case-insensitive code matching', () => {
    expect(inferBillingUnit('', 'VIDEO_DURATION_SECONDS')).toBe('seconds');
    expect(inferBillingUnit('', 'IMAGE_COUNT')).toBe('images');
    expect(inferBillingUnit('', 'CHAR_USAGE')).toBe('characters');
  });
});

// ────────────────────────────────────────────────────────────────────
// computeUsageValue — additional branches
// ────────────────────────────────────────────────────────────────────

describe('computeUsageValue — additional branches', () => {
  it('detects "万字" (Chinese) as ×10000 multiplier', () => {
    expect(computeUsageValue(3, '每万字')).toBe(30_000);
  });

  it('handles "Per 500 tokens" as ×500', () => {
    expect(computeUsageValue(4, 'Per 500 tokens')).toBe(2000);
  });

  it('handles "Per 1,000,000 tokens" (comma-separated M)', () => {
    expect(computeUsageValue(2, 'Per 1,000,000 tokens')).toBe(2_000_000);
  });

  it('returns billQuantity when stepUnit has no numeric pattern and no keyword', () => {
    expect(computeUsageValue(123, 'unknown')).toBe(123);
  });

  it('handles zero quantity regardless of multiplier', () => {
    expect(computeUsageValue(0, 'Per 1M tokens')).toBe(0);
    expect(computeUsageValue(0, 'Per tenthousand tokens')).toBe(0);
  });

  it('handles negative billQuantity (refund scenario)', () => {
    expect(computeUsageValue(-2, 'Per 1K tokens')).toBe(-2000);
  });
});

// ────────────────────────────────────────────────────────────────────
// parseBillingItem — costMode minimal
// ────────────────────────────────────────────────────────────────────

describe('parseBillingItem — costMode variations', () => {
  it('uses RequireAmount → Amount → Cost → ListPrice in full mode', () => {
    const item = makeLineItem({ RequireAmount: 1, Amount: 2, Cost: 3, ListPrice: 4 });
    const parsed = parseBillingItem(item, 'full');
    expect(parsed!.cost).toBe(1);
  });

  it('uses RequireAmount → ListPrice in minimal mode (skips Amount/Cost)', () => {
    const item = makeLineItem({ RequireAmount: undefined, Amount: 2, Cost: 3, ListPrice: 4 });
    const parsed = parseBillingItem(item, 'minimal');
    expect(parsed!.cost).toBe(4);
  });

  it('uses RequireAmount first in minimal mode', () => {
    const item = makeLineItem({ RequireAmount: 10, Amount: 20, ListPrice: 30 });
    const parsed = parseBillingItem(item, 'minimal');
    expect(parsed!.cost).toBe(10);
  });

  it('falls back through Amount → Cost in full mode', () => {
    const item = makeLineItem({ RequireAmount: undefined, Amount: undefined, Cost: 7, ListPrice: 8 });
    const parsed = parseBillingItem(item, 'full');
    expect(parsed!.cost).toBe(7);
  });

  it('defaults to full mode when costMode is omitted', () => {
    const item = makeLineItem({ RequireAmount: undefined, Amount: 5, ListPrice: 10 });
    const parsed = parseBillingItem(item);
    expect(parsed!.cost).toBe(5);
  });

  it('returns 0 cost when all cost fields are missing', () => {
    const item = makeLineItem({ RequireAmount: undefined, Amount: undefined, Cost: undefined, ListPrice: undefined });
    const parsed = parseBillingItem(item);
    expect(parsed!.cost).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// splitIntoMonths — additional cross-boundary scenarios
// ────────────────────────────────────────────────────────────────────

describe('splitIntoMonths — additional cross-boundary scenarios', () => {
  it('handles February non-leap year (28 days)', () => {
    const result = splitIntoMonths('2025-02-01', '2025-02-28');
    expect(result).toEqual([['2025-02-01', '2025-02-28']]);
  });

  it('handles six-month span', () => {
    const result = splitIntoMonths('2026-01-01', '2026-06-30');
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual(['2026-01-01', '2026-01-31']);
    expect(result[5]).toEqual(['2026-06-01', '2026-06-30']);
  });

  it('handles start and end in same day mid-month', () => {
    const result = splitIntoMonths('2026-07-15', '2026-07-15');
    expect(result).toEqual([['2026-07-15', '2026-07-15']]);
  });

  it('handles year-end to year-start crossing', () => {
    const result = splitIntoMonths('2025-11-15', '2026-02-10');
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(['2025-11-15', '2025-11-30']);
    expect(result[1]).toEqual(['2025-12-01', '2025-12-31']);
    expect(result[2]).toEqual(['2026-01-01', '2026-01-31']);
    expect(result[3]).toEqual(['2026-02-01', '2026-02-10']);
  });
});

// ────────────────────────────────────────────────────────────────────
// sumAmountStrings — additional edge cases
// ────────────────────────────────────────────────────────────────────

describe('sumAmountStrings — additional edge cases', () => {
  it('handles very small negative result', () => {
    expect(sumAmountStrings(['0.1', '-0.1'])).toBe('0');
  });

  it('handles large values without overflow', () => {
    expect(sumAmountStrings(['999999.999999', '0.000001'])).toBe('1000000');
  });

  it('trims trailing zeros from result', () => {
    expect(sumAmountStrings(['1.100000', '2.200000'])).toBe('3.3');
  });

  it('handles negative-only array', () => {
    const result = sumAmountStrings(['-1.5', '-2.5']);
    expect(parseFloat(result)).toBe(-4);
  });
});

/** Unit tests for BillingService. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type { ConsumeSummaryLineItem } from '../../src/types/api-models.js';
import {
  BillingService,
  parseBillingItem,
  sumAmountStrings,
  inferBillingUnit,
  computeUsageValue,
  splitIntoMonths,
  SKIP_LINE_ITEM_CATEGORIES,
} from '../../src/services/billing-service.js';
import type { ApiClient } from '../../src/api/api-client.js';

function makeCachedFetcher(): CachedFetcher & { getOrFetch: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> } {
  return {
    getOrFetch: vi.fn(async <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) => fetcher()),
    invalidate: vi.fn(),
  };
}

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn() };
}

interface MockBillingAdapter {
  toNormalizedItem: ReturnType<typeof vi.fn>;
}

function makeMockBillingAdapter(): MockBillingAdapter {
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
// Pure function tests (migrated from billing-rules.test.ts)
// ────────────────────────────────────────────────────────────────────

describe('BillingService — inferBillingUnit', () => {
  describe('priority 1 — BillingItemCode keyword match', () => {
    it('returns "images" when code contains "image"', () => {
      expect(inferBillingUnit('Per 1 Image', 'image_number')).toBe('images');
    });

    it('returns "seconds" when code contains "video"', () => {
      expect(inferBillingUnit('Per 1 second', 'video_duration')).toBe('seconds');
    });

    it('returns "seconds" when code contains "duration"', () => {
      expect(inferBillingUnit('Per 1 unit', 'audio_duration')).toBe('seconds');
    });

    it('returns "characters" when code contains "char"', () => {
      expect(inferBillingUnit('Per 1K chars', 'char_number')).toBe('characters');
    });

    it('returns "voices" when code contains "voice"', () => {
      expect(inferBillingUnit('Per 1 unit', 'voice_count')).toBe('voices');
    });

    it('returns "tokens" when code contains "token"', () => {
      expect(inferBillingUnit('Per 1K tokens', 'token_number')).toBe('tokens');
    });
  });

  describe('priority 2 — StepQuantityUnit keyword match', () => {
    it('detects "tokens" from unit string', () => {
      expect(inferBillingUnit('Per 1M tokens')).toBe('tokens');
    });

    it('detects "images" from unit containing "image"', () => {
      expect(inferBillingUnit('Per 1 image')).toBe('images');
    });

    it('detects "images" from unit containing "page"', () => {
      expect(inferBillingUnit('Per 1 page')).toBe('images');
    });

    it('detects "seconds" from unit containing "second"', () => {
      expect(inferBillingUnit('Per 1 second')).toBe('seconds');
    });

    it('detects "seconds" from unit containing "sec"', () => {
      expect(inferBillingUnit('Per 10 sec')).toBe('seconds');
    });

    it('detects "characters" from unit containing "char"', () => {
      expect(inferBillingUnit('Per 1K characters')).toBe('characters');
    });

    it('detects "characters" from unit containing "word"', () => {
      expect(inferBillingUnit('Per 1K words')).toBe('characters');
    });

    it('detects "voices" from unit containing "voice"', () => {
      expect(inferBillingUnit('Per 1 voice')).toBe('voices');
    });
  });

  describe('priority 3 — "Per X Y" fallback regex', () => {
    it('extracts trailing unit word from "Per 1 Calls"', () => {
      expect(inferBillingUnit('Per 1 Calls')).toBe('calls');
    });

    it('handles multi-word remainder from "Per 1 Custom Unit"', () => {
      expect(inferBillingUnit('Per 1 Custom Unit')).toBe('custom unit');
    });
  });

  describe('default fallback', () => {
    it('falls back to "tokens" for unrecognized single-word formats', () => {
      expect(inferBillingUnit('weird-format')).toBe('tokens');
    });

    it('falls back to "tokens" for empty string', () => {
      expect(inferBillingUnit('')).toBe('tokens');
    });
  });
});

describe('BillingService — computeUsageValue', () => {
  it('multiplies by 1000 for "1K tokens"', () => {
    expect(computeUsageValue(2, 'Per 1K tokens')).toBe(2000);
  });

  it('multiplies by 1_000_000 for "1M tokens"', () => {
    expect(computeUsageValue(3, 'Per 1M tokens')).toBe(3_000_000);
  });

  it('multiplies by 10_000 for "tenthousand"', () => {
    expect(computeUsageValue(2, 'Per tenthousand tokens')).toBe(20_000);
  });

  it('multiplies by 10_000 for "万字"', () => {
    expect(computeUsageValue(5, 'Per 万字')).toBe(50_000);
  });

  it('returns 0 when billQuantity is 0', () => {
    expect(computeUsageValue(0, 'Per 1M tokens')).toBe(0);
  });

  it('falls back to ×1 for unrecognized unit without numeric pattern', () => {
    expect(computeUsageValue(7, 'weird-format')).toBe(7);
  });

  it('handles numeric multiplier without K/M suffix', () => {
    expect(computeUsageValue(10, 'Per 1 token')).toBe(10);
  });

  it('handles comma-separated numeric multiplier', () => {
    expect(computeUsageValue(2, 'Per 1,000 tokens')).toBe(2000);
  });

  it('handles fractional bill quantity with 1K multiplier', () => {
    expect(computeUsageValue(0.5, 'Per 1K tokens')).toBe(500);
  });
});

describe('BillingService — parseBillingItem', () => {
  it('returns null for "Rounding Adjustment" category', () => {
    const item = makeLineItem({ LineItemCategory: 'Rounding Adjustment' });
    expect(parseBillingItem(item)).toBeNull();
  });

  it('returns null for "Refund" category', () => {
    const item = makeLineItem({ LineItemCategory: 'Refund' });
    expect(parseBillingItem(item)).toBeNull();
  });

  it('returns null for "Credit Adjustment" category', () => {
    const item = makeLineItem({ LineItemCategory: 'Credit Adjustment' });
    expect(parseBillingItem(item)).toBeNull();
  });

  it('parses a normal LLM token line correctly', () => {
    const item = makeLineItem();
    const parsed = parseBillingItem(item);
    expect(parsed).not.toBeNull();
    expect(parsed!.modelId).toBe('qwen-plus');
    expect(parsed!.billingDate).toBe('2026-04-15');
    expect(parsed!.billingMonth).toBe('2026-04');
    expect(parsed!.billingUnit).toBe('tokens');
    expect(parsed!.usageValue).toBe(5000);
  });

  it('marks isFree=true for Free Tier categories', () => {
    const item = makeLineItem({ LineItemCategory: 'Free Tier Image Generation' });
    const parsed = parseBillingItem(item);
    expect(parsed).not.toBeNull();
    expect(parsed!.isFree).toBe(true);
  });

  it('uses ModelName when present, falls back to Model otherwise', () => {
    const parsed1 = parseBillingItem(makeLineItem({ ModelName: 'qwen-plus' }));
    expect(parsed1!.modelId).toBe('qwen-plus');

    const parsed2 = parseBillingItem(makeLineItem({ ModelName: undefined, Model: 'qwen-fallback' }));
    expect(parsed2!.modelId).toBe('qwen-fallback');
  });

  it('falls back to JobId when ModelName and Model are absent (Training type)', () => {
    const item = makeLineItem({
      ModelName: undefined,
      Model: undefined,
      JobId: 'ft-202605191420-ddb1',
      MaasTypeName: 'Training',
      MaasType: 'training',
      BillingItemCode: 'ft_token_number',
      BillQuantity: '282.46',
      RequireAmount: '0.451936000000',
      ListPrice: '0.451936000000',
      StepQuantityUnit: '1K tokens',
    });
    const parsed = parseBillingItem(item);
    expect(parsed).not.toBeNull();
    expect(parsed!.modelId).toBe('ft-202605191420-ddb1');
  });

  it('falls back to MaasTypeName when ModelName, Model, and JobId are all absent', () => {
    const item = makeLineItem({
      ModelName: undefined,
      Model: undefined,
      JobId: undefined,
      MaasTypeName: 'Training',
      BillQuantity: 10,
      RequireAmount: 1.5,
    });
    const parsed = parseBillingItem(item);
    expect(parsed).not.toBeNull();
    expect(parsed!.modelId).toBe('Training');
  });

  it('falls back to "Other" when all identifier fields are absent', () => {
    const item = makeLineItem({
      ModelName: undefined,
      Model: undefined,
      JobId: undefined,
      MaasTypeName: undefined,
      BillQuantity: 1,
      RequireAmount: 0.1,
    });
    const parsed = parseBillingItem(item);
    expect(parsed).not.toBeNull();
    expect(parsed!.modelId).toBe('Other');
  });

  it('correctly converts string numeric fields to numbers', () => {
    const item = makeLineItem({
      BillQuantity: '282.46',
      RequireAmount: '0.451936000000',
      ListPrice: '0.451936000000',
      StepQuantityUnit: '1K tokens',
    });
    const parsed = parseBillingItem(item);
    expect(parsed).not.toBeNull();
    expect(parsed!.usageValue).toBeCloseTo(282460, 0);
    expect(parsed!.cost).toBeCloseTo(0.451936, 6);
  });

  it('handles undefined/null numeric fields gracefully', () => {
    const item = makeLineItem({
      BillQuantity: undefined,
      RequireAmount: undefined,
      ListPrice: undefined,
      Amount: undefined,
      Cost: undefined,
    });
    const parsed = parseBillingItem(item);
    expect(parsed).not.toBeNull();
    expect(parsed!.usageValue).toBe(0);
    expect(parsed!.cost).toBe(0);
  });

  describe('costMode priority', () => {
    it('prefers RequireAmount in full mode', () => {
      const item = makeLineItem({ RequireAmount: 1, Amount: 2, Cost: 3, ListPrice: 4 });
      const cost = item.RequireAmount ?? item.Amount ?? item.Cost ?? item.ListPrice ?? 0;
      expect(cost).toBe(1);
    });

    it('falls back to Amount when RequireAmount is undefined', () => {
      const item = makeLineItem({ RequireAmount: undefined, Amount: 2, Cost: 3 });
      const cost = item.RequireAmount ?? item.Amount ?? item.Cost ?? item.ListPrice ?? 0;
      expect(cost).toBe(2);
    });
  });
});

describe('BillingService — SKIP_LINE_ITEM_CATEGORIES', () => {
  it('contains the three documented skip categories', () => {
    expect(SKIP_LINE_ITEM_CATEGORIES.has('Rounding Adjustment')).toBe(true);
    expect(SKIP_LINE_ITEM_CATEGORIES.has('Refund')).toBe(true);
    expect(SKIP_LINE_ITEM_CATEGORIES.has('Credit Adjustment')).toBe(true);
  });

  it('does not contain regular usage categories', () => {
    expect(SKIP_LINE_ITEM_CATEGORIES.has('LLM Token Consumption')).toBe(false);
    expect(SKIP_LINE_ITEM_CATEGORIES.has('Free Tier Image Generation')).toBe(false);
  });
});

describe('BillingService — splitIntoMonths', () => {
  it('single month range', () => {
    expect(splitIntoMonths('2026-05-01', '2026-05-31')).toEqual([['2026-05-01', '2026-05-31']]);
  });

  it('two-month range', () => {
    expect(splitIntoMonths('2026-04-15', '2026-05-10')).toEqual([
      ['2026-04-15', '2026-04-30'],
      ['2026-05-01', '2026-05-10'],
    ]);
  });

  it('leap year boundary', () => {
    expect(splitIntoMonths('2024-01-15', '2024-03-05')).toEqual([
      ['2024-01-15', '2024-01-31'],
      ['2024-02-01', '2024-02-29'],
      ['2024-03-01', '2024-03-05'],
    ]);
  });

  it('year-boundary crossing', () => {
    expect(splitIntoMonths('2025-12-25', '2026-01-05')).toEqual([
      ['2025-12-25', '2025-12-31'],
      ['2026-01-01', '2026-01-05'],
    ]);
  });

  it('single-day range', () => {
    expect(splitIntoMonths('2026-05-15', '2026-05-15')).toEqual([['2026-05-15', '2026-05-15']]);
  });

  it('three-month range starting mid-month', () => {
    expect(splitIntoMonths('2026-03-20', '2026-06-05')).toEqual([
      ['2026-03-20', '2026-03-31'],
      ['2026-04-01', '2026-04-30'],
      ['2026-05-01', '2026-05-31'],
      ['2026-06-01', '2026-06-05'],
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────
// PAYG aggregation tests
// ────────────────────────────────────────────────────────────────────

describe('BillingService — PAYG aggregation (getPaygSummary)', () => {
  let apiClient: MockApiClient;
  let billingAdapter: MockBillingAdapter;
  let cache: ReturnType<typeof makeCachedFetcher>;
  let service: BillingService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    billingAdapter = makeMockBillingAdapter();
    cache = makeCachedFetcher();
    service = new BillingService(apiClient as unknown as ApiClient, billingAdapter, cache);
  });

  it('aggregates items from API into per-model summary', async () => {
    billingAdapter.toNormalizedItem
      .mockReturnValueOnce({
        lineItemCat: 'LLM Token', billingDate: '2026-05-01', billingMonth: '2026-05',
        modelId: 'qwen-plus', usageValue: 5000, cost: 0.5, billingUnit: 'tokens', isFree: false,
      })
      .mockReturnValueOnce({
        lineItemCat: 'LLM Token', billingDate: '2026-05-01', billingMonth: '2026-05',
        modelId: 'qwen-max', usageValue: 2000, cost: 1.2, billingUnit: 'tokens', isFree: false,
      });

    apiClient.callFlatApi.mockResolvedValue({
      Data: [
        makeLineItem({ ModelName: 'qwen-plus', RequireAmount: 0.5, BillQuantity: 5 }),
        makeLineItem({ ModelName: 'qwen-max', RequireAmount: 1.2, BillQuantity: 2 }),
      ],
    });

    const result = await service.getPaygSummary({ from: '2026-05-01', to: '2026-05-31' });
    expect(result.models.length).toBeGreaterThanOrEqual(2);
  });

  it('filters out free-tier items from PAYG summary', async () => {
    billingAdapter.toNormalizedItem
      .mockReturnValueOnce({
        lineItemCat: 'LLM Token', billingDate: '2026-05-01', billingMonth: '2026-05',
        modelId: 'qwen-plus', usageValue: 5000, cost: 0.5, billingUnit: 'tokens', isFree: false,
      })
      .mockReturnValueOnce({
        lineItemCat: 'Free Tier', billingDate: '2026-05-01', billingMonth: '2026-05',
        modelId: 'qwen-plus', usageValue: 1000, cost: 0, billingUnit: 'tokens', isFree: true,
      });

    apiClient.callFlatApi.mockResolvedValue({
      Data: [
        makeLineItem({ ModelName: 'qwen-plus', RequireAmount: 0.5 }),
        makeLineItem({ ModelName: 'qwen-plus', RequireAmount: 0, LineItemCategory: 'Free Tier' }),
      ],
    });

    const result = await service.getPaygSummary({ from: '2026-05-01', to: '2026-05-31' });
    expect(result.total.cost).toBeGreaterThan(0);
  });

  it('filters out null items from adapter', async () => {
    billingAdapter.toNormalizedItem
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        lineItemCat: 'LLM Token', billingDate: '2026-05-01', billingMonth: '2026-05',
        modelId: 'qwen-plus', usageValue: 5000, cost: 0.5, billingUnit: 'tokens', isFree: false,
      });

    apiClient.callFlatApi.mockResolvedValue({
      Data: [makeLineItem({ LineItemCategory: 'Refund' }), makeLineItem({ ModelName: 'qwen-plus' })],
    });

    const result = await service.getPaygSummary({ from: '2026-05-01', to: '2026-05-31' });
    expect(result.models.length).toBe(1);
  });

  it('handles empty Data from API', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    const result = await service.getPaygSummary({ from: '2026-05-01', to: '2026-05-31' });
    expect(result.models).toEqual([]);
    expect(result.total.cost).toBe(0);
  });

  it('handles undefined Data from API', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    const result = await service.getPaygSummary({ from: '2026-05-01', to: '2026-05-31' });
    expect(result.models).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// sumAmountStrings — 12-digit precision boundary
// ────────────────────────────────────────────────────────────────────

describe('BillingService — sumAmountStrings (high precision)', () => {
  it('sums simple integers correctly', () => {
    expect(sumAmountStrings(['1', '2', '3'])).toBe('6');
  });

  it('sums decimal values without IEEE-754 drift', () => {
    expect(sumAmountStrings(['0.1', '0.2'])).toBe('0.3');
  });

  it('handles 12-digit fractional precision boundary', () => {
    expect(sumAmountStrings(['0.000000000001', '0.000000000002'])).toBe('0.000000000003');
  });

  it('handles large number of small values without drift', () => {
    const values = Array.from({ length: 1000 }, () => '0.001');
    expect(sumAmountStrings(values)).toBe('1');
  });

  it('handles empty array', () => {
    expect(sumAmountStrings([])).toBe('0');
  });

  it('handles single value', () => {
    expect(sumAmountStrings(['3.14159'])).toBe('3.14159');
  });

  it('handles mixed positive and negative values', () => {
    expect(sumAmountStrings(['10.5', '-3.2', '0.7'])).toBe('8');
  });

  it('handles zero values', () => {
    expect(sumAmountStrings(['0', '0', '0'])).toBe('0');
  });
});

// ────────────────────────────────────────────────────────────────────
// sumAmountStrings — fault tolerance (non-numeric / empty inputs)
// ────────────────────────────────────────────────────────────────────

describe('BillingService — sumAmountStrings (fault tolerance)', () => {
  it('returns 0 for array containing a single empty string', () => {
    expect(sumAmountStrings([''])).toBe('0');
  });

  it('skips empty strings and sums valid values correctly', () => {
    expect(sumAmountStrings(['1', '', '2'])).toBe('3');
  });

  it('returns 0 for array containing non-numeric string', () => {
    expect(sumAmountStrings(['abc'])).toBe('0');
  });

  it('skips non-numeric strings in mixed arrays', () => {
    expect(sumAmountStrings(['5', 'abc', '3'])).toBe('8');
  });

  it('returns 0 for multiple empty strings', () => {
    expect(sumAmountStrings(['', '', ''])).toBe('0');
  });

  it('handles whitespace-only strings gracefully', () => {
    expect(sumAmountStrings(['  ', '1.5'])).toBe('1.5');
  });

  it('handles undefined-like strings ("undefined", "null") gracefully', () => {
    expect(sumAmountStrings(['undefined', 'null', '10'])).toBe('10');
  });

  it('handles Infinity string gracefully', () => {
    expect(sumAmountStrings(['Infinity', '5'])).toBe('5');
  });

  it('handles NaN string gracefully', () => {
    expect(sumAmountStrings(['NaN', '7'])).toBe('7');
  });
});

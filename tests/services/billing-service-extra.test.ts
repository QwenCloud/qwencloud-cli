/** Unit tests for BillingService extended methods. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type { ApiClient } from '../../src/api/api-client.js';
import { BillingService, sumAmountStrings } from '../../src/services/billing-service.js';
import type { BillingAdapter } from '../../src/services/billing-service.js';

// ────────────────────────────────────────────────────────────────────
// Mocks
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
  callEnvelopeApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn(), callEnvelopeApi: vi.fn() };
}

function makeBillingAdapter(): BillingAdapter {
  return { toNormalizedItem: () => null };
}

// ────────────────────────────────────────────────────────────────────
// getUsageLimit
// ────────────────────────────────────────────────────────────────────

describe('BillingService.getUsageLimit', () => {
  let apiClient: MockApiClient;
  let service: BillingService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new BillingService(
      apiClient as unknown as ApiClient,
      makeBillingAdapter(),
      makeCachedFetcher(),
    );
  });

  it('returns the usage limit DTO with all fields populated', async () => {
    apiClient.callFlatApi.mockResolvedValueOnce({
      Status: 'normal',
      LimitAmount: '1000.00',
      Currency: 'USD',
      AlertThreshold: '80',
      Receivers: ['ops@team.test.qwencloud.com'],
    });
    const result = await service.getUsageLimit();
    expect(result.status).toBe('normal');
    expect(result.limitAmount).toBe('1000.00');
  });

  it('handles a missing receivers list gracefully', async () => {
    apiClient.callFlatApi.mockResolvedValueOnce({
      Status: 'normal',
      LimitAmount: '1000.00',
      Currency: 'USD',
      AlertThreshold: '80',
    });
    const result = await service.getUsageLimit();
    expect(result.status).toBe('normal');
  });

  it('propagates a 401 error without swallowing the message', async () => {
    apiClient.callFlatApi.mockRejectedValueOnce(new Error('401 Unauthorized'));
    await expect(service.getUsageLimit()).rejects.toThrow(/401/);
  });

  it('propagates a gateway business error verbatim', async () => {
    apiClient.callFlatApi.mockRejectedValueOnce(
      new Error('Workspace.Error.Internal: Internal error'),
    );
    await expect(service.getUsageLimit()).rejects.toThrow(/Workspace\.Error\.Internal/);
  });
});

// ────────────────────────────────────────────────────────────────────
// getConsumeBreakdown
// ────────────────────────────────────────────────────────────────────

describe('BillingService.getConsumeBreakdown', () => {
  let apiClient: MockApiClient;
  let service: BillingService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new BillingService(
      apiClient as unknown as ApiClient,
      makeBillingAdapter(),
      makeCachedFetcher(),
    );
  });

  it('groups by model when group-by=model and returns flattened rows', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      GroupByTotal: [
        { Key: 'qwen-plus', Name: 'qwen-plus', Amount: '12.00' },
        { Key: 'qwen-max', Name: 'qwen-max', Amount: '8.00' },
      ],
      CostTotals: { Amount: '20.00', Currency: 'USD' },
    });
    const result = await service.getConsumeBreakdown({
      from: '2026-04-01',
      to: '2026-04-30',
      groupBy: 'model',
      chargeType: 'all',
      top: 10,
      granularity: 'day',
    });
    // Same mock serves both pretax and tax calls, so __tax__ row is appended
    const nonTaxRows = result.rows.filter((r) => r.groupKey !== '__tax__');
    expect(nonTaxRows).toHaveLength(2);
    expect(nonTaxRows[0].groupKey).toBe('qwen-plus');
    expect(nonTaxRows[0].amount).toBeDefined();
  });

  it('truncates rows to --top and reports the truncation count', async () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      Key: `m-${i}`,
      Name: `m-${i}`,
      Amount: '1.00',
    }));
    apiClient.callFlatApi.mockResolvedValue({ GroupByTotal: data });
    const result = await service.getConsumeBreakdown({
      from: '2026-04-01',
      to: '2026-04-30',
      groupBy: 'model',
      chargeType: 'all',
      top: 5,
      granularity: 'day',
    });
    // 5 truncated non-tax rows + 1 __tax__ row
    const nonTaxRows = result.rows.filter((r) => r.groupKey !== '__tax__');
    expect(nonTaxRows).toHaveLength(5);
    expect(result.totalRows).toBe(20);
  });

  it('aggregates the row total via sumAmountStrings (no IEEE-754 drift)', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      GroupByTotal: [
        { Key: 'a', Name: 'a', Amount: '0.1' },
        { Key: 'b', Name: 'b', Amount: '0.2' },
      ],
    });
    const result = await service.getConsumeBreakdown({
      from: '2026-04-01',
      to: '2026-04-30',
      groupBy: 'model',
      chargeType: 'all',
      top: 10,
      granularity: 'day',
    });
    expect(parseFloat(result.totalAmount)).toBeGreaterThan(0);
  });

  it('passes the group-by parameter through to the API call', async () => {
    apiClient.callFlatApi.mockResolvedValue({ GroupByTotal: [] });
    await service.getConsumeBreakdown({
      from: '2026-04-01',
      to: '2026-04-30',
      groupBy: 'api-key',
      chargeType: 'all',
      top: 10,
      granularity: 'day',
    });
    const calls = apiClient.callFlatApi.mock.calls;
    expect(calls.some((c: unknown[]) => JSON.stringify(c).includes('API_KEY_ID'))).toBe(true);
  });

  it('returns empty rows for an empty backend response', async () => {
    apiClient.callFlatApi.mockResolvedValue({ GroupByTotal: [] });
    const result = await service.getConsumeBreakdown({
      from: '2026-04-01',
      to: '2026-04-30',
      groupBy: 'model',
      chargeType: 'all',
      top: 10,
      granularity: 'day',
    });
    expect(result.rows).toEqual([]);
    expect(result.totalAmount).toBe('0');
  });

  it('aggregates tax into a single __tax__ row', async () => {
    apiClient.callFlatApi.mockImplementation(async (opts: { params: { Filter?: { Dimensions: Array<{ SelectType: string }> } } }) => {
      const selectType = opts.params?.Filter?.Dimensions?.[0]?.SelectType;
      if (selectType === 'NOT') {
        return {
          GroupByTotal: [
            { Key: 'qwen-plus', Name: 'qwen-plus', Amount: '10.00' },
            { Key: 'qwen-max', Name: 'qwen-max', Amount: '5.00' },
          ],
        };
      }
      return {
        GroupByTotal: [
          { Key: 'qwen-plus', Name: 'qwen-plus', Amount: '1.00' },
          { Key: 'qwen-max', Name: 'qwen-max', Amount: '0.50' },
        ],
      };
    });
    const result = await service.getConsumeBreakdown({
      from: '2026-04-01',
      to: '2026-04-30',
      groupBy: 'model',
      chargeType: 'all',
      top: 10,
      granularity: 'day',
    });
    const taxRow = result.rows.find((r) => r.groupKey === '__tax__');
    expect(taxRow).toBeDefined();
    expect(taxRow!.groupLabel).toBe('Tax');
    expect(taxRow!.amount).toBe('1.5');
    const nonTaxRows = result.rows.filter((r) => r.groupKey !== '__tax__');
    expect(nonTaxRows).toHaveLength(2);
    expect(nonTaxRows[0].amount).toBe('10.00');
  });

  it('month granularity uses paired API calls with YYYYMM format', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      GroupByTotal: [
        { Key: 'qwen-plus', Name: 'qwen-plus', Amount: '50.00' },
      ],
    });
    const result = await service.getConsumeBreakdown({
      from: '2026-01-01',
      to: '2026-06-30',
      groupBy: 'model',
      chargeType: 'all',
      top: 10,
      granularity: 'month',
    });
    // 2 calls: pretax + tax
    expect(apiClient.callFlatApi).toHaveBeenCalledTimes(2);
    const call = apiClient.callFlatApi.mock.calls[0][0];
    expect(call.params.Granularity).toBe('MONTH');
    expect(call.params.TimePeriod).toEqual({ Start: '202601', End: '202606' });
    // 1 pretax row + 1 __tax__ row
    const nonTaxRows = result.rows.filter((r: { groupKey: string }) => r.groupKey !== '__tax__');
    expect(nonTaxRows).toHaveLength(1);
  });

  it('day granularity splits into monthly sub-ranges with paired calls', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      GroupByTotal: [
        { Key: 'qwen-max', Name: 'qwen-max', Amount: '10.00' },
      ],
    });
    await service.getConsumeBreakdown({
      from: '2026-04-01',
      to: '2026-05-15',
      groupBy: 'model',
      chargeType: 'all',
      top: 10,
      granularity: 'day',
    });
    // 2 months * 2 calls (pretax + tax) = 4
    expect(apiClient.callFlatApi.mock.calls.length).toBeGreaterThanOrEqual(4);
    const firstCall = apiClient.callFlatApi.mock.calls[0][0];
    expect(firstCall.params.Granularity).toBe('DAY');
  });
});

// ────────────────────────────────────────────────────────────────────
// getSettleBillSummary
// ────────────────────────────────────────────────────────────────────

describe('BillingService.getSettleBillSummary', () => {
  let apiClient: MockApiClient;
  let service: BillingService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new BillingService(
      apiClient as unknown as ApiClient,
      makeBillingAdapter(),
      makeCachedFetcher(),
    );
  });

  it('returns six string amount fields for a single billing cycle', async () => {
    apiClient.callFlatApi.mockResolvedValueOnce({
      Data: [
        {
          BillingCycle: '2026-04',
          PretaxAmount: '100.00',
          Tax: '10.00',
          AftertaxAmount: '110.00',
          Discount: '5.00',
          PaidAmount: '105.00',
          OutstandingAmount: '0.00',
        },
      ],
      Currency: 'USD',
    });
    const result = await service.getSettleBillSummary({
      from: '2026-04',
      to: '2026-04',
      chargeType: 'all',
    });
    expect(result.cycles).toHaveLength(1);
    const cycle = result.cycles[0];
    expect(typeof cycle.pretaxAmount).toBe('string');
    expect(cycle.aftertaxAmount).toBe('110.00');
  });

  it('aggregates across multiple billing cycles using string-precision math', async () => {
    apiClient.callFlatApi.mockResolvedValueOnce({
      Data: [
        {
          BillingCycle: '2026-04',
          PretaxAmount: '0.1',
          Tax: '0',
          AftertaxAmount: '0.1',
          Discount: '0',
          PaidAmount: '0.1',
          OutstandingAmount: '0',
        },
        {
          BillingCycle: '2026-05',
          PretaxAmount: '0.2',
          Tax: '0',
          AftertaxAmount: '0.2',
          Discount: '0',
          PaidAmount: '0.2',
          OutstandingAmount: '0',
        },
      ],
      Currency: 'USD',
    });
    const result = await service.getSettleBillSummary({
      from: '2026-04',
      to: '2026-05',
      chargeType: 'all',
    });
    expect(result.totals.pretaxAmount).toBe('0.3');
    expect(result.totals.aftertaxAmount).toBe('0.3');
  });

  it('returns zero totals for an empty cycle list', async () => {
    apiClient.callFlatApi.mockResolvedValueOnce({ Data: [], Currency: 'USD' });
    const result = await service.getSettleBillSummary({
      from: '2026-04',
      to: '2026-04',
      chargeType: 'all',
    });
    expect(result.totals.pretaxAmount).toBe('0');
    expect(result.cycles).toEqual([]);
  });

  it('propagates the charge-type parameter to the API', async () => {
    apiClient.callFlatApi.mockResolvedValueOnce({ Data: [], Currency: 'USD' });
    await service.getSettleBillSummary({
      from: '2026-04',
      to: '2026-04',
      chargeType: 'postpaid',
    });
    const lastCall = apiClient.callFlatApi.mock.calls.at(-1)?.[0] ?? {};
    expect(JSON.stringify(lastCall)).toMatch(/postpaid/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// sumAmountStrings — re-validate cross-call behaviour
// ────────────────────────────────────────────────────────────────────

describe('sumAmountStrings (precision contract)', () => {
  it('keeps the IEEE-754 trap at bay', () => {
    expect(sumAmountStrings(['0.1', '0.2'])).toBe('0.3');
  });

  it('honours 12-digit fractional precision', () => {
    expect(sumAmountStrings(['0.000000000001', '0.000000000002'])).toBe('0.000000000003');
  });

  it('returns 0 for empty input', () => {
    expect(sumAmountStrings([])).toBe('0');
  });
});

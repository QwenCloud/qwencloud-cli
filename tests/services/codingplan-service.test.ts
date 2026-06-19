/**
 * Unit tests for CodingplanService (src/services/codingplan-service.ts).
 *
 * CodingplanService handles Coding Plan instance retrieval via envelope API,
 * validity checking, capacity/quota parsing, and degraded-mode fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type { CodingPlanInstance, CodingPlanApiResponse } from '../../src/types/api-models.js';
import { CodingplanService } from '../../src/services/codingplan-service.js';
import type { GatewayAdapter } from '../../src/services/codingplan-service.js';
import type { ApiClient } from '../../src/api/api-client.js';

// Mock config and site modules
vi.mock('../../src/config/manager.js', () => ({
  getEffectiveConfig: vi.fn(() => ({
    'api.endpoint': 'https://mock-api.test.qwencloud.com/',
  })),
}));

vi.mock('../../src/site.js', () => ({
  site: {
    features: {
      codingPlanCommodityCode: 'sfm_codingplan_public_intl',
      currency: 'USD',
    },
    defaults: {
      language: 'en-US',
    },
  },
}));

vi.mock('../../src/api/debug-buffer.js', () => ({
  addDiagnostic: vi.fn(),
}));

// ────────────────────────────────────────────────────────────────────
// Mock factory helpers
// ────────────────────────────────────────────────────────────────────

function makeCodingPlanInstance(overrides: Partial<CodingPlanInstance> = {}): CodingPlanInstance {
  return {
    instanceType: 'pro',
    status: 'VALID',
    codingPlanQuotaInfo: {
      per5HourTotalQuota: 500,
      per5HourUsedQuota: 100,
      per5HourQuotaNextRefreshTime: 1700000000000,
      perWeekTotalQuota: 3000,
      perWeekUsedQuota: 500,
      perWeekQuotaNextRefreshTime: 1700100000000,
      perBillMonthTotalQuota: 10000,
      perBillMonthUsedQuota: 2000,
      perBillMonthQuotaNextRefreshTime: 1700500000000,
    },
    nextResetTime: '2024-11-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeCachedFetcher(): CachedFetcher {
  return {
    getOrFetch: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()) as CachedFetcher['getOrFetch'],
    invalidate: vi.fn(),
  };
}

function makeMockApiClient() {
  return { callEnvelopeApi: vi.fn() };
}

function makeMockGatewayAdapter(): GatewayAdapter {
  return { extractCodingPlanInstances: vi.fn() };
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe('CodingplanService', () => {
  let apiClient: ReturnType<typeof makeMockApiClient>;
  let gatewayAdapter: GatewayAdapter & { extractCodingPlanInstances: ReturnType<typeof vi.fn> };
  let cache: CachedFetcher;
  let service: CodingplanService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    gatewayAdapter = makeMockGatewayAdapter() as GatewayAdapter & { extractCodingPlanInstances: ReturnType<typeof vi.fn> };
    cache = makeCachedFetcher();
    service = new CodingplanService(
      apiClient as unknown as ApiClient,
      gatewayAdapter,
      cache,
    );
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchCodingPlan — success path (VALID instance)
  // ──────────────────────────────────────────────────────────────────

  describe('fetchCodingPlan — success path', () => {
    it('returns a fully populated CodingPlan DTO for a pro instance', async () => {
      const instance = makeCodingPlanInstance();
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(true);
      expect(result.plan).toBe('pro');
      expect(result.price).toEqual({ amount: 50, currency: 'USD', cycle: 'monthly' });
      expect(result.windows).toBeDefined();
      expect(result.windows!.per_5h.remaining).toBe(400);
      expect(result.windows!.per_5h.total).toBe(500);
      expect(result.windows!.per_5h.used_pct).toBe(20);
      expect(result.windows!.weekly.remaining).toBe(2500);
      expect(result.windows!.weekly.total).toBe(3000);
      expect(result.windows!.monthly.remaining).toBe(8000);
      expect(result.windows!.monthly.total).toBe(10000);
      expect(result.windows!.monthly.used_pct).toBe(20);
    });

    it('returns starter plan pricing for starter instanceType', async () => {
      const instance = makeCodingPlanInstance({ instanceType: 'starter' });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(true);
      expect(result.plan).toBe('starter');
      expect(result.price).toEqual({ amount: 10, currency: 'USD', cycle: 'monthly' });
    });

    it('omits price for unknown instance types', async () => {
      const instance = makeCodingPlanInstance({ instanceType: 'enterprise' });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(true);
      expect(result.plan).toBe('enterprise');
      expect(result.price).toBeUndefined();
    });

    it('passes correct envelope API parameters', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([]);

      await service.fetchCodingPlan();

      expect(apiClient.callEnvelopeApi).toHaveBeenCalledWith(
        expect.objectContaining({
          api: 'zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2',
          data: {
            queryCodingPlanInstanceInfoRequest: {
              commodityCode: 'sfm_codingplan_public_intl',
              onlyLatestOne: true,
            },
          },
          cornerstoneParam: expect.objectContaining({
            domain: 'mock-api.test.qwencloud.com',
            consoleSite: 'QWENCLOUD',
            console: 'ONE_CONSOLE',
            xsp_lang: 'en-US',
            protocol: 'V2',
            productCode: 'p_efm',
          }),
        }),
      );
    });

    it('converts quota refresh timestamps to ISO strings', async () => {
      const instance = makeCodingPlanInstance({
        codingPlanQuotaInfo: {
          per5HourTotalQuota: 100,
          per5HourUsedQuota: 50,
          per5HourQuotaNextRefreshTime: 1700000000000,
          perWeekTotalQuota: 1000,
          perWeekUsedQuota: 200,
          perWeekQuotaNextRefreshTime: 1700100000000,
          perBillMonthTotalQuota: 5000,
          perBillMonthUsedQuota: 1000,
          perBillMonthQuotaNextRefreshTime: 1700500000000,
        },
      });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.windows!.per_5h.next_reset_at).toBe(new Date(1700000000000).toISOString());
      expect(result.windows!.weekly.next_reset_at).toBe(new Date(1700100000000).toISOString());
      expect(result.windows!.monthly.next_reset_at).toBe(new Date(1700500000000).toISOString());
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchCodingPlan — no subscription / invalid status
  // ──────────────────────────────────────────────────────────────────

  describe('fetchCodingPlan — no subscription', () => {
    it('returns subscribed=false when no instances are returned', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(false);
      expect(result.plan).toBeUndefined();
      expect(result.windows).toBeUndefined();
    });

    it('returns subscribed=false when first instance has non-VALID status', async () => {
      const expiredInstance = makeCodingPlanInstance({ status: 'EXPIRED' });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([expiredInstance]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(false);
    });

    it('returns subscribed=false when instances array is null-like', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue(null as unknown as CodingPlanInstance[]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchCodingPlan — error handling
  // ──────────────────────────────────────────────────────────────────

  describe('fetchCodingPlan — error handling', () => {
    it('degrades to subscribed=false on API error', async () => {
      apiClient.callEnvelopeApi.mockRejectedValue(new Error('envelope API unreachable'));

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(false);
    });

    it('degrades to subscribed=false on gateway adapter throwing', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockImplementation(() => {
        throw new Error('extraction failed');
      });

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchCodingPlan — edge cases
  // ──────────────────────────────────────────────────────────────────

  describe('fetchCodingPlan — edge cases', () => {
    it('handles zero total quota without division-by-zero', async () => {
      const instance = makeCodingPlanInstance({
        codingPlanQuotaInfo: {
          per5HourTotalQuota: 0,
          per5HourUsedQuota: 0,
          perWeekTotalQuota: 0,
          perWeekUsedQuota: 0,
          perBillMonthTotalQuota: 0,
          perBillMonthUsedQuota: 0,
        },
      });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(true);
      expect(result.windows!.per_5h.used_pct).toBe(0);
      expect(result.windows!.weekly.used_pct).toBe(0);
      expect(result.windows!.monthly.used_pct).toBe(0);
    });

    it('handles missing quotaInfo gracefully', async () => {
      const instance = makeCodingPlanInstance({
        codingPlanQuotaInfo: undefined,
      });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(true);
      expect(result.windows!.per_5h.total).toBe(0);
      expect(result.windows!.per_5h.remaining).toBe(0);
    });

    it('returns empty next_reset_at when refresh time is undefined', async () => {
      const instance = makeCodingPlanInstance({
        codingPlanQuotaInfo: {
          per5HourTotalQuota: 100,
          per5HourUsedQuota: 10,
          per5HourQuotaNextRefreshTime: undefined,
          perWeekTotalQuota: 500,
          perWeekUsedQuota: 50,
          perWeekQuotaNextRefreshTime: undefined,
          perBillMonthTotalQuota: 2000,
          perBillMonthUsedQuota: 200,
          perBillMonthQuotaNextRefreshTime: undefined,
        },
      });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.windows!.per_5h.next_reset_at).toBe('');
      expect(result.windows!.weekly.next_reset_at).toBe('');
      expect(result.windows!.monthly.next_reset_at).toBe('');
    });

    it('defaults instanceType to unknown when absent', async () => {
      const instance = makeCodingPlanInstance({ instanceType: undefined });
      apiClient.callEnvelopeApi.mockResolvedValue({} as CodingPlanApiResponse);
      gatewayAdapter.extractCodingPlanInstances.mockReturnValue([instance]);

      const result = await service.fetchCodingPlan();

      expect(result.subscribed).toBe(true);
      expect(result.plan).toBe('unknown');
    });
  });
});

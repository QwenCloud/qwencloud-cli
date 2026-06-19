/**
 * Unit tests for FreetierService (src/services/freetier-service.ts).
 *
 * Covers:
 *   - fetchFreeTierQuotas: batch quota retrieval via callFlatApi
 *   - fetchModelMapping: CDN mapping retrieval via fetch (through cache)
 *   - fetchQuotasForModels: model augmentation with quota data
 *   - fetchFreeTierUsageList: per-model free-tier usage composition
 *   - peekCachedQuota / rememberQuota: memoization layer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type { FqInstanceItem } from '../../src/types/api-models.js';
import type { Model } from '../../src/types/model.js';
import { FreetierService } from '../../src/services/freetier-service.js';
import type { ApiClient } from '../../src/api/api-client.js';

// ────────────────────────────────────────────────────────────────────
// Mock factory helpers
// ────────────────────────────────────────────────────────────────────

function makeFqInstanceItem(overrides: Partial<FqInstanceItem> = {}): FqInstanceItem {
  return {
    InstanceName: 'qwen-plus-free',
    Status: 'valid',
    Uid: 123456,
    InitCapacity: { BaseValue: 1000000, ShowUnit: 'Tokens', ShowValue: '1,000,000' },
    CurrCapacity: { BaseValue: 500000, ShowUnit: 'Tokens', ShowValue: '500,000' },
    Template: { Code: 'tpl-qwen-plus', Name: 'Qwen Plus Free Tier' },
    StartTime: '2026-01-01T00:00:00Z',
    EndTime: '2026-12-31T23:59:59Z',
    CurrentCycleStartTime: '2026-05-01T00:00:00Z',
    CurrentCycleEndTime: '2026-05-31T23:59:59Z',
    ...overrides,
  };
}

function makeCachedFetcher() {
  const mock = {
    getOrFetch: vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate: vi.fn(),
  };
  return mock as unknown as CachedFetcher & typeof mock;
}

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
  callEnvelopeApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return {
    callFlatApi: vi.fn(),
    callEnvelopeApi: vi.fn(),
  };
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'qwen-plus',
    modality: { input: ['text'], output: ['text'] },
    can_try: true,
    free_tier: { mode: 'standard', quota: null },
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe('FreetierService', () => {
  let apiClient: MockApiClient;
  let cache: ReturnType<typeof makeCachedFetcher>;
  let service: FreetierService;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    cache = makeCachedFetcher();
    service = new FreetierService(apiClient as unknown as ApiClient, cache as unknown as CachedFetcher);

    // Mock global fetch for fetchModelMapping CDN calls
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchFreeTierQuotas
  // ──────────────────────────────────────────────────────────────────

  describe('fetchFreeTierQuotas', () => {
    it('returns quota map keyed by templateCode on successful API response', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        Data: [makeFqInstanceItem()],
      });

      const result = await service.fetchFreeTierQuotas(['tpl-qwen-plus']);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(1);
      const quota = result.get('tpl-qwen-plus')!;
      expect(quota.total).toBe(1000000);
      expect(quota.remaining).toBe(500000);
      expect(quota.unit).toBe('tokens');
      expect(quota.used_pct).toBe(50);
      expect(quota.status).toBe('valid');
      expect(quota.resetDate).toBe('2026-05-31T23:59:59.000Z');
    });

    it('returns empty map when templateCodes array is empty', async () => {
      const result = await service.fetchFreeTierQuotas([]);

      expect(result.size).toBe(0);
      expect(apiClient.callFlatApi).not.toHaveBeenCalled();
    });

    it('filters out instances with invalid status', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        Data: [
          makeFqInstanceItem({ Status: 'cancelled' }),
          makeFqInstanceItem({ Template: { Code: 'tpl-valid', Name: 'Valid' }, Status: 'valid' }),
        ],
      });

      const result = await service.fetchFreeTierQuotas(['tpl-cancelled', 'tpl-valid']);

      expect(result.size).toBe(1);
      expect(result.has('tpl-valid')).toBe(true);
    });

    it('filters out instances missing Template.Code', async () => {
      const noCode = makeFqInstanceItem({ Template: { Code: '', Name: 'No Code' } });
      apiClient.callFlatApi.mockResolvedValue({ Data: [noCode] });

      const result = await service.fetchFreeTierQuotas(['anything']);

      expect(result.size).toBe(0);
    });

    it('returns empty map on API error (absorbs failure)', async () => {
      apiClient.callFlatApi.mockRejectedValue(new Error('gateway timeout'));

      const result = await service.fetchFreeTierQuotas(['tpl-qwen-plus']);

      expect(result.size).toBe(0);
    });

    it('handles exhaust status correctly', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        Data: [
          makeFqInstanceItem({
            Status: 'exhaust',
            CurrCapacity: { BaseValue: 0, ShowUnit: 'Tokens', ShowValue: '0' },
          }),
        ],
      });

      const result = await service.fetchFreeTierQuotas(['tpl-qwen-plus']);

      const quota = result.get('tpl-qwen-plus')!;
      expect(quota.remaining).toBe(0);
      expect(quota.used_pct).toBe(100);
      expect(quota.status).toBe('exhaust');
    });

    it('passes correct product/action/params to callFlatApi', async () => {
      apiClient.callFlatApi.mockResolvedValue({ Data: [] });

      await service.fetchFreeTierQuotas(['code-a', 'code-b']);

      expect(apiClient.callFlatApi).toHaveBeenCalledWith({
        product: 'BssOpenAPI-V3',
        action: 'DescribeFqInstance',
        params: { templateCodes: ['code-a', 'code-b'], PageSize: 500 },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchModelMapping
  // ──────────────────────────────────────────────────────────────────

  describe('fetchModelMapping', () => {
    it('returns model-to-templateCode mapping on successful fetch', async () => {
      const mapping = { 'qwen-plus': 'tpl-qwen-plus', 'qwen-max': 'tpl-qwen-max' };
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mapping,
      });

      const result = await service.fetchModelMapping();

      expect(result).toEqual(mapping);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns empty object on fetch failure (non-ok response)', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      const result = await service.fetchModelMapping();

      expect(result).toEqual({});
    });

    it('returns empty object on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.fetchModelMapping();

      expect(result).toEqual({});
    });

    it('uses cache via getOrFetch with correct key', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      });

      await service.fetchModelMapping();

      expect(cache.getOrFetch).toHaveBeenCalledWith(
        'models:mapping',
        10 * 60 * 1000,
        expect.any(Function),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchQuotasForModels
  // ──────────────────────────────────────────────────────────────────

  describe('fetchQuotasForModels', () => {
    it('augments models with quota data from API', async () => {
      const mapping = { 'qwen-plus': 'tpl-qwen-plus' };
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mapping,
      });
      apiClient.callFlatApi.mockResolvedValue({
        Data: [makeFqInstanceItem()],
      });

      const models = [makeModel({ id: 'qwen-plus' })];
      const result = await service.fetchQuotasForModels(models);

      expect(result[0].free_tier.quota).not.toBeNull();
      expect(result[0].free_tier.quota!.total).toBe(1000000);
      expect(result[0].free_tier.quota!.remaining).toBe(500000);
    });

    it('returns models unchanged when none have free_tier mode=standard', async () => {
      const models = [makeModel({ id: 'qwen-plus', free_tier: { mode: null, quota: null } })];

      const result = await service.fetchQuotasForModels(models);

      expect(result).toEqual(models);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(apiClient.callFlatApi).not.toHaveBeenCalled();
    });

    it('handles models without mapping entries gracefully', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      });

      const models = [makeModel({ id: 'qwen-plus' })];
      const result = await service.fetchQuotasForModels(models);

      expect(result[0].free_tier.quota).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchFreeTierUsageList
  // ──────────────────────────────────────────────────────────────────

  describe('fetchFreeTierUsageList', () => {
    it('returns per-model usage list combining mapping and quotas', async () => {
      const mapping = { 'qwen-plus': 'tpl-qwen-plus', 'qwen-max': 'tpl-qwen-max' };
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mapping,
      });
      apiClient.callFlatApi.mockResolvedValue({
        Data: [
          makeFqInstanceItem({ Template: { Code: 'tpl-qwen-plus', Name: 'Plus' } }),
          makeFqInstanceItem({
            Template: { Code: 'tpl-qwen-max', Name: 'Max' },
            InitCapacity: { BaseValue: 2000000, ShowUnit: 'Tokens', ShowValue: '2M' },
            CurrCapacity: { BaseValue: 1800000, ShowUnit: 'Tokens', ShowValue: '1.8M' },
          }),
        ],
      });

      const result = await service.fetchFreeTierUsageList();

      expect(result).toHaveLength(2);
      const plusEntry = result.find((r) => r.model_id === 'qwen-plus');
      expect(plusEntry).toBeDefined();
      expect(plusEntry!.quota).not.toBeNull();
      expect(plusEntry!.quota!.total).toBe(1000000);

      const maxEntry = result.find((r) => r.model_id === 'qwen-max');
      expect(maxEntry).toBeDefined();
      expect(maxEntry!.quota!.total).toBe(2000000);
    });

    it('returns empty list when mapping is empty', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      });

      const result = await service.fetchFreeTierUsageList();

      expect(result).toHaveLength(0);
    });

    it('returns entries with null quota when API fails', async () => {
      const mapping = { 'qwen-plus': 'tpl-qwen-plus' };
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mapping,
      });
      apiClient.callFlatApi.mockRejectedValue(new Error('timeout'));

      const result = await service.fetchFreeTierUsageList();

      expect(result).toHaveLength(1);
      expect(result[0].model_id).toBe('qwen-plus');
      expect(result[0].quota).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // peekCachedQuota / rememberQuota
  // ──────────────────────────────────────────────────────────────────

  describe('peekCachedQuota / rememberQuota', () => {
    it('returns undefined for uncached templateCode', () => {
      expect(service.peekCachedQuota('tpl-unknown')).toBeUndefined();
    });

    it('returns remembered quota after rememberQuota', () => {
      const quota = { remaining: 100, total: 200, unit: 'tokens', used_pct: 50, status: 'valid' as const, resetDate: null };
      service.rememberQuota('tpl-x', quota);

      expect(service.peekCachedQuota('tpl-x')).toEqual(quota);
    });

    it('returns null for explicitly remembered null quota', () => {
      service.rememberQuota('tpl-y', null);

      expect(service.peekCachedQuota('tpl-y')).toBeNull();
    });
  });
});

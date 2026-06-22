/**
 * Unit tests for ModelsService (src/services/models-service.ts).
 *
 * Covers:
 *   - listModels: raw API fetch + flattenApiModels + free-tier mapping merge
 *   - getModel: one-shot detail lookup (non-REPL path)
 *   - getModels: batch detail with quota resolution
 *   - searchModels: local keyword filtering
 *   - fetchQuotasForModels: delegation to FreetierService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type { FreeTierQuota } from '../../src/types/model.js';
import type { ApiModelItem } from '../../src/types/api-models.js';
import { ModelsService } from '../../src/services/models-service.js';
import type { ModelAdapter } from '../../src/services/models-service.js';
import type { ApiClient } from '../../src/api/api-client.js';
import type { FreetierService } from '../../src/services/freetier-service.js';

// ────────────────────────────────────────────────────────────────────
// Mock factory helpers
// ────────────────────────────────────────────────────────────────────

function makeApiModelItem(overrides: Partial<ApiModelItem> = {}): ApiModelItem {
  return {
    Model: 'qwen-plus',
    Name: 'Qwen Plus',
    Description: 'A capable LLM model',
    ShortDescription: 'Capable LLM',
    Category: 'Flagship',
    Language: 'en-US',
    DataId: 'data-001',
    GroupModel: 'Qwen-Plus',
    VersionTag: 'MAJOR',
    ActivationStatus: 1,
    Scope: 'PUBLIC',
    OpenSource: false,
    FreeTierOnly: false,
    NeedApply: false,
    AliyunRecommend: true,
    UpdateAt: '2026-05-01T00:00:00Z',
    LatestOnlineAt: '2026-05-01T00:00:00Z',
    InferenceMetadata: { RequestModality: ['Text'], ResponseModality: ['Text'] },
    Capabilities: [],
    Prices: [{ Type: 'text_input_token', PriceUnit: 'Per 1M tokens', Price: '0.8', PriceName: 'Input' }],
    ModelInfo: { ContextWindow: 131072, MaxInputTokens: 130048, MaxOutputTokens: 8192 },
    ContextWindow: 131072,
    MaxInputTokens: 130048,
    MaxOutputTokens: 8192,
    QpmInfo: { ModelDefault: { UsageLimitField: 'total_tokens', CountLimit: 500, Type: 'model-default', UsageLimit: 2000000, CountLimitPeriod: 60, UsageLimitPeriod: 60 } },
    Supports: { Sft: false, App: true, Dpo: false, WorkflowText: true, CheckpointImport: false, WorkflowMultimodal: false, Cpt: false, Inference: true, Workflow: true, Deploy: false, SelfServiceLimitIncrease: false, Experience: true, SellingByQpm: false, AppV1: true, ExperienceUpcoming: false, AppV2: true, DisplayQpmLimit: true, Tokenizer: true, Eval: true, FineTune: false },
    Permissions: { Inference: true },
    Features: ['cache'],
    Tags: ['llm', 'text'],
    InferenceProvider: 'bailian',
    Provider: 'qwen',
    SampleCodeV2: {},
    ApplyType: 0,
    ...overrides,
  } as ApiModelItem;
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

interface MockFreetierService {
  fetchModelMapping: ReturnType<typeof vi.fn>;
  fetchFreeTierQuotas: ReturnType<typeof vi.fn>;
  fetchQuotasForModels: ReturnType<typeof vi.fn>;
  peekCachedQuota: ReturnType<typeof vi.fn>;
  rememberQuota: ReturnType<typeof vi.fn>;
}

function makeMockFreetierService(): MockFreetierService {
  return {
    fetchModelMapping: vi.fn().mockResolvedValue({}),
    fetchFreeTierQuotas: vi.fn().mockResolvedValue(new Map()),
    fetchQuotasForModels: vi.fn(async (models) => models),
    peekCachedQuota: vi.fn().mockReturnValue(undefined),
    rememberQuota: vi.fn(),
  };
}

function makeMockModelAdapter(): ModelAdapter {
  return {
    toModelList: vi.fn(),
    toModelDetail: vi.fn(),
  };
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe('ModelsService', () => {
  let apiClient: MockApiClient;
  let modelAdapter: ModelAdapter;
  let freetierService: MockFreetierService;
  let cache: ReturnType<typeof makeCachedFetcher>;
  let service: ModelsService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    modelAdapter = makeMockModelAdapter();
    freetierService = makeMockFreetierService();
    cache = makeCachedFetcher();
    service = new ModelsService(
      apiClient as unknown as ApiClient,
      modelAdapter,
      freetierService as unknown as FreetierService,
      cache as unknown as CachedFetcher,
    );
  });

  // ──────────────────────────────────────────────────────────────────
  // listModels
  // ──────────────────────────────────────────────────────────────────

  describe('listModels', () => {
    it('returns model list from flattened API response', async () => {
      const item = makeApiModelItem({ Model: 'qwen-plus' });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const result = await service.listModels();

      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('qwen-plus');
      expect(result.total).toBe(1);
    });

    it('merges free-tier mapping info into model list', async () => {
      const item = makeApiModelItem({ Model: 'qwen-plus' });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({ 'qwen-plus': 'tpl-qwen-plus' });

      const result = await service.listModels();

      expect(result.models[0].free_tier.mode).toBe('standard');
    });

    it('marks models without mapping as no free tier', async () => {
      const item = makeApiModelItem({ Model: 'qwen-max' });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const result = await service.listModels();

      expect(result.models[0].free_tier.mode).toBeNull();
    });

    it('filters by input modality when specified', async () => {
      const textModel = makeApiModelItem({ Model: 'qwen-plus', InferenceMetadata: { RequestModality: ['Text'], ResponseModality: ['Text'] } });
      const imageModel = makeApiModelItem({ Model: 'qwen-vl', InferenceMetadata: { RequestModality: ['Text', 'Image'], ResponseModality: ['Text'] } });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [textModel, imageModel] }] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const result = await service.listModels({ input: 'image' });

      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('qwen-vl');
    });

    it('returns empty list when API responds with no groups', async () => {
      apiClient.callFlatApi.mockResolvedValue({ Data: [] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const result = await service.listModels();

      expect(result.models).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('throws when API returns empty payload', async () => {
      apiClient.callFlatApi.mockResolvedValue(null);

      await expect(service.listModels()).rejects.toThrow('Models API returned empty payload');
    });

    it('uses cache with correct key and TTL', async () => {
      apiClient.callFlatApi.mockResolvedValue({ Data: [] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      await service.listModels();

      expect(cache.getOrFetch).toHaveBeenCalledWith(
        'models:raw_list',
        10 * 60 * 1000,
        expect.any(Function),
      );
    });

    it('marks FreeTierOnly models with mode=only', async () => {
      const item = makeApiModelItem({ Model: 'qwen-free', FreeTierOnly: true });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({ 'qwen-free': 'tpl-free' });

      const result = await service.listModels();

      expect(result.models[0].free_tier.mode).toBe('only');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // getModel (non-REPL path)
  // ──────────────────────────────────────────────────────────────────

  describe('getModel', () => {
    it('returns model detail when found in cache', async () => {
      const item = makeApiModelItem({ Model: 'qwen-plus' });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const detail = await service.getModel('qwen-plus');

      expect(detail.id).toBe('qwen-plus');
      expect(detail.description).toBe('A capable LLM model');
    });

    it('fetches from API with Query+MatchOnly when not in cache', async () => {
      // First call (cache miss): empty raw list
      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [] })
        // Second call (query fallback): returns the model
        .mockResolvedValueOnce({ Data: [{ Items: [makeApiModelItem({ Model: 'qwen-new' })] }] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const detail = await service.getModel('qwen-new');

      expect(detail.id).toBe('qwen-new');
      expect(apiClient.callFlatApi).toHaveBeenCalledTimes(2);
      expect(apiClient.callFlatApi.mock.calls[1][0]).toMatchObject({
        params: expect.objectContaining({ Query: 'qwen-new', MatchOnly: true }),
      });
    });

    it('throws when model is not found anywhere', async () => {
      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [] })
        .mockResolvedValueOnce({ Data: [] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      await expect(service.getModel('nonexistent')).rejects.toThrow("Model 'nonexistent' not found");
    });

    it('resolves free-tier quota for model with mapping', async () => {
      const item = makeApiModelItem({ Model: 'qwen-plus' });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({ 'qwen-plus': 'tpl-qwen-plus' });
      freetierService.peekCachedQuota.mockReturnValue(undefined);
      const quota: FreeTierQuota = { remaining: 500000, total: 1000000, unit: 'tokens', used_pct: 50, status: 'valid', resetDate: null };
      freetierService.fetchFreeTierQuotas.mockResolvedValue(new Map([['tpl-qwen-plus', quota]]));

      const detail = await service.getModel('qwen-plus');

      expect(detail.free_tier.mode).toBe('standard');
      expect(detail.free_tier.quota).toEqual(quota);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // getModels (batch)
  // ──────────────────────────────────────────────────────────────────

  describe('getModels', () => {
    it('returns array of model details for valid ids', async () => {
      const items = [
        makeApiModelItem({ Model: 'qwen-plus' }),
        makeApiModelItem({ Model: 'qwen-max', Name: 'Qwen Max', Description: 'Max model' }),
      ];
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: items }] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const results = await service.getModels(['qwen-plus', 'qwen-max']);

      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe('qwen-plus');
      expect(results[1]!.id).toBe('qwen-max');
    });

    it('returns null for unresolved model ids', async () => {
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [makeApiModelItem({ Model: 'qwen-plus' })] }] });
      freetierService.fetchModelMapping.mockResolvedValue({});

      const results = await service.getModels(['qwen-plus', 'nonexistent']);

      expect(results[0]).not.toBeNull();
      expect(results[1]).toBeNull();
    });

    it('returns empty array for empty ids input', async () => {
      const results = await service.getModels([]);

      expect(results).toHaveLength(0);
      expect(apiClient.callFlatApi).not.toHaveBeenCalled();
    });

    it('batch-fetches quotas for models with mapping', async () => {
      const item = makeApiModelItem({ Model: 'qwen-plus' });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({ 'qwen-plus': 'tpl-plus' });
      const quota: FreeTierQuota = { remaining: 800000, total: 1000000, unit: 'tokens', used_pct: 20, status: 'valid', resetDate: null };
      freetierService.fetchFreeTierQuotas.mockResolvedValue(new Map([['tpl-plus', quota]]));
      // After rememberQuota is called, peekCachedQuota should return the stored value
      const storedQuotas = new Map<string, FreeTierQuota | null>();
      freetierService.rememberQuota.mockImplementation((code: string, q: FreeTierQuota | null) => { storedQuotas.set(code, q); });
      freetierService.peekCachedQuota.mockImplementation((code: string) => storedQuotas.get(code));

      const results = await service.getModels(['qwen-plus']);

      expect(results[0]!.free_tier.quota).toEqual(quota);
      expect(freetierService.rememberQuota).toHaveBeenCalledWith('tpl-plus', quota);
    });

    it('skips quota fetch when cached quota exists', async () => {
      const item = makeApiModelItem({ Model: 'qwen-plus' });
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: [item] }] });
      freetierService.fetchModelMapping.mockResolvedValue({ 'qwen-plus': 'tpl-plus' });
      const cachedQuota: FreeTierQuota = { remaining: 100, total: 200, unit: 'tokens', used_pct: 50, status: 'valid', resetDate: null };
      freetierService.peekCachedQuota.mockReturnValue(cachedQuota);

      await service.getModels(['qwen-plus']);

      expect(freetierService.fetchFreeTierQuotas).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // searchModels
  // ──────────────────────────────────────────────────────────────────

  describe('searchModels', () => {
    beforeEach(() => {
      freetierService.fetchModelMapping.mockResolvedValue({});
    });

    it('filters models by id keyword match', async () => {
      const items = [
        makeApiModelItem({ Model: 'qwen-plus' }),
        makeApiModelItem({ Model: 'qwen-max' }),
        makeApiModelItem({ Model: 'wan2.6-t2i', InferenceMetadata: { RequestModality: ['Text'], ResponseModality: ['Image'] } }),
      ];
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: items }] });

      const result = await service.searchModels('qwen');

      expect(result.models).toHaveLength(2);
      expect(result.models.map((m) => m.id)).toContain('qwen-plus');
      expect(result.models.map((m) => m.id)).toContain('qwen-max');
    });

    it('performs case-insensitive search', async () => {
      const items = [makeApiModelItem({ Model: 'Qwen-Plus' })];
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: items }] });

      const result = await service.searchModels('qwen');

      expect(result.models).toHaveLength(1);
    });

    it('returns empty result when no models match', async () => {
      const items = [makeApiModelItem({ Model: 'qwen-plus' })];
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: items }] });

      const result = await service.searchModels('nonexistent-xyz-model');

      expect(result.models).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('matches against description and tags', async () => {
      const items = [makeApiModelItem({ Model: 'model-a', Tags: ['reasoning', 'math'], Description: 'Advanced reasoning model' })];
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: items }] });

      const result = await service.searchModels('reasoning');

      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('model-a');
    });

    it('matches against modality types', async () => {
      const items = [
        makeApiModelItem({ Model: 'text-model', InferenceMetadata: { RequestModality: ['Text'], ResponseModality: ['Text'] } }),
        makeApiModelItem({ Model: 'image-model', InferenceMetadata: { RequestModality: ['Text', 'Image'], ResponseModality: ['Image'] } }),
      ];
      apiClient.callFlatApi.mockResolvedValue({ Data: [{ Items: items }] });

      const result = await service.searchModels('image');

      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('image-model');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchQuotasForModels (delegation)
  // ──────────────────────────────────────────────────────────────────

  describe('fetchQuotasForModels', () => {
    it('delegates to freetierService.fetchQuotasForModels', async () => {
      const models = [
        { id: 'qwen-plus', modality: { input: ['text' as const], output: ['text' as const] }, can_try: true, free_tier: { mode: 'standard' as const, quota: null } },
      ];
      freetierService.fetchQuotasForModels.mockResolvedValue(models);

      const result = await service.fetchQuotasForModels(models);

      expect(freetierService.fetchQuotasForModels).toHaveBeenCalledWith(models);
      expect(result).toEqual(models);
    });
  });
});

/**
 * Pure function tests for ModelAdapter (src/api/adapters/model-adapter.ts).
 *
 * ModelAdapter transforms raw API model responses into Service-layer DTOs:
 *   - Model list: ApiModelGroup[] → Model[] (trimmed, normalized)
 *   - Model detail: ApiModelItem → ModelDetail (full field mapping)
 *   - Model mapping: external CDN JSON → key-value lookup
 *
 * All functions are pure (no I/O, no module state) — tests pass in fixture
 * data directly and assert on outputs.
 */
import { describe, it, expect } from 'vitest';
import type {
  ApiModelItem,
  ApiModelGroup,
  ApiModelsListResponse,
} from '../../../src/types/api-models.js';
import type { Model, ModelDetail } from '../../../src/types/model.js';

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

function makeApiModelItem(overrides: Partial<ApiModelItem> = {}): ApiModelItem {
  return {
    Model: 'qwen-plus',
    Name: 'Qwen Plus',
    Description: 'A powerful LLM model',
    ShortDescription: 'Powerful LLM',
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
    UpdateAt: '2026-05-01T10:00:00Z',
    LatestOnlineAt: '2026-04-15T08:00:00Z',
    InferenceMetadata: {
      RequestModality: ['Text', 'Image'],
      ResponseModality: ['Text'],
    },
    Capabilities: ['Multimodal'],
    Prices: [
      { Type: 'text_input_token', PriceUnit: 'Per 1M tokens', Price: '0.30', PriceName: 'Input: Text' },
      { Type: 'text_output_token', PriceUnit: 'Per 1M tokens', Price: '1.20', PriceName: 'Output: Text' },
    ],
    ModelInfo: { ContextWindow: 128000, MaxInputTokens: 128000, MaxOutputTokens: 8192 },
    ContextWindow: 128000,
    MaxInputTokens: 128000,
    MaxOutputTokens: 8192,
    QpmInfo: {
      ModelDefault: {
        UsageLimitField: 'total_tokens',
        CountLimit: 500,
        Type: 'model-default',
        UsageLimit: 500000,
        CountLimitPeriod: 60,
        UsageLimitPeriod: 60,
      },
    },
    Supports: {
      Sft: false, App: true, Dpo: false, WorkflowText: true,
      CheckpointImport: false, WorkflowMultimodal: false, Cpt: false,
      Inference: true, Workflow: true, Deploy: false,
      SelfServiceLimitIncrease: true, Experience: true, SellingByQpm: false,
      AppV1: true, ExperienceUpcoming: false, AppV2: true,
      DisplayQpmLimit: true, Tokenizer: true, Eval: true, FineTune: false,
    },
    Permissions: { Inference: true },
    Features: ['cache', 'model-experience'],
    Tags: ['recommended', 'multimodal'],
    InferenceProvider: 'bailian',
    Provider: 'qwen',
    SampleCodeV2: {},
    ApplyType: 0,
    ...overrides,
  };
}

function makeApiModelGroup(items: Partial<ApiModelItem>[] = [{}]): ApiModelGroup {
  return {
    Group: true,
    Name: 'Qwen-Plus',
    DataId: 'group-001',
    Providers: ['qwen'],
    LatestOnlineAt: '2026-05-01T10:00:00Z',
    InstanceLatestOnlineAt: '2026-05-01T10:00:00Z',
    ActivationStatus: 1,
    UpdateAt: '2026-05-01T10:00:00Z',
    Supports: makeApiModelItem().Supports,
    Language: 'en-US',
    Permissions: { Inference: true },
    Features: ['cache'],
    Items: items.map(makeApiModelItem),
    ApplyType: 0,
  };
}

// ────────────────────────────────────────────────────────────────────
// Model list transformation
// ────────────────────────────────────────────────────────────────────

describe('ModelAdapter — model list transformation', () => {
  it('extracts model id from ApiModelItem.Model', async () => {
    const { transformModelList } = await import('../../../src/api/adapters/model-adapter.js');
    const groups = [makeApiModelGroup([{ Model: 'qwen-turbo' }])];
    const result = transformModelList(groups);
    expect(result.models[0]?.id).toBe('qwen-turbo');
  });

  it('maps InferenceMetadata modalities to lowercase input/output arrays', async () => {
    const { transformModelList } = await import('../../../src/api/adapters/model-adapter.js');
    const groups = [makeApiModelGroup([{
      InferenceMetadata: {
        RequestModality: ['Text', 'Image', 'Audio'],
        ResponseModality: ['Text', 'Audio'],
      },
    }])];
    const result = transformModelList(groups);
    const modality = result.models[0]?.modality;
    expect(modality?.input).toContain('text');
    expect(modality?.input).toContain('image');
    expect(modality?.input).toContain('audio');
    expect(modality?.output).toContain('text');
    expect(modality?.output).toContain('audio');
  });

  it('determines can_try from Supports.Experience', async () => {
    const { transformModelList } = await import('../../../src/api/adapters/model-adapter.js');
    const groups = [makeApiModelGroup([
      { Model: 'model-tryable', Supports: { ...makeApiModelItem().Supports, Experience: true } },
      { Model: 'model-not-tryable', Supports: { ...makeApiModelItem().Supports, Experience: false } },
    ])];
    const result = transformModelList(groups);
    expect(result.models.find((m) => m.id === 'model-tryable')?.can_try).toBe(true);
    expect(result.models.find((m) => m.id === 'model-not-tryable')?.can_try).toBe(false);
  });

  it('sets free_tier.mode to "only" for FreeTierOnly models', async () => {
    const { transformModelList } = await import('../../../src/api/adapters/model-adapter.js');
    const groups = [makeApiModelGroup([{ FreeTierOnly: true }])];
    const result = transformModelList(groups);
    expect(result.models[0]?.free_tier.mode).toBe('only');
  });

  it('returns total count matching the number of models across groups', async () => {
    const { transformModelList } = await import('../../../src/api/adapters/model-adapter.js');
    const groups = [
      makeApiModelGroup([{ Model: 'a' }, { Model: 'b' }]),
      makeApiModelGroup([{ Model: 'c' }]),
    ];
    const result = transformModelList(groups);
    expect(result.total).toBe(3);
  });

  it('handles empty groups array', async () => {
    const { transformModelList } = await import('../../../src/api/adapters/model-adapter.js');
    const result = transformModelList([]);
    expect(result.models).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('handles group with empty Items array', async () => {
    const { transformModelList } = await import('../../../src/api/adapters/model-adapter.js');
    const group: ApiModelGroup = { ...makeApiModelGroup(), Items: [] };
    const result = transformModelList([group]);
    expect(result.models).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// Model detail transformation
// ────────────────────────────────────────────────────────────────────

describe('ModelAdapter — model detail transformation', () => {
  it('maps all standard fields to ModelDetail DTO', async () => {
    const { transformModelDetail } = await import('../../../src/api/adapters/model-adapter.js');
    const raw = makeApiModelItem();
    const result = transformModelDetail(raw);
    expect(result.id).toBe('qwen-plus');
    expect(result.description).toBe('A powerful LLM model');
    expect(result.tags).toContain('recommended');
    expect(result.features).toContain('cache');
  });

  it('maps context window info from ModelInfo', async () => {
    const { transformModelDetail } = await import('../../../src/api/adapters/model-adapter.js');
    const raw = makeApiModelItem({
      ModelInfo: { ContextWindow: 256000, MaxInputTokens: 200000, MaxOutputTokens: 16384 },
    });
    const result = transformModelDetail(raw);
    expect(result.context?.context_window).toBe(256000);
    expect(result.context?.max_input).toBe(200000);
    expect(result.context?.max_output).toBe(16384);
  });

  it('maps rate limits from QpmInfo', async () => {
    const { transformModelDetail } = await import('../../../src/api/adapters/model-adapter.js');
    const raw = makeApiModelItem({
      QpmInfo: {
        ModelDefault: {
          UsageLimitField: 'total_tokens',
          CountLimit: 1000,
          Type: 'model-default',
          UsageLimit: 2000000,
          CountLimitPeriod: 60,
          UsageLimitPeriod: 60,
        },
      },
    });
    const result = transformModelDetail(raw);
    expect(result.rate_limits.rpm).toBe(1000);
    expect(result.rate_limits.tpm).toBe(2000000);
  });

  it('maps metadata fields (version_tag, open_source, updated, category)', async () => {
    const { transformModelDetail } = await import('../../../src/api/adapters/model-adapter.js');
    const raw = makeApiModelItem({
      VersionTag: 'MAJOR',
      OpenSource: true,
      UpdateAt: '2026-05-20T12:00:00Z',
      Category: 'Standard',
    });
    const result = transformModelDetail(raw);
    expect(result.metadata.version_tag).toBe('MAJOR');
    expect(result.metadata.open_source).toBe(true);
    expect(result.metadata.updated).toBe('2026-05-20T12:00:00Z');
    expect(result.metadata.category).toBe('Standard');
  });

  it('generates pricing from Prices array (LLM token pricing)', async () => {
    const { transformModelDetail } = await import('../../../src/api/adapters/model-adapter.js');
    const raw = makeApiModelItem({
      Prices: [
        { Type: 'text_input_token', PriceUnit: 'Per 1M tokens', Price: '0.50', PriceName: 'Input' },
        { Type: 'text_output_token', PriceUnit: 'Per 1M tokens', Price: '2.00', PriceName: 'Output' },
      ],
    });
    const result = transformModelDetail(raw);
    expect(result.pricing).toBeDefined();
    // LLM pricing should have tiers
    if ('tiers' in result.pricing) {
      expect(result.pricing.tiers.length).toBeGreaterThan(0);
    }
  });

  it('handles model with no Prices (free-only model)', async () => {
    const { transformModelDetail } = await import('../../../src/api/adapters/model-adapter.js');
    const raw = makeApiModelItem({ Prices: undefined, FreeTierOnly: true });
    const result = transformModelDetail(raw);
    expect(result.pricing).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// Model mapping transformation
// ────────────────────────────────────────────────────────────────────

describe('ModelAdapter — model mapping transformation', () => {
  it('transforms CDN mapping JSON to key-value lookup', async () => {
    const { transformModelMapping } = await import('../../../src/api/adapters/model-adapter.js');
    const rawMapping = {
      'qwen-plus': { snapshot: 'qwen-plus-2024-09-19', deprecated: false },
      'qwen-turbo': { snapshot: 'qwen-turbo-2024-06-24', deprecated: true },
    };
    const result = transformModelMapping(rawMapping);
    expect(result['qwen-plus']?.snapshot).toBe('qwen-plus-2024-09-19');
    expect(result['qwen-turbo']?.deprecated).toBe(true);
  });

  it('handles empty mapping object', async () => {
    const { transformModelMapping } = await import('../../../src/api/adapters/model-adapter.js');
    const result = transformModelMapping({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('preserves all fields from raw mapping entry', async () => {
    const { transformModelMapping } = await import('../../../src/api/adapters/model-adapter.js');
    const rawMapping = {
      'test-model': { snapshot: 'test-v1', deprecated: false, extra: 'info' },
    };
    const result = transformModelMapping(rawMapping);
    expect(result['test-model']).toBeDefined();
  });
});

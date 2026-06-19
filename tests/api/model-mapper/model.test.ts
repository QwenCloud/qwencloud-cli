import { describe, it, expect } from 'vitest';
import {
  mapApiModelToModel,
  mapApiModelToModelDetail,
  flattenApiModels,
} from '../../../src/api/model-mapper/index.js';
import type { ApiModelItem, ApiModelGroup } from '../../../src/types/api-models.js';
import type { LLMPricing } from '../../../src/types/model.js';

// ──────────────────────────────────────────────────────────────────────
// Test fixtures: minimal-but-realistic ApiModelItem builders.
// We keep them inline (rather than separate JSON files) so each test owns
// the exact shape it cares about and reviewers don't have to flip between
// files to understand what's being asserted. Common scaffolding lives in
// makeApiItem(); each test overrides only the relevant fields.
// ──────────────────────────────────────────────────────────────────────

function makeApiItem(overrides: Partial<ApiModelItem> = {}): ApiModelItem {
  return {
    Model: 'test-model',
    Name: 'Test Model',
    Description: 'desc',
    ShortDescription: 'short',
    Category: 'Standard',
    Language: 'en-US',
    DataId: 'd1',
    GroupModel: 'TestSeries',
    VersionTag: 'MAJOR',
    ActivationStatus: 1,
    Scope: 'PUBLIC',
    OpenSource: false,
    FreeTierOnly: false,
    NeedApply: false,
    AliyunRecommend: false,
    UpdateAt: '2026-04-01T00:00:00Z',
    LatestOnlineAt: '2026-04-01T00:00:00Z',
    InferenceMetadata: { RequestModality: ['Text'], ResponseModality: ['Text'] },
    Capabilities: [],
    ModelInfo: { ContextWindow: 128000, MaxInputTokens: 120000, MaxOutputTokens: 8000 },
    ContextWindow: 128000,
    MaxInputTokens: 120000,
    MaxOutputTokens: 8000,
    QpmInfo: {
      ModelDefault: {
        UsageLimitField: 'total_tokens',
        CountLimit: 1500,
        Type: 'model-default',
        UsageLimit: 5_000_000,
        CountLimitPeriod: 60,
        UsageLimitPeriod: 60,
      },
    },
    Supports: {
      Sft: false, App: false, Dpo: false, WorkflowText: false, CheckpointImport: false,
      WorkflowMultimodal: false, Cpt: false, Inference: true, Workflow: false, Deploy: false,
      SelfServiceLimitIncrease: false, Experience: true, SellingByQpm: false, AppV1: false,
      ExperienceUpcoming: false, AppV2: false, DisplayQpmLimit: true, Tokenizer: true,
      Eval: false, FineTune: false,
    },
    Permissions: { Inference: true },
    Features: [],
    Tags: [],
    InferenceProvider: 'bailian',
    Provider: 'qwen',
    SampleCodeV2: {},
    ApplyType: 0,
    ...overrides,
  };
}

// ── flattenApiModels ──────────────────────────────────────────────────

describe('flattenApiModels', () => {
  it('flattens nested groups into a single Items array (preserving order)', () => {
    const groups: Pick<ApiModelGroup, 'Items'>[] = [
      { Items: [makeApiItem({ Model: 'a' }), makeApiItem({ Model: 'b' })] },
      { Items: [makeApiItem({ Model: 'c' })] },
    ];
    const flat = flattenApiModels(groups);
    expect(flat.map((x) => x.Model)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for empty groups', () => {
    expect(flattenApiModels([])).toEqual([]);
  });

  it('handles groups with empty Items', () => {
    expect(flattenApiModels([{ Items: [] }, { Items: [] }])).toEqual([]);
  });
});

// ── mapApiModelToModel: modality / can_try / free_tier ────────────────

describe('mapApiModelToModel', () => {
  it('lowercases modality and only maps known types', () => {
    const item = makeApiItem({
      InferenceMetadata: {
        RequestModality: ['Text', 'Image', 'Video', 'Audio', 'Unknown'],
        ResponseModality: ['Text', 'Audio'],
      },
    });
    const m = mapApiModelToModel(item, false);
    expect(m.modality.input).toEqual(['text', 'image', 'video', 'audio']);
    expect(m.modality.output).toEqual(['text', 'audio']);
  });

  it('sets free_tier mode "only" when FreeTierOnly is true (regardless of hasFreeTier)', () => {
    const item = makeApiItem({ FreeTierOnly: true });
    expect(mapApiModelToModel(item, false).free_tier.mode).toBe('only');
    expect(mapApiModelToModel(item, true).free_tier.mode).toBe('only');
  });

  it('sets free_tier mode "standard" when hasFreeTier is true and not FreeTierOnly', () => {
    const item = makeApiItem({ FreeTierOnly: false });
    expect(mapApiModelToModel(item, true).free_tier.mode).toBe('standard');
  });

  it('sets free_tier mode null when neither flag is true', () => {
    expect(mapApiModelToModel(makeApiItem(), false).free_tier.mode).toBeNull();
  });

  it('maps Supports.Experience to can_try', () => {
    const yes = mapApiModelToModel(
      makeApiItem({ Supports: { ...makeApiItem().Supports, Experience: true } }),
      false,
    );
    const no = mapApiModelToModel(
      makeApiItem({ Supports: { ...makeApiItem().Supports, Experience: false } }),
      false,
    );
    expect(yes.can_try).toBe(true);
    expect(no.can_try).toBe(false);
  });

  it('attaches context only for text-modality models with positive ContextWindow', () => {
    const text = mapApiModelToModel(makeApiItem(), false);
    expect(text.context).toEqual({
      context_window: 128000,
      max_input: 120000,
      max_output: 8000,
    });

    const img = mapApiModelToModel(
      makeApiItem({
        InferenceMetadata: { RequestModality: ['Image'], ResponseModality: ['Image'] },
      }),
      false,
    );
    expect(img.context).toBeUndefined();

    const zeroCtx = mapApiModelToModel(
      makeApiItem({ ModelInfo: { ContextWindow: 0, MaxInputTokens: 0, MaxOutputTokens: 0 } }),
      false,
    );
    expect(zeroCtx.context).toBeUndefined();
  });

  it('omits features when empty, includes when non-empty', () => {
    expect(mapApiModelToModel(makeApiItem(), false).features).toBeUndefined();
    const m = mapApiModelToModel(makeApiItem({ Features: ['cache', 'tool-call'] }), false);
    expect(m.features).toEqual(['cache', 'tool-call']);
  });
});

// ── mapApiModelToModel: pricing variants & summary ────────────────────

describe('mapApiModelToModel pricing summary', () => {
  it('LLM single tier → billing_type "token", cheapest_input from tier', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'input_token', Price: '0.50', PriceUnit: 'USD/1M tokens', PriceName: 'Input' },
        { Type: 'output_token', Price: '3.00', PriceUnit: 'USD/1M tokens', PriceName: 'Output' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toBeDefined();
    expect(m.pricing!.summary).toEqual({
      cheapest_input: 0.5,
      cheapest_output: 3,
      unit: 'USD/1M tokens',
      billing_type: 'token',
    });
  });

  it('LLM all-zero tier → billing_type "unknown"', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'input_token', Price: '0', PriceUnit: 'USD/1M tokens', PriceName: 'Input' },
        { Type: 'output_token', Price: '0', PriceUnit: 'USD/1M tokens', PriceName: 'Output' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    // all-zero prices now yield empty tiers and billing_type 'no_pricing'
    expect(m.pricing!.summary?.billing_type).toBe('no_pricing');
  });

  it('image pricing → billing_type "image", cheapest_output from per_image', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'image_number', Price: '0.03', PriceUnit: 'USD/image', PriceName: 'Image' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing!.summary).toMatchObject({
      cheapest_input: 0,
      cheapest_output: 0.03,
      billing_type: 'image',
    });
  });

  it('TTS (per_character) pricing → billing_type "character"', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'cosy_tts_number', Price: '0.70', PriceUnit: 'USD/1K characters', PriceName: 'TTS' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing!.summary).toMatchObject({
      billing_type: 'character',
      cheapest_output: 0.7,
    });
  });

  it('ASR (content_duration with no video) → per_second_audio + billing_type "second"', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'content_duration', Price: '0.00012', PriceUnit: 'USD/second', PriceName: 'ASR' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({ per_second_audio: { price: 0.00012 } });
    expect(m.pricing!.summary).toMatchObject({
      billing_type: 'second',
      cheapest_input: 0.00012,
    });
  });

  it('Video (video_*) pricing → per_second list + billing_type "second"', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'video_ratio_480p', Price: '0.10', PriceUnit: 'USD/second', PriceName: '480p' },
        { Type: 'video_ratio_720p', Price: '0.25', PriceUnit: 'USD/second', PriceName: '720p' },
        { Type: 'video_ratio_1080p', Price: '0.50', PriceUnit: 'USD/second', PriceName: '1080p' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({
      per_second: expect.arrayContaining([
        expect.objectContaining({ resolution: '480p', price: 0.1 }),
      ]),
    });
    expect(m.pricing!.summary).toMatchObject({
      billing_type: 'second',
      cheapest_output: 0.1, // minPositive of the per_second prices
    });
  });

  it('Embedding pricing → per_token + billing_type "token"', () => {
    const item = makeApiItem({
      Prices: [
        {
          Type: 'embedding_token',
          Price: '0.05',
          PriceUnit: 'USD/1M tokens',
          PriceName: 'Embedding',
        },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({ per_token: { price: 0.05 } });
    expect(m.pricing!.summary).toMatchObject({ billing_type: 'token', cheapest_input: 0.05 });
  });

  it('MultiPrices → multiple LLM tiers (cheapest input wins for summary)', () => {
    const item = makeApiItem({
      MultiPrices: [
        {
          RangeName: '0-128k',
          Prices: [
            { Type: 'input_token', Price: '0.80', PriceUnit: 'USD/1M tokens', PriceName: 'In' },
            { Type: 'output_token', Price: '4.00', PriceUnit: 'USD/1M tokens', PriceName: 'Out' },
          ],
        },
        {
          RangeName: '128k-256k',
          Prices: [
            { Type: 'input_token', Price: '1.60', PriceUnit: 'USD/1M tokens', PriceName: 'In' },
            { Type: 'output_token', Price: '8.00', PriceUnit: 'USD/1M tokens', PriceName: 'Out' },
          ],
        },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({
      tiers: [
        expect.objectContaining({ label: '0-128k', input: 0.8 }),
        expect.objectContaining({ label: '128k-256k', input: 1.6 }),
      ],
    });
    expect(m.pricing!.summary).toMatchObject({
      cheapest_input: 0.8,
      cheapest_output: 4,
      billing_type: 'token',
    });
  });

  it('No pricing data → empty tiers + billing_type "no_pricing"', () => {
    const m = mapApiModelToModel(makeApiItem({ Prices: undefined }), false);
    expect(m.pricing).toMatchObject({ tiers: [] });
    expect(m.pricing!.summary).toMatchObject({ billing_type: 'no_pricing' });
  });

  it('Multimodal LLM (text + vision input) → multiple input-modality tiers', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'input_token', Price: '0.50', PriceUnit: 'USD/1M tokens', PriceName: 'TextIn' },
        { Type: 'output_token', Price: '3.00', PriceUnit: 'USD/1M tokens', PriceName: 'Out' },
        { Type: 'vision_input_token', Price: '1.00', PriceUnit: 'USD/1M tokens', PriceName: 'VisIn' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({
      tiers: expect.arrayContaining([
        expect.objectContaining({ label: 'Text input' }),
        expect.objectContaining({ label: 'Text+Image input' }),
      ]),
    });
  });

  it('Omni model (omni_audio + omni_no_audio) → "Text mode" + "Audio mode" tiers', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'omni_no_audio_input_token', Price: '0.40', PriceUnit: 'USD/1M tokens', PriceName: 'NoAudioIn' },
        { Type: 'omni_no_audio_output_token', Price: '0.80', PriceUnit: 'USD/1M tokens', PriceName: 'NoAudioOut' },
        { Type: 'omni_audio_input_token', Price: '1.50', PriceUnit: 'USD/1M tokens', PriceName: 'AudioIn' },
        { Type: 'omni_audio_output_token', Price: '3.00', PriceUnit: 'USD/1M tokens', PriceName: 'AudioOut' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({
      tiers: [
        expect.objectContaining({ label: 'Text mode', input: 0.4 }),
        expect.objectContaining({ label: 'Audio mode', input: 1.5 }),
      ],
    });
  });

  it('Thinking-only LLM → adds "Thinking mode" tier', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'thinking_input_token', Price: '2.00', PriceUnit: 'USD/1M tokens', PriceName: 'TIn' },
        { Type: 'thinking_output_token', Price: '6.00', PriceUnit: 'USD/1M tokens', PriceName: 'TOut' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({
      tiers: expect.arrayContaining([expect.objectContaining({ label: 'Thinking mode' })]),
    });
  });
});

// ── mapApiModelToModelDetail ──────────────────────────────────────────

describe('mapApiModelToModelDetail', () => {
  it('builds full detail with tags falling back to Capabilities', () => {
    const item = makeApiItem({
      Tags: [],
      Capabilities: ['Multimodal-Omni'],
      Description: 'A flagship model',
    });
    const d = mapApiModelToModelDetail(item, false);
    expect(d.tags).toEqual(['Multimodal-Omni']);
    expect(d.description).toBe('A flagship model');
  });

  it('uses Tags when non-empty (Capabilities ignored)', () => {
    const item = makeApiItem({ Tags: ['Reasoning'], Capabilities: ['Multimodal-Omni'] });
    const d = mapApiModelToModelDetail(item, false);
    expect(d.tags).toEqual(['Reasoning']);
  });

  it('attaches built_in_tools to LLM pricing', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'input_token', Price: '0.50', PriceUnit: 'USD/1M tokens', PriceName: 'In' },
        { Type: 'output_token', Price: '3.00', PriceUnit: 'USD/1M tokens', PriceName: 'Out' },
      ],
      BuiltInToolMultiPrices: [
        {
          Type: 'web_search',
          Name: 'web_search',
          Prices: [{ PriceUnit: 'USD/1K calls', Price: '10.00', Currency: 'USD' }],
          SupportedApi: 'Responses API',
        },
      ],
    });
    const d = mapApiModelToModelDetail(item, false);
    expect((d.pricing as any).built_in_tools).toEqual([
      { name: 'web_search', price: 10, unit: 'USD/1K calls', api: 'Responses API' },
    ]);
  });

  it('omits built_in_tools when not present', () => {
    const d = mapApiModelToModelDetail(makeApiItem(), false);
    // tiers array exists, built_in_tools should be undefined
    expect((d.pricing as any).built_in_tools).toBeUndefined();
  });

  it('parses metadata: version, open_source, updated (date only), category, snapshot', () => {
    const item = makeApiItem({
      VersionTag: 'MAJOR',
      OpenSource: true,
      UpdateAt: '2026-04-15T12:34:56Z',
      Category: 'Flagship',
      EquivalentSnapshot: 'v3.6.0',
    });
    const d = mapApiModelToModelDetail(item, false);
    expect(d.metadata).toEqual({
      version_tag: 'MAJOR',
      open_source: true,
      updated: '2026-04-15',
      category: 'Flagship',
      snapshot: 'v3.6.0',
    });
  });

  it('omits category/snapshot when empty strings', () => {
    const item = makeApiItem({ Category: '', EquivalentSnapshot: '' });
    const d = mapApiModelToModelDetail(item, false);
    expect(d.metadata.category).toBeUndefined();
    expect(d.metadata.snapshot).toBeUndefined();
  });

  it('computes RPM/TPM from QpmInfo periods (not assuming per-minute)', () => {
    const item = makeApiItem({
      QpmInfo: {
        ModelDefault: {
          UsageLimitField: 'total_tokens',
          CountLimit: 60, // 60 requests / 60 sec = 60 rpm
          Type: 'model-default',
          UsageLimit: 1_000_000, // 1M / 60 sec * 60 = 1M tpm
          CountLimitPeriod: 60,
          UsageLimitPeriod: 60,
        },
      },
    });
    const d = mapApiModelToModelDetail(item, false);
    expect(d.rate_limits).toEqual({ rpm: 60, tpm: 1_000_000 });
  });

  it('omits TPM when UsageLimit is missing (TTS/ASR)', () => {
    const item = makeApiItem({
      QpmInfo: {
        ModelDefault: {
          UsageLimitField: '',
          CountLimit: 100,
          Type: 'model-default',
          UsageLimit: 0,
          CountLimitPeriod: 60,
          UsageLimitPeriod: 0,
        },
      },
    });
    const d = mapApiModelToModelDetail(item, false);
    expect(d.rate_limits).toEqual({ rpm: 100 });
  });

  it('returns rpm:0 when QpmInfo is missing', () => {
    const d = mapApiModelToModelDetail(makeApiItem({ QpmInfo: undefined as any }), false);
    expect(d.rate_limits).toEqual({ rpm: 0 });
  });
});

// ── Discount handling ──────────────────────────────────────────────────────

describe('Discount handling', () => {
  it('applies Discount multiplier to video pricing', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'video_ratio_720p', Price: '0.14', PriceUnit: 'USD/second', PriceName: '720p', Discount: '0.8' },
        { Type: 'video_ratio_1080p', Price: '0.24', PriceUnit: 'USD/second', PriceName: '1080p', Discount: '0.8' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect(m.pricing).toMatchObject({
      per_second: expect.arrayContaining([
        expect.objectContaining({ resolution: '720p', price: 0.112 }),
        expect.objectContaining({ resolution: '1080p', price: 0.192 }),
      ]),
    });
  });

  it('applies Discount multiplier to LLM token pricing', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'input_token', Price: '2.00', PriceUnit: 'USD/1M tokens', PriceName: 'Input', Discount: '0.5' },
        { Type: 'output_token', Price: '6.00', PriceUnit: 'USD/1M tokens', PriceName: 'Output', Discount: '0.5' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect((m.pricing as LLMPricing).tiers![0]).toMatchObject({ input: 1.0, output: 3.0 });
  });

  it('ignores invalid Discount values', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'input_token', Price: '2.00', PriceUnit: 'USD/1M tokens', PriceName: 'Input', Discount: '1.5' },
        { Type: 'output_token', Price: '6.00', PriceUnit: 'USD/1M tokens', PriceName: 'Output', Discount: '0' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    // Invalid discounts (>1 or <=0) should be ignored, base price used
    expect((m.pricing as LLMPricing).tiers![0]).toMatchObject({ input: 2.0, output: 6.0 });
  });

  it('handles missing Discount field gracefully', () => {
    const item = makeApiItem({
      Prices: [
        { Type: 'input_token', Price: '2.00', PriceUnit: 'USD/1M tokens', PriceName: 'Input' },
        { Type: 'output_token', Price: '6.00', PriceUnit: 'USD/1M tokens', PriceName: 'Output' },
      ],
    });
    const m = mapApiModelToModel(item, false);
    expect((m.pricing as LLMPricing).tiers![0]).toMatchObject({ input: 2.0, output: 6.0 });
  });
});

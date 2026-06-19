import { describe, it, expect } from 'vitest';
import { buildModelDetailViewModel } from '../../../src/view-models/models/index.js';
import type { ModelDetail } from '../../../src/types/model.js';

describe('buildModelDetailViewModel', () => {
  const mockDetail: ModelDetail = {
    id: 'qwen3.6-plus',
    description: 'Qwen3.6 native vision-language flagship.',
    tags: ['Reasoning', 'Visual Understanding', 'Text Generation'],
    modality: { input: ['text', 'image', 'video'], output: ['text'] },
    features: ['Prefix Completion', 'Function Calling', 'Cache'],
    can_try: true,
    free_tier: {
      mode: 'standard',
      quota: { remaining: 850000, total: 1000000, unit: 'tokens', used_pct: 15, resetDate: '2026-05-01' },
    },
    pricing: {
      tiers: [
        { label: '≤ 256K tokens', input: 0.50, output: 3.00, cache_creation: 0.625, cache_read: 0.05, unit: 'USD/1M tokens' },
      ],
      built_in_tools: [
        { name: 'web_search', price: 10.00, unit: 'USD/1K calls', api: 'Responses API' },
        { name: 'code_interpreter', price: 0, unit: 'free', api: 'Responses API' },
      ],
    },
    context: {
      context_window: 1000000,
      max_input: 991800,
      max_output: 65536,
    },
    rate_limits: { rpm: 15000, tpm: 5000000 },
    metadata: {
      version_tag: 'MAJOR',
      open_source: false,
      updated: '2026-04-01',
      category: 'Flagship',
      snapshot: 'v3.6.0',
    },
  };

  it('transforms model detail correctly', () => {
    const vm = buildModelDetailViewModel(mockDetail);

    expect(vm.id).toBe('qwen3.6-plus');
    expect(vm.description).toBe('Qwen3.6 native vision-language flagship.');
    // Tags now use ' · ' separator
    expect(vm.tags).toBe('Reasoning · Visual Understanding · Text Generation');
    expect(vm.modalityInput).toBe('Text · Img · Video');
    expect(vm.modalityOutput).toBe('Text');
    expect(vm.features).toBe('Prefix Completion · Function Calling · Cache');
    expect(vm.pricingType).toBe('llm');
    expect(vm.pricingLines).toHaveLength(1);
    expect(vm.builtInTools).toHaveLength(2);
    expect(vm.builtInTools[0]).toEqual({
      name: 'web_search',
      price: '$10 / 1K calls',
      api: 'Responses API',
    });
    expect(vm.builtInTools[1]).toEqual({
      name: 'code_interpreter',
      price: 'Free',
      api: 'Responses API',
    });

    expect(vm.context).toBeDefined();
    expect(vm.context!.window).toBe('1M tok');
    expect(vm.context!.maxInput).toBe('991.8K tok');
    expect(vm.context!.maxOutput).toBe('65.5K tok');

    expect(vm.rateLimits).toContain('RPM');
    expect(vm.rateLimits).toContain('15K');
    expect(vm.rateLimits).toContain('5M');

    // Metadata now includes category and snapshot
    expect(vm.metadata).toEqual({
      category: 'Flagship',
      version: 'MAJOR',
      snapshot: 'v3.6.0',
      openSource: 'No',
      updated: '2026-04-01',
    });

    // Free Tier is now structured
    expect(vm.freeTier).toBeDefined();
    expect(vm.freeTier!.mode).toBe('standard');
    expect(vm.freeTier!.total).toBe('1M tok');
    expect(vm.freeTier!.remaining).toBe('850K tok');
    expect(vm.freeTier!.remainingPct).toBe(85);
    expect(vm.freeTier!.resetDate).toBe('2026-05-01');
  });

  it('handles "only" free tier', () => {
    const detail = { ...mockDetail, free_tier: { mode: 'only' as const, quota: null } };
    const vm = buildModelDetailViewModel(detail);

    expect(vm.freeTier).toBeDefined();
    expect(vm.freeTier!.mode).toBe('only');
    expect(vm.freeTier!.total).toBeUndefined();
    expect(vm.freeTier!.remaining).toBeUndefined();
  });

  it('handles standard free tier without quota data', () => {
    const detail = { ...mockDetail, free_tier: { mode: 'standard' as const, quota: null } };
    const vm = buildModelDetailViewModel(detail);

    expect(vm.freeTier).toBeDefined();
    expect(vm.freeTier!.mode).toBe('standard');
    expect(vm.freeTier!.remaining).toBeUndefined();
  });

  it('handles model without features', () => {
    const detail = { ...mockDetail, features: [] };
    const vm = buildModelDetailViewModel(detail);
    expect(vm.features).toBe('—');
  });

  it('handles built_in_tools with per prefix in unit', () => {
    const detail: ModelDetail = {
      ...mockDetail,
      pricing: {
        tiers: [],
        built_in_tools: [
          { name: 'search', price: 5.00, unit: 'USD/per request', api: 'Chat API' },
        ],
      },
    };
    const vm = buildModelDetailViewModel(detail);
    // "per " prefix should be stripped from unit
    expect(vm.builtInTools[0].price).toBe('$5 / request');
  });

  it('includes category and snapshot in metadata when present', () => {
    const vm = buildModelDetailViewModel(mockDetail);
    expect(vm.metadata.category).toBe('Flagship');
    expect(vm.metadata.snapshot).toBe('v3.6.0');
  });

  it('omits category and snapshot when not present', () => {
    const detail: ModelDetail = {
      ...mockDetail,
      metadata: {
        version_tag: 'v1',
        open_source: true,
        updated: '2026-01-01',
      },
    };
    const vm = buildModelDetailViewModel(detail);
    expect(vm.metadata.category).toBeUndefined();
    expect(vm.metadata.snapshot).toBeUndefined();
  });
});

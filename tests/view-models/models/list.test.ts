import { describe, it, expect } from 'vitest';
import { buildModelListViewModel } from '../../../src/view-models/models/index.js';
import type { ModelsListResponse } from '../../../src/types/model.js';

describe('buildModelListViewModel', () => {
  const mockResponse: ModelsListResponse = {
    models: [
      {
        id: 'qwen3.6-plus',
        modality: { input: ['text', 'image', 'video'], output: ['text'] },
        can_try: true,
        free_tier: {
          mode: 'standard',
          quota: { remaining: 850000, total: 1000000, unit: 'tokens', used_pct: 15 },
        },
        pricing: {
          tiers: [
            { label: '≤ 256K tokens', input: 0.50, output: 3.00, cache_creation: 0.625, cache_read: 0.05, unit: 'USD/1M tokens' },
            { label: '256K – 1M tokens', input: 2.00, output: 6.00, cache_creation: 2.50, cache_read: 0.20, unit: 'USD/1M tokens' },
          ],
        },
      },
      {
        id: 'qwen3.5-omni-plus',
        modality: { input: ['text', 'image', 'video', 'audio'], output: ['text', 'audio'] },
        can_try: true,
        free_tier: { mode: 'only', quota: null },
      },
      {
        id: 'wan2.6-t2i',
        modality: { input: ['text'], output: ['image'] },
        can_try: true,
        free_tier: {
          mode: 'standard',
          quota: { remaining: 38, total: 50, unit: 'images', used_pct: 24 },
        },
        pricing: { per_image: { price: 0.03, unit: 'USD/image' } },
      },
    ],
    total: 3,
  };

  it('transforms models with split fields', () => {
    const vm = buildModelListViewModel(mockResponse);

    expect(vm.total).toBe(3);
    expect(vm.rows).toHaveLength(3);

    // First row: LLM with tiered pricing
    const r0 = vm.rows[0];
    expect(r0.id).toBe('qwen3.6-plus');
    expect(r0.modalityInput).toBe('Text+Img+Video');
    expect(r0.modalityOutput).toBe('Text');
    expect(r0.freeTierAmt).toBe('1M');
    expect(r0.freeTierUnit).toBe('tok');
    expect(r0.freeTierRemainingPct).toBe(85);
    expect(r0.canTry).toBe('Yes');
    // Price split: amount + unit
    expect(r0.price).toContain('$0.5');
    expect(r0.priceUnit).toBe('/1M tok');

    // Second row: "Only" mode
    const r1 = vm.rows[1];
    expect(r1.id).toBe('qwen3.5-omni-plus');
    expect(r1.modalityInput).toBe('Text+Img+Video+Audio');
    expect(r1.freeTierAmt).toBe('Only');
    expect(r1.freeTierUnit).toBe('');
    expect(r1.canTry).toBe('Yes');
    expect(r1.price).toBe('—');
    expect(r1.priceUnit).toBe('');

    // Third row: image generation
    const r2 = vm.rows[2];
    expect(r2.id).toBe('wan2.6-t2i');
    expect(r2.modalityInput).toBe('Text');
    expect(r2.modalityOutput).toBe('Img');
    expect(r2.freeTierAmt).toBe('50');
    expect(r2.freeTierUnit).toBe('img');
    expect(r2.canTry).toBe('Yes');
    expect(r2.price).toBe('$0.03');
    expect(r2.priceUnit).toBe('/img');
  });

  it('handles empty models list', () => {
    const vm = buildModelListViewModel({ models: [], total: 0 });
    expect(vm.rows).toEqual([]);
    expect(vm.total).toBe(0);
  });

  it('calculates freeTierRemainingPct correctly', () => {
    const vm = buildModelListViewModel({
      models: [{
        id: 'test',
        modality: { input: ['text'], output: ['text'] },
        can_try: true,
        free_tier: {
          mode: 'standard',
          quota: { remaining: 333000, total: 1000000, unit: 'tokens', used_pct: 66.7 },
        },
      }],
      total: 1,
    });
    expect(vm.rows[0].freeTierRemainingPct).toBe(33.3);
  });

  it('returns undefined freeTierRemainingPct when no quota', () => {
    const vm = buildModelListViewModel({
      models: [{
        id: 'test',
        modality: { input: ['text'], output: ['text'] },
        can_try: true,
        free_tier: { mode: 'only', quota: null },
      }],
      total: 1,
    });
    expect(vm.rows[0].freeTierRemainingPct).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { mapFqInstanceToQuota } from '../../../src/api/model-mapper/index.js';
import type { FqInstanceItem } from '../../../src/types/api-models.js';

describe('mapFqInstanceToQuota', () => {
  function makeFq(overrides: Partial<FqInstanceItem> = {}): FqInstanceItem {
    return {
      InstanceName: 'inst-1',
      Status: 'valid',
      Uid: 12345,
      InitCapacity: { BaseValue: 1_000_000, ShowUnit: 'Tokens', ShowValue: '1M' },
      CurrCapacity: { BaseValue: 850_000, ShowUnit: 'Tokens', ShowValue: '850K' },
      Template: { Code: 'qwen-plus', Name: 'qwen-plus' },
      StartTime: '2026-01-01T00:00:00Z',
      EndTime: '2026-12-31T23:59:59Z',
      CurrentCycleStartTime: '2026-04-01T00:00:00Z',
      CurrentCycleEndTime: '2026-05-01T00:00:00Z',
      ...overrides,
    };
  }

  it('computes used_pct correctly (rounded to 2dp)', () => {
    const q = mapFqInstanceToQuota(makeFq());
    expect(q.total).toBe(1_000_000);
    expect(q.remaining).toBe(850_000);
    expect(q.used_pct).toBe(15); // (1M - 850K) / 1M = 15.00%
    expect(q.unit).toBe('tokens');
    expect(q.status).toBe('valid');
  });

  it('handles 0 total → used_pct = 0 (no NaN/Infinity)', () => {
    const q = mapFqInstanceToQuota(
      makeFq({ InitCapacity: { BaseValue: 0, ShowUnit: 'Tokens', ShowValue: '0' } }),
    );
    expect(q.used_pct).toBe(0);
  });

  it('computes used_pct with floor truncation (no rounding up)', () => {
    // 995/1000 = 99.5% → floor(99.5 * 100)/100 would be wrong; it's floor((995/1000)*10000)/100
    // (1000-5)/1000 * 10000 = 9950 → floor(9950)/100 = 99.50
    const q = mapFqInstanceToQuota(
      makeFq({
        InitCapacity: { BaseValue: 1000, ShowUnit: 'Tokens', ShowValue: '1K' },
        CurrCapacity: { BaseValue: 5, ShowUnit: 'Tokens', ShowValue: '5' },
      }),
    );
    expect(q.used_pct).toBe(99.5);
  });

  it('computes used_pct for tiny usage (preserves 2dp precision)', () => {
    // (4 / 1_000_000) * 10000 = 0.04 → floor(0.04) = 0 → 0/100 = 0
    const q = mapFqInstanceToQuota(
      makeFq({
        InitCapacity: { BaseValue: 1_000_000, ShowUnit: 'Tokens', ShowValue: '1M' },
        CurrCapacity: { BaseValue: 999_996, ShowUnit: 'Tokens', ShowValue: '999996' },
      }),
    );
    expect(q.used_pct).toBe(0);
  });

  it('normalizes ShowUnit "Images" / "Pieces" → "images"', () => {
    expect(
      mapFqInstanceToQuota(
        makeFq({
          InitCapacity: { BaseValue: 50, ShowUnit: 'Images', ShowValue: '50' },
          CurrCapacity: { BaseValue: 50, ShowUnit: 'Images', ShowValue: '50' },
        }),
      ).unit,
    ).toBe('images');

    expect(
      mapFqInstanceToQuota(
        makeFq({
          InitCapacity: { BaseValue: 10, ShowUnit: 'Pieces', ShowValue: '10' },
          CurrCapacity: { BaseValue: 10, ShowUnit: 'Pieces', ShowValue: '10' },
        }),
      ).unit,
    ).toBe('images');
  });

  it('normalizes ShowUnit "Seconds" → "seconds", "Characters" → "characters"', () => {
    expect(
      mapFqInstanceToQuota(
        makeFq({
          InitCapacity: { BaseValue: 100, ShowUnit: 'Seconds', ShowValue: '100' },
          CurrCapacity: { BaseValue: 100, ShowUnit: 'Seconds', ShowValue: '100' },
        }),
      ).unit,
    ).toBe('seconds');
    expect(
      mapFqInstanceToQuota(
        makeFq({
          InitCapacity: { BaseValue: 100, ShowUnit: 'Characters', ShowValue: '100' },
          CurrCapacity: { BaseValue: 100, ShowUnit: 'Characters', ShowValue: '100' },
        }),
      ).unit,
    ).toBe('characters');
  });

  it('TTS-style "tenthousand word" ShowUnit → "characters"', () => {
    const q = mapFqInstanceToQuota(
      makeFq({
        InitCapacity: { BaseValue: 100, ShowUnit: 'tenthousand word', ShowValue: '100' },
        CurrCapacity: { BaseValue: 100, ShowUnit: 'tenthousand word', ShowValue: '100' },
      }),
    );
    expect(q.unit).toBe('characters');
  });

  it('falls back to keyword inference for unknown ShowUnit', () => {
    const q = mapFqInstanceToQuota(
      makeFq({
        InitCapacity: { BaseValue: 1, ShowUnit: 'mega-token-thingies', ShowValue: '1' },
        CurrCapacity: { BaseValue: 1, ShowUnit: 'mega-token-thingies', ShowValue: '1' },
      }),
    );
    // "token" keyword → tokens
    expect(q.unit).toBe('tokens');
  });

  it('parses CurrentCycleEndTime to ISO 8601 UTC', () => {
    const q = mapFqInstanceToQuota(
      makeFq({ CurrentCycleEndTime: '2026-05-01T00:00:00Z' }),
    );
    expect(q.resetDate).toBe('2026-05-01T00:00:00.000Z');
  });

  it('returns null resetDate when CurrentCycleEndTime is empty', () => {
    expect(mapFqInstanceToQuota(makeFq({ CurrentCycleEndTime: '' })).resetDate).toBeNull();
  });

  it('returns null resetDate when CurrentCycleEndTime is invalid', () => {
    expect(mapFqInstanceToQuota(makeFq({ CurrentCycleEndTime: 'not-a-date' })).resetDate).toBeNull();
  });

  it('preserves status field (expire / exhaust)', () => {
    expect(mapFqInstanceToQuota(makeFq({ Status: 'expire' })).status).toBe('expire');
    expect(mapFqInstanceToQuota(makeFq({ Status: 'exhaust' })).status).toBe('exhaust');
  });
});

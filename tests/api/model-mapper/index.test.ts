/**
 * Re-export integrity test for the model-mapper bucket file.
 *
 * iter-4 splits `src/api/model-mapper.ts` into a directory with multiple
 * slice files. The directory's `index.ts` MUST re-export the four named
 * functions that downstream services (`models-service`, `freetier-service`)
 * depend on, with the original signatures preserved.
 *
 * This file does NOT re-test behaviour — slice tests own that. The single
 * job here is structural: every public symbol promised by scope §1.B
 * remains reachable through the bucket import.
 */
import { describe, it, expect } from 'vitest';
import * as ModelMapper from '../../../src/api/model-mapper/index.js';

describe('model-mapper bucket re-export integrity', () => {
  it('re-exports mapApiModelToModel as a function', () => {
    expect(typeof ModelMapper.mapApiModelToModel).toBe('function');
  });

  it('re-exports mapApiModelToModelDetail as a function', () => {
    expect(typeof ModelMapper.mapApiModelToModelDetail).toBe('function');
  });

  it('re-exports flattenApiModels as a function', () => {
    expect(typeof ModelMapper.flattenApiModels).toBe('function');
  });

  it('re-exports mapFqInstanceToQuota as a function', () => {
    expect(typeof ModelMapper.mapFqInstanceToQuota).toBe('function');
  });

  it('exposes the full set of names required by scope §1.B', () => {
    const exposed = Object.keys(ModelMapper).sort();
    const required = [
      'flattenApiModels',
      'mapApiModelToModel',
      'mapApiModelToModelDetail',
      'mapFqInstanceToQuota',
    ];
    for (const name of required) {
      expect(exposed).toContain(name);
    }
  });
});

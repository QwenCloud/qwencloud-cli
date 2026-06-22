import { describe, it, expect } from 'vitest';
import { buildWorkspaceLimitViewModel } from '../../../src/view-models/workspace/limit.js';
import type { WorkspaceLimitResult } from '../../../src/types/workspace.js';

describe('buildWorkspaceLimitViewModel', () => {
  it('computes remaining and utilization correctly for normal values', () => {
    const result: WorkspaceLimitResult = { current: 3, max: 10 };
    const vm = buildWorkspaceLimitViewModel(result);
    expect(vm.current).toBe(3);
    expect(vm.max).toBe(10);
    expect(vm.remaining).toBe(7);
    expect(vm.utilizationPct).toBe(30);
  });

  it('returns 0% utilization when max is 0 (falsy division guard)', () => {
    const result: WorkspaceLimitResult = { current: 0, max: 0 };
    const vm = buildWorkspaceLimitViewModel(result);
    expect(vm.current).toBe(0);
    expect(vm.max).toBe(0);
    expect(vm.remaining).toBe(0);
    expect(vm.utilizationPct).toBe(0);
  });

  it('clamps negative values to 0', () => {
    const result: WorkspaceLimitResult = { current: -5, max: -2 };
    const vm = buildWorkspaceLimitViewModel(result);
    expect(vm.current).toBe(0);
    expect(vm.max).toBe(0);
    expect(vm.remaining).toBe(0);
    expect(vm.utilizationPct).toBe(0);
  });

  it('handles current exceeding max gracefully', () => {
    const result: WorkspaceLimitResult = { current: 12, max: 10 };
    const vm = buildWorkspaceLimitViewModel(result);
    expect(vm.current).toBe(12);
    expect(vm.max).toBe(10);
    expect(vm.remaining).toBe(0);
    expect(vm.utilizationPct).toBe(120);
  });

  it('rounds utilization percentage to nearest integer', () => {
    const result: WorkspaceLimitResult = { current: 1, max: 3 };
    const vm = buildWorkspaceLimitViewModel(result);
    expect(vm.utilizationPct).toBe(33);
  });
});

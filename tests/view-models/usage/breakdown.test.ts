/**
 * Unit tests for buildUsageBreakdownViewModel — focuses on the dynamic
 * billing-unit branches added alongside the voices/Per-X-Y support.
 *
 * Coverage targets (each guards against a real regression we hit during
 * the recent refactor):
 *   1. Non-tokens override (images/characters/voices) is trusted even when
 *      every row is empty — protects model-metadata-driven headers.
 *   2. Tokens override yields to a non-fixed inferred unit (e.g. "calls") so
 *      headers match real row data when the model registry falls through to
 *      'tokens'.
 *   3. Zero-value cells render as em-dash "—" uniformly across every unit
 *      (tokens / images / characters / seconds / voices / dynamic).
 *   4. Dynamic unit cells (e.g. "calls") render with capitalized header and
 *      route through the `default` switch arm in columns/cells/total.
 *   5. tokens_out auto-expansion only fires when a row actually carries it.
 */
import { describe, it, expect } from 'vitest';
import { buildUsageBreakdownViewModel } from '../../../src/view-models/usage/index.js';
import type { UsageBreakdownResponse, UsageBreakdownRow } from '../../../src/types/usage.js';

function makeResponse(
  overrides: Partial<UsageBreakdownResponse> & { rows: UsageBreakdownRow[] },
): UsageBreakdownResponse {
  return {
    model_id: 'test-model',
    period: { from: '2026-04-01', to: '2026-04-07' },
    granularity: 'day',
    total: { cost: 0, currency: 'USD' },
    ...overrides,
  };
}

describe('buildUsageBreakdownViewModel — pickBillingUnit override behaviour', () => {
  it('trusts a non-tokens override (images) even when all rows are zero', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        model_id: 'wan2.6-t2i',
        rows: [
          { period: '2026-04-01', usage: { images: 0 }, cost: 0 },
          { period: '2026-04-02', usage: { images: 0 }, cost: 0 },
        ],
        total: { usage: { images: 0 }, cost: 0 },
      }),
      { billingUnitOverride: 'images' },
    );
    expect(vm.columns.map((c) => c.header)).toEqual(['Date', 'Images', 'Cost']);
    // Zero usage renders as em-dash, not "0".
    expect(vm.items[0].cells.images).toBe('—');
    expect(vm.total.cells.images).toBe('—');
  });

  it('trusts a voices override (characters/seconds/voices are equally authoritative)', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [{ period: '2026-04-01', usage: { voices: 0 }, cost: 0 }],
        total: { usage: { voices: 0 }, cost: 0 },
      }),
      { billingUnitOverride: 'voices' },
    );
    expect(vm.columns.map((c) => c.header)).toEqual(['Date', 'Voice', 'Cost']);
    expect(vm.items[0].cells.voices).toBe('—');
  });

  it('lets tokens override yield to a dynamic inferred unit (e.g. "calls")', () => {
    // Scenario: inferBillingUnitFromModel falls through to 'tokens' for a
    // service whose API actually returns Per-1-call lines; the row carries a
    // numeric "calls" key, so the header must follow the data.
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [
          { period: '2026-04-01', usage: { calls: 2_000_200 } as Record<string, number>, cost: 0.5 },
        ],
        total: { usage: { calls: 2_000_200 } as Record<string, number>, cost: 0.5 },
      }),
      { billingUnitOverride: 'tokens' },
    );
    expect(vm.columns.map((c) => c.header)).toEqual(['Date', 'Calls', 'Cost']);
    expect(vm.items[0].cells.calls).toBe('2M');
    expect(vm.total.cells.calls).toBe('2M');
  });

  it('keeps the tokens override when inferred is also a fixed unit (tokens or voices)', () => {
    // Defensive: rows have tokens data; override='tokens' must win over a
    // hypothetical mis-inference. The fixed-unit guard in pickBillingUnit
    // protects against accidentally letting voices/images replace tokens.
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [{ period: '2026-04-01', tokens_in: 1234, cost: 0.01 }],
        total: { tokens_in: 1234, cost: 0.01 },
      }),
      { billingUnitOverride: 'tokens' },
    );
    expect(vm.columns.find((c) => c.key === 'tokens')?.header).toBe('Tokens');
    expect(vm.items[0].cells.tokens).toBe('1.2K');
  });
});

describe('buildUsageBreakdownViewModel — inference without override', () => {
  it('infers voices from row.usage.voices when no override is provided', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [{ period: '2026-04-01', usage: { voices: 12 }, cost: 0.24 }],
        total: { usage: { voices: 12 }, cost: 0.24 },
      }),
    );
    expect(vm.columns.map((c) => c.header)).toEqual(['Date', 'Voice', 'Cost']);
    expect(vm.items[0].cells.voices).toBe('12');
  });

  it('infers a dynamic unit from the first numeric key in usage', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [
          { period: '2026-04-01', usage: { request: 42 } as Record<string, number>, cost: 0.10 },
        ],
        total: { usage: { request: 42 } as Record<string, number>, cost: 0.10 },
      }),
    );
    expect(vm.columns.map((c) => c.header)).toEqual(['Date', 'Request', 'Cost']);
    expect(vm.items[0].cells.request).toBe('42');
  });

  it('defaults to tokens when no rows are present', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({ rows: [], total: { cost: 0 } }),
    );
    expect(vm.columns.map((c) => c.header)).toEqual(['Date', 'Tokens', 'Cost']);
    expect(vm.isEmpty).toBe(true);
    expect(vm.emptyHint).toMatch(/No usage/);
  });
});

describe('buildUsageBreakdownViewModel — zero-value em-dash rendering', () => {
  it('renders zero across every fixed unit as em-dash', () => {
    const cases: Array<{ unit: string; row: UsageBreakdownRow; cellKey: string }> = [
      { unit: 'tokens',     row: { period: 'p', tokens_in: 0, cost: 0 },               cellKey: 'tokens' },
      { unit: 'images',     row: { period: 'p', usage: { images: 0 }, cost: 0 },       cellKey: 'images' },
      { unit: 'characters', row: { period: 'p', usage: { characters: 0 }, cost: 0 },   cellKey: 'characters' },
      { unit: 'seconds',    row: { period: 'p', usage: { seconds: 0 }, cost: 0 },      cellKey: 'seconds' },
      { unit: 'voices',     row: { period: 'p', usage: { voices: 0 }, cost: 0 },       cellKey: 'voices' },
    ];
    for (const c of cases) {
      const vm = buildUsageBreakdownViewModel(
        makeResponse({ rows: [c.row], total: { cost: 0 } }),
        { billingUnitOverride: c.unit },
      );
      expect(vm.items[0].cells[c.cellKey]).toBe('—');
    }
  });

  it('renders zero for dynamic unit cells as em-dash too', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [
          { period: '2026-04-01', usage: { calls: 100 } as Record<string, number>, cost: 0.10 },
          { period: '2026-04-02', usage: { calls: 0 } as Record<string, number>,   cost: 0 },
        ],
        total: { usage: { calls: 100 } as Record<string, number>, cost: 0.10 },
      }),
    );
    expect(vm.items[0].cells.calls).toBe('100');
    expect(vm.items[1].cells.calls).toBe('—');
  });
});

describe('buildUsageBreakdownViewModel — tokens split expansion', () => {
  it('keeps single Tokens column when no row carries tokens_out', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [{ period: '2026-04-01', tokens_in: 5000, cost: 0.01 }],
        total: { tokens_in: 5000, cost: 0.01 },
      }),
    );
    expect(vm.columns.map((c) => c.header)).toEqual(['Date', 'Tokens', 'Cost']);
  });

  it('expands to Tokens (in)/(out) only when tokens_out > 0 appears', () => {
    const vm = buildUsageBreakdownViewModel(
      makeResponse({
        rows: [{ period: '2026-04-01', tokens_in: 5000, tokens_out: 1200, cost: 0.02 }],
        total: { tokens_in: 5000, tokens_out: 1200, cost: 0.02 },
      }),
    );
    expect(vm.columns.map((c) => c.header)).toEqual([
      'Date',
      'Tokens (in)',
      'Tokens (out)',
      'Cost',
    ]);
    expect(vm.items[0].cells.tokensIn).toBe('5K');
    expect(vm.items[0].cells.tokensOut).toBe('1.2K');
  });
});

/**
 * Pure function tests for BillingAdapter (src/api/adapters/billing-adapter.ts).
 *
 * BillingAdapter transforms raw flat-parameter API responses into Service-layer
 * DTOs. These tests validate:
 *   - Field renaming and flattening
 *   - Amount/unit standardization
 *   - Date formatting
 *   - Tolerance for missing/null fields
 *   - Boundary values (zero, negative, max safe integer)
 *
 * No HTTP mocking is needed — BillingAdapter is a pure transformation layer.
 */
import { describe, it, expect } from 'vitest';
import type {
  ConsumeSummaryLineItem,
  ConsumeSummaryResponse,
  FqInstanceItem,
  FqInstanceResponse,
  FrInstanceItem,
  FrInstanceResponse,
} from '../../../src/types/api-models.js';

// ────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────

function makeConsumeSummaryResponse(
  items: Partial<ConsumeSummaryLineItem>[],
): ConsumeSummaryResponse {
  return {
    Data: items.map((item) => ({
      LineItemCategory: 'LLM Token Consumption',
      BillingItemCode: 'token_number',
      BillingDate: '2026-05-01',
      BillingMonth: '2026-05',
      ModelName: 'qwen-plus',
      BillQuantity: 10,
      StepQuantityUnit: 'Per 1K tokens',
      RequireAmount: 2.5,
      ...item,
    })),
    TotalCount: items.length,
    RequestId: 'req-billing-test',
  };
}

function makeFqInstance(overrides: Partial<FqInstanceItem> = {}): FqInstanceItem {
  return {
    InstanceName: 'free-tier-qwen-plus',
    Status: 'Normal',
    Uid: 12345,
    InitCapacity: { BaseValue: 1000000, ShowUnit: '1M tokens', ShowValue: '1000000' },
    CurrCapacity: { BaseValue: 750000, ShowUnit: '1M tokens', ShowValue: '750000' },
    Template: { Code: 'qwen-plus-free', Name: 'Qwen Plus Free Tier' },
    StartTime: '2026-01-01T00:00:00Z',
    EndTime: '2026-12-31T23:59:59Z',
    CurrentCycleStartTime: '2026-05-01T00:00:00Z',
    CurrentCycleEndTime: '2026-05-31T23:59:59Z',
    ...overrides,
  };
}

function makeFrInstance(overrides: Partial<FrInstanceItem> = {}): FrInstanceItem {
  return {
    InstanceId: 'fr-inst-001',
    CommodityCode: 'token_plan_monthly',
    CommodityName: 'Token Plan Team (Monthly)',
    TemplateName: 'token-plan-team',
    Status: { Code: 'VALID', Name: 'Active' },
    InitCapacityBaseValue: '5000000',
    CurrCapacityBaseValue: '3200000',
    EndTime: 1735689599000, // 2024-12-31
    EnableRenew: true,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// Consume summary → DTO transformation
// ────────────────────────────────────────────────────────────────────

describe('BillingAdapter — consume summary transformation', () => {
  it('maps standard token consumption fields correctly', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { ModelName: 'qwen-plus', BillQuantity: 5, StepQuantityUnit: 'Per 1K tokens', RequireAmount: 1.23 },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.modelId).toBe('qwen-plus');
    expect(result[0]?.cost).toBe(1.23);
  });

  it('computes usage value from bill quantity and step unit', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { BillQuantity: 3, StepQuantityUnit: 'Per 1M tokens' },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result[0]?.usageValue).toBe(3_000_000);
  });

  it('identifies billing unit from BillingItemCode keyword', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { BillingItemCode: 'image_number', StepQuantityUnit: 'Per 1 image' },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result[0]?.billingUnit).toBe('images');
  });

  it('filters out Rounding Adjustment and Refund categories', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { LineItemCategory: 'Rounding Adjustment' },
      { LineItemCategory: 'Refund' },
      { LineItemCategory: 'LLM Token Consumption' },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.lineItemCat).toBe('LLM Token Consumption');
  });

  it('marks Free Tier items with isFree=true', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { LineItemCategory: 'Free Tier Image Generation', BillingItemCode: 'image_number' },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result[0]?.isFree).toBe(true);
  });

  it('handles empty Data array gracefully', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: ConsumeSummaryResponse = { Data: [], TotalCount: 0 };
    const result = transformConsumeSummary(raw);
    expect(result).toEqual([]);
  });

  it('handles missing optional fields without throwing', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      {
        ModelName: undefined,
        BillingDate: undefined,
        BillQuantity: undefined,
        RequireAmount: undefined,
      },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result).toHaveLength(1);
    // Should use safe fallback values
    expect(typeof result[0]?.modelId).toBe('string');
    expect(typeof result[0]?.cost).toBe('number');
  });
});

// ────────────────────────────────────────────────────────────────────
// FreeTier instance (FqInstance) → DTO transformation
// ────────────────────────────────────────────────────────────────────

describe('BillingAdapter — FreeTier instance transformation', () => {
  it('maps capacity fields to remaining/total/usedPct', async () => {
    const { transformFqInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FqInstanceResponse = {
      TotalCount: 1,
      PageSize: 10,
      RequestId: 'req-fq',
      CurrentPage: 1,
      Data: [makeFqInstance()],
    };
    const result = transformFqInstances(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.total).toBe(1000000);
    expect(result[0]?.remaining).toBe(750000);
  });

  it('handles zero capacity without division errors', async () => {
    const { transformFqInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FqInstanceResponse = {
      TotalCount: 1,
      PageSize: 10,
      RequestId: 'req-fq',
      CurrentPage: 1,
      Data: [makeFqInstance({
        InitCapacity: { BaseValue: 0, ShowUnit: '1M tokens', ShowValue: '0' },
        CurrCapacity: { BaseValue: 0, ShowUnit: '1M tokens', ShowValue: '0' },
      })],
    };
    const result = transformFqInstances(raw);
    expect(result[0]?.usedPct).toBe(0);
  });

  it('handles empty Data array', async () => {
    const { transformFqInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FqInstanceResponse = {
      TotalCount: 0, PageSize: 10, RequestId: 'r', CurrentPage: 1, Data: [],
    };
    expect(transformFqInstances(raw)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// Token Plan (FrInstance) → DTO transformation
// ────────────────────────────────────────────────────────────────────

describe('BillingAdapter — Token Plan instance transformation', () => {
  it('maps FrInstance fields to TokenPlan DTO', async () => {
    const { transformFrInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FrInstanceResponse = {
      TotalCount: 1,
      Data: [makeFrInstance()],
    };
    const result = transformFrInstances(raw);
    expect(result.subscribed).toBe(true);
    expect(result.totalCredits).toBe(5000000);
    expect(result.remainingCredits).toBe(3200000);
  });

  it('computes usedPct correctly', async () => {
    const { transformFrInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FrInstanceResponse = {
      TotalCount: 1,
      Data: [makeFrInstance({ InitCapacityBaseValue: '1000', CurrCapacityBaseValue: '250' })],
    };
    const result = transformFrInstances(raw);
    expect(result.usedPct).toBe(75);
  });

  it('returns subscribed=false when Data is empty', async () => {
    const { transformFrInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FrInstanceResponse = { TotalCount: 0, Data: [] };
    const result = transformFrInstances(raw);
    expect(result.subscribed).toBe(false);
  });

  it('extracts planName from CommodityName', async () => {
    const { transformFrInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FrInstanceResponse = {
      TotalCount: 1,
      Data: [makeFrInstance({ CommodityName: 'Token Plan Enterprise' })],
    };
    const result = transformFrInstances(raw);
    expect(result.planName).toBe('Token Plan Enterprise');
  });

  it('handles string Status field (legacy format)', async () => {
    const { transformFrInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FrInstanceResponse = {
      TotalCount: 1,
      Data: [makeFrInstance({ Status: 'VALID' })],
    };
    const result = transformFrInstances(raw);
    expect(result.status).toBe('valid');
  });

  it('handles zero InitCapacity without NaN in usedPct', async () => {
    const { transformFrInstances } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw: FrInstanceResponse = {
      TotalCount: 1,
      Data: [makeFrInstance({ InitCapacityBaseValue: '0', CurrCapacityBaseValue: '0' })],
    };
    const result = transformFrInstances(raw);
    expect(Number.isNaN(result.usedPct)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Boundary values and edge cases
// ────────────────────────────────────────────────────────────────────

describe('BillingAdapter — boundary values', () => {
  it('handles very large bill quantities (Number.MAX_SAFE_INTEGER range)', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { BillQuantity: 9_000_000, StepQuantityUnit: 'Per 1M tokens' },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result[0]?.usageValue).toBe(9_000_000_000_000);
  });

  it('handles negative RequireAmount (credits/refunds pass-through)', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { RequireAmount: -0.5, LineItemCategory: 'LLM Token Consumption' },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result[0]?.cost).toBe(-0.5);
  });

  it('handles fractional BillQuantity with precision', async () => {
    const { transformConsumeSummary } = await import(
      '../../../src/api/adapters/billing-adapter.js'
    );
    const raw = makeConsumeSummaryResponse([
      { BillQuantity: 0.001, StepQuantityUnit: 'Per 1K tokens' },
    ]);
    const result = transformConsumeSummary(raw);
    expect(result[0]?.usageValue).toBe(1);
  });
});

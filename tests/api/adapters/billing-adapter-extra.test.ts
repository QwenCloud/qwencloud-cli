/**
 * Pure function tests for the billing adapter extensions.
 *
 * Validates the transforms for the billing command group:
 *   - transformUsageLimit
 *   - transformConsumeBreakdown
 *   - transformSettleBillSummary
 *
 * Each transform is a pure function: raw flat-protocol response → DTO.
 * Tests focus on field renaming, missing-field tolerance, and amount string
 * pass-through (no premature coercion to number).
 */
import { describe, it, expect } from 'vitest';
import {
  transformUsageLimit,
  transformConsumeBreakdown,
  transformSettleBillSummary,
} from '../../../src/api/adapters/billing-adapter.js';
import type {
  DescribeUsageLimitResponse,
  MaasDescribeCostAnalysisResponse,
  ListSettleBillTotalSummaryResponse,
} from '../../../src/types/api-models.js';

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

function makeUsageLimitResponse(
  overrides: Partial<DescribeUsageLimitResponse> = {},
): DescribeUsageLimitResponse {
  return {
    Status: 'normal',
    LimitAmount: '1000.00',
    Currency: 'USD',
    AlertThreshold: '80',
    Receivers: ['ops@team.test.qwencloud.com'],
    RequestId: 'req-limit-001',
    ...overrides,
  } as DescribeUsageLimitResponse;
}

function makeConsumeBreakdownResponse(
  overrides: Partial<MaasDescribeCostAnalysisResponse> = {},
): MaasDescribeCostAnalysisResponse {
  return {
    GroupByTotal: [
      { Key: 'qwen-plus', Name: 'qwen-plus', Amount: '12.345' },
      { Key: 'qwen-max', Name: 'qwen-max', Amount: '4.567' },
    ],
    CostTotals: { Amount: '16.912', Currency: 'USD' },
    RequestId: 'req-bd-001',
    ...overrides,
  } as MaasDescribeCostAnalysisResponse;
}

function makeSettleBillSummaryResponse(
  overrides: Partial<ListSettleBillTotalSummaryResponse> = {},
): ListSettleBillTotalSummaryResponse {
  return {
    Data: [
      {
        BillingCycle: '2026-04',
        PretaxAmount: '100.50',
        Tax: '10.05',
        AftertaxAmount: '110.55',
      },
    ],
    Currency: 'USD',
    RequestId: 'req-bs-001',
    ...overrides,
  } as ListSettleBillTotalSummaryResponse;
}

// ────────────────────────────────────────────────────────────────────
// transformUsageLimit
// ────────────────────────────────────────────────────────────────────

describe('transformUsageLimit', () => {
  it('maps the standard response into a DTO with all fields', () => {
    const dto = transformUsageLimit(makeUsageLimitResponse());
    expect(dto.status).toBe('normal');
    expect(dto.limitAmount).toBe('1000.00');
    expect(dto.currency).toBe('USD');
    expect(dto.alertThreshold).toBe('80');
  });

  it('handles a missing Receivers field gracefully', () => {
    const dto = transformUsageLimit(makeUsageLimitResponse({ Receivers: undefined }));
    expect(dto.status).toBe('normal');
  });

  it('treats a 0 alert threshold as a valid value (not falsy fallback)', () => {
    const dto = transformUsageLimit(makeUsageLimitResponse({ AlertThreshold: '0' }));
    expect(dto.alertThreshold).toBe('0');
  });

  it('falls back to null for missing limit amount instead of NaN', () => {
    const dto = transformUsageLimit(makeUsageLimitResponse({ LimitAmount: undefined }));
    expect(dto.limitAmount).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// transformConsumeBreakdown
// ────────────────────────────────────────────────────────────────────

describe('transformConsumeBreakdown', () => {
  it('flattens the grouped response into rows with pass-through amount strings', () => {
    const dto = transformConsumeBreakdown(makeConsumeBreakdownResponse());
    expect(dto.rows).toHaveLength(2);
    expect(dto.rows[0]).toEqual({
      groupKey: 'qwen-plus',
      groupLabel: 'qwen-plus',
      amount: '12.345',
    });
    expect(dto.rows[1].amount).toBe('4.567');
  });

  it('returns an empty rows array when GroupByTotal is missing', () => {
    const dto = transformConsumeBreakdown(makeConsumeBreakdownResponse({ GroupByTotal: undefined }));
    expect(dto.rows).toEqual([]);
  });

  it('falls back groupLabel to groupKey when Name is missing', () => {
    const dto = transformConsumeBreakdown(
      makeConsumeBreakdownResponse({
        GroupByTotal: [{ Key: 'ws-9999', Amount: '1.00' }],
      }),
    );
    expect(dto.rows[0].groupLabel).toBe('ws-9999');
  });

  it('preserves zero-amount rows (do not silently drop)', () => {
    const dto = transformConsumeBreakdown(
      makeConsumeBreakdownResponse({
        GroupByTotal: [{ Key: 'free', Name: 'Free Tier', Amount: '0' }],
      }),
    );
    expect(dto.rows).toHaveLength(1);
    expect(dto.rows[0].amount).toBe('0');
  });
});

// ────────────────────────────────────────────────────────────────────
// transformSettleBillSummary
// ────────────────────────────────────────────────────────────────────

describe('transformSettleBillSummary', () => {
  it('maps the three amount fields to DTO strings (no float coercion)', () => {
    const dto = transformSettleBillSummary(makeSettleBillSummaryResponse());
    expect(dto.cycles).toHaveLength(1);
    const cycle = dto.cycles[0];
    expect(cycle.billingCycle).toBe('2026-04');
    expect(cycle.pretaxAmount).toBe('100.50');
    expect(cycle.tax).toBe('10.05');
    expect(cycle.aftertaxAmount).toBe('110.55');
  });

  it('maps actual API fields (TotalPriceSettleFee/TotalPriceTaxFee/TotalPricePostTaxFee)', () => {
    const dto = transformSettleBillSummary({
      Data: [
        {
          BillingCycle: '202605',
          TotalPriceSettleFee: '2960.110000',
          TotalPriceTaxFee: '266.370000',
          TotalPricePostTaxFee: '3226.480000',
          Currency: 'USD',
        },
      ],
    });
    expect(dto.cycles).toHaveLength(1);
    const cycle = dto.cycles[0];
    expect(cycle.billingCycle).toBe('202605');
    expect(cycle.pretaxAmount).toBe('2960.110000');
    expect(cycle.tax).toBe('266.370000');
    expect(cycle.aftertaxAmount).toBe('3226.480000');
  });

  it('prefers actual API fields over legacy fields when both present', () => {
    const dto = transformSettleBillSummary({
      Data: [
        {
          BillingCycle: '202605',
          TotalPriceSettleFee: '100.00',
          TotalPriceTaxFee: '10.00',
          TotalPricePostTaxFee: '110.00',
          PretaxAmount: '999.00',
          Tax: '999.00',
          AftertaxAmount: '999.00',
        },
      ],
    });
    const cycle = dto.cycles[0];
    expect(cycle.pretaxAmount).toBe('100.00');
    expect(cycle.tax).toBe('10.00');
    expect(cycle.aftertaxAmount).toBe('110.00');
  });

  it('reads currency from Data item when response root Currency is absent', () => {
    const dto = transformSettleBillSummary({
      Data: [
        {
          BillingCycle: '202605',
          TotalPriceSettleFee: '100.00',
          Currency: 'USD',
        },
      ],
    });
    expect(dto.currency).toBe('USD');
  });

  it('falls back missing amount fields to "0" instead of undefined', () => {
    const dto = transformSettleBillSummary(
      makeSettleBillSummaryResponse({
        Data: [{ BillingCycle: '2026-05' }],
      }),
    );
    const cycle = dto.cycles[0];
    expect(cycle.pretaxAmount).toBe('0');
    expect(cycle.tax).toBe('0');
    expect(cycle.aftertaxAmount).toBe('0');
  });

  it('handles multiple billing cycles in order', () => {
    const dto = transformSettleBillSummary(
      makeSettleBillSummaryResponse({
        Data: [
          {
            BillingCycle: '2026-04',
            PretaxAmount: '10',
            Tax: '1',
            AftertaxAmount: '11',
          },
          {
            BillingCycle: '2026-05',
            PretaxAmount: '20',
            Tax: '2',
            AftertaxAmount: '22',
          },
        ],
      }),
    );
    expect(dto.cycles.map((c) => c.billingCycle)).toEqual(['2026-04', '2026-05']);
  });

  it('reads currency from the response root', () => {
    const dto = transformSettleBillSummary(makeSettleBillSummaryResponse({ Currency: 'CNY' }));
    expect(dto.currency).toBe('CNY');
  });
});

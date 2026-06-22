/**
 * Pure function tests for the subscription adapter.
 *
 * Validates the seven transforms that bridge raw flat-protocol responses to
 * Service-layer DTOs for the subscription command group.
 */
import { describe, it, expect } from 'vitest';
import {
  transformSubscriptionGray,
  transformSeatSubscriptionSummary,
  transformSubscriptionDetail,
  transformAutoRenewal,
  transformInstancesRenewable,
  transformOrderList,
  transformOrderDetail,
} from '../../../src/api/adapters/subscription-adapter.js';
import type {
  QuerySubscriptionGrayResponse,
  GetSeatSubscriptionSummaryResponse,
  GetSubscriptionDetailResponse,
  CheckTokenPlanAutoRenewalResponse,
  CheckInstancesRenewableResponse,
  QueryOrderListResponse,
  QueryOrderDetailResponse,
} from '../../../src/types/api-models.js';

// ────────────────────────────────────────────────────────────────────
// transformSubscriptionGray
// ────────────────────────────────────────────────────────────────────

describe('transformSubscriptionGray', () => {
  it('maps IsGray=true to a positive flag', () => {
    const dto = transformSubscriptionGray({ IsGray: true } as QuerySubscriptionGrayResponse);
    expect(dto.isGray).toBe(true);
  });

  it('maps IsGray=false to a negative flag', () => {
    const dto = transformSubscriptionGray({ IsGray: false } as QuerySubscriptionGrayResponse);
    expect(dto.isGray).toBe(false);
  });

  it('falls back to null when the field is missing', () => {
    const dto = transformSubscriptionGray({} as QuerySubscriptionGrayResponse);
    expect(dto.isGray).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// transformSeatSubscriptionSummary
// ────────────────────────────────────────────────────────────────────

describe('transformSeatSubscriptionSummary', () => {
  it('maps a complete plan/period payload', () => {
    const raw = {
      PlanName: 'Token Plan Team (Monthly)',
      PlanCode: 'token_plan_team_monthly',
      PeriodStart: '2026-04-01T00:00:00Z',
      PeriodEnd: '2026-04-30T23:59:59Z',
      Seats: 10,
    } as GetSeatSubscriptionSummaryResponse;
    const dto = transformSeatSubscriptionSummary(raw);
    expect(dto.plan).toBe('Token Plan Team (Monthly)');
    expect(dto.planCode).toBe('token_plan_team_monthly');
    expect(dto.period?.start).toBe('2026-04-01T00:00:00Z');
    expect(dto.period?.end).toBe('2026-04-30T23:59:59Z');
    expect(dto.seats).toBe(10);
  });

  it('returns null period when start or end is missing', () => {
    const dto = transformSeatSubscriptionSummary({
      PlanName: 'Token Plan Personal',
    } as GetSeatSubscriptionSummaryResponse);
    expect(dto.period).toBeNull();
  });

  it('returns null plan when PlanName is missing', () => {
    const dto = transformSeatSubscriptionSummary({} as GetSeatSubscriptionSummaryResponse);
    expect(dto.plan).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// transformSubscriptionDetail
// ────────────────────────────────────────────────────────────────────

describe('transformSubscriptionDetail', () => {
  it('returns the first valid instance from a multi-instance payload', () => {
    const raw = {
      Data: [
        { InstanceId: 'inst-01', Status: 'VALID', PlanName: 'Plan A' },
        { InstanceId: 'inst-02', Status: 'EXPIRED', PlanName: 'Plan B' },
      ],
    } as unknown as GetSubscriptionDetailResponse;
    const dto = transformSubscriptionDetail(raw);
    expect(dto.instances).toHaveLength(2);
    expect(dto.activeInstance?.instanceId).toBe('inst-01');
  });

  it('returns null active instance when no instance is VALID', () => {
    const raw = {
      Data: [{ InstanceId: 'inst-01', Status: 'EXPIRED', PlanName: 'Plan A' }],
    } as unknown as GetSubscriptionDetailResponse;
    const dto = transformSubscriptionDetail(raw);
    expect(dto.activeInstance).toBeNull();
  });

  it('handles empty instance list gracefully', () => {
    const dto = transformSubscriptionDetail({
      Data: [],
    } as unknown as GetSubscriptionDetailResponse);
    expect(dto.instances).toEqual([]);
    expect(dto.activeInstance).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// transformAutoRenewal
// ────────────────────────────────────────────────────────────────────

describe('transformAutoRenewal', () => {
  it('maps EnableRenew=true', () => {
    const dto = transformAutoRenewal({
      EnableRenew: true,
    } as CheckTokenPlanAutoRenewalResponse);
    expect(dto.autoRenew).toBe(true);
  });

  it('maps EnableRenew=false', () => {
    const dto = transformAutoRenewal({
      EnableRenew: false,
    } as CheckTokenPlanAutoRenewalResponse);
    expect(dto.autoRenew).toBe(false);
  });

  it('falls back to null when missing', () => {
    const dto = transformAutoRenewal({} as CheckTokenPlanAutoRenewalResponse);
    expect(dto.autoRenew).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// transformInstancesRenewable
// ────────────────────────────────────────────────────────────────────

describe('transformInstancesRenewable', () => {
  it('maps Renewable=true', () => {
    const dto = transformInstancesRenewable({
      Renewable: true,
    } as CheckInstancesRenewableResponse);
    expect(dto.renewable).toBe(true);
  });

  it('maps Renewable=false', () => {
    const dto = transformInstancesRenewable({
      Renewable: false,
    } as CheckInstancesRenewableResponse);
    expect(dto.renewable).toBe(false);
  });

  it('falls back to null when missing', () => {
    const dto = transformInstancesRenewable({} as CheckInstancesRenewableResponse);
    expect(dto.renewable).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// transformOrderList
// ────────────────────────────────────────────────────────────────────

describe('transformOrderList', () => {
  it('maps the list payload preserving order metadata', () => {
    const raw = {
      Data: [
        {
          OrderId: 'ord-001',
          OrderType: 'purchase',
          OrderTime: '2026-04-15T10:00:00Z',
          Amount: '199.00',
          Status: 'paid',
        },
      ],
      TotalCount: 1,
      PageSize: 20,
      CurrentPage: 1,
    } as unknown as QueryOrderListResponse;
    const dto = transformOrderList(raw);
    expect(dto.orders).toHaveLength(1);
    expect(dto.orders[0]).toEqual({
      orderId: 'ord-001',
      orderType: 'purchase',
      orderTime: '2026-04-15T10:00:00Z',
      amount: '199.00',
      status: 'paid',
    });
    expect(dto.pagination).toEqual({ totalCount: 1, pageSize: 20, currentPage: 1 });
  });

  it('returns empty orders when Data is missing', () => {
    const dto = transformOrderList({} as unknown as QueryOrderListResponse);
    expect(dto.orders).toEqual([]);
  });

  it('passes amount strings through unchanged (no float coercion)', () => {
    const dto = transformOrderList({
      Data: [
        {
          OrderId: 'ord-002',
          OrderType: 'renew',
          OrderTime: '2026-04-15T10:00:00Z',
          Amount: '0.000000000001',
          Status: 'paid',
        },
      ],
    } as unknown as QueryOrderListResponse);
    expect(dto.orders[0].amount).toBe('0.000000000001');
  });

  it('reads real amount fields (PayAmount preferred) and settlement currency', () => {
    const dto = transformOrderList({
      Data: [
        {
          OrderId: 'o-real',
          OrderType: 'BUY',
          GmtCreate: '2026-06-08T06:17:29Z',
          OriginalAmount: '99.00',
          PayAmount: '79.20',
          TradeAmount: '79.20',
          CashAmount: '79.20',
          SettCurrency: 'CNY',
          OrderStatus: 'PAID',
        },
      ],
    });
    expect(dto.orders[0].amount).toBe('79.20');
    expect(dto.orders[0].currency).toBe('CNY');
  });

  it('falls back to OriginalAmount when pay/trade/cash amounts are absent', () => {
    const dto = transformOrderList({
      Data: [{ OrderId: 'o-x', GmtCreate: '2026-06-01', OriginalAmount: '54.00' }],
    });
    expect(dto.orders[0].amount).toBe('54.00');
  });
});

// ────────────────────────────────────────────────────────────────────
// transformOrderDetail
// ────────────────────────────────────────────────────────────────────

describe('transformOrderDetail', () => {
  it('maps the complete detail payload', () => {
    const raw = {
      OrderId: 'ord-001',
      OrderType: 'purchase',
      OrderTime: '2026-04-15T10:00:00Z',
      Amount: '199.00',
      Status: 'paid',
      Items: [{ Name: 'Token Plan Team', Quantity: 1, Amount: '199.00' }],
      InvoiceUrl: 'https://billing.test.qwencloud.com/invoice/ord-001',
    } as unknown as QueryOrderDetailResponse;
    const dto = transformOrderDetail(raw);
    expect(dto.orderId).toBe('ord-001');
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0].name).toBe('Token Plan Team');
    expect(dto.invoiceUrl).toBe('https://billing.test.qwencloud.com/invoice/ord-001');
  });

  it('returns empty items list when missing', () => {
    const dto = transformOrderDetail({
      OrderId: 'ord-002',
    } as unknown as QueryOrderDetailResponse);
    expect(dto.items).toEqual([]);
  });

  it('falls back invoice url to null when missing', () => {
    const dto = transformOrderDetail({
      OrderId: 'ord-003',
    } as unknown as QueryOrderDetailResponse);
    expect(dto.invoiceUrl).toBeNull();
  });
});

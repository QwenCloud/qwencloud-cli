/** Unit tests for SubscriptionTokenPlanService. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';

// Type stubs

interface SeatGroup {
  specType: string;
  seats: number;
  assigned: number;
  totalValue: string;
  surplusValue: string;
  unit: string;
  nextCycleFlushTime: string;
}

interface SeatTotal {
  seats: number;
  totalValue: string;
  surplusValue: string;
  unit: string;
}

interface SeatSummary {
  groups: SeatGroup[];
  total: SeatTotal;
}

interface TokenPlanPeriod {
  start: string;
  end: string;
  remainingDays: number;
}

interface AutoRenew {
  enabled: boolean;
  period: number;
  periodUnit: string;
}

interface Renewable {
  canRenew: boolean;
  interceptCode: string;
}

interface TokenPlanDiagnostic {
  api: string;
  errorCode: string;
  errorMessage: string;
}

interface TokenPlanStatusResult {
  product: string | null;
  period: TokenPlanPeriod | null;
  autoRenew: AutoRenew | null;
  renewable: Renewable | null;
  seatSummary: SeatSummary | null;
  diagnostics: TokenPlanDiagnostic[];
}

// Mock infrastructure

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn() };
}

/** Per-action success payload factory. */
function defaultSuccess(action: string): Record<string, unknown> {
  switch (action) {
    case 'DescribeFrInstances':
      return {
        TotalCount: 1,
        Data: [
          {
            InstanceId: 'subs-test-instance-001',
            CommodityCode: 'sfm_tokenplanteams_dp_intl',
            Status: { Code: 'valid' },
          },
        ],
      };
    case 'GetSeatSubscriptionSummary':
      return {
        Data: {
          PlanName: 'Token Plan Team Edition',
          StartTime: '2026-06-14T00:00:00+08:00',
          EndTime: '2026-07-14T00:00:00+08:00',
          RemainingDays: 41,
          SubscriptionGroupList: [
            {
              SpecType: 'standard',
              SubscriptionTotalNumber: 7,
              SubscriptionAssignedNumber: 7,
              EquityList: [{ EquityCode: 'credit_value', TotalValue: '175000', SurplusValue: '174999.75' }],
              NextCycleFlushTime: '2026-06-14T00:00:00+08:00',
            },
            {
              SpecType: 'pro',
              SubscriptionTotalNumber: 4,
              SubscriptionAssignedNumber: 4,
              EquityList: [{ EquityCode: 'credit_value', TotalValue: '400000', SurplusValue: '391284.56' }],
              NextCycleFlushTime: '2026-06-14T00:00:00+08:00',
            },
          ],
        },
      };
    case 'GetSubscriptionSummary':
      return {
        Data: {
          TotalValue: '575000',
          TotalSurplusValue: '566284.3192002',
          TotalCount: 11,
          NearestExpireDate: '2026-07-14T00:00:00+08:00',
        },
      };
    case 'CheckTokenPlanAutoRenewal':
      return {
        Data: {
          AutoRenewal: 1,
          RenewalPeriod: 1,
          RenewalPeriodUnit: 'M',
        },
      };
    case 'CheckInstancesRenewable':
      return {
        Data: [
          {
            InstanceId: 'subs-test-instance-001',
            CanRenew: false,
            InterceptCode: 'PENDING_RENEWAL',
          },
        ],
      };
    default:
      return {};
  }
}

/** Build a callFlatApi mock that resolves/rejects per Action selectively. */
function buildSelectiveMock(
  failures: Partial<Record<string, Error>> = {},
  hangs: Set<string> = new Set(),
): ReturnType<typeof vi.fn> {
  return vi.fn(async (opts: { action: string }) => {
    const fail = failures[opts.action];
    if (fail) throw fail;
    if (hangs.has(opts.action)) {
      return new Promise(() => {});
    }
    return defaultSuccess(opts.action);
  });
}

// Test suite

describe('SubscriptionTokenPlanService.getTokenPlanStatus — 4-API orchestration', () => {
  let apiClient: MockApiClient;
  let service: { getTokenPlanStatus: () => Promise<TokenPlanStatusResult> };

  beforeEach(async () => {
    apiClient = makeMockApiClient();
    apiClient.callFlatApi = buildSelectiveMock();
    // Dynamic import to let vi.mock take effect
    const mod = await import('../../src/services/subscription-tokenplan-service.js');
    const ServiceClass = mod.SubscriptionTokenPlanService;
    service = new ServiceClass(
      apiClient as unknown as ApiClient,
    );
  });

  // ──────── Happy Path ────────

  it('returns full data with empty diagnostics when all 4 APIs succeed', async () => {
    const result = await service.getTokenPlanStatus();
    expect(result.diagnostics).toEqual([]);
    expect(result.product).toBe('Token Plan Team Edition');
    expect(result.period).not.toBeNull();
    expect(result.period!.remainingDays).toBe(41);
    expect(result.autoRenew).not.toBeNull();
    expect(result.autoRenew!.enabled).toBe(true);
    expect(result.renewable).not.toBeNull();
    expect(result.seatSummary).not.toBeNull();
  });

  it('seatSummary.groups contains both standard and pro with correct fields', async () => {
    const result = await service.getTokenPlanStatus();
    const groups = result.seatSummary!.groups;
    expect(groups).toHaveLength(2);
    const std = groups.find((g) => g.specType === 'standard')!;
    expect(std.seats).toBe(7);
    expect(std.assigned).toBe(7);
    expect(std.totalValue).toBe('175000');
    expect(std.surplusValue).toBe('174999.75');
    expect(std.unit).toBe('Credits');
    expect(std.nextCycleFlushTime).toBe('2026-06-14T00:00:00+08:00');
    const pro = groups.find((g) => g.specType === 'pro')!;
    expect(pro.seats).toBe(4);
    expect(pro.totalValue).toBe('400000');
  });

  it('seatSummary.total comes from GetSubscriptionSummary (independent API)', async () => {
    const result = await service.getTokenPlanStatus();
    const total = result.seatSummary!.total;
    expect(total.seats).toBe(11);
    expect(total.totalValue).toBe('575000');
    expect(total.surplusValue).toBe('566284.3192002');
    expect(total.unit).toBe('Credits');
  });

  it('autoRenew.enabled converts AutoRenewal 1 → true', async () => {
    const result = await service.getTokenPlanStatus();
    expect(result.autoRenew!.enabled).toBe(true);
    expect(result.autoRenew!.period).toBe(1);
    expect(result.autoRenew!.periodUnit).toBe('M');
  });

  it('autoRenew.enabled converts AutoRenewal 0 → false', async () => {
    apiClient.callFlatApi = vi.fn(async (opts: { action: string }) => {
      if (opts.action === 'CheckTokenPlanAutoRenewal') {
        return { Data: { AutoRenewal: 0, RenewalPeriod: 1, RenewalPeriodUnit: 'M' } };
      }
      return defaultSuccess(opts.action);
    });
    const result = await service.getTokenPlanStatus();
    expect(result.autoRenew!.enabled).toBe(false);
  });

  it('renewable fields map correctly from CheckInstancesRenewable', async () => {
    const result = await service.getTokenPlanStatus();
    expect(result.renewable!.canRenew).toBe(false);
    expect(result.renewable!.interceptCode).toBe('PENDING_RENEWAL');
  });

  it('period fields contain start, end, and remainingDays as number', async () => {
    const result = await service.getTokenPlanStatus();
    expect(result.period!.start).toBe('2026-06-14T00:00:00+08:00');
    expect(result.period!.end).toBe('2026-07-14T00:00:00+08:00');
    expect(typeof result.period!.remainingDays).toBe('number');
  });

  it('amount fields are strings (not numbers) — full precision preserved', async () => {
    const result = await service.getTokenPlanStatus();
    expect(typeof result.seatSummary!.groups[0].totalValue).toBe('string');
    expect(typeof result.seatSummary!.groups[0].surplusValue).toBe('string');
    expect(typeof result.seatSummary!.total.totalValue).toBe('string');
    expect(typeof result.seatSummary!.total.surplusValue).toBe('string');
  });

  it('specType values are passed through unchanged', async () => {
    const result = await service.getTokenPlanStatus();
    const types = result.seatSummary!.groups.map((g) => g.specType);
    expect(types).toContain('standard');
    expect(types).toContain('pro');
  });

  // ──────── Partial Failure ────────

  it('GetSeatSubscriptionSummary failure → seatSummary.groups null, diagnostics non-empty', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      GetSeatSubscriptionSummary: new Error('Service timeout'),
    });
    const result = await service.getTokenPlanStatus();
    expect(result.seatSummary).toBeNull();
    expect(result.period).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.some((d) => d.api === 'GetSeatSubscriptionSummary')).toBe(true);
  });

  it('CheckTokenPlanAutoRenewal failure → autoRenew null, other fields intact', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      CheckTokenPlanAutoRenewal: new Error('BssOpenApi.InternalError'),
    });
    const result = await service.getTokenPlanStatus();
    expect(result.autoRenew).toBeNull();
    expect(result.seatSummary).not.toBeNull();
    expect(result.period).not.toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].api).toBe('CheckTokenPlanAutoRenewal');
  });

  it('CheckInstancesRenewable failure → renewable null', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      CheckInstancesRenewable: new Error('Network error'),
    });
    const result = await service.getTokenPlanStatus();
    expect(result.renewable).toBeNull();
    expect(result.seatSummary).not.toBeNull();
    expect(result.diagnostics.some((d) => d.api === 'CheckInstancesRenewable')).toBe(true);
  });

  it('GetSubscriptionSummary failure → total degrades (groups still available)', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      GetSubscriptionSummary: new Error('500 Internal Server Error'),
    });
    const result = await service.getTokenPlanStatus();
    // groups from API 1 should still be present
    expect(result.seatSummary).not.toBeNull();
    expect(result.seatSummary!.groups.length).toBeGreaterThan(0);
    // total should be null or degraded
    expect(result.seatSummary!.total).toBeNull();
    expect(result.diagnostics.some((d) => d.api === 'GetSubscriptionSummary')).toBe(true);
  });

  // ──────── Full Failure ────────

  it('all 4 APIs fail → all fields null, diagnostics has 4 entries', async () => {
    const e = new Error('All services down');
    apiClient.callFlatApi = buildSelectiveMock({
      GetSeatSubscriptionSummary: e,
      GetSubscriptionSummary: e,
      CheckTokenPlanAutoRenewal: e,
      CheckInstancesRenewable: e,
    });
    const result = await service.getTokenPlanStatus();
    expect(result.seatSummary).toBeNull();
    expect(result.period).toBeNull();
    expect(result.autoRenew).toBeNull();
    expect(result.renewable).toBeNull();
    expect(result.diagnostics).toHaveLength(4);
  });

  // ──────── Data Dependency ────────

  it('API 1 failure causes API 3/4 to skip (InstanceId dependency)', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      DescribeFrInstances: new Error('Upstream unavailable'),
    });
    const result = await service.getTokenPlanStatus();
    // API 3 (CheckTokenPlanAutoRenewal) and API 4 (CheckInstancesRenewable)
    // require InstanceId resolution → should be skipped
    expect(result.autoRenew).toBeNull();
    expect(result.renewable).toBeNull();
    // Check diagnostics mention the skip reason
    const skipDiags = result.diagnostics.filter(
      (d) => d.api === 'CheckTokenPlanAutoRenewal' || d.api === 'CheckInstancesRenewable',
    );
    expect(skipDiags.length).toBeGreaterThanOrEqual(1);
  });

  it('API 3/4 are not called when API 1 fails (no wasted network requests)', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      DescribeFrInstances: new Error('Upstream unavailable'),
    });
    await service.getTokenPlanStatus();
    const calledActions = apiClient.callFlatApi.mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    );
    // API 3 and API 4 should not be called when InstanceId resolution fails
    expect(calledActions).not.toContain('CheckTokenPlanAutoRenewal');
    expect(calledActions).not.toContain('CheckInstancesRenewable');
  });

  // ──────── Timeout ────────

  it('classifies a hung call as a timeout diagnostic via soft timeout sentinel', async () => {
    vi.useFakeTimers();
    apiClient.callFlatApi = buildSelectiveMock({}, new Set(['CheckTokenPlanAutoRenewal']));
    const promise = service.getTokenPlanStatus();
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.autoRenew).toBeNull();
    expect(result.diagnostics.some((d) => /timeout/i.test(d.errorMessage))).toBe(true);
  });

  it('returns timeout diagnostics for every call when entire batch hangs', async () => {
    vi.useFakeTimers();
    apiClient.callFlatApi = buildSelectiveMock(
      {},
      new Set([
        'GetSeatSubscriptionSummary',
        'GetSubscriptionSummary',
        'CheckTokenPlanAutoRenewal',
        'CheckInstancesRenewable',
      ]),
    );
    const promise = service.getTokenPlanStatus();
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.seatSummary).toBeNull();
    expect(result.period).toBeNull();
    expect(result.autoRenew).toBeNull();
    expect(result.renewable).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics.every((d) => /timeout/i.test(d.errorMessage))).toBe(true);
  });

  // ──────── Parameter Validation ────────

  it('passes productCode to GetSeatSubscriptionSummary', async () => {
    await service.getTokenPlanStatus();
    const seatCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'GetSeatSubscriptionSummary',
    );
    expect(seatCall).toBeDefined();
    const opts = seatCall![0] as { params?: Record<string, unknown> };
    expect(opts.params?.productCode).toBeDefined();
    expect(typeof opts.params?.productCode).toBe('string');
  });

  it('passes productCode to GetSubscriptionSummary', async () => {
    await service.getTokenPlanStatus();
    const sumCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'GetSubscriptionSummary',
    );
    expect(sumCall).toBeDefined();
    const opts = sumCall![0] as { params?: Record<string, unknown> };
    expect(opts.params?.productCode).toBeDefined();
  });

  it('uses BssOpenApi product (non-V3) for CheckTokenPlanAutoRenewal', async () => {
    await service.getTokenPlanStatus();
    const autoCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'CheckTokenPlanAutoRenewal',
    );
    expect(autoCall).toBeDefined();
    const opts = autoCall![0] as { product?: string };
    expect(opts.product).toBe('BssOpenApi');
  });

  it('uses BssOpenAPI-V3 product for GetSeatSubscriptionSummary', async () => {
    await service.getTokenPlanStatus();
    const seatCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'GetSeatSubscriptionSummary',
    );
    expect(seatCall).toBeDefined();
    const opts = seatCall![0] as { product?: string };
    expect(opts.product).toMatch(/BssOpenAPI/i);
  });

  it('uses flat dot-notation for CheckInstancesRenewable params', async () => {
    await service.getTokenPlanStatus();
    const renewCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'CheckInstancesRenewable',
    );
    expect(renewCall).toBeDefined();
    const opts = renewCall![0] as { params?: Record<string, string> };
    expect(opts.params?.['instanceIdentities.1.InstanceId']).toBeDefined();
  });
});

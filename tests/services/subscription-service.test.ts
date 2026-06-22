/** Unit tests for SubscriptionService. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import type { CachedFetcher } from '../../src/types/cache.js';
import { SubscriptionService } from '../../src/services/subscription-service.js';
import type { SubscriptionAdapter } from '../../src/services/subscription-service.js';
import type { TokenplanService } from '../../src/services/tokenplan-service.js';
import type { TokenPlan } from '../../src/types/usage.js';

// Mocks

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
  callEnvelopeApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn(), callEnvelopeApi: vi.fn() };
}

function makeCachedFetcher(): CachedFetcher {
  return {
    getOrFetch: vi.fn(async <T>(_k: string, _t: number, fetcher: () => Promise<T>) => fetcher()),
    invalidate: vi.fn(),
  };
}

interface MockTokenplanService {
  fetchTokenPlan: ReturnType<typeof vi.fn>;
}

function makeMockTokenplanService(
  result: TokenPlan = { subscribed: false },
): MockTokenplanService {
  return { fetchTokenPlan: vi.fn(async () => result) };
}

function makeSubscriptionAdapter(): SubscriptionAdapter {
  // Identity-style adapter: the adapter unit tests cover field renames; here
  // we focus on orchestration so the adapter just passes payloads through
  // shaped as the service expects.
  return {
    transformSubscriptionGray: (raw: unknown) => ({
      isGray: (raw as { IsGray?: boolean })?.IsGray ?? null,
    }),
    transformSeatSubscriptionSummary: (raw: unknown) => ({
      plan: (raw as { PlanName?: string })?.PlanName ?? null,
      planCode: null,
      period: null,
      seats: null,
    }),
    transformSubscriptionDetail: () => ({ instances: [], activeInstance: null }),
    transformAutoRenewal: (raw: unknown) => ({
      autoRenew: (raw as { EnableRenew?: boolean })?.EnableRenew ?? null,
    }),
    transformInstancesRenewable: (raw: unknown) => ({
      renewable: (raw as { Renewable?: boolean })?.Renewable ?? null,
    }),
    transformOrderList: (raw: unknown) => {
      const r = raw as { Data?: Array<Record<string, unknown>> };
      return {
        orders: (r.Data ?? []).map((o) => ({
          orderId: String(o.OrderId ?? ''),
          orderType: String(o.OrderType ?? ''),
          orderTime: String(o.OrderTime ?? ''),
          amount: String(o.Amount ?? '0'),
          status: String(o.Status ?? ''),
        })),
        pagination: { totalCount: 0, pageSize: 20, currentPage: 1 },
      };
    },
    transformOrderDetail: (raw: unknown) => {
      const r = raw as { OrderId?: string };
      return {
        orderId: String(r.OrderId ?? ''),
        orderType: '',
        orderTime: '',
        amount: '0',
        status: '',
        items: [],
        invoiceUrl: null,
      };
    },
  };
}

/** Per-call success payload factory. */
function defaultSuccess(action: string): Record<string, unknown> {
  switch (action) {
    case 'QuerySubscriptionGray':
      return { IsGray: false };
    case 'DescribeFrInstances':
      return {
        Data: [
          { InstanceId: 'fr-001', CurrCapacityBaseValue: '1000', StatusCode: 'valid' },
        ],
      };
    case 'GetSeatSubscriptionSummary':
      return { PlanName: 'Token Plan Team' };
    case 'GetSubscriptionDetail':
      return {
        Data: [
          {
            InstanceCode: 'subs-001',
            ProductCode: 'sfm_codingplan_public_intl',
            Status: 'NORMAL',
          },
        ],
        TotalCount: 1,
        PageSize: 100,
        CurrentPage: 1,
      };
    case 'CheckTokenPlanAutoRenewal':
      return { EnableRenew: true };
    case 'CheckInstancesRenewable':
      return { Data: [{ InstanceId: 'subs-001', CanRenew: true }] };
    default:
      return {};
  }
}

/** Build a callFlatApi mock that resolves/rejects per Action selectively. */
function buildSelectiveMock(
  failures: Partial<Record<string, Error>> = {},
  hangs: Set<string> = new Set(),
): ReturnType<typeof vi.fn> {
  return vi.fn(async (opts: { action: string; params?: Record<string, unknown> }) => {
    const fail = failures[opts.action];
    if (fail) throw fail;
    if (hangs.has(opts.action)) {
      // Never resolves — service must trip the timeout sentinel.
      return new Promise(() => {});
    }
    return defaultSuccess(opts.action);
  });
}

// getStatus

describe('SubscriptionService.getStatus — multi-API orchestration', () => {
  let apiClient: MockApiClient;
  let service: SubscriptionService;
  let tokenplanService: MockTokenplanService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    apiClient.callFlatApi = buildSelectiveMock();
    tokenplanService = makeMockTokenplanService();
    service = new SubscriptionService(
      apiClient as unknown as ApiClient,
      makeSubscriptionAdapter(),
      makeCachedFetcher(),
      tokenplanService as unknown as TokenplanService,
    );
  });

  it('returns full data with empty diagnostics when all six calls succeed', async () => {
    const result = await service.getStatus();
    expect(result.diagnostics).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  it('records a single diagnostic when one call fails', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      QuerySubscriptionGray: new Error('GrayService.Timeout'),
    });
    const result = await service.getStatus();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].api).toBe('QuerySubscriptionGray');
    expect(result.data).not.toBeNull();
  });

  it('keeps successful slices when one slice fails', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      DescribeFrInstances: new Error('Quota service unavailable'),
    });
    const result = await service.getStatus();
    expect(result.data?.quota).toBeNull();
    expect(result.data?.plan).not.toBeNull();
  });

  it('records four diagnostics when the addon DescribeFrInstances and three other phase-1 calls fail', async () => {
    apiClient.callFlatApi = buildSelectiveMock({
      QuerySubscriptionGray: new Error('e'),
      DescribeFrInstances: new Error('e'),
      GetSeatSubscriptionSummary: new Error('e'),
      CheckTokenPlanAutoRenewal: new Error('e'),
    });
    const result = await service.getStatus();
    // After the TokenPlan refactor only the addon DescribeFrInstances call
    // remains in the orchestrator; quota now flows through TokenplanService.
    expect(result.diagnostics).toHaveLength(4);
    expect(result.data).not.toBeNull();
    const apis = result.diagnostics.map((d) => d.api).sort();
    expect(apis).toContain('DescribeFrInstances-addon');
    expect(apis).not.toContain('DescribeFrInstances');
  });

  it('returns null data when all phase-1 calls fail', async () => {
    const e = new Error('All down');
    apiClient.callFlatApi = buildSelectiveMock({
      QuerySubscriptionGray: e,
      DescribeFrInstances: e,
      GetSeatSubscriptionSummary: e,
      GetSubscriptionDetail: e,
      CheckTokenPlanAutoRenewal: e,
    });
    tokenplanService.fetchTokenPlan.mockRejectedValueOnce(e);
    const result = await service.getStatus();
    expect(result.data).toBeNull();
    // Six phase-1 sub-calls: gray + seat-summary + TokenPlan + addon-fr +
    // auto-renew + subscription-detail.
    expect(result.diagnostics).toHaveLength(6);
  });

  it('classifies a hung call as a timeout diagnostic via the overall sentinel', async () => {
    vi.useFakeTimers();
    apiClient.callFlatApi = buildSelectiveMock({}, new Set(['CheckTokenPlanAutoRenewal']));
    const promise = service.getStatus();
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].errorMessage).toMatch(/timeout/i);
    expect(result.data).not.toBeNull();
  });

  it('returns timeout diagnostics for every call when the entire batch hangs', async () => {
    vi.useFakeTimers();
    apiClient.callFlatApi = buildSelectiveMock(
      {},
      new Set([
        'QuerySubscriptionGray',
        'DescribeFrInstances',
        'GetSeatSubscriptionSummary',
        'GetSubscriptionDetail',
        'CheckTokenPlanAutoRenewal',
      ]),
    );
    tokenplanService.fetchTokenPlan.mockImplementationOnce(
      () => new Promise<TokenPlan>(() => {}),
    );
    const promise = service.getStatus();
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.data).toBeNull();
    // Six phase-1 sub-calls all stall: gray + seat-summary + TokenPlan +
    // addon-fr + auto-renew + subscription-detail.
    expect(result.diagnostics).toHaveLength(6);
    expect(result.diagnostics.every((d) => /timeout/i.test(d.errorMessage ?? ''))).toBe(true);
  });

  it('mixes timeout and error diagnostics correctly', async () => {
    vi.useFakeTimers();
    apiClient.callFlatApi = buildSelectiveMock(
      { DescribeFrInstances: new Error('500 Internal') },
      new Set(['CheckTokenPlanAutoRenewal']),
    );
    const promise = service.getStatus();
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    vi.useRealTimers();
    const apis = result.diagnostics.map((d) => d.api).sort();
    // The orchestrator only issues the addon DescribeFrInstances call now;
    // quota flows through TokenplanService and is mocked-stable here.
    expect(apis).toEqual(['CheckTokenPlanAutoRenewal', 'DescribeFrInstances-addon']);
  });

  it('passes productCode param to GetSeatSubscriptionSummary', async () => {
    await service.getStatus({ plan: 'token' });
    const seatCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'GetSeatSubscriptionSummary',
    );
    expect(seatCall).toBeDefined();
    const opts = seatCall![0] as { params?: Record<string, unknown> };
    expect(opts.params?.productCode).toBe('sfm_tokenplanteams_dp_intl');
  });

  it('passes pageNo and pageSize to GetSubscriptionDetail', async () => {
    await service.getStatus({ plan: 'coding' });
    const detailCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'GetSubscriptionDetail',
    );
    expect(detailCall).toBeDefined();
    const opts = detailCall![0] as { params?: Record<string, unknown> };
    expect(opts.params?.pageNo).toBe(1);
    expect(opts.params?.pageSize).toBe(100);
  });

  it('calls CheckInstancesRenewable with instanceIdentities when valid instances exist', async () => {
    await service.getStatus({ plan: 'coding' });
    const renewCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'CheckInstancesRenewable',
    );
    expect(renewCall).toBeDefined();
    const opts = renewCall![0] as { params?: Record<string, string> };
    expect(opts.params?.['instanceIdentities.1.InstanceId']).toBe('subs-001');
    expect(opts.params?.['instanceIdentities.1.CommodityCode']).toBe('sfm_codingplan_public_intl');
    expect(opts.params?.['instanceIdentities.1.ResourceType']).toBe('subscription');
  });

  it('skips CheckInstancesRenewable when no valid instances exist', async () => {
    apiClient.callFlatApi = vi.fn(async (opts: { action: string }) => {
      if (opts.action === 'GetSubscriptionDetail') {
        return { Data: [{ InstanceCode: 'subs-x', Status: 'REFUNDED', ProductCode: 'x' }] };
      }
      return defaultSuccess(opts.action);
    });
    await service.getStatus({ plan: 'coding' });
    const renewCall = apiClient.callFlatApi.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'CheckInstancesRenewable',
    );
    expect(renewCall).toBeUndefined();
  });

  it('does not cache the status response (real-time semantics)', async () => {
    const cache = makeCachedFetcher();
    service = new SubscriptionService(
      apiClient as unknown as ApiClient,
      makeSubscriptionAdapter(),
      cache,
      tokenplanService as unknown as TokenplanService,
    );
    await service.getStatus();
    await service.getStatus();
    // Phase 1 (5 apiClient calls: gray + seat-summary + addon-fr + auto-renew
    // + subscription-detail) + Phase 2 (1 call) = 6 per invocation; × 2 = 12.
    // TokenPlan is sourced from the injected service and bypasses apiClient.
    expect(apiClient.callFlatApi.mock.calls.length).toBeGreaterThanOrEqual(12);
  });

  it('limits the call set when --plan token is provided', async () => {
    await service.getStatus({ plan: 'token' });
    const calledActions = new Set(
      apiClient.callFlatApi.mock.calls.map((c) => (c[0] as { action: string }).action),
    );
    // Token cohort: gray + seat-summary + auto-renewal + DescribeFrInstances
    // (both personal Token Plan quota and addon Credit Pack data).
    expect(calledActions.has('QuerySubscriptionGray')).toBe(true);
    expect(calledActions.has('GetSeatSubscriptionSummary')).toBe(true);
    expect(calledActions.has('CheckTokenPlanAutoRenewal')).toBe(true);
    expect(calledActions.has('DescribeFrInstances')).toBe(true);
    expect(calledActions.has('GetSubscriptionDetail')).toBe(false);
    expect(calledActions.has('CheckInstancesRenewable')).toBe(false);
  });

  it('issues only the addon DescribeFrInstances call under --plan token', async () => {
    await service.getStatus({ plan: 'token' });
    const frCalls = apiClient.callFlatApi.mock.calls.filter(
      (c) => (c[0] as { action: string }).action === 'DescribeFrInstances',
    );
    // The personal Token Plan instance query has migrated into
    // TokenplanService; only the addon Credit Pack call remains here.
    expect(frCalls).toHaveLength(1);
    const codes = frCalls.map(
      (c) => (c[0] as { params?: Record<string, unknown> }).params?.CommodityCode,
    );
    expect(codes).toEqual(['sfm_tokenplanteamsaddon_dp_intl']);
    expect(tokenplanService.fetchTokenPlan).toHaveBeenCalledTimes(1);
  });

  it('limits the call set when --plan coding is provided', async () => {
    await service.getStatus({ plan: 'coding' });
    const calledActions = new Set(
      apiClient.callFlatApi.mock.calls.map((c) => (c[0] as { action: string }).action),
    );
    // Phase 1: gray + subscription-detail. Phase 2: instances-renewable
    // (default mock yields a NORMAL instance, so the renew check fires).
    expect(calledActions.has('QuerySubscriptionGray')).toBe(true);
    expect(calledActions.has('GetSubscriptionDetail')).toBe(true);
    expect(calledActions.has('CheckInstancesRenewable')).toBe(true);
    expect(calledActions.has('GetSeatSubscriptionSummary')).toBe(false);
    expect(calledActions.has('DescribeFrInstances')).toBe(false);
    expect(calledActions.has('CheckTokenPlanAutoRenewal')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // assembleStatus: multi-region field extraction
  // ─────────────────────────────────────────────────────────────────

  it('returns multi-region fields with default values when responses are minimal', async () => {
    const result = await service.getStatus();
    expect(result.data).not.toBeNull();
    // Field presence contract: every multi-region field is always populated
    // (defaults to null/[]) so view-models can rely on the shape.
    expect(result.data?.remainingDays).toBeNull();
    expect(Array.isArray(result.data?.seatTiers)).toBe(true);
    expect(Array.isArray(result.data?.creditPacks)).toBe(true);
    expect(Array.isArray(result.data?.recentOrders)).toBe(true);
    expect('codingPlanStatus' in (result.data ?? {})).toBe(true);
  });

  it('extracts seatTiers and remainingDays from GetSeatSubscriptionSummary.SubscriptionGroupList', async () => {
    apiClient.callFlatApi = vi.fn(async (opts: { action: string }) => {
      if (opts.action === 'GetSeatSubscriptionSummary') {
        return {
          Data: {
            PlanName: 'Token Plan Team',
            RemainingDays: 12,
            SubscriptionGroupList: [
              {
                SpecType: 'pro',
                SubscriptionTotalNumber: 3,
                EquityList: [{ TotalValue: '1000000', SurplusValue: '600000' }],
                NextCycleFlushTime: 1735689600000,
              },
              {
                SpecType: 'standard',
                SubscriptionTotalNumber: 1,
                TotalValue: '500000',
                SurplusValue: '500000',
              },
            ],
          },
        };
      }
      return defaultSuccess(opts.action);
    });
    const result = await service.getStatus({ plan: 'token' });
    expect(result.data?.remainingDays).toBe(12);
    expect(result.data?.seatTiers).toHaveLength(2);
    expect(result.data?.seatTiers[0]).toMatchObject({
      specType: 'pro',
      seats: 3,
      totalCredits: 1_000_000,
      remainingCredits: 600_000,
      usedPct: 40,
    });
    expect(result.data?.seatTiers[0].nextCycleFlushTime).not.toBeNull();
    expect(result.data?.seatTiers[1]).toMatchObject({
      specType: 'standard',
      seats: 1,
      totalCredits: 500_000,
      remainingCredits: 500_000,
      usedPct: 0,
    });
  });

  it('returns an empty seatTiers array when SubscriptionGroupList is missing', async () => {
    apiClient.callFlatApi = vi.fn(async (opts: { action: string }) => {
      if (opts.action === 'GetSeatSubscriptionSummary') {
        return { Data: { PlanName: 'Token Plan Team' } };
      }
      return defaultSuccess(opts.action);
    });
    const result = await service.getStatus({ plan: 'token' });
    expect(result.data?.seatTiers).toEqual([]);
    expect(result.data?.remainingDays).toBeNull();
  });

  it('extracts creditPacks from the addon DescribeFrInstances response when multiple instances exist', async () => {
    apiClient.callFlatApi = vi.fn(
      async (opts: { action: string; params?: Record<string, unknown> }) => {
        if (opts.action === 'DescribeFrInstances') {
          const code = opts.params?.CommodityCode;
          if (code === 'sfm_tokenplanteamsaddon_dp_intl') {
            return {
              Data: [
                {
                  InstanceId: 'fr-001',
                  InitCapacityBaseValue: '1000000',
                  CurrCapacityBaseValue: '250000',
                  EndTime: 4102444800000,
                  StatusCode: 'valid',
                },
                {
                  InstanceId: 'fr-002',
                  InitCapacityBaseValue: '500000',
                  CurrCapacityBaseValue: '500000',
                  StatusCode: 'valid',
                },
                {
                  InstanceId: 'fr-expired',
                  InitCapacityBaseValue: '100000',
                  CurrCapacityBaseValue: '0',
                  StatusCode: 'expired',
                },
              ],
            };
          }
          return { Data: [] };
        }
        return defaultSuccess(opts.action);
      },
    );
    const result = await service.getStatus();
    expect(result.data?.creditPacks).toHaveLength(2);
    expect(result.data?.creditPacks[0]).toMatchObject({
      instanceId: 'fr-001',
      totalCredits: 1_000_000,
      remainingCredits: 250_000,
    });
    expect(result.data?.creditPacks[0].expiresAt).not.toBeNull();
    expect(result.data?.creditPacks[1].expiresAt).toBeNull();
  });

  it('returns null expiresAt for creditPacks with sentinel far-future EndTime (year >= 7000)', async () => {
    const sentinelMs = new Date('9999-12-31T23:59:59Z').getTime();
    const normalMs = new Date('2027-06-30T00:00:00Z').getTime();
    apiClient.callFlatApi = vi.fn(
      async (opts: { action: string; params?: Record<string, unknown> }) => {
        if (opts.action === 'DescribeFrInstances') {
          const code = opts.params?.CommodityCode;
          if (code === 'sfm_tokenplanteamsaddon_dp_intl') {
            return {
              Data: [
                {
                  InstanceId: 'fr-sentinel',
                  InitCapacityBaseValue: '500000',
                  CurrCapacityBaseValue: '300000',
                  EndTime: sentinelMs,
                  StatusCode: 'valid',
                },
                {
                  InstanceId: 'fr-normal',
                  InitCapacityBaseValue: '200000',
                  CurrCapacityBaseValue: '100000',
                  EndTime: normalMs,
                  StatusCode: 'valid',
                },
              ],
            };
          }
          return { Data: [] };
        }
        return defaultSuccess(opts.action);
      },
    );
    const result = await service.getStatus();
    expect(result.data?.creditPacks).toHaveLength(2);
    expect(result.data?.creditPacks[0]?.instanceId).toBe('fr-sentinel');
    expect(result.data?.creditPacks[0]?.expiresAt).toBeNull();
    expect(result.data?.creditPacks[1]?.instanceId).toBe('fr-normal');
    expect(result.data?.creditPacks[1]?.expiresAt).not.toBeNull();
    expect(result.data?.creditPacks[1]?.expiresAt).toContain('2027');
  });

  it('feeds TokenplanService.fetchTokenPlan into quota and addon DescribeFrInstances into creditPacks', async () => {
    apiClient.callFlatApi = vi.fn(
      async (opts: { action: string; params?: Record<string, unknown> }) => {
        if (opts.action === 'DescribeFrInstances') {
          const code = opts.params?.CommodityCode;
          if (code === 'sfm_tokenplanteamsaddon_dp_intl') {
            return {
              Data: [
                {
                  InstanceId: 'fr-addon',
                  InitCapacityBaseValue: '300000',
                  CurrCapacityBaseValue: '120000',
                  StatusCode: 'valid',
                },
              ],
            };
          }
          return { Data: [] };
        }
        return defaultSuccess(opts.action);
      },
    );
    tokenplanService.fetchTokenPlan.mockResolvedValueOnce({
      subscribed: true,
      status: 'valid',
      totalCredits: 2_000_000,
      remainingCredits: 500_000,
      usedPct: 75,
      planName: 'Token Plan Personal',
    });
    const result = await service.getStatus({ plan: 'token' });
    expect(result.data?.quota).toMatchObject({
      total: 2_000_000,
      remaining: 500_000,
      usedPct: 75,
    });
    expect(result.data?.creditPacks).toHaveLength(1);
    expect(result.data?.creditPacks[0]).toMatchObject({
      instanceId: 'fr-addon',
      totalCredits: 300_000,
      remainingCredits: 120_000,
    });
  });

  it('returns an empty creditPacks array when the addon DescribeFrInstances response has no data', async () => {
    apiClient.callFlatApi = vi.fn(
      async (opts: { action: string; params?: Record<string, unknown> }) => {
        if (opts.action === 'DescribeFrInstances') {
          const code = opts.params?.CommodityCode;
          if (code === 'sfm_tokenplanteamsaddon_dp_intl') {
            return { Data: [] };
          }
          return {
            Data: [{ InstanceId: 'fr-personal', CurrCapacityBaseValue: '1000' }],
          };
        }
        return defaultSuccess(opts.action);
      },
    );
    const result = await service.getStatus({ plan: 'token' });
    expect(result.data?.creditPacks).toEqual([]);
  });

  it('returns an empty creditPacks array when the addon DescribeFrInstances call fails', async () => {
    apiClient.callFlatApi = vi.fn(
      async (opts: { action: string; params?: Record<string, unknown> }) => {
        if (opts.action === 'DescribeFrInstances') {
          const code = opts.params?.CommodityCode;
          if (code === 'sfm_tokenplanteamsaddon_dp_intl') {
            throw new Error('addon backend down');
          }
          return {
            Data: [{ InstanceId: 'fr-personal', CurrCapacityBaseValue: '1000' }],
          };
        }
        return defaultSuccess(opts.action);
      },
    );
    const result = await service.getStatus({ plan: 'token' });
    expect(result.data?.creditPacks).toEqual([]);
    expect(result.diagnostics.map((d) => d.api)).toContain('DescribeFrInstances-addon');
  });

  it('extracts codingPlanStatus from the active subscription instance', async () => {
    const adapter: SubscriptionAdapter = {
      ...makeSubscriptionAdapter(),
      transformSubscriptionDetail: () => ({
        instances: [
          {
            instanceId: 'subs-001',
            status: 'NORMAL',
            plan: 'Coding Plan Pro',
            period: { start: '2099-04-01T00:00:00Z', end: '2099-04-30T23:59:59Z' },
          },
        ],
        activeInstance: {
          instanceId: 'subs-001',
          status: 'NORMAL',
          plan: 'Coding Plan Pro',
          period: { start: '2099-04-01T00:00:00Z', end: '2099-04-30T23:59:59Z' },
        },
      }),
    };
    service = new SubscriptionService(
      apiClient as unknown as ApiClient,
      adapter,
      makeCachedFetcher(),
      tokenplanService as unknown as TokenplanService,
    );
    const result = await service.getStatus({ plan: 'coding' });
    expect(result.data?.codingPlanStatus).toBe('NORMAL');
    expect(result.data?.plan).toBe('Coding Plan Pro');
  });

  it('keeps codingPlanStatus null when no active instance is present', async () => {
    const result = await service.getStatus();
    expect(result.data?.codingPlanStatus).toBeNull();
  });

  it('survives a recent-orders best-effort failure with empty recentOrders and no extra diagnostic', async () => {
    apiClient.callFlatApi = vi.fn(async (opts: { action: string }) => {
      if (opts.action === 'QueryOrderList') {
        throw new Error('orders backend down');
      }
      return defaultSuccess(opts.action);
    });
    const result = await service.getStatus();
    expect(result.data).not.toBeNull();
    expect(result.data?.recentOrders).toEqual([]);
    // Best-effort failures must not surface as user-visible diagnostics.
    expect(result.diagnostics.some((d) => d.api === 'QueryOrderList')).toBe(false);
  });

  it('populates recentOrders when listOrders returns rows', async () => {
    apiClient.callFlatApi = vi.fn(async (opts: { action: string }) => {
      if (opts.action === 'QueryAccountBaseInfoApi') {
        return { Data: { NbId: '2688801000001' } };
      }
      if (opts.action === 'QueryOrderList') {
        return {
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
          PageSize: 3,
          CurrentPage: 1,
        };
      }
      return defaultSuccess(opts.action);
    });
    const result = await service.getStatus();
    expect(result.data?.recentOrders).toHaveLength(1);
    expect(result.data?.recentOrders[0]).toMatchObject({
      orderId: 'ord-001',
      orderType: 'purchase',
      amount: '199.00',
    });
  });

  it('scopes recent orders to the token-plan commodity codes', async () => {
    let orderListParams: Record<string, unknown> | undefined;
    apiClient.callFlatApi = vi.fn(
      async (opts: { action: string; params?: Record<string, unknown> }) => {
        if (opts.action === 'QueryAccountBaseInfoApi') {
          return { Data: { NbId: '2688801000001' } };
        }
        if (opts.action === 'QueryOrderList') {
          orderListParams = opts.params;
          return { Data: [], TotalCount: 0, PageSize: 3, CurrentPage: 1 };
        }
        return defaultSuccess(opts.action);
      },
    );
    await service.getStatus();
    expect(orderListParams?.CommodityCodeList).toBe(
      'sfm_tokenplanteams_dp_intl,sfm_tokenplanteamsaddon_dp_intl',
    );
  });
});

// listOrders

describe('SubscriptionService.listOrders', () => {
  let apiClient: MockApiClient;
  let service: SubscriptionService;

  /** Mock for QueryAccountBaseInfoApi. */
  const NBID_RESPONSE = { Data: { NbId: '2688801000001' } };

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SubscriptionService(
      apiClient as unknown as ApiClient,
      makeSubscriptionAdapter(),
      makeCachedFetcher(),
      makeMockTokenplanService() as unknown as TokenplanService,
    );
  });

  it('returns the order list without expanding details by default', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({
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
    });
    const result = await service.listOrders({
      from: '2026-04-01',
      to: '2026-04-30',
      page: 1,
      pageSize: 20,
    });
    expect(result.orders).toHaveLength(1);
    // 1 NbId call + 1 list call
    expect(apiClient.callFlatApi).toHaveBeenCalledTimes(2);

    // Verify startDate/endDate are epoch milliseconds (local timezone)
    const listCall = apiClient.callFlatApi.mock.calls.find(
      (call) => (call[0] as { action: string }).action === 'QueryOrderList',
    );
    const params = (listCall![0] as { params?: Record<string, unknown> }).params;
    expect(params?.startDate).toBe(new Date('2026-04-01T00:00:00').getTime());
    expect(params?.endDate).toBe(new Date('2026-04-30T23:59:59.999').getTime());
  });

  it('forwards CommodityCodeList into the QueryOrderList params when provided', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({ Data: [], TotalCount: 0, PageSize: 20, CurrentPage: 1 });
    await service.listOrders({
      page: 1,
      pageSize: 20,
      commodityCodeList: 'sfm_tokenplanteams_dp_intl,sfm_tokenplanteamsaddon_dp_intl',
    });
    const listCall = apiClient.callFlatApi.mock.calls.find(
      (call) => (call[0] as { action: string }).action === 'QueryOrderList',
    );
    expect(listCall).toBeDefined();
    const params = (listCall![0] as { params?: Record<string, unknown> }).params;
    expect(params?.CommodityCodeList).toBe(
      'sfm_tokenplanteams_dp_intl,sfm_tokenplanteamsaddon_dp_intl',
    );
  });

  it('omits CommodityCodeList from the QueryOrderList params when not provided', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({ Data: [], TotalCount: 0, PageSize: 20, CurrentPage: 1 });
    await service.listOrders({ page: 1, pageSize: 20 });
    const listCall = apiClient.callFlatApi.mock.calls.find(
      (call) => (call[0] as { action: string }).action === 'QueryOrderList',
    );
    const params = (listCall![0] as { params?: Record<string, unknown> }).params;
    expect(params && 'CommodityCodeList' in params).toBe(false);
  });

  it('returns an empty list when the backend has no orders', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({
      Data: [],
      TotalCount: 0,
      PageSize: 20,
      CurrentPage: 1,
    });
    const result = await service.listOrders({
      from: '2026-04-01',
      to: '2026-04-30',
      page: 1,
      pageSize: 20,
    });
    expect(result.orders).toEqual([]);
  });

  it('fans out detail requests when expandDetail is set', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({
        Data: [
          {
            OrderId: 'ord-001',
            OrderType: 'purchase',
            OrderTime: '2026-04-15T10:00:00Z',
            Amount: '199.00',
            Status: 'paid',
          },
          {
            OrderId: 'ord-002',
            OrderType: 'renew',
            OrderTime: '2026-04-20T10:00:00Z',
            Amount: '99.00',
            Status: 'paid',
          },
        ],
        TotalCount: 2,
        PageSize: 20,
        CurrentPage: 1,
      })
      .mockResolvedValue({ OrderId: 'ord-001' });
    await service.listOrders({
      from: '2026-04-01',
      to: '2026-04-30',
      page: 1,
      pageSize: 20,
      expandDetail: true,
    });
    // 1 NbId call + 1 list call + 2 detail calls
    expect(apiClient.callFlatApi.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('attaches detailError to a row whose detail fetch failed without aborting others', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({
        Data: [
          {
            OrderId: 'ord-fail',
            OrderType: 'purchase',
            OrderTime: '2026-04-15T10:00:00Z',
            Amount: '199.00',
            Status: 'paid',
          },
          {
            OrderId: 'ord-ok',
            OrderType: 'purchase',
            OrderTime: '2026-04-16T10:00:00Z',
            Amount: '199.00',
            Status: 'paid',
          },
        ],
        TotalCount: 2,
        PageSize: 20,
        CurrentPage: 1,
      })
      .mockImplementationOnce(async () => {
        throw new Error('Detail fetch failed');
      })
      .mockResolvedValueOnce({ OrderId: 'ord-ok' });

    const result = await service.listOrders({
      from: '2026-04-01',
      to: '2026-04-30',
      page: 1,
      pageSize: 20,
      expandDetail: true,
    });
    const failedRow = result.orders.find((o) => o.orderId === 'ord-fail');
    const okRow = result.orders.find((o) => o.orderId === 'ord-ok');
    expect(failedRow?.detailError).toBeTruthy();
    expect(okRow?.detailError).toBeFalsy();
  });

  it('propagates list-call failures (no silent fallback)', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockRejectedValueOnce(new Error('401 Unauthorized'));
    await expect(
      service.listOrders({ from: '2026-04-01', to: '2026-04-30', page: 1, pageSize: 20 }),
    ).rejects.toThrow(/401/);
  });

  // The CLI gateway does not auto-inject Nbid for QueryOrderList /
  // QueryOrderDetail. When the upstream returns an error payload without
  // a Data array, the service must surface a CliError(FEATURE_UNAVAILABLE)
  // instead of silently treating the missing Data as an empty list.
  it('list: surfaces FEATURE_UNAVAILABLE when upstream returns error payload', async () => {
    const { CliError } = await import('../../src/utils/errors.js');
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({
      RequestId: 'rid',
      Code: 'PARAM_INVALID',
      Message: 'param error',
      Success: true,
    });
    const promise = service.listOrders({ page: 1, pageSize: 20 });
    await expect(promise).rejects.toBeInstanceOf(CliError);
    await promise.catch((err: { code: string; message: string }) => {
      expect(err.code).toBe('FEATURE_UNAVAILABLE');
      expect(err.message).toMatch(/not available/i);
    });
  });

  it('list: surfaces FEATURE_UNAVAILABLE for any inner business code without Data', async () => {
    const { CliError } = await import('../../src/utils/errors.js');
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({
      RequestId: 'rid',
      Code: '1005',
      Message: 'Unknown error. : 1005',
      Success: true,
    });
    const promise = service.listOrders({ page: 1, pageSize: 20 });
    await expect(promise).rejects.toBeInstanceOf(CliError);
    await promise.catch((err: { code: string; message: string }) => {
      expect(err.code).toBe('FEATURE_UNAVAILABLE');
      expect(err.message).toMatch(/not available/i);
    });
  });

  it('detail: surfaces FEATURE_UNAVAILABLE when upstream returns error payload', async () => {
    const { CliError } = await import('../../src/utils/errors.js');
    apiClient.callFlatApi.mockResolvedValueOnce({
      RequestId: 'rid',
      Code: 'PARAM_INVALID',
      Message: 'param error',
      Success: true,
    });
    const promise = service.getOrderDetail('ORD-1');
    await expect(promise).rejects.toBeInstanceOf(CliError);
    await promise.catch((err: { code: string; message: string }) => {
      expect(err.code).toBe('FEATURE_UNAVAILABLE');
      expect(err.message).toMatch(/not available/i);
    });
  });

  it('list: a successful response (Data array, no Code) is unaffected', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce(NBID_RESPONSE)
      .mockResolvedValueOnce({
      Data: [
        {
          OrderId: 'ord-ok',
          OrderType: 'PURCHASE',
          OrderTime: '2026-04-01T00:00:00Z',
          Amount: '10.00',
          Status: 'PAID',
        },
      ],
      TotalCount: 1,
      PageSize: 20,
      CurrentPage: 1,
    });
    const result = await service.listOrders({ page: 1, pageSize: 20 });
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].orderId).toBe('ord-ok');
  });
});

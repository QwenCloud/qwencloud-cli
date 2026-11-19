import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import * as subscriptionAdapter from '../../src/api/adapters/subscription-adapter.js';
import type { TokenPlanSeatDetails } from '../../src/types/tokenplan-subscription.js';
import type { CachedFetcher } from '../../src/types/cache.js';
import {
  SubscriptionService,
  type SubscriptionAdapter,
} from '../../src/services/subscription-service.js';
import { TokenplanService } from '../../src/services/tokenplan-service.js';
import { SubscriptionTokenPlanService } from '../../src/services/subscription-tokenplan-service.js';
import {
  readCodingSubscription,
  readTeamSubscription,
} from '../../src/services/subscription-readers.js';
import { projectSubscriptionStatus } from '../../src/services/subscription-status-compat.js';
import { CliError } from '../../src/utils/errors.js';
import { site } from '../../src/site.js';
import { buildSubscriptionStatusViewModel } from '../../src/view-models/subscription/status.js';

vi.mock('../../src/auth/credentials.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveCredentials: vi.fn(() => null),
  readCredentials: vi.fn(() => null),
  getCurrentUser: vi.fn(() => null),
}));

const SUBSCRIPTION = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription';
const QUOTA = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config';
const USAGE = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage';

function useTimedClock(): void {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
}

interface CsCall {
  api: string;
  data?: Record<string, unknown>;
  authMode?: string;
  parse: (raw: unknown) => unknown;
}

interface FlatCall {
  action: string;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

function cache(): CachedFetcher {
  return {
    getOrFetch: async <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) => fetcher(),
    invalidate: vi.fn(),
  };
}

function apiClient() {
  const responses: Record<string, unknown> = {
    [SUBSCRIPTION]: {
      commodityCode: 'sfm_tokenplansolo_public_intl',
      status: 'VALID',
      instanceCode: 'mock-personal-instance',
      specCode: 'lite',
      remainingDays: 22,
      startTime: Date.parse('2026-10-01T00:00:00Z'),
      endTime: Date.parse('2026-11-20T00:00:00Z'),
      autoRenewFlag: true,
    },
    [QUOTA]: { lite: { five_hour: 100, weekly: 200, monthly: 500 } },
    [USAGE]: {
      per1WeekPercentage: 0.25,
      per1WeekResetTime: Date.parse('2026-10-30T00:00:00Z'),
    },
  };
  const callCsDataApi = vi.fn(async (options: CsCall) =>
    options.parse({ code: 'SUCCESS', success: true, data: responses[options.api] }),
  );
  const callFlatApi = vi.fn(async (options: FlatCall): Promise<unknown> => {
    if (options.action === 'QuerySubscriptionGray') return { IsGray: true };
    if (options.action === 'QueryAccountBaseInfoApi')
      return { Data: { NbId: 'mock-billing-account' } };
    if (options.action === 'GetSeatSubscriptionSummary')
      return { Data: { SubscriptionGroupList: [] } };
    if (options.action === 'GetSubscriptionSummary')
      return { Data: { TotalCount: 0, TotalValue: '0', TotalSurplusValue: '0' } };
    if (options.action === 'CheckTokenPlanAutoRenewal') return { Data: { AutoRenewal: 0 } };
    if (options.action === 'DescribeFrInstances') return { Data: [], TotalCount: 0 };
    if (options.action === 'GetSubscriptionDetail') return { Data: [], TotalCount: 0 };
    if (options.action === 'QueryOrderList') return { Data: [], TotalCount: 0 };
    return {};
  });
  const callOrchestrationApi = vi.fn(async (options: { parse: (raw: unknown) => unknown }) =>
    options.parse({}),
  );
  const client = { callCsDataApi, callFlatApi, callOrchestrationApi } as unknown as ApiClient;
  const cached = cache();
  const tokenplanService = new TokenplanService(client, cached);
  const service = new SubscriptionService(
    client,
    subscriptionAdapter as unknown as SubscriptionAdapter,
    cached,
    tokenplanService,
  );
  return { client, service, tokenplanService, responses, callCsDataApi, callFlatApi };
}

const emptySeatDetails: TokenPlanSeatDetails = {
  items: [],
  fetchedCount: 0,
  totalCount: 0,
  historicalCount: 0,
  collectionCompleteness: 'complete',
  completeness: 'complete',
  diagnostics: [],
};
const mismatchedSeatDetails: TokenPlanSeatDetails = {
  ...emptySeatDetails,
  completeness: 'partial',
  diagnostics: [
    {
      api: 'GetSubscriptionDetail',
      errorCode: 'SeatSummaryMismatch',
      errorMessage: 'Seat details do not match the seat summary. Please try again later.',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Aggregate subscription edition preservation', () => {
  it('rejects an invalid runtime plan before querying subscription APIs', async () => {
    const api = apiClient();
    await expect(api.service.getStatus({ plan: 'bogus' as 'token' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      exitCode: 4,
    });
    expect(api.callCsDataApi).not.toHaveBeenCalled();
    expect(api.callFlatApi).not.toHaveBeenCalled();
  });

  it.each([
    { ratio: 0.07, usedPct: 7, remainingPct: 93 },
    { ratio: 0.0004, usedPct: 0.04, remainingPct: 99.96 },
    { ratio: 0.00005, usedPct: 0.005, remainingPct: 99.995 },
  ])('keeps the personal tier and credit-window percentages consistent: %j', async (fixture) => {
    const api = apiClient();
    api.responses[USAGE] = { per1WeekPercentage: fixture.ratio };
    const aggregate = await api.service.getStatus({ plan: 'token' });
    const dedicated = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });
    for (const individual of [aggregate.data?.individual, dedicated.individual]) {
      expect(individual?.tiers?.[0]).toMatchObject({
        usedPct: fixture.usedPct,
        remainingPct: fixture.remainingPct,
      });
      expect(individual?.weeklyCredits?.usedPct).toBe(fixture.usedPct);
    }
  });

  function seatContractApi(groups: Record<string, unknown>[]) {
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (
        options.action === 'GetSubscriptionDetail' &&
        options.params?.productCode === site.features.tokenPlanCommodityCodes.teams
      )
        return { Data: [], TotalCount: 0 };
      if (options.action === 'GetSubscriptionDetail')
        return {
          Data: [
            {
              InstanceId: 'mock-coding-instance',
              Status: 'VALID',
              PlanName: 'Coding Plan Pro',
              StartTime: '2026-10-01T00:00:00Z',
              EndTime: '2026-12-01T00:00:00Z',
            },
          ],
        };
      if (options.action === 'GetSeatSubscriptionSummary')
        return { Data: { SubscriptionGroupList: groups } };
      if (options.action === 'GetSubscriptionSummary') return { Data: { TotalCount: 2 } };
      if (
        options.action === 'DescribeFrInstances' &&
        options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
      )
        return {
          TotalCount: 1,
          Data: [
            {
              InstanceId: 'mock-team-instance',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              Status: 'valid',
              InitCapacityBaseValue: '200',
              CurrCapacityBaseValue: '150',
            },
          ],
        };
      return original(options);
    });
    return api;
  }

  const completeSeat = {
    SpecType: 'standard',
    SubscriptionTotalNumber: 1,
    SubscriptionAssignedNumber: 0,
    NextCycleFlushTime: '2026-12-01T00:00:00Z',
    EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100.00', SurplusValue: '66.66' }],
  };

  const confirmedPersonalRenewal = {
    Success: true,
    Code: 'Success',
    Data: {
      PageNum: 1,
      PageSize: 20,
      TotalCount: 1,
      InstanceList: [
        {
          InstanceID: 'mock-personal-instance',
          ProductCode: 'sfm',
          ProductType: site.features.tokenPlanCommodityCodes.soloBuy,
          Status: 'Normal',
          SubStatus: 'Normal',
          SubscriptionType: 'Subscription',
          EndTime: Date.parse('2026-11-20T00:00:00Z'),
          RenewStatus: 'AutoRenewal',
          RenewalDuration: 1,
          RenewalUnit: 'Month',
        },
      ],
    },
  };

  it('retains legacy numeric seats and rounded percentage while additive percentages remain exact', async () => {
    const api = seatContractApi([completeSeat]);
    const result = await api.service.getStatus({ plan: 'token' });

    expect(result.data?.seatTiers).toEqual([
      {
        specType: 'standard',
        seats: 1,
        totalCredits: 100,
        remainingCredits: 66.66,
        usedPct: 33,
        nextCycleFlushTime: '2026-12-01T00:00:00.000Z',
      },
    ]);
    expect(result.data?.team?.seatSummaries?.[0]?.remainingPct).toBe(66.66);
    expect(result.data?.team?.seatSummary?.groups[0]?.totalValue).toBe('100.00');
    expect(result.diagnostics.some((entry) => entry.errorCode === 'IncompleteLegacySeatTier')).toBe(
      false,
    );
  });

  it('keeps true zero quota and seat counts numeric without borrowing the FR quota', async () => {
    const api = seatContractApi([
      {
        ...completeSeat,
        SubscriptionTotalNumber: 0,
        EquityList: [{ EquityType: 'CREDITS', TotalValue: '0', SurplusValue: '0' }],
      },
    ]);
    const result = await api.service.getStatus();
    expect(result.data?.seatTiers).toEqual([
      {
        specType: 'standard',
        seats: 0,
        totalCredits: 0,
        remainingCredits: 0,
        usedPct: 0,
        nextCycleFlushTime: '2026-12-01T00:00:00.000Z',
      },
    ]);
    expect(result.data?.quota).toBeNull();
    expect(result.data?.team?.seatSummaries?.[0]).toMatchObject({
      seatCount: 0,
      totalCredits: '0',
      remainingCredits: '0',
      remainingPct: null,
    });
  });

  it.each([
    {
      name: 'missing seat count',
      overrides: { SubscriptionTotalNumber: undefined },
      expected: { seatCount: null, totalCredits: '100', remainingCredits: '66.66' },
    },
    {
      name: 'missing total quota',
      overrides: { EquityList: [{ EquityCode: 'CREDITS', SurplusValue: '50' }] },
      expected: { seatCount: 1, totalCredits: null, remainingCredits: '50' },
    },
    {
      name: 'missing remaining quota',
      overrides: { EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100' }] },
      expected: { seatCount: 1, totalCredits: '100', remainingCredits: null },
    },
    {
      name: 'non-Credits right',
      overrides: {
        EquityList: [{ EquityType: 'REQUESTS', TotalValue: '100', SurplusValue: '50' }],
      },
      expected: { seatCount: 1, totalCredits: null, remainingCredits: null },
    },
    {
      name: 'invalid numeric text',
      overrides: {
        EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100bad', SurplusValue: '50bad' }],
      },
      expected: { seatCount: 1, totalCredits: null, remainingCredits: null },
    },
    {
      name: 'impossible balance',
      overrides: {
        EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100', SurplusValue: '101' }],
      },
      expected: { seatCount: 1, totalCredits: '100', remainingCredits: null },
    },
  ])(
    'omits $name from legacy seatTiers while preserving its additive fields and diagnosis',
    async ({ overrides, expected }) => {
      const api = seatContractApi([{ ...completeSeat, ...overrides }]);
      const result = await api.service.getStatus({ plan: 'token' });
      expect(result.data?.team?.status).toBe('active');
      expect(result.data?.seatTiers).toEqual([]);
      expect(result.data?.team?.seatSummaries?.[0]).toMatchObject(expected);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ errorCode: 'IncompleteLegacySeatTier' }),
      );
      expect(result.data?.team?.completeness).toBe('partial');
    },
  );

  it('keeps complete and zero rows in order when another seat type is incomplete', async () => {
    const api = seatContractApi([
      completeSeat,
      { ...completeSeat, SpecType: 'pro', EquityList: [{ EquityCode: 'CREDITS' }] },
      {
        ...completeSeat,
        SpecType: 'max',
        EquityList: [{ EquityCode: 'CREDITS', TotalValue: '0', SurplusValue: '0' }],
      },
    ]);
    const result = await api.service.getStatus({ plan: 'token' });
    const json = JSON.parse(JSON.stringify(result.data)) as NonNullable<typeof result.data>;
    expect(json.seatTiers.map((tier) => tier.specType)).toEqual(['standard', 'max']);
    for (const row of json.seatTiers) {
      expect(typeof row.seats).toBe('number');
      expect(typeof row.totalCredits).toBe('number');
      expect(typeof row.remainingCredits).toBe('number');
      expect(typeof row.usedPct).toBe('number');
    }
    expect(json.team?.seatSummaries?.[1]).toMatchObject({
      seatType: 'pro',
      totalCredits: null,
      remainingCredits: null,
    });
  });

  it('keeps the historical gray Coding quota while strictly selecting Token Plan Credits', async () => {
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'GetSubscriptionDetail')
        return {
          Data: [
            {
              InstanceId: 'mock-coding-instance',
              Status: 'VALID',
              PlanName: 'Coding Plan Pro',
              StartTime: '2026-10-01T00:00:00Z',
              EndTime: '2026-12-01T00:00:00Z',
            },
          ],
        };
      if (options.action === 'GetSeatSubscriptionSummary')
        return {
          Data: {
            SubscriptionGroupList: [
              {
                SpecType: 'standard',
                SubscriptionTotalNumber: 1,
                SubscriptionAssignedNumber: 0,
                EquityList: [
                  { EquityType: 'REQUESTS', TotalValue: '1000', SurplusValue: '800' },
                  { EquityCode: 'CREDITS', TotalValue: '200.00', SurplusValue: '150.00' },
                ],
              },
            ],
          },
        };
      if (options.action === 'GetSubscriptionSummary')
        return { Data: { TotalCount: 1, TotalValue: '200', TotalSurplusValue: '150' } };
      if (
        options.action === 'DescribeFrInstances' &&
        options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
      )
        return {
          TotalCount: 1,
          Data: [
            {
              InstanceId: 'mock-team-instance',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              Status: 'valid',
              InitCapacityBaseValue: '200',
              CurrCapacityBaseValue: '150',
            },
          ],
        };
      return original(options);
    });

    const aggregate = await api.service.getStatus();
    const tokenOnly = await api.service.getStatus({ plan: 'token' });
    expect(aggregate.data?.plan).toBe('Coding Plan Pro');
    expect(aggregate.data?.period).toEqual({
      start: '2026-10-01T00:00:00Z',
      end: '2026-12-01T00:00:00Z',
    });
    expect(aggregate.data?.quota).toEqual({ total: 1000, remaining: 800, usedPct: 20 });
    expect(tokenOnly.data?.quota).toEqual({ total: 200, remaining: 150, usedPct: 25 });
    expect(aggregate.data?.team?.seatSummary?.groups[0]).toMatchObject({
      totalValue: '200.00',
      surplusValue: '150.00',
    });
    expect(aggregate.data?.team?.seatSummaries?.[0]).toMatchObject({
      totalCredits: '200',
      remainingCredits: '150',
    });
    expect(
      buildSubscriptionStatusViewModel(aggregate.data, aggregate.diagnostics).codingPlanSection
        ?.credits,
    ).toBe('800 / 1,000');
  });

  it('preserves active Coding Plan fields without querying Token Plan when coding is selected', async () => {
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) =>
      options.action === 'GetSubscriptionDetail'
        ? {
            Data: [
              {
                InstanceId: 'mock-coding-instance',
                Status: 'VALID',
                PlanName: 'Coding Plan Pro',
                StartTime: '2026-10-01T00:00:00Z',
                EndTime: '2026-12-01T00:00:00Z',
              },
            ],
          }
        : original(options),
    );

    const result = await api.service.getStatus({ plan: 'coding' });

    expect(result.data).toEqual({
      isGray: true,
      plan: 'Coding Plan Pro',
      period: { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' },
      quota: null,
      autoRenew: null,
      renewable: null,
      remainingDays: null,
      seatTiers: [],
      creditPacks: [],
      codingPlanStatus: 'VALID',
      recentOrders: [],
    });
    expect(api.callCsDataApi).not.toHaveBeenCalled();
    expect(api.callFlatApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DescribeFrInstances' }),
    );
    expect(api.callFlatApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GetSeatSubscriptionSummary' }),
    );
    expect(api.callFlatApi).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GetSubscriptionDetail',
        params: {
          productCode: site.features.codingPlanCommodityCode,
          pageNo: 1,
          pageSize: 100,
        },
      }),
    );
  });

  it.each([
    { isGray: false, teamStatus: 'active' },
    { isGray: false, teamStatus: 'not_subscribed' },
    { isGray: false, teamStatus: 'unknown' },
    { isGray: true, teamStatus: 'active' },
    { isGray: true, teamStatus: 'not_subscribed' },
    { isGray: true, teamStatus: 'unknown' },
  ] as const)(
    'preserves Coding Plan fields for gray=$isGray when the team subscription is $teamStatus',
    async ({ isGray, teamStatus }) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'QuerySubscriptionGray') return { IsGray: isGray };
        if (options.action === 'GetSubscriptionDetail')
          return {
            Data: [
              {
                InstanceId: 'mock-coding-instance',
                Status: 'VALID',
                PlanName: 'Coding Plan Pro',
                StartTime: '2026-10-01T00:00:00Z',
                EndTime: '2026-12-01T00:00:00Z',
              },
              {
                InstanceCode: 'mock-coding-renewal-instance',
                ProductCode: site.features.codingPlanCommodityCode,
                Status: 'NORMAL',
              },
            ],
          };
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
        ) {
          if (teamStatus === 'unknown') throw new Error('Mock team service unavailable');
          if (teamStatus === 'active')
            return {
              TotalCount: 1,
              Data: [
                {
                  InstanceId: 'mock-team-instance',
                  CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                  Status: 'valid',
                  TemplateName: 'Mock Team Plan',
                  InitCapacityBaseValue: '100',
                  CurrCapacityBaseValue: '50',
                },
              ],
            };
        }
        if (teamStatus === 'active' && options.action === 'GetSeatSubscriptionSummary')
          return {
            Data: {
              PlanName: 'Mock Team Plan',
              StartTime: '2026-10-15T00:00:00Z',
              EndTime: '2026-11-15T00:00:00Z',
              RemainingDays: 17,
              SubscriptionGroupList: [
                {
                  SpecType: 'standard',
                  SubscriptionTotalNumber: 1,
                  SubscriptionAssignedNumber: 0,
                  EquityList: [{ EquityCode: 'CREDITS', TotalValue: '200', SurplusValue: '150' }],
                },
              ],
            },
          };
        if (teamStatus === 'active' && options.action === 'GetSubscriptionSummary')
          return {
            Data: { TotalCount: 1, TotalValue: '200', TotalSurplusValue: '150' },
          };
        if (options.action === 'CheckInstancesRenewable')
          return {
            Data: [
              {
                InstanceId: String(options.params?.['instanceIdentities.1.InstanceId']),
                CommodityCode: options.params?.['instanceIdentities.1.CommodityCode'],
                CanRenew:
                  options.params?.['instanceIdentities.1.CommodityCode'] !==
                  site.features.codingPlanCommodityCode,
              },
            ],
          };
        return original(options);
      });

      const result = await api.service.getStatus();

      expect(result.data).toMatchObject({
        plan: 'Coding Plan Pro',
        period: { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' },
        autoRenew: false,
        renewable: false,
        remainingDays: teamStatus === 'active' ? 17 : null,
        codingPlanStatus: 'VALID',
      });
      expect(result.data?.team?.status).toBe(teamStatus);
      if (teamStatus === 'active') {
        expect(result.data?.quota).toEqual(
          isGray
            ? { total: 200, remaining: 150, usedPct: 25 }
            : { total: 100, remaining: 50, usedPct: 50 },
        );
        expect(result.data?.team).toMatchObject({
          name: 'Mock Team Plan',
          period: {
            start: '2026-10-15T00:00:00.000Z',
            end: '2026-11-15T00:00:00.000Z',
          },
          renewable: { canRenew: true },
        });
        const vm = buildSubscriptionStatusViewModel(result.data, result.diagnostics);
        const teamSection = vm.sections.find((section) => section.id === 'tokenplan-team');
        expect(teamSection?.fields.find((field) => field.label === 'Renewable')?.value).toBe('Yes');
        expect(teamSection?.fields.find((field) => field.label === 'Period')?.value).toContain(
          '2026-11-15',
        );
        expect(vm.codingPlanSection?.status).toBe('VALID');
        expect(vm.codingPlanSection?.credits).toBe(isGray ? '150 / 200' : '50 / 100');
        const tokenOnly = await api.service.getStatus({ plan: 'token' });
        expect(tokenOnly.data?.quota).toEqual({ total: 200, remaining: 150, usedPct: 25 });
        expect(tokenOnly.data?.individual).toEqual(result.data?.individual);
        expect(tokenOnly.data?.team).toEqual(result.data?.team);
        const legacy = await api.tokenplanService.fetchTokenPlan();
        expect(legacy.totalCredits).toBe(isGray ? 200 : 100);
        expect(legacy.remainingCredits).toBe(isGray ? 150 : 50);
      } else {
        expect(result.data?.quota).toBeNull();
      }
    },
  );

  it.each(['not_subscribed', 'unknown', 'empty_summary', 'failed_summary'] as const)(
    'keeps gray Coding Plan quota independent of the FR state and summary availability: %s',
    async (scenario) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'GetSubscriptionDetail')
          return {
            Data: [{ InstanceId: 'mock-coding-instance', Status: 'VALID' }],
          };
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
        ) {
          if (scenario === 'unknown') throw new Error('Mock team service unavailable');
          if (scenario !== 'not_subscribed')
            return {
              TotalCount: 1,
              Data: [
                {
                  InstanceId: 'mock-team-instance',
                  CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                  Status: 'valid',
                  InitCapacityBaseValue: '100',
                  CurrCapacityBaseValue: '50',
                },
              ],
            };
        }
        if (options.action === 'GetSeatSubscriptionSummary') {
          if (scenario === 'failed_summary') throw new Error('Mock seat summary unavailable');
          return {
            Data: {
              SubscriptionGroupList:
                scenario === 'empty_summary'
                  ? []
                  : [
                      {
                        SpecType: 'standard',
                        SubscriptionTotalNumber: 1,
                        SubscriptionAssignedNumber: 0,
                        EquityList: [
                          { EquityCode: 'CREDITS', TotalValue: '200', SurplusValue: '150' },
                        ],
                      },
                    ],
            },
          };
        }
        return original(options);
      });

      const result = await api.service.getStatus();

      expect(result.data?.codingPlanStatus).toBe('VALID');
      const vm = buildSubscriptionStatusViewModel(result.data, result.diagnostics);
      if (scenario === 'not_subscribed' || scenario === 'unknown') {
        expect(result.data?.team?.status).toBe(scenario);
        expect(result.data?.quota).toEqual({ total: 200, remaining: 150, usedPct: 25 });
        expect(vm.codingPlanSection?.credits).toBe('150 / 200');
      } else {
        expect(result.data?.team?.status).toBe('active');
        expect(result.data?.quota).toBeNull();
        expect(vm.codingPlanSection?.credits).toBe('—');
      }
      const calls = api.callFlatApi.mock.calls;
      expect(
        calls.filter(([options]) => options.action === 'GetSeatSubscriptionSummary'),
      ).toHaveLength(1);
      expect(calls.filter(([options]) => options.action === 'QuerySubscriptionGray')).toHaveLength(
        1,
      );
    },
  );

  it('keeps the first valid non-gray FR quota without mixing in the new team summary', async () => {
    const api = seatContractApi([completeSeat]);
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'QuerySubscriptionGray') return { IsGray: false };
      if (
        options.action === 'DescribeFrInstances' &&
        options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
      )
        return {
          TotalCount: 3,
          Data: [
            {
              InstanceId: 'mock-expired-team',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              Status: 'expired',
              InitCapacityBaseValue: '500',
              CurrCapacityBaseValue: '0',
            },
            {
              InstanceId: 'mock-first-team',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              Status: { Code: 'valid' },
              InitCapacityBaseValue: '100',
              CurrCapacityBaseValue: '60',
            },
            {
              InstanceId: 'mock-second-team',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              Status: 'valid',
              InitCapacityBaseValue: '900',
              CurrCapacityBaseValue: '800',
            },
          ],
        };
      return original(options);
    });

    const result = await api.service.getStatus();
    expect(result.failureExitCode).toBeUndefined();
    expect(result.data?.quota).toEqual({ total: 100, remaining: 60, usedPct: 40 });
    expect(result.data?.team?.status).toBe('active');
    expect(result.data?.team?.seatSummary?.groups[0]?.surplusValue).toBe('66.66');
    expect(result.data?.codingPlanStatus).toBe('VALID');
    const json = JSON.parse(JSON.stringify(result.data));
    expect(json.quota).toEqual({ total: 100, remaining: 60, usedPct: 40 });
    expect(json.period).toEqual({
      start: '2026-10-01T00:00:00Z',
      end: '2026-12-01T00:00:00Z',
    });
    expect(
      buildSubscriptionStatusViewModel(result.data, result.diagnostics).codingPlanSection?.credits,
    ).toBe('60 / 100');
    expect(
      api.callFlatApi.mock.calls.filter(([call]) => call.action === 'QuerySubscriptionGray'),
    ).toHaveLength(1);
    expect(
      api.callFlatApi.mock.calls.filter(
        ([call]) =>
          call.action === 'DescribeFrInstances' &&
          call.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams,
      ),
    ).toHaveLength(1);
    expect(
      api.callFlatApi.mock.calls.filter(
        ([call]) =>
          call.action === 'DescribeFrInstances' &&
          call.params?.CommodityCode === site.features.tokenPlanCommodityCodes.personal,
      ),
    ).toHaveLength(1);
    expect(api.callFlatApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CheckInstancesRenewable' }),
    );
  });

  it.each([
    {
      isGray: false,
      plan: undefined,
      expected: { total: 100, remaining: 0, usedPct: 100 },
      requests: 1,
    },
    { isGray: true, plan: undefined, expected: null, requests: 0 },
    { isGray: false, plan: 'coding' as const, expected: null, requests: 0 },
    { isGray: false, plan: 'token' as const, expected: null, requests: 0 },
  ])(
    'uses historical personal FR only for the default non-gray quota: $isGray/$plan',
    async ({ isGray, plan, expected, requests }) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'QuerySubscriptionGray') return { IsGray: isGray };
        if (options.action === 'GetSubscriptionDetail')
          return { Data: [{ InstanceId: 'mock-coding', Status: 'VALID' }] };
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.personal
        )
          return {
            TotalCount: 1,
            Data: [
              {
                InstanceId: 'mock-historical-personal',
                CommodityCode: site.features.tokenPlanCommodityCodes.personal,
                Status: 'valid',
                InitCapacityBaseValue: '100',
                CurrCapacityBaseValue: '60',
                CapacityTypeCode: 'periodMonthlyShift',
                periodCapacityBaseValue: '0',
              },
            ],
          };
        return original(options);
      });
      const result = await api.service.getStatus({ plan });
      expect(result.data?.quota).toEqual(expected);
      expect(
        api.callFlatApi.mock.calls.filter(
          ([call]) =>
            call.action === 'DescribeFrInstances' &&
            call.params?.CommodityCode === site.features.tokenPlanCommodityCodes.personal,
        ),
      ).toHaveLength(requests);
      if (plan === 'coding') expect(api.callCsDataApi).not.toHaveBeenCalled();
      if (plan === 'token')
        expect(api.callFlatApi).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: 'GetSubscriptionDetail' }),
        );
    },
  );

  it.each([
    { Data: [], TotalCount: 0 },
    { Data: [{ InstanceId: 'mock-expired-coding', Status: 'EXPIRED' }], TotalCount: 1 },
    {
      Data: {
        SubscriptionList: [{ InstanceId: 'mock-expired-coding', Status: 'EXPIRED' }],
        TotalCount: 1,
      },
    },
  ])(
    'succeeds for confirmed empty or expired Coding lists without querying Token Plan: %j',
    async (response) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) =>
        options.action === 'GetSubscriptionDetail' ? response : original(options),
      );
      const result = await api.service.getStatus({ plan: 'coding' });
      expect(result).toEqual({
        data: {
          isGray: true,
          plan: null,
          period: null,
          quota: null,
          autoRenew: null,
          renewable: null,
          remainingDays: null,
          seatTiers: [],
          creditPacks: [],
          codingPlanStatus: null,
          recentOrders: [],
        },
        diagnostics: [],
      });
      expect(api.callCsDataApi).not.toHaveBeenCalled();
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DescribeFrInstances' }),
      );
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CheckInstancesRenewable' }),
      );
    },
  );

  it.each([
    { response: { Data: [{ Status: 'UNKNOWN' }], TotalCount: 1 }, code: 'UnconfirmedState' },
    { response: { Data: [{ Status: 'EXPIRED' }], TotalCount: 2 }, code: 'IncompleteInstances' },
    {
      response: { Data: [{ Status: 'EXPIRED' }], TotalCount: 1, Success: false },
      code: 'InvalidResponse',
    },
    { response: { Data: [], TotalCount: 1 }, code: 'IncompleteInstances' },
    { response: { Data: [null], TotalCount: 1 }, code: 'InvalidInstances' },
    { response: { Data: null }, code: 'InvalidInstances' },
  ])(
    'retains protocol diagnostics for incomplete or failed Coding responses: $code',
    async ({ response, code }) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) =>
        options.action === 'GetSubscriptionDetail' ? response : original(options),
      );
      const result = await api.service.getStatus({ plan: 'coding' });
      expect(result.data).toBeNull();
      expect(result.failureExitCode).toBe(4);
      expect(result.diagnostics).toEqual([
        {
          api: 'GetSubscriptionDetail',
          errorCode: code,
          errorMessage: 'The response could not be verified. Try again later.',
        },
      ]);
      expect(api.callCsDataApi).not.toHaveBeenCalled();
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DescribeFrInstances' }),
      );
    },
  );

  it('preserves a confirmed valid Coding instance despite unknown peers or incomplete pagination', async () => {
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) =>
      options.action === 'GetSubscriptionDetail'
        ? {
            Data: [{ InstanceId: 'mock-coding', Status: 'VALID' }, { Status: 'UNKNOWN' }],
            TotalCount: 3,
          }
        : original(options),
    );
    const result = await api.service.getStatus({ plan: 'coding' });
    expect(result.data?.codingPlanStatus).toBe('VALID');
    expect(result.failureExitCode).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ api: 'GetSubscriptionDetail', errorCode: 'IncompleteInstances' }),
    );
  });

  it.each([
    { code: 'AUTH_REQUIRED', exit: 2, diagnostic: 'AUTH_REQUIRED' },
    { code: 'ServiceUnavailable', exit: 1, diagnostic: 'SERVICE_UNAVAILABLE' },
  ])(
    'classifies Coding business failures without trusting valid instances in failed responses: $code',
    async ({ code, exit, diagnostic }) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) =>
        options.action === 'GetSubscriptionDetail'
          ? { Data: [{ InstanceId: 'mock-coding', Status: 'VALID' }], Code: code, Success: false }
          : original(options),
      );
      const result = await api.service.getStatus({ plan: 'coding' });
      expect(result.data).toBeNull();
      expect(result.failureExitCode).toBe(exit);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ api: 'GetSubscriptionDetail', errorCode: diagnostic }),
      );
      expect(api.callCsDataApi).not.toHaveBeenCalled();
    },
  );

  function unknownEditionsApi(seat: unknown, summary: unknown) {
    const api = apiClient();
    const failure = new CliError({
      code: 'NETWORK_ERROR',
      message: 'Mock unavailable',
      exitCode: 3,
    });
    api.callCsDataApi.mockRejectedValue(failure);
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'GetSeatSubscriptionSummary') return { Data: seat };
      if (options.action === 'GetSubscriptionSummary') return { Data: summary };
      if (options.action === 'GetSubscriptionDetail') throw failure;
      if (
        options.action === 'DescribeFrInstances' &&
        options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
      )
        throw failure;
      return original(options);
    });
    return api;
  }

  it.each([
    { seat: {}, summary: { TotalCount: 2 } },
    { seat: {}, summary: { TotalCount: 0 } },
    {
      seat: { SubscriptionGroupList: [{ SpecType: 'standard', SubscriptionTotalNumber: 1 }] },
      summary: {},
    },
    {
      seat: { SubscriptionGroupList: [{ SpecType: 'standard', SubscriptionAssignedNumber: 2 }] },
      summary: {},
    },
    {
      seat: { SubscriptionGroupList: [{ SpecType: 'standard', SubscriptionAssignedNumber: 0 }] },
      summary: {},
    },
    { seat: { StartTime: '2026-10-01T00:00:00Z', EndTime: '2026-12-01T00:00:00Z' }, summary: {} },
  ])(
    'preserves validated team summaries or periods when instances are unknown: %j',
    async ({ seat, summary }) => {
      const api = unknownEditionsApi(seat, summary);
      const aggregate = await api.service.getStatus({ plan: 'token' });
      const dedicated = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus();
      const combined = await api.service.getStatus();
      expect(aggregate.failureExitCode).toBeUndefined();
      expect(combined.failureExitCode).toBeUndefined();
      expect(aggregate.data?.individual?.status).toBe('unknown');
      expect(dedicated.team).toBeDefined();
      const { seatDetails, ...expectedTeam } = dedicated.team!;
      expect(seatDetails).toEqual({
        ...emptySeatDetails,
        totalCount: null,
        collectionCompleteness: 'unknown',
        completeness: 'unknown',
        diagnostics: [
          {
            api: 'GetSubscriptionDetail',
            errorCode: 'NETWORK_ERROR',
            errorMessage: 'The service could not be reached. Check your network connection.',
          },
        ],
      });
      expect(aggregate.data?.team).not.toHaveProperty('seatDetails');
      expect(combined.data?.team).not.toHaveProperty('seatDetails');
      expect(aggregate.data?.team).toEqual(expectedTeam);
      expect(combined.data?.team).toEqual(expectedTeam);
      expect(aggregate.data?.team?.status).toBe('unknown');
      expect(aggregate.diagnostics).toContainEqual(
        expect.objectContaining({ api: SUBSCRIPTION, errorCode: 'NETWORK_ERROR' }),
      );
      expect(aggregate.diagnostics).toContainEqual(
        expect.objectContaining({ api: 'DescribeFrInstances', errorCode: 'NETWORK_ERROR' }),
      );
      expect(aggregate.diagnostics).not.toContainEqual(
        expect.objectContaining({ api: 'CheckInstancesRenewable' }),
      );
      expect(aggregate.diagnostics).not.toContainEqual(
        expect.objectContaining({ api: 'TokenPlan' }),
      );
      expect(combined.diagnostics).not.toContainEqual(
        expect.objectContaining({ api: 'TokenPlan' }),
      );
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CheckInstancesRenewable' }),
      );
    },
  );

  it.each([
    { seat: {}, summary: {} },
    { seat: { SubscriptionGroupList: [{ SpecType: 'standard' }] }, summary: { TotalCount: null } },
    { seat: { StartTime: 'bad', EndTime: 'bad' }, summary: { TotalCount: -1 } },
    { seat: { StartTime: '2026-12-01T00:00:00Z', EndTime: '2026-10-01T00:00:00Z' }, summary: {} },
    {
      seat: { SubscriptionGroupList: [{ SpecType: 'standard', SubscriptionAssignedNumber: -1 }] },
      summary: {},
    },
    {
      seat: { SubscriptionGroupList: [{ SpecType: 'standard', SubscriptionAssignedNumber: 1.5 }] },
      summary: {},
    },
    {
      seat: { SubscriptionGroupList: [{ SpecType: 'standard', SubscriptionAssignedNumber: '2' }] },
      summary: {},
    },
  ])(
    'keeps empty summaries, invalid periods and renewal-only data from masking total failure: %j',
    async ({ seat, summary }) => {
      const api = unknownEditionsApi(seat, summary);
      const result = await api.service.getStatus({ plan: 'token' });
      expect(result.data).toBeNull();
      expect(result.failureExitCode).toBe(3);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ api: SUBSCRIPTION }));
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ api: 'DescribeFrInstances' }),
      );
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ api: 'CheckInstancesRenewable' }),
      );
    },
  );

  it.each(
    [true, false].flatMap((gray) =>
      ['normal', 'expired', 'empty'].flatMap((coding) =>
        [1, 2].flatMap((instances) =>
          [undefined, 'coding' as const].map((plan) => ({ gray, coding, instances, plan })),
        ),
      ),
    ),
  )(
    'preserves legacy name sources and query isolation: gray=$gray / coding=$coding / instances=$instances / plan=$plan',
    async ({ gray, coding, instances, plan }) => {
      const api = seatContractApi([]);
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'QuerySubscriptionGray') return { IsGray: gray };
        if (options.action === 'GetSubscriptionDetail') {
          const rows =
            coding === 'empty'
              ? []
              : [
                  {
                    InstanceCode: 'mock-coding',
                    ProductCode: site.features.codingPlanCommodityCode,
                    Status: coding === 'normal' ? 'NORMAL' : 'EXPIRED',
                  },
                ];
          return { Data: rows, TotalCount: rows.length };
        }
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
        )
          return {
            Data:
              instances === 1
                ? [
                    {
                      InstanceId: 'mock-team-first',
                      CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                      Status: 'valid',
                      TemplateName: 'Mock FR First',
                      InitCapacityBaseValue: '100',
                      CurrCapacityBaseValue: '60',
                    },
                  ]
                : [
                    {
                      InstanceId: 'mock-team-first',
                      CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                      Status: 'valid',
                      TemplateName: 'Mock FR First',
                      InitCapacityBaseValue: '100',
                      CurrCapacityBaseValue: '60',
                    },
                    {
                      InstanceId: 'mock-team-second',
                      CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                      Status: 'valid',
                      TemplateName: 'Mock FR Second',
                      InitCapacityBaseValue: '300',
                      CurrCapacityBaseValue: '80',
                    },
                  ],
            TotalCount: instances,
          };
        if (options.action === 'CheckInstancesRenewable')
          return {
            Data: [
              {
                InstanceId: options.params?.['instanceIdentities.1.InstanceId'],
                CommodityCode: options.params?.['instanceIdentities.1.CommodityCode'],
                CanRenew: true,
              },
            ],
          };
        return original(options);
      });
      const result = await api.service.getStatus({ plan });
      expect(result.data?.plan).toBe(
        plan === 'coding' ? null : gray ? 'Token Plan' : 'Mock FR First',
      );
      expect(result.data?.codingPlanStatus).toBeNull();
      expect(result.failureExitCode).toBeUndefined();
      expect(result.data?.quota).toEqual(
        plan === 'coding' || gray ? null : { total: 100, remaining: 60, usedPct: 40 },
      );
      if (plan === 'coding') {
        expect(api.callCsDataApi).not.toHaveBeenCalled();
        expect(api.callFlatApi).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: 'DescribeFrInstances' }),
        );
      } else {
        expect(result.data?.team?.name).toBe(instances === 1 ? 'Mock FR First' : null);
      }
    },
  );

  it.each(['coding', 'seat'])('preserves gray legacy name precedence: %s', async (nameSource) => {
    const api = seatContractApi([]);
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'GetSeatSubscriptionSummary')
        return { Data: { PlanName: 'Mock Seat Plan', SubscriptionGroupList: [] } };
      if (options.action === 'GetSubscriptionDetail' && nameSource === 'seat')
        return { Data: [], TotalCount: 0 };
      return original(options);
    });
    const result = await api.service.getStatus();
    expect(result.data?.plan).toBe(nameSource === 'coding' ? 'Coding Plan Pro' : 'Mock Seat Plan');
    expect(result.data?.team?.name).toBe('Mock Seat Plan');
  });

  it.each(['network', 'protocol'])(
    'does not fill names or fall back to team FR after gray seat reads fail: %s',
    async (failure) => {
      const api = seatContractApi([]);
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'GetSubscriptionDetail') return { Data: [], TotalCount: 0 };
        if (options.action === 'GetSeatSubscriptionSummary')
          throw new CliError({
            code: failure === 'network' ? 'NETWORK_ERROR' : 'PROTOCOL_ERROR',
            message: 'Mock seat unavailable',
            exitCode: failure === 'network' ? 3 : 4,
          });
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
        )
          return {
            TotalCount: 1,
            Data: [
              {
                InstanceId: 'mock-team',
                CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                Status: 'valid',
                TemplateName: 'Mock FR Name',
                InitCapacityBaseValue: '100',
                CurrCapacityBaseValue: '60',
              },
            ],
          };
        return original(options);
      });
      const result = await api.service.getStatus();
      expect(result.data?.plan).toBeNull();
      expect(result.data?.quota).toBeNull();
      expect(result.data?.team?.name).toBe('Mock FR Name');
      expect(result.failureExitCode).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          api: 'GetSeatSubscriptionSummary',
          errorCode: failure === 'network' ? 'NETWORK_ERROR' : 'PROTOCOL_ERROR',
        }),
      );
    },
  );

  it.each(
    [true, false].flatMap((gray) => [undefined, 'token' as const].map((plan) => ({ gray, plan }))),
  )(
    'reports team query timeouts as dependency failures without false renewal failures: gray=$gray / plan=$plan',
    async ({ gray, plan }) => {
      useTimedClock();
      const api = seatContractApi([]);
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'QuerySubscriptionGray') return { IsGray: gray };
        if (options.action === 'QueryAvailableInstances') return confirmedPersonalRenewal;
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
        )
          return new Promise<unknown>(() => {});
        return original(options);
      });
      const pending = api.service.getStatus({ plan });
      await vi.advanceTimersByTimeAsync(35000);
      const result = await pending;
      expect(result.failureExitCode).toBeUndefined();
      expect(result.data?.individual?.status).toBe('active');
      expect(result.data?.team?.status).toBe('unknown');
      expect(result.data?.team?.renewable).toBeNull();
      expect(result.diagnostics).toEqual([
        {
          api: 'DescribeFrInstances',
          errorCode: 'NETWORK_ERROR',
          errorMessage: 'The service could not be reached. Check your network connection.',
        },
      ]);
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CheckInstancesRenewable' }),
      );
      expect(
        api.callFlatApi.mock.calls.filter(
          ([call]) =>
            call.action === 'DescribeFrInstances' &&
            call.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams,
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    { code: 'NETWORK_ERROR', exitCode: 3 },
    { code: 'AUTH_REQUIRED', exitCode: 2 },
    { code: 'PROTOCOL_ERROR', exitCode: 4 },
  ] as const)(
    'does not attribute team dependency failures to the renewal API: $code',
    async ({ code, exitCode }) => {
      const api = seatContractApi([]);
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'QueryAvailableInstances') return confirmedPersonalRenewal;
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
        )
          throw new CliError({ code, message: 'Mock team unavailable', exitCode });
        return original(options);
      });
      const result = await api.service.getStatus({ plan: 'token' });
      expect(result.data?.team?.status).toBe('unknown');
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ api: 'DescribeFrInstances', errorCode: code }),
      ]);
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CheckInstancesRenewable' }),
      );
    },
  );

  it.each([
    { code: 'NETWORK_ERROR', exitCode: 3 },
    { code: 'AUTH_REQUIRED', exitCode: 2 },
    { code: 'PROTOCOL_ERROR', exitCode: 4 },
    { code: 'timeout', exitCode: 3 },
  ] as const)(
    'attributes failures after an actual renewal request to the renewal API: $code',
    async ({ code, exitCode }) => {
      useTimedClock();
      const api = seatContractApi([]);
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'QueryAvailableInstances') return confirmedPersonalRenewal;
        if (options.action === 'CheckInstancesRenewable') {
          if (code === 'timeout') return new Promise<unknown>(() => {});
          throw new CliError({ code, message: 'Mock renewal unavailable', exitCode });
        }
        return original(options);
      });
      const pending = api.service.getStatus({ plan: 'token' });
      await vi.advanceTimersByTimeAsync(code === 'timeout' ? 35000 : 1);
      const result = await pending;
      expect(result.data?.team?.status).toBe('active');
      expect(result.data?.team?.renewable).toBeNull();
      expect(result.failureExitCode).toBeUndefined();
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          api: 'CheckInstancesRenewable',
          errorCode: code === 'timeout' ? 'Timeout' : code,
        }),
      ]);
      expect(
        api.callFlatApi.mock.calls.filter(([call]) => call.action === 'CheckInstancesRenewable'),
      ).toHaveLength(1);
    },
  );

  it.each(
    ['flat', 'nested'].flatMap((shape) =>
      ['success', 'network', 'auth', 'protocol', 'timeout'].map((renewal) => ({ shape, renewal })),
    ),
  )(
    'preserves NORMAL-only core results despite auxiliary renewal failures: $shape / $renewal',
    async ({ shape, renewal }) => {
      useTimedClock();
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      const instances = [
        {
          InstanceCode: 'mock-coding-normal',
          Status: 'NORMAL',
          ProductCode: site.features.codingPlanCommodityCode,
        },
      ];
      const errorCodes = {
        network: 'NETWORK_ERROR',
        auth: 'AUTH_REQUIRED',
        protocol: 'PROTOCOL_ERROR',
      };
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'GetSubscriptionDetail')
          return {
            Data: shape === 'flat' ? instances : { SubscriptionList: instances, TotalCount: 1 },
            TotalCount: 1,
          };
        if (options.action === 'CheckInstancesRenewable') {
          if (renewal === 'timeout') return new Promise<unknown>(() => {});
          if (renewal === 'network' || renewal === 'auth' || renewal === 'protocol')
            throw new CliError({
              code: errorCodes[renewal],
              message: 'Mock renewal unavailable',
              exitCode: renewal === 'auth' ? 2 : renewal === 'protocol' ? 4 : 3,
            });
          return { Data: [{ CanRenew: true }] };
        }
        return original(options);
      });
      const pending = api.service.getStatus({ plan: 'coding' });
      await vi.advanceTimersByTimeAsync(renewal === 'timeout' ? 35000 : 1);
      const result = await pending;
      expect(result.data).toEqual({
        isGray: true,
        plan: null,
        period: null,
        quota: null,
        autoRenew: null,
        renewable: renewal === 'success' ? true : null,
        remainingDays: null,
        seatTiers: [],
        creditPacks: [],
        codingPlanStatus: null,
        recentOrders: [],
      });
      expect(result.failureExitCode).toBeUndefined();
      expect(result.diagnostics).toEqual(
        renewal === 'success'
          ? []
          : [
              expect.objectContaining({
                api: 'CheckInstancesRenewable',
                errorCode:
                  renewal === 'timeout'
                    ? 'NETWORK_ERROR'
                    : errorCodes[renewal as keyof typeof errorCodes],
              }),
            ],
      );
      expect(api.callCsDataApi).not.toHaveBeenCalled();
      expect(
        api.callFlatApi.mock.calls.filter(([call]) => call.action === 'GetSubscriptionDetail'),
      ).toHaveLength(1);
      expect(
        api.callFlatApi.mock.calls.filter(([call]) => call.action === 'CheckInstancesRenewable'),
      ).toEqual([
        [
          {
            product: 'BssOpenAPI-V3',
            action: 'CheckInstancesRenewable',
            signal: expect.any(AbortSignal),
            params: {
              'instanceIdentities.1.InstanceId': 'mock-coding-normal',
              'instanceIdentities.1.CommodityCode': site.features.codingPlanCommodityCode,
              'instanceIdentities.1.ResourceType': 'subscription',
            },
          },
        ],
      ]);
    },
  );

  it.each([
    { rows: [{ Status: 'NORMAL' }, { Status: 'UNKNOWN' }], total: 2, code: 'UnconfirmedState' },
    { rows: [{ Status: 'NORMAL' }], total: 2, code: 'IncompleteInstances' },
    { rows: [{ Status: 'UNKNOWN' }], total: 1, code: 'UnconfirmedState' },
  ])(
    'still fails for incomplete or unknown Coding core results: $code',
    async ({ rows, total, code }) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'GetSubscriptionDetail') return { Data: rows, TotalCount: total };
        if (options.action === 'CheckInstancesRenewable')
          throw new CliError({
            code: 'PROTOCOL_ERROR',
            message: 'Mock renewal unavailable',
            exitCode: 4,
          });
        return original(options);
      });
      const result = await api.service.getStatus({ plan: 'coding' });
      expect(result.data).toBeNull();
      expect(result.failureExitCode).toBe(4);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ api: 'GetSubscriptionDetail', errorCode: code }),
      );
    },
  );

  it.each(
    [SUBSCRIPTION, QUOTA, USAGE].flatMap((stalled) =>
      [true, false].flatMap((gray) =>
        [undefined, 'token' as const].map((plan) => ({ stalled, gray, plan })),
      ),
    ),
  )(
    'completes team renewal independently when personal queries stall: $stalled / gray=$gray / plan=$plan',
    async ({ stalled, gray, plan }) => {
      useTimedClock();
      const api = seatContractApi([]);
      const originalCs = api.callCsDataApi.getMockImplementation()!;
      api.callCsDataApi.mockImplementation(async (options: CsCall) =>
        options.api === stalled ? new Promise<unknown>(() => {}) : originalCs(options),
      );
      const originalFlat = api.callFlatApi.getMockImplementation()!;
      const renewalAborted: boolean[] = [];
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'QuerySubscriptionGray') return { IsGray: gray };
        if (options.action === 'CheckInstancesRenewable') {
          renewalAborted.push(options.signal?.aborted ?? true);
          options.signal?.throwIfAborted();
          return {
            Data: [
              {
                InstanceId: 'mock-team-instance',
                CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                CanRenew: true,
              },
            ],
          };
        }
        return originalFlat(options);
      });
      const pending = api.service.getStatus({ plan });
      await vi.advanceTimersByTimeAsync(1);
      const completedBeforeTimeout = renewalAborted.slice();
      await vi.advanceTimersByTimeAsync(34999);
      const result = await pending;
      expect(completedBeforeTimeout).toEqual([false]);
      expect(renewalAborted).toEqual([false]);
      expect(result.data?.team?.renewable).toEqual({ canRenew: true, interceptCode: null });
      expect(result.data?.individual?.status).toBe(stalled === SUBSCRIPTION ? 'unknown' : 'active');
      expect(result.failureExitCode).toBeUndefined();
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ api: 'CheckInstancesRenewable' }),
      );
      expect(
        api.callFlatApi.mock.calls.filter(
          ([call]) =>
            call.action === 'DescribeFrInstances' &&
            call.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams,
        ),
      ).toEqual([
        [
          {
            product: 'BssOpenAPI-V3',
            action: 'DescribeFrInstances',
            signal: expect.any(AbortSignal),
            params: {
              Group: 'tokenPlan',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              PageNum: 1,
              PageSize: 100,
            },
          },
        ],
      ]);
      expect(
        api.callFlatApi.mock.calls.filter(([call]) => call.action === 'CheckInstancesRenewable'),
      ).toEqual([
        [
          {
            product: 'BssOpenAPI-V3',
            action: 'CheckInstancesRenewable',
            signal: expect.any(AbortSignal),
            params: {
              'instanceIdentities.1.InstanceId': 'mock-team-instance',
              'instanceIdentities.1.CommodityCode': site.features.tokenPlanCommodityCodes.teams,
              'instanceIdentities.1.ResourceType': 'subscription',
            },
          },
        ],
      ]);
      const dedicated = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
        edition: 'team',
      });
      expect(dedicated.team).toBeDefined();
      const { seatDetails, ...expectedTeam } = dedicated.team!;
      expect(seatDetails).toEqual(mismatchedSeatDetails);
      expect(result.data?.team).not.toHaveProperty('seatDetails');
      expect(result.data?.team).toEqual(expectedTeam);
    },
  );

  it.each(['multiple', 'empty', 'failure'])(
    'does not request renewal without a unique team instance: %s',
    async (state) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (
          options.action === 'DescribeFrInstances' &&
          options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams
        ) {
          if (state === 'failure') throw new Error('Mock team unavailable');
          const rows =
            state === 'multiple'
              ? [
                  {
                    InstanceId: 'mock-team-one',
                    CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                    Status: 'valid',
                  },
                  {
                    InstanceId: 'mock-team-two',
                    CommodityCode: site.features.tokenPlanCommodityCodes.teams,
                    Status: 'valid',
                  },
                ]
              : [];
          return { Data: rows, TotalCount: rows.length };
        }
        return original(options);
      });
      const result = await api.service.getStatus({ plan: 'token' });
      expect(result.data?.team?.status).toBe(
        state === 'multiple' ? 'active' : state === 'empty' ? 'not_subscribed' : 'unknown',
      );
      expect(result.data?.team?.renewable).toBeNull();
      expect(
        api.callFlatApi.mock.calls.filter(
          ([call]) =>
            call.action === 'DescribeFrInstances' &&
            call.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams,
        ),
      ).toHaveLength(1);
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CheckInstancesRenewable' }),
      );
    },
  );

  it.each(['token', 'coding'] as const)(
    'does not start late renewal requests after cancellation: %s',
    async (plan) => {
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      const controller = new AbortController();
      let finish: (value: unknown) => void = () => {};
      let started: () => void = () => {};
      const queryStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (
          (plan === 'coding' && options.action === 'GetSubscriptionDetail') ||
          (plan === 'token' &&
            options.action === 'DescribeFrInstances' &&
            options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams)
        ) {
          started();
          return new Promise<unknown>((resolve) => {
            finish = resolve;
          });
        }
        return original(options);
      });
      const pending = api.service.getStatus({ plan, signal: controller.signal });
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await queryStarted;
      controller.abort(new DOMException('Mock user cancellation', 'AbortError'));
      finish({
        Data: [
          {
            InstanceId: 'mock-late-instance',
            InstanceCode: 'mock-late-instance',
            CommodityCode: site.features.tokenPlanCommodityCodes.teams,
            ProductCode: site.features.codingPlanCommodityCode,
            Status: plan === 'coding' ? 'NORMAL' : 'valid',
          },
        ],
        TotalCount: 1,
      });
      await rejected;
      await new Promise<void>((resolve) => process.nextTick(resolve));
      expect(api.callFlatApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CheckInstancesRenewable' }),
      );
    },
  );

  it('keeps team and Coding renewal queries and legacy quotas independent of historical personal FR timeouts', async () => {
    useTimedClock();
    const api = seatContractApi([]);
    const original = api.callFlatApi.getMockImplementation()!;
    let renewSignal: AbortSignal | undefined;
    let codingRenewSignal: AbortSignal | undefined;
    let markRenewed: () => void = () => {};
    const renewed = new Promise<void>((resolve) => {
      markRenewed = resolve;
    });
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'QuerySubscriptionGray') return { IsGray: false };
      if (options.action === 'GetSubscriptionDetail')
        return {
          Data: [
            { InstanceId: 'mock-coding', Status: 'VALID' },
            {
              InstanceCode: 'mock-coding-renewal',
              Status: 'NORMAL',
              ProductCode: site.features.codingPlanCommodityCode,
            },
          ],
        };
      if (
        options.action === 'DescribeFrInstances' &&
        options.params?.CommodityCode === site.features.tokenPlanCommodityCodes.personal
      )
        return new Promise<unknown>(() => {});
      if (options.action === 'CheckInstancesRenewable') {
        if (
          options.params?.['instanceIdentities.1.CommodityCode'] ===
          site.features.codingPlanCommodityCode
        ) {
          codingRenewSignal = options.signal;
          options.signal?.throwIfAborted();
          return { Data: [{ CanRenew: false }] };
        }
        renewSignal = options.signal;
        options.signal?.throwIfAborted();
        markRenewed();
        return {
          Data: [
            {
              InstanceId: 'mock-team-instance',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              CanRenew: true,
            },
          ],
        };
      }
      return original(options);
    });
    const pending = api.service.getStatus();
    await vi.advanceTimersByTimeAsync(1);
    await renewed;
    expect(renewSignal?.aborted).toBe(false);
    expect(codingRenewSignal?.aborted).toBe(false);
    expect(codingRenewSignal).toBeDefined();
    await vi.advanceTimersByTimeAsync(34999);
    const result = await pending;
    expect(result.data?.team?.status).toBe('active');
    expect(result.data?.team?.renewable).toEqual({ canRenew: true, interceptCode: null });
    expect(result.data?.renewable).toBe(false);
    expect(result.data?.codingPlanStatus).toBe('VALID');
    expect(result.data?.quota).toEqual({ total: 200, remaining: 150, usedPct: 25 });
    expect(result.failureExitCode).toBeUndefined();
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ api: 'CheckInstancesRenewable' }),
    );
  });

  it('preserves confirmed Coding subscriptions and records one renewal diagnostic on renewal timeout', async () => {
    useTimedClock();
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'GetSubscriptionDetail')
        return {
          Data: [
            { InstanceId: 'mock-coding', Status: 'VALID' },
            {
              InstanceCode: 'mock-coding-renewal',
              Status: 'NORMAL',
              ProductCode: site.features.codingPlanCommodityCode,
            },
          ],
        };
      if (options.action === 'CheckInstancesRenewable') return new Promise<unknown>(() => {});
      return original(options);
    });
    const pending = api.service.getStatus({ plan: 'coding' });
    await vi.advanceTimersByTimeAsync(35000);
    const result = await pending;
    expect(result.data?.codingPlanStatus).toBe('VALID');
    expect(result.data?.quota).toBeNull();
    expect(result.data?.renewable).toBeNull();
    expect(result.failureExitCode).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        api: 'CheckInstancesRenewable',
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'The service could not be reached. Check your network connection.',
      },
    ]);
    expect(api.callCsDataApi).not.toHaveBeenCalled();
    expect(
      api.callFlatApi.mock.calls.filter(([call]) => call.action === 'GetSubscriptionDetail'),
    ).toHaveLength(1);
    expect(
      api.callFlatApi.mock.calls.filter(([call]) => call.action === 'CheckInstancesRenewable'),
    ).toHaveLength(1);
  });

  it('returns confirmed editions within the shared budget when recent orders remain pending', async () => {
    useTimedClock();
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    let orderSignal: AbortSignal | undefined;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'QueryOrderList') {
        orderSignal = options.signal;
        markStarted();
        return new Promise<unknown>(() => {});
      }
      return original(options);
    });

    const pending = api.service.getStatus({ plan: 'token' });
    await started;
    await vi.advanceTimersByTimeAsync(35000);
    const result = await pending;

    expect(result.data?.individual).toMatchObject({
      edition: 'individual',
      status: 'active',
      specCode: 'lite',
      endAt: '2026-11-20T00:00:00.000Z',
    });
    expect(result.data?.team?.status).toBe('not_subscribed');
    expect(result.data?.recentOrders).toEqual([]);
    expect(result.failureExitCode).toBeUndefined();
    expect(orderSignal?.aborted).toBe(true);
  });

  it('preserves confirmed active core and the completed team when personal supplements exceed the shared budget', async () => {
    useTimedClock();
    const api = apiClient();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options: CsCall) => {
      if (options.api === USAGE || options.api === QUOTA) return new Promise<unknown>(() => {});
      return original(options);
    });

    const pending = api.service.getStatus({ plan: 'token' });
    await vi.advanceTimersByTimeAsync(35000);
    const result = await pending;

    expect(result.data?.individual).toMatchObject({
      edition: 'individual',
      status: 'active',
      specCode: 'lite',
      endAt: '2026-11-20T00:00:00.000Z',
      remainingDays: 22,
      completeness: 'partial',
      tiers: [],
    });
    expect(result.data?.team?.status).toBe('not_subscribed');
    expect(result.data?.individual?.weeklyCredits).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ api: USAGE }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ api: QUOTA }));
    expect(result.failureExitCode).toBeUndefined();
  });

  it('includes the active personal edition with the same fields as the dedicated status service', async () => {
    const api = apiClient();

    const aggregate = await api.service.getStatus({ plan: 'token' });
    const dedicated = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(aggregate.data?.individual).toEqual(dedicated.individual);
    expect(aggregate.data?.individual).toMatchObject({
      edition: 'individual',
      status: 'active',
      specCode: 'lite',
      endAt: '2026-11-20T00:00:00.000Z',
      weeklyCredits: {
        total: 200,
        used: null,
        remaining: null,
        usedPct: 25,
        resetTime: '2026-10-30T00:00:00.000Z',
      },
    });
    expect(aggregate.data?.team?.status).toBe('not_subscribed');
    expect(aggregate.data?.quota).toBeNull();
    expect(aggregate.failureExitCode).toBeUndefined();
    expect(api.callCsDataApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ api: expect.stringMatching(/harness|humanInfo/i) }),
    );
  });

  it('includes a confirmed personal no-subscription state without issuing usage and quota queries', async () => {
    const api = apiClient();
    api.callCsDataApi.mockImplementation(async (options: CsCall) =>
      options.parse({ code: 'SUCCESS', success: true }),
    );

    const result = await api.service.getStatus({ plan: 'token' });

    expect(result.data?.individual).toMatchObject({
      edition: 'individual',
      status: 'not_subscribed',
      period: null,
      autoRenew: null,
    });
    expect(api.callCsDataApi).toHaveBeenCalledTimes(1);
    expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: SUBSCRIPTION }));
    expect(result.failureExitCode).toBeUndefined();
  });

  it('preserves active personal core fields and partial diagnostics after the usage supplement fails', async () => {
    const api = apiClient();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options: CsCall) => {
      if (options.api === USAGE) throw new Error('Mock usage service unavailable');
      return original(options);
    });

    const result = await api.service.getStatus({ plan: 'token' });

    expect(result.data?.individual).toMatchObject({
      edition: 'individual',
      status: 'active',
      specCode: 'lite',
      endAt: '2026-11-20T00:00:00.000Z',
      remainingDays: 22,
      completeness: 'partial',
      tiers: [],
    });
    expect(result.data?.individual?.weeklyCredits).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ api: USAGE }));
    expect(result.failureExitCode).toBeUndefined();
  });

  it('preserves personal unknown independently when team non-subscription is confirmed', async () => {
    const api = apiClient();
    api.callCsDataApi.mockRejectedValue(new Error('Mock personal subscription unavailable'));

    const result = await api.service.getStatus({ plan: 'token' });

    expect(result.data?.individual?.status).toBe('unknown');
    expect(result.data?.team?.status).toBe('not_subscribed');
    expect(result.data?.individual?.diagnostics).toContainEqual(
      expect.objectContaining({ api: SUBSCRIPTION }),
    );
    expect(result.failureExitCode).toBeUndefined();
  });

  it('returns unavailable data and classifies failure without inventing non-subscription when all sources fail', async () => {
    const api = apiClient();
    const failure = new CliError({
      code: 'NETWORK_ERROR',
      message: 'Mock network unavailable',
      exitCode: 3,
    });
    api.callCsDataApi.mockRejectedValue(failure);
    api.callFlatApi.mockRejectedValue(failure);

    const result = await api.service.getStatus({ plan: 'token' });

    expect(result.data).toBeNull();
    expect(result.failureExitCode).toBe(3);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('does not treat successful gray metadata as subscription success when every business source fails', async () => {
    const api = apiClient();
    const failure = new CliError({
      code: 'NETWORK_ERROR',
      message: 'Mock business source unavailable',
      exitCode: 3,
    });
    api.callCsDataApi.mockRejectedValue(failure);
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'QuerySubscriptionGray') return { IsGray: true };
      throw failure;
    });

    const result = await api.service.getStatus({ plan: 'token' });

    expect(result.data).toBeNull();
    expect(result.failureExitCode).toBe(3);
    expect(result.diagnostics).toContainEqual({
      api: 'TokenPlan',
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'The service could not be reached. Check your network connection.',
    });
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ api: 'QuerySubscriptionGray' }),
    );
  });

  it('does not request either Token Plan edition when the selected plan is coding', async () => {
    const api = apiClient();

    const result = await api.service.getStatus({ plan: 'coding' });

    expect(result.data).not.toBeNull();
    expect(result.data?.codingPlanStatus).toBeNull();
    expect(result.failureExitCode).toBeUndefined();
    expect(api.callCsDataApi).not.toHaveBeenCalled();
    expect(api.callFlatApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GetSeatSubscriptionSummary' }),
    );
    expect(result.data?.individual).toBeUndefined();
    expect(result.data?.team).toBeUndefined();
  });
});

describe('Independent subscription readers and compatibility projection', () => {
  const codingDetail = {
    Data: [
      {
        InstanceId: 'mock-coding-active',
        Status: 'VALID',
        PlanName: 'Mock Coding Plan',
        StartTime: '2026-10-01T00:00:00+08:00',
        EndTime: '2026-12-01T00:00:00+08:00',
      },
      {
        InstanceCode: 'mock-coding-renewal',
        Status: 'NORMAL',
        ProductCode: site.features.codingPlanCommodityCode,
      },
    ],
    TotalCount: 2,
  };

  it.each(['healthy', 'empty', 'network', 'protocol', 'timeout'] as const)(
    'Token input %s preserves Coding data and request parameters',
    async (state) => {
      if (state === 'timeout') useTimedClock();
      const api = apiClient();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action === 'GetSubscriptionDetail') return codingDetail;
        if (
          options.action === 'CheckInstancesRenewable' &&
          options.params?.['instanceIdentities.1.CommodityCode'] ===
            site.features.codingPlanCommodityCode
        )
          return { Data: [{ CanRenew: true }] };
        if (
          [
            'GetSeatSubscriptionSummary',
            'GetSubscriptionSummary',
            'DescribeFrInstances',
            'CheckTokenPlanAutoRenewal',
          ].includes(options.action)
        ) {
          if (state === 'network')
            throw new CliError({ code: 'NETWORK_ERROR', message: 'Mock read failed', exitCode: 3 });
          if (state === 'protocol') return { Success: false, Code: 'MockInvalid' };
        }
        return original(options);
      });
      if (state === 'empty') api.responses[SUBSCRIPTION] = null;
      if (state === 'network' || state === 'protocol')
        api.callCsDataApi.mockRejectedValue(
          new CliError({
            code: 'NETWORK_ERROR',
            message: 'Mock personal read failed',
            exitCode: 3,
          }),
        );
      if (state === 'timeout')
        api.callCsDataApi.mockImplementation(() => new Promise<never>(() => {}));
      const coding = await readCodingSubscription(
        api.client,
        subscriptionAdapter,
        new AbortController().signal,
      );
      const expectedCalls = api.callFlatApi.mock.calls.map(([call]) => ({
        action: call.action,
        params: call.params,
      }));
      api.callFlatApi.mockClear();
      const pending = api.service.getStatus();
      if (state === 'timeout') await vi.advanceTimersByTimeAsync(35000);
      const result = await pending;
      expect(result.data?.codingPlanStatus).toBe(coding.data.detail.activeInstance?.status);
      expect(result.data?.plan).toBe(coding.data.detail.activeInstance?.plan);
      expect(result.data?.period).toEqual(coding.data.detail.activeInstance?.period);
      expect(result.data?.renewable).toBe(coding.data.renewable.renewable);
      expect(result.failureExitCode).toBeUndefined();
      const actualCalls = api.callFlatApi.mock.calls
        .filter(
          ([call]) =>
            call.action === 'GetSubscriptionDetail' ||
            (call.action === 'CheckInstancesRenewable' &&
              call.params?.['instanceIdentities.1.CommodityCode'] ===
                site.features.codingPlanCommodityCode),
        )
        .map(([call]) => ({ action: call.action, params: call.params }));
      expect(actualCalls).toEqual(expectedCalls);
      expect(coding.outcome).toBe('confirmed');
      expect(coding.diagnostics).toEqual([]);
    },
  );

  it.each(['valid', 'expired', 'empty', 'unknown', 'failure', 'incomplete'] as const)(
    'Coding input %s preserves both Token edition nodes',
    async (state) => {
      const api = apiClient();
      const dedicated = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus();
      api.callFlatApi.mockClear();
      api.callCsDataApi.mockClear();
      const original = api.callFlatApi.getMockImplementation()!;
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action !== 'GetSubscriptionDetail') return original(options);
        if (state === 'failure')
          throw new CliError({
            code: 'AUTH_REQUIRED',
            message: 'Mock Coding read failed',
            exitCode: 2,
          });
        const rows =
          state === 'empty'
            ? []
            : [
                {
                  InstanceId: 'mock-coding',
                  Status:
                    state === 'expired' ? 'EXPIRED' : state === 'unknown' ? 'UNKNOWN' : 'VALID',
                },
              ];
        return { Data: rows, TotalCount: state === 'incomplete' ? 2 : rows.length };
      });
      const result = await api.service.getStatus();
      expect(result.data?.individual).toEqual(dedicated.individual);
      expect(dedicated.team).toBeDefined();
      const { seatDetails, ...expectedTeam } = dedicated.team!;
      expect(seatDetails).toEqual(emptySeatDetails);
      expect(result.data?.team).not.toHaveProperty('seatDetails');
      expect(result.data?.team).toEqual(expectedTeam);
      expect(result.failureExitCode).toBeUndefined();
      expect(api.callCsDataApi).toHaveBeenCalledTimes(3);
      expect(
        api.callFlatApi.mock.calls.filter(
          ([call]) =>
            call.action === 'DescribeFrInstances' &&
            call.params?.CommodityCode === site.features.tokenPlanCommodityCodes.teams,
        ),
      ).toHaveLength(1);
    },
  );

  it('successful Coding renewal does not confirm unknown subscription data', async () => {
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'GetSubscriptionDetail')
        return {
          Data: [codingDetail.Data[1], { InstanceId: 'mock-unknown', Status: 'UNKNOWN' }],
          TotalCount: 2,
        };
      if (options.action === 'CheckInstancesRenewable') return { Data: [{ CanRenew: true }] };
      return original(options);
    });
    const read = await readCodingSubscription(
      api.client,
      subscriptionAdapter,
      new AbortController().signal,
    );
    expect(read.data.detail.activeInstance).toBeNull();
    expect(read.data.renewable).toEqual({ renewable: true });
    expect(read.outcome).toBe('failed');
    const result = await api.service.getStatus({ plan: 'coding' });
    expect(result.data).toBeNull();
    expect(result.failureExitCode).toBe(4);
    expect(api.callFlatApi).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'QueryOrderList' }),
    );
  });

  it('compatibility projection leaves frozen reader results and raw input unchanged', async () => {
    const api = apiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'DescribeFrInstances')
        return {
          Data: [
            {
              InstanceId: 'mock-team',
              CommodityCode: site.features.tokenPlanCommodityCodes.teams,
              Status: 'valid',
            },
          ],
          TotalCount: 1,
        };
      if (options.action === 'GetSeatSubscriptionSummary')
        return {
          Data: {
            SubscriptionGroupList: [
              { SpecType: 'standard', SubscriptionTotalNumber: 2, SubscriptionAssignedNumber: 0 },
            ],
          },
        };
      return original(options);
    });
    const team = await readTeamSubscription(api.client, new AbortController().signal);
    const before = structuredClone(team);
    function freeze(value: unknown): void {
      if (value === null || typeof value !== 'object') return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    freeze(team);
    const input = {
      team,
      includeCoding: true,
      includeToken: true,
      recentOrders: [],
      gray: { IsGray: true },
    };
    const first = projectSubscriptionStatus(input, subscriptionAdapter);
    const second = projectSubscriptionStatus(
      { ...input, includeCoding: false },
      subscriptionAdapter,
    );
    expect(team).toEqual(before);
    expect(first.team).toEqual(second.team);
    expect(first.team?.diagnostics).toContainEqual(
      expect.objectContaining({ errorCode: 'IncompleteLegacySeatTier' }),
    );
    expect(first.seatTiers).toEqual([]);
    expect(team.outcome).toBe('partial');
    expect(team.data.seatSummaries?.[0].assignedCount).toBe(0);
    const dedicated = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });
    expect(dedicated.team).toBeDefined();
    const { seatDetails, ...expectedTeam } = dedicated.team!;
    expect(seatDetails).toEqual(emptySeatDetails);
    expect(first.team).not.toHaveProperty('seatDetails');
    expect(first.team).toEqual(expectedTeam);
  });
});

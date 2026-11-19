import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import { SubscriptionTokenPlanService } from '../../src/services/subscription-tokenplan-service.js';
import {
  fetchTokenPlanSeatDetails,
  resolveTokenPlanSeatAssignments,
} from '../../src/services/tokenplan-seat-details.js';
import { hasConfirmedTokenPlanEdition } from '../../src/services/tokenplan-team.js';

vi.mock('../../src/auth/credentials.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveCredentials: vi.fn(() => null),
  readCredentials: vi.fn(() => null),
  getCurrentUser: vi.fn(() => null),
}));

const SUBSCRIPTION = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription';
const QUOTA = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config';
const USAGE = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage';
const START = Date.parse('2026-10-01T00:00:00Z');
const END = Date.parse('2026-11-01T00:00:00Z');
const WEEK_RESET = Date.parse('2026-10-29T12:00:00Z');
const MONTH_RESET = Date.parse('2026-10-31T12:00:00Z');

function useTimedClock(): void {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
}

interface CsCall {
  api: string;
  data?: Record<string, unknown>;
  authMode?: 'required' | 'none';
  signal?: AbortSignal;
  parse: (raw: unknown) => unknown;
}

interface FlatCall {
  product: string;
  action: string;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

function personalSubscription(overrides: Record<string, unknown> = {}) {
  return {
    commodityCode: 'sfm_tokenplansolo_public_intl',
    status: 'VALID',
    instanceCode: 'mock-personal-instance',
    specCode: 'lite',
    remainingDays: 10,
    startTime: START,
    endTime: END,
    autoRenewFlag: true,
    ...overrides,
  };
}

function teamResponse(action: string): unknown {
  switch (action) {
    case 'QuerySubscriptionGray':
      return { IsGray: true };
    case 'QueryAccountBaseInfoApi':
      return { Data: { NbId: 'mock-billing-account' } };
    case 'DescribeFrInstances':
      return {
        TotalCount: 1,
        Data: [
          {
            InstanceId: 'mock-team-instance',
            CommodityCode: 'sfm_tokenplanteams_dp_intl',
            Status: { Code: 'valid' },
          },
        ],
      };
    case 'GetSeatSubscriptionSummary':
      return {
        Data: {
          PlanName: 'Mock Team Token Plan',
          StartTime: '2026-10-01T00:00:00Z',
          EndTime: '2026-11-01T00:00:00Z',
          RemainingDays: 10,
          SubscriptionGroupList: [
            {
              SpecType: 'standard',
              SubscriptionTotalNumber: 2,
              SubscriptionAssignedNumber: 1,
              NextCycleFlushTime: '2026-10-29T12:00:00Z',
              EquityList: [
                { EquityType: 'REQUESTS', TotalValue: '9999', SurplusValue: '8888' },
                {
                  EquityType: 'CREDITS',
                  TotalValue: '200.50',
                  SurplusValue: '100.25',
                  CycleTotalValue: '900',
                  CycleSurplusValue: '800',
                },
              ],
            },
            {
              SpecType: 'pro',
              SubscriptionTotalNumber: 1,
              SubscriptionAssignedNumber: 1,
              NextCycleFlushTime: '2026-10-31T12:00:00Z',
              EquityList: [{ EquityType: 'CREDITS', TotalValue: '500', SurplusValue: '0' }],
            },
          ],
        },
      };
    case 'GetSubscriptionSummary':
      return { Data: { TotalCount: 3, TotalValue: '700.50', TotalSurplusValue: '100.25' } };
    case 'CheckTokenPlanAutoRenewal':
      return { Data: { AutoRenewal: 1, RenewalPeriod: 1, RenewalPeriodUnit: 'M' } };
    case 'CheckInstancesRenewable':
      return {
        Data: [
          {
            InstanceId: 'mock-team-instance',
            CommodityCode: 'sfm_tokenplanteams_dp_intl',
            CanRenew: true,
          },
        ],
      };
    case 'GetSubscriptionDetail':
      return { Data: [], TotalCount: 0 };
    default:
      return {};
  }
}

function makeApiClient() {
  const responses: Record<string, unknown> = {
    [SUBSCRIPTION]: personalSubscription(),
    [QUOTA]: { lite: { five_hour: 100, weekly: 200, monthly: 500 } },
    [USAGE]: {
      per1WeekPercentage: 0.25,
      per1WeekResetTime: WEEK_RESET,
      per1MonthPercentage: 0.5,
      per1MonthResetTime: MONTH_RESET,
    },
  };
  const callCsDataApi = vi.fn(async (options: CsCall) =>
    options.parse({ code: 'SUCCESS', success: true, data: responses[options.api] }),
  );
  const callFlatApi = vi.fn(async (options: FlatCall) => teamResponse(options.action));
  const callOrchestrationApi = vi.fn(async (options: { parse: (raw: unknown) => unknown }) =>
    options.parse({}),
  );
  const client = {
    callCsDataApi,
    callFlatApi,
    callOrchestrationApi,
  } as unknown as ApiClient;
  return { client, responses, callCsDataApi, callFlatApi, callOrchestrationApi };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Team subscription identity', () => {
  const valid = {
    InstanceId: 'mock-team-subscription',
    CommodityCode: 'sfm_tokenplanteams_dp_intl',
    Status: { Code: 'valid' },
  };
  it.each([
    { name: 'one active subscription', items: [valid], total: 1, id: 'mock-team-subscription' },
    {
      name: 'one active and one expired',
      items: [valid, { ...valid, InstanceId: 'mock-expired', Status: { Code: 'expired' } }],
      total: 2,
      id: 'mock-team-subscription',
    },
    {
      name: 'multiple active subscriptions',
      items: [valid, { ...valid, InstanceId: 'mock-second' }],
      total: 2,
      id: null,
    },
    { name: 'incomplete page', items: [valid], total: 2, id: null },
    { name: 'duplicate identity', items: [valid, valid], total: 2, id: null },
    {
      name: 'unknown instance state',
      items: [valid, { ...valid, InstanceId: 'mock-unknown', Status: { Code: 'pending' } }],
      total: 2,
      id: null,
    },
    {
      name: 'foreign commodity',
      items: [
        valid,
        { ...valid, InstanceId: 'mock-foreign', CommodityCode: 'sfm_codingplan_public_intl' },
      ],
      total: 2,
      id: null,
    },
    {
      name: 'expired subscription',
      items: [{ ...valid, Status: { Code: 'expired' } }],
      total: 1,
      id: null,
    },
    { name: 'no subscription', items: [], total: 0, id: null },
  ])('uses a confirmed subscription identity for $name', async ({ items, total, id }) => {
    const api = makeApiClient();
    const response = { TotalCount: total, Data: items };
    const before = structuredClone(response);
    api.callFlatApi.mockImplementation(async ({ action }) =>
      action === 'DescribeFrInstances' ? response : teamResponse(action),
    );
    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });
    expect(result.team?.subscriptionId).toBe(id);
    expect(result.team?.subscriptionIds).toEqual(
      id
        ? [id]
        : total === 2 && items.some((item) => item.InstanceId === 'mock-second')
          ? ['mock-team-subscription', 'mock-second']
          : undefined,
    );
    expect(api.callCsDataApi).not.toHaveBeenCalled();
    expect(
      api.callFlatApi.mock.calls.filter(([call]) => call.action === 'DescribeFrInstances'),
    ).toHaveLength(1);
    expect(response).toEqual(before);
  });
});

describe('Status seat detail collection', () => {
  const seat = (id: number, fields: Record<string, unknown> = {}) => ({
    InstanceCode: `mock-seat-${id}`,
    ProductCode: 'sfm_tokenplanteams_dp_intl',
    SpecType: 'standard',
    Status: 'NORMAL',
    MemberId: '',
    EquityList: [{ CycleTotalValue: '25000', CycleSurplusValue: '20000' }],
    ...fields,
  });
  const page = (items: unknown[], total: unknown = items.length, current = 1) => ({
    Success: true,
    Code: 'Success',
    Data: { SubscriptionList: items, TotalCount: total, CurrentPage: current, PageSize: 100 },
  });

  it('collects pages with one team commodity and hides confirmed historical seats', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockImplementation(async ({ params }: FlatCall) => {
      const current = Number(params?.pageNo);
      return page(
        Array.from({ length: current === 1 ? 100 : 50 }, (_, n) =>
          seat((current - 1) * 100 + n, { Status: n === 0 ? 'REFUNDED' : 'NORMAL' }),
        ),
        150,
        current,
      );
    });
    const result = await fetchTokenPlanSeatDetails(api.client);
    expect(result).toMatchObject({
      fetchedCount: 150,
      totalCount: 150,
      historicalCount: 2,
      collectionCompleteness: 'complete',
      completeness: 'complete',
      diagnostics: [],
    });
    expect(result.items).toHaveLength(148);
    expect(result.items[0].instanceCode).toBe('mock-seat-1');
    expect(result.items.at(-1)?.instanceCode).toBe('mock-seat-149');
    expect(api.callFlatApi).toHaveBeenCalledTimes(2);
    const requests = api.callFlatApi.mock.calls.map(([options]) => options);
    expect(requests[0].params).toEqual({
      productCode: 'sfm_tokenplanteams_dp_intl',
      pageNo: 1,
      pageSize: 100,
    });
    expect(requests[1].params).toEqual({
      productCode: 'sfm_tokenplanteams_dp_intl',
      pageNo: 2,
      pageSize: 100,
    });
    expect(requests[0].signal).toBe(requests[1].signal);
  });

  it.each([
    { name: 'missing total', response: { Data: [seat(1)] }, code: 'MissingTotal' },
    { name: 'invalid total', response: page([seat(1)], -1), code: 'InconsistentTotal' },
    { name: 'wrong page', response: page([seat(1)], 1, 2), code: 'InvalidPagination' },
    { name: 'duplicate identity', response: page([seat(1), seat(1)], 2), code: 'DuplicateSeat' },
    {
      name: 'foreign commodity',
      response: page([seat(1, { ProductCode: 'sfm_codingplan_public_intl' })]),
      code: 'InvalidSeat',
    },
    { name: 'invalid envelope', response: { Success: false, Data: [] }, code: 'Unavailable' },
  ])(
    'keeps $name distinguishable from a confirmed empty collection',
    async ({ response, code }) => {
      const api = makeApiClient();
      api.callFlatApi.mockResolvedValue(response);
      const result = await fetchTokenPlanSeatDetails(api.client);
      expect(result.collectionCompleteness).not.toBe('complete');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ errorCode: code }));
    },
  );

  it.each([
    {
      name: 'requests first',
      rights: [
        { EquityType: 'REQUESTS', TotalValue: '999', SurplusValue: '888' },
        { EquityType: 'CREDITS', CycleTotalValue: '100', CycleSurplusValue: '0' },
      ],
      total: '100',
      remaining: '0',
    },
    {
      name: 'alternate Credits marker',
      rights: [{ EquityCode: 'CREDITS', TotalValue: '100', SurplusValue: '50' }],
      total: '100',
      remaining: '50',
    },
    {
      name: 'Credits type with an independent equity identifier',
      rights: [
        {
          EquityType: 'CREDITS',
          EquityCode: 'mock-credit-right',
          CycleTotalValue: '25000',
          CycleSurplusValue: '25000',
        },
      ],
      total: '25000',
      remaining: '25000',
    },
    {
      name: 'non Credits type with a Credits code',
      rights: [
        { EquityType: 'REQUESTS', EquityCode: 'CREDITS', TotalValue: '999', SurplusValue: '888' },
      ],
      total: null,
      remaining: null,
    },
    {
      name: 'ambiguous explicitly typed Credits',
      rights: [
        {
          EquityType: 'CREDITS',
          EquityCode: 'mock-credit-one',
          TotalValue: '100',
          SurplusValue: '50',
        },
        {
          EquityType: 'CREDITS',
          EquityCode: 'mock-credit-two',
          TotalValue: '200',
          SurplusValue: '100',
        },
      ],
      total: null,
      remaining: null,
    },
    {
      name: 'no mixed cycle and lifetime values',
      rights: [{ CycleTotalValue: '100', TotalValue: '999', SurplusValue: '888' }],
      total: '100',
      remaining: null,
    },
    {
      name: 'non Credits',
      rights: [{ EquityType: 'REQUESTS', TotalValue: '999', SurplusValue: '888' }],
      total: null,
      remaining: null,
    },
    {
      name: 'contradicting unit',
      rights: [
        { EquityType: 'CREDITS', UnitName: 'Requests', TotalValue: '999', SurplusValue: '888' },
      ],
      total: null,
      remaining: null,
    },
    {
      name: 'ambiguous Credits',
      rights: [
        { TotalValue: '100', SurplusValue: '50' },
        { TotalValue: '200', SurplusValue: '100' },
      ],
      total: null,
      remaining: null,
    },
    {
      name: 'invalid balance',
      rights: [{ TotalValue: '100', SurplusValue: '101' }],
      total: '100',
      remaining: null,
    },
    {
      name: 'exact decimal',
      rights: [
        { TotalValue: '9007199254740993.123456789', SurplusValue: '9007199254740992.123456789' },
      ],
      total: '9007199254740993.123456789',
      remaining: '9007199254740992.123456789',
    },
  ])('preserves $name without fabricating Credits', async ({ rights, total, remaining }) => {
    const api = makeApiClient();
    api.callFlatApi.mockResolvedValue(page([seat(1, { EquityList: rights })]));
    const result = await fetchTokenPlanSeatDetails(api.client);
    expect(result.items[0]).toMatchObject({ totalValue: total, surplusValue: remaining });
    expect(result.collectionCompleteness).toBe('complete');
    expect(result.completeness).toBe(total === null || remaining === null ? 'partial' : 'complete');
  });

  it.each(['Unit', 'UnitName', 'EquityUnit'])(
    'rejects conflicting %s at either level while preserving complete pagination',
    async (field) => {
      for (const level of ['seat', 'equity']) {
        const api = makeApiClient();
        const equity = {
          EquityType: 'CREDITS',
          EquityCode: 'mock-credit-right',
          Unit: 'Credits',
          CycleTotalValue: '100',
          CycleSurplusValue: '80',
          ...(level === 'equity' ? { [field]: 'Requests' } : {}),
        };
        api.callFlatApi.mockResolvedValue(
          page([
            seat(1, {
              ...(level === 'seat' ? { [field]: 'Requests' } : {}),
              EquityList: [equity],
            }),
          ]),
        );
        const result = await fetchTokenPlanSeatDetails(api.client);
        expect(result.items[0]).toMatchObject({ totalValue: null, surplusValue: null });
        expect(result.collectionCompleteness).toBe('complete');
        expect(result.completeness).toBe('partial');
        expect(result.diagnostics).toEqual([
          expect.objectContaining({ errorCode: 'IncompleteCredits' }),
        ]);
      }
    },
  );

  it.each([undefined, null, 'Credit', 'Credits', ' credit ', 'CREDITS'])(
    'accepts compatible units without replacing real zero: %j',
    async (unit) => {
      const api = makeApiClient();
      api.callFlatApi.mockResolvedValue(
        page([
          seat(1, {
            Unit: unit,
            UnitName: unit,
            EquityUnit: unit,
            EquityList: [
              {
                EquityType: 'CREDITS',
                EquityCode: 'mock-credit-right',
                Unit: unit,
                UnitName: unit,
                EquityUnit: unit,
                CycleTotalValue: '100',
                CycleSurplusValue: '0',
              },
            ],
          }),
        ]),
      );
      const result = await fetchTokenPlanSeatDetails(api.client);
      expect(result.items[0]).toMatchObject({ totalValue: '100', surplusValue: '0' });
      expect(result.collectionCompleteness).toBe('complete');
      expect(result.completeness).toBe('complete');
      expect(result.diagnostics).toEqual([]);
    },
  );

  it('keeps the first page when a later page fails', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockResolvedValueOnce(
      page(
        Array.from({ length: 100 }, (_, n) => seat(n)),
        101,
      ),
    );
    api.callFlatApi.mockRejectedValueOnce(new Error('Mock network timeout'));
    const result = await fetchTokenPlanSeatDetails(api.client);
    expect(result.items).toHaveLength(100);
    expect(result.totalCount).toBe(101);
    expect(result.collectionCompleteness).toBe('partial');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ errorCode: 'NETWORK_ERROR' }),
    );
  });

  it('bounds collection at ten pages and retains unknown status records', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockImplementation(async ({ params }: FlatCall) => {
      const current = Number(params?.pageNo);
      return page(
        Array.from({ length: 100 }, (_, n) =>
          seat((current - 1) * 100 + n, { Status: 'UNCONFIRMED' }),
        ),
        1001,
        current,
      );
    });
    const result = await fetchTokenPlanSeatDetails(api.client);
    expect(result.items).toHaveLength(1000);
    expect(result.items[0].status).toBeNull();
    expect(result.collectionCompleteness).toBe('partial');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ errorCode: 'PageLimit' }));
    expect(api.callFlatApi).toHaveBeenCalledTimes(10);
  });

  it('returns a stable timeout result even if a transport ignores cancellation', async () => {
    useTimedClock();
    const api = makeApiClient();
    let finish: (value: unknown) => void = () => {};
    api.callFlatApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = fetchTokenPlanSeatDetails(api.client);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;
    const before = structuredClone(result);
    expect(result.collectionCompleteness).toBe('unknown');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ errorCode: 'NETWORK_ERROR' }),
    );
    finish(page([seat(1)]));
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toEqual(before);
  });

  it('adds details only to the selected team node and never changes its subscription status', async () => {
    const api = makeApiClient();
    const original = api.callFlatApi.getMockImplementation()!;
    api.callFlatApi.mockImplementation(async (options) =>
      options.action === 'GetSubscriptionDetail' ? page([seat(1)]) : original(options),
    );
    const service = new SubscriptionTokenPlanService(api.client);
    const personal = await service.getTokenPlanStatus({ edition: 'individual' });
    expect(personal.team).toBeUndefined();
    expect(
      api.callFlatApi.mock.calls.filter(([request]) => request.action === 'GetSubscriptionDetail'),
    ).toHaveLength(0);
    const team = await service.getTokenPlanStatus({ edition: 'team' });
    expect(team.team?.status).toBe('active');
    expect(team.team?.seatDetails?.items[0].instanceCode).toBe('mock-seat-1');
    expect(team.individual).toBeUndefined();
    const unknown = {
      ...team.team!,
      status: 'unknown' as const,
      period: null,
      seatSummary: null,
      seatSummaries: [],
    };
    expect(hasConfirmedTokenPlanEdition(unknown)).toBe(false);
    expect(resolveTokenPlanSeatAssignments(team.team?.seatDetails, unknown)).toEqual(
      team.team?.seatDetails,
    );
  });

  it('resolves assignment only from a fully matched uniform group without mutating inputs', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockResolvedValue(page([seat(1, { MemberId: undefined })]));
    const details = await fetchTokenPlanSeatDetails(api.client);
    const team = (
      await new SubscriptionTokenPlanService(makeApiClient().client).getTokenPlanStatus({
        edition: 'team',
      })
    ).team!;
    team.seatSummary = {
      groups: [
        {
          specType: 'standard',
          seats: 1,
          assigned: 1,
          totalValue: null,
          surplusValue: null,
          unit: 'Credits',
          nextCycleFlushTime: null,
        },
      ],
      total: { seats: 1, totalValue: null, surplusValue: null, unit: 'Credits' },
    };
    team.diagnostics = [];
    const before = structuredClone(details);
    const resolved = resolveTokenPlanSeatAssignments(details, team);
    expect(resolved?.items[0].assignment).toBe('assigned');
    expect(details).toEqual(before);
    team.seatSummary.groups[0].seats = 2;
    expect(resolveTokenPlanSeatAssignments(details, team)?.diagnostics).toContainEqual(
      expect.objectContaining({ errorCode: 'SeatSummaryMismatch' }),
    );
  });
});

describe('Selected Token Plan subscription editions', () => {
  it('keeps a resolved null response unknown without reporting a timeout', async () => {
    const api = makeApiClient();
    api.responses[SUBSCRIPTION] = null;

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.status).toBe('unknown');
    expect(result.individual?.completeness).toBe('unknown');
    expect(result.individual?.diagnostics).toEqual([
      expect.objectContaining({ api: SUBSCRIPTION, errorCode: 'UnconfirmedState' }),
    ]);
    expect(api.callCsDataApi).toHaveBeenCalledTimes(1);
  });

  it('freezes a timed-out personal result when the original request completes later', async () => {
    useTimedClock();
    const api = makeApiClient();
    let finish: (raw: unknown) => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    api.callCsDataApi.mockImplementation(async (options: CsCall) => {
      markStarted();
      const raw = await new Promise<unknown>((resolve) => {
        finish = resolve;
      });
      return options.parse(raw);
    });

    const pending = new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });
    await started;
    await vi.advanceTimersByTimeAsync(35000);
    const result = await pending;
    const original = structuredClone(result);

    expect(result.individual?.status).toBe('unknown');
    expect(result.individual?.diagnostics).toEqual([
      expect.objectContaining({ api: SUBSCRIPTION, errorCode: 'NETWORK_ERROR' }),
    ]);

    finish({ code: 'SUCCESS', success: true, data: personalSubscription() });
    await vi.advanceTimersByTimeAsync(0);

    expect(result).toEqual(original);
    expect(api.callCsDataApi).toHaveBeenCalledTimes(1);
  });

  it('redacts untrusted transport error details from subscription diagnostics', async () => {
    const api = makeApiClient();
    api.callCsDataApi.mockRejectedValue(
      new Error('Mock transport Bearer mock-credential-marker?token=mock-session-marker'),
    );

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.status).toBe('unknown');
    expect(result.individual?.diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('mock-credential-marker');
    expect(JSON.stringify(result)).not.toContain('mock-session-marker');
  });

  it('queries only the individual edition and keeps legacy team fields empty', async () => {
    const api = makeApiClient();

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual).toMatchObject({
      edition: 'individual',
      commodityCode: 'sfm_tokenplansolo_public_intl',
      status: 'active',
      specCode: 'lite',
    });
    expect(result.team).toBeUndefined();
    expect(result.period).toBeNull();
    expect(result.autoRenew).toBeNull();
    expect(result.renewable).toBeNull();
    expect(result.seatSummary).toBeNull();
    expect(api.callFlatApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GetSeatSubscriptionSummary' }),
    );
    expect(api.callCsDataApi).toHaveBeenCalledWith(
      expect.objectContaining({
        api: SUBSCRIPTION,
        data: { commodityCode: 'sfm_tokenplansolo_public_intl' },
      }),
    );
  });

  it('queries only the team edition and preserves its legacy JSON fields', async () => {
    const api = makeApiClient();

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });

    expect(result.individual).toBeUndefined();
    expect(api.callCsDataApi).not.toHaveBeenCalled();
    expect(result.team).toMatchObject({ edition: 'team', status: 'active' });
    expect(result.product).toBe('Token Plan Team Edition');
    expect(result.period).toEqual({
      start: '2026-10-01T00:00:00Z',
      end: '2026-11-01T00:00:00Z',
      remainingDays: 10,
    });
    expect(result.autoRenew).toEqual({ enabled: true, period: 1, periodUnit: 'M' });
    expect(result.renewable).toMatchObject({ canRenew: true });
    expect(result.seatSummary?.groups).toHaveLength(2);
    expect(api.callFlatApi).toHaveBeenCalledWith(
      expect.objectContaining({
        product: 'BssOpenAPI-V3',
        action: 'GetSeatSubscriptionSummary',
        params: expect.objectContaining({ productCode: 'sfm_tokenplanteams_dp_intl' }),
      }),
    );
  });

  it('defaults to both editions without sharing personal values into team legacy fields', async () => {
    const api = makeApiClient();

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus();

    expect(result.individual?.status).toBe('active');
    expect(result.team?.status).toBe('active');
    expect(result.product).toBe('Token Plan Team Edition');
    expect(result.seatSummary?.total).toMatchObject({
      seats: 3,
      totalValue: '700.50',
      surplusValue: '100.25',
    });
  });

  it('keeps a successful team result when the selected personal request exceeds the shared budget', async () => {
    useTimedClock();
    const api = makeApiClient();
    api.callCsDataApi.mockImplementation(async () => new Promise<unknown>(() => {}));

    const promise = new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'all',
    });
    await vi.advanceTimersByTimeAsync(35000);
    const result = await promise;

    expect(result.team?.status).toBe('active');
    expect(result.team?.seatSummaries).toHaveLength(2);
    expect(result.individual?.status).toBe('unknown');
    expect(result.individual?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ api: expect.stringMatching(/\S/), errorCode: 'NETWORK_ERROR' }),
      ]),
    );
    expect(result.product).toBe('Token Plan Team Edition');
    expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: SUBSCRIPTION }));
  });

  it('propagates caller cancellation instead of returning an unknown subscription result', async () => {
    const api = makeApiClient();
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    api.callCsDataApi.mockImplementation(async () => {
      markStarted();
      return new Promise<unknown>(() => {});
    });
    const controller = new AbortController();
    const promise = new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
      signal: controller.signal,
    });
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();

    await rejected;
    expect(api.callFlatApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GetSeatSubscriptionSummary' }),
    );
  });

  it('preserves confirmed personal core fields when usage exceeds the shared budget', async () => {
    useTimedClock();
    const api = makeApiClient();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options) =>
      options.api === USAGE ? new Promise<unknown>(() => {}) : original(options),
    );

    const pending = new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'all',
    });
    await vi.advanceTimersByTimeAsync(35000);
    const result = await pending;

    expect(result.team?.status).toBe('active');
    expect(result.individual).toMatchObject({
      status: 'active',
      specCode: 'lite',
      remainingDays: 10,
      endAt: '2026-11-01T00:00:00.000Z',
      completeness: 'partial',
      period: {
        start: '2026-10-01T00:00:00.000Z',
        end: '2026-11-01T00:00:00.000Z',
        remainingDays: 10,
      },
    });
    expect(result.individual?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ api: USAGE, errorCode: 'NETWORK_ERROR' })]),
    );
    expect(result.individual?.tiers).toEqual([]);
    expect(result.individual?.weeklyCredits).toBeUndefined();
    expect(result.individual?.monthlyCredits).toBeUndefined();
  });
});

describe('Personal subscription validity gate', () => {
  it('does not request usage or quota until subscription validity has been confirmed', async () => {
    const api = makeApiClient();
    let finishSubscription: (payload: unknown) => void = () => {
      throw new Error('The subscription request was not started');
    };
    const pending = new Promise<unknown>((resolve) => {
      finishSubscription = resolve;
    });
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    api.callCsDataApi.mockImplementation(async (options: CsCall) => {
      if (options.api === SUBSCRIPTION) markStarted();
      const payload = options.api === SUBSCRIPTION ? await pending : api.responses[options.api];
      return options.parse({ code: 'SUCCESS', success: true, data: payload });
    });
    const promise = new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });
    await started;

    expect(api.callCsDataApi).toHaveBeenCalledTimes(1);
    expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: SUBSCRIPTION }));

    finishSubscription(personalSubscription());
    const result = await promise;

    expect(result.individual?.status).toBe('active');
    expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: USAGE }));
    expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: QUOTA }));
  });

  it('does not query account quotas after an explicitly successful missing subscription', async () => {
    const api = makeApiClient();
    api.callCsDataApi.mockImplementation(async (options: CsCall) =>
      options.parse({ code: 'SUCCESS', success: true }),
    );

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.status).toBe('not_subscribed');
    expect(api.callCsDataApi).toHaveBeenCalledTimes(1);
    expect(result.team).toBeUndefined();
  });

  it.each([null, {}, { status: 'INVALID' }, personalSubscription({ status: 'FUTURE_STATE' })])(
    'keeps an unconfirmed subscription unknown without querying account quotas: %j',
    async (payload) => {
      const api = makeApiClient();
      api.responses[SUBSCRIPTION] = payload;

      const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
        edition: 'individual',
      });

      expect(result.individual?.status).toBe('unknown');
      expect(result.individual?.subscriptionId).toBeNull();
      expect(result.individual?.diagnostics.length).toBeGreaterThan(0);
      expect(api.callCsDataApi).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps a subscription request failure distinct from a confirmed empty subscription', async () => {
    const api = makeApiClient();
    api.callCsDataApi.mockRejectedValue(new Error('Mock subscription transport failure'));

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.status).toBe('unknown');
    expect(result.individual?.diagnostics.length).toBeGreaterThan(0);
    expect(api.callCsDataApi).toHaveBeenCalledTimes(1);
    expect(api.callFlatApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GetSeatSubscriptionSummary' }),
    );
  });
});

describe('Personal quota source and window boundaries', () => {
  it('prefers the reported weekly window and never invents exact remaining Credits or subscription identity', async () => {
    const api = makeApiClient();

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.tiers).toEqual([
      {
        tier: 'lite',
        windowType: 'weekly',
        totalCredits: '200',
        remainingCredits: null,
        remainingPct: 75,
        usedPct: 25,
        resetAt: '2026-10-29T12:00:00.000Z',
      },
    ]);
    expect(result.individual?.endAt).toBe('2026-11-01T00:00:00.000Z');
    expect(result.individual?.subscriptionId).toBe('mock-personal-instance');
    expect(result.individual?.monthlyCredits).toBeUndefined();
  });

  it('uses the monthly window only when the weekly ratio is absent', async () => {
    const api = makeApiClient();
    api.responses[USAGE] = {
      per1WeekPercentage: null,
      per1MonthPercentage: 0.5,
      per1MonthResetTime: MONTH_RESET,
    };

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.tiers).toEqual([
      {
        tier: 'lite',
        windowType: 'monthly',
        totalCredits: '500',
        remainingCredits: null,
        remainingPct: 50,
        usedPct: 50,
        resetAt: '2026-10-31T12:00:00.000Z',
      },
    ]);
    expect(result.individual?.weeklyCredits).toBeUndefined();
  });

  it.each([
    [0, 0, 100],
    [1, 100, 0],
  ])('preserves the boundary ratio %s', async (ratio, usedPct, remainingPct) => {
    const api = makeApiClient();
    api.responses[USAGE] = { per1WeekPercentage: ratio, per1WeekResetTime: WEEK_RESET };

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.tiers?.[0]).toMatchObject({
      windowType: 'weekly',
      totalCredits: '200',
      usedPct,
      remainingPct,
      remainingCredits: null,
    });
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not replace an invalid weekly ratio %s with the valid monthly ratio',
    async (ratio) => {
      const api = makeApiClient();
      api.responses[USAGE] = {
        per1WeekPercentage: ratio,
        per1MonthPercentage: 0.5,
        per1MonthResetTime: MONTH_RESET,
      };

      const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
        edition: 'individual',
      });

      expect(result.individual?.status).toBe('active');
      expect(result.individual?.monthlyCredits).toBeUndefined();
      expect(result.individual?.tiers).toEqual([]);
      expect(result.individual?.weeklyCredits).toBeUndefined();
      expect(result.individual?.diagnostics.length).toBeGreaterThan(0);
    },
  );

  it('keeps a missing quota reset unknown instead of filling it with the subscription expiry', async () => {
    const api = makeApiClient();
    api.responses[USAGE] = { per1WeekPercentage: 0.25 };

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.tiers?.[0]?.resetAt).toBeNull();
    expect(result.individual?.endAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('keeps the selected tier quota unknown rather than borrowing another tier', async () => {
    const api = makeApiClient();
    api.responses[SUBSCRIPTION] = personalSubscription({ specCode: 'pro' });

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.tiers?.[0]).toMatchObject({
      tier: 'pro',
      windowType: 'weekly',
      totalCredits: null,
      remainingCredits: null,
      remainingPct: 75,
    });
  });

  it('retains the confirmed subscription when the optional usage request fails', async () => {
    const api = makeApiClient();
    api.callCsDataApi.mockImplementation(async (options: CsCall) => {
      if (options.api === USAGE) throw new Error('Mock usage transport failure');
      return options.parse({ code: 'SUCCESS', success: true, data: api.responses[options.api] });
    });

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'individual',
    });

    expect(result.individual?.status).toBe('active');
    expect(result.individual?.endAt).toBe('2026-11-01T00:00:00.000Z');
    expect(result.individual?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ api: USAGE })]),
    );
  });
});

describe('Team quota equity selection', () => {
  it('preserves the valid Credits row and active core when another reported group is malformed', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action !== 'GetSeatSubscriptionSummary') return teamResponse(options.action);
      return {
        Data: {
          PlanName: 'Mock Team Token Plan',
          SubscriptionGroupList: [
            null,
            {
              SpecType: 'standard',
              SubscriptionTotalNumber: 1,
              SubscriptionAssignedNumber: 0,
              NextCycleFlushTime: '2026-10-30T00:00:00Z',
              EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100', SurplusValue: '50.05' }],
            },
          ],
        },
      };
    });

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });

    expect(result.team?.status).toBe('active');
    expect(result.team?.completeness).toBe('partial');
    expect(result.team?.seatSummaries).toEqual([
      {
        seatType: 'standard',
        seatCount: 1,
        assignedCount: 0,
        totalCredits: '100',
        remainingCredits: '50.05',
        remainingPct: 50.05,
        resetAt: '2026-10-30T00:00:00.000Z',
      },
    ]);
    expect(result.team?.diagnostics).toContainEqual(
      expect.objectContaining({ api: 'GetSeatSubscriptionSummary' }),
    );
    expect(result.seatSummary?.groups[0]).toMatchObject({
      specType: 'standard',
      totalValue: '100',
      surplusValue: '50.05',
    });
  });

  it.each([0, null, 'false'])(
    'does not confirm renewable data when the response explicit success marker is %j',
    async (Success) => {
      const api = makeApiClient();
      api.callFlatApi.mockImplementation(async (options: FlatCall) => {
        if (options.action !== 'CheckInstancesRenewable') return teamResponse(options.action);
        return {
          Success,
          Data: [
            {
              InstanceId: 'mock-team-instance',
              CommodityCode: 'sfm_tokenplanteams_dp_intl',
              CanRenew: true,
            },
          ],
        };
      });

      const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
        edition: 'team',
      });

      expect(result.team?.status).toBe('active');
      expect(result.renewable).toBeNull();
      expect(api.callFlatApi).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CheckInstancesRenewable' }),
      );
    },
  );

  it('uses CREDITS amounts and keeps seat types and reset times separate', async () => {
    const api = makeApiClient();

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });

    expect(result.team?.seatSummaries).toEqual([
      {
        seatType: 'standard',
        seatCount: 2,
        assignedCount: 1,
        totalCredits: '200.5',
        remainingCredits: '100.25',
        remainingPct: 50,
        resetAt: '2026-10-29T12:00:00.000Z',
      },
      {
        seatType: 'pro',
        seatCount: 1,
        assignedCount: 1,
        totalCredits: '500',
        remainingCredits: '0',
        remainingPct: 0,
        resetAt: '2026-10-31T12:00:00.000Z',
      },
    ]);
    expect(result.seatSummary?.groups[0]).toMatchObject({
      specType: 'standard',
      totalValue: '200.50',
      surplusValue: '100.25',
    });
    expect(result.seatSummary?.groups[1]).toMatchObject({
      specType: 'pro',
      totalValue: '500',
      surplusValue: '0',
    });
  });

  it('does not turn a missing CREDITS amount into zero or a non-credit balance', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action !== 'GetSeatSubscriptionSummary') return teamResponse(options.action);
      return {
        Data: {
          PlanName: 'Mock Team Token Plan',
          SubscriptionGroupList: [
            {
              SpecType: 'standard',
              SubscriptionTotalNumber: 1,
              EquityList: [
                { EquityType: 'REQUESTS', TotalValue: '9999', SurplusValue: '8888' },
                { EquityType: 'CREDITS' },
              ],
            },
          ],
        },
      };
    });

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });

    expect(result.team?.seatSummaries?.[0]).toMatchObject({
      seatType: 'standard',
      totalCredits: null,
      remainingCredits: null,
      remainingPct: null,
      resetAt: null,
    });
  });

  it('preserves decimal Credits beyond JavaScript safe integer precision', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action !== 'GetSeatSubscriptionSummary') return teamResponse(options.action);
      return {
        Data: {
          SubscriptionGroupList: [
            {
              SpecType: 'pro',
              SubscriptionTotalNumber: 1,
              EquityList: [
                {
                  EquityType: 'CREDITS',
                  TotalValue: '9007199254740993.123456789',
                  SurplusValue: '9007199254740992.123456789',
                },
              ],
            },
          ],
        },
      };
    });

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });

    expect(result.team?.seatSummaries?.[0]?.totalCredits).toBe('9007199254740993.123456789');
    expect(result.team?.seatSummaries?.[0]?.remainingCredits).toBe('9007199254740992.123456789');
    expect(result.seatSummary?.groups[0]?.totalValue).toBe('9007199254740993.123456789');
  });

  it('keeps unreported days and renewal settings unknown in the additive team node', async () => {
    const api = makeApiClient();
    api.callFlatApi.mockImplementation(async (options: FlatCall) => {
      if (options.action === 'CheckTokenPlanAutoRenewal') return { Data: {} };
      if (options.action === 'GetSeatSubscriptionSummary')
        return {
          Data: {
            StartTime: '2026-10-01T00:00:00Z',
            EndTime: '2026-11-01T00:00:00Z',
            SubscriptionGroupList: [
              {
                SpecType: 'standard',
                SubscriptionTotalNumber: 1,
                EquityList: [{ EquityType: 'CREDITS', TotalValue: '200', SurplusValue: '100' }],
              },
            ],
          },
        };
      return teamResponse(options.action);
    });

    const result = await new SubscriptionTokenPlanService(api.client).getTokenPlanStatus({
      edition: 'team',
    });

    expect(result.team?.remainingDays).toBeNull();
    expect(result.team?.period?.remainingDays).toBeNull();
    expect(result.team?.autoRenew).toBeNull();
  });
});

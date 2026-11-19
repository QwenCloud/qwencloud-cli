import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import type { SubscriptionDiagnostic } from '../../src/types/subscription.js';
import {
  confirmedTeamAutoRenew,
  enrichTeamTokenPlan,
  fetchTeamTokenPlan,
  parseTeamSeatGroups,
  parseTeamSeatTypeSummaries,
  unknownTokenPlanEdition,
} from '../../src/services/tokenplan-team.js';
import { projectTokenPlanStatus } from '../../src/services/subscription-status-compat.js';

vi.mock('../../src/auth/credentials.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveCredentials: vi.fn(() => null),
  readCredentials: vi.fn(() => null),
  getCurrentUser: vi.fn(() => null),
}));

function group(overrides: Record<string, unknown> = {}) {
  return {
    SpecType: 'standard',
    SubscriptionTotalNumber: 2,
    SubscriptionAssignedNumber: 1,
    NextCycleFlushTime: '2026-10-30T00:00:00Z',
    EquityList: [
      { EquityType: 'REQUESTS', TotalValue: '9999', SurplusValue: '8888' },
      { EquityCode: 'CREDITS', TotalValue: '100.10', SurplusValue: '50.05' },
    ],
    ...overrides,
  };
}

describe('Team quota grouping boundaries', () => {
  const creditRight = { EquityType: 'CREDITS', TotalValue: '100.00', SurplusValue: '50.0500' };
  it.each([undefined, null, '2026-12-01T00:00:00Z'])(
    'uses the same EndTime/PeriodEnd priority for the team period and endAt: %j',
    (EndTime) => {
      const seatRaw = {
        Data: {
          PeriodStart: '2026-10-01T00:00:00Z',
          PeriodEnd: '2026-11-01T00:00:00Z',
          EndTime,
          SubscriptionGroupList: [group()],
        },
      };
      const result = enrichTeamTokenPlan(unknownTokenPlanEdition('team'), seatRaw, {}, {});
      const expected = EndTime ? '2026-12-01T00:00:00.000Z' : '2026-11-01T00:00:00.000Z';
      expect(result.period?.end).toBe(expected);
      expect(result.endAt).toBe(expected);
    },
  );

  it('preserves the original legacy FR quota formula at the numeric boundary', async () => {
    const callFlatApi = vi.fn(async (options: { action: string }) => {
      if (options.action === 'DescribeFrInstances')
        return {
          Data: [
            {
              InstanceId: 'mock-team-instance',
              CommodityCode: 'sfm_tokenplanteams_dp_intl',
              Status: { Code: 'valid' },
              InitCapacityBaseValue: '3',
              CurrCapacityBaseValue: '1',
              EndTime: '2099-11-01T00:00:00Z',
            },
          ],
          TotalCount: 1,
        };
      return {};
    });
    const result = await fetchTeamTokenPlan({ callFlatApi } as unknown as ApiClient);
    expect(result.legacy.totalCredits).toBe(3);
    expect(result.legacy.remainingCredits).toBe(1);
    expect(result.legacy.usedPct).toBe(66.66666666666666);
  });

  it.each([
    [
      'non-credit right',
      { EquityList: [{ EquityType: 'REQUESTS', TotalValue: '100', SurplusValue: '50' }] },
    ],
    [
      'conflicting Credits code',
      {
        EquityList: [
          { EquityType: 'REQUESTS', EquityCode: 'CREDITS', TotalValue: '100', SurplusValue: '50' },
        ],
      },
    ],
    [
      'invalid explicit type',
      {
        EquityList: [
          { EquityType: null, EquityCode: 'CREDITS', TotalValue: '100', SurplusValue: '50' },
        ],
      },
    ],
    ['missing marker', { EquityList: [{ TotalValue: '100', SurplusValue: '50' }] }],
    ['bare group values', { EquityList: [], TotalValue: '100', SurplusValue: '50' }],
    [
      'multiple Credits rights',
      { EquityList: [creditRight, { ...creditRight, EquityCode: 'CREDITS' }] },
    ],
    ['right unit mismatch', { EquityList: [{ ...creditRight, Unit: 'requests' }] }],
    [
      'right unit name mismatch',
      { EquityList: [{ ...creditRight, Unit: 'Credits', UnitName: 'requests' }] },
    ],
    ['group unit mismatch', { EquityList: [creditRight], Unit: 'requests' }],
    ['group unit name mismatch', { EquityList: [creditRight], UnitName: 'requests' }],
    ['right equity unit mismatch', { EquityList: [{ ...creditRight, EquityUnit: 'Requests' }] }],
    ['group equity unit mismatch', { EquityList: [creditRight], EquityUnit: 'Requests' }],
    [
      'conflicting unit aliases',
      { EquityList: [{ ...creditRight, Unit: 'Credits', EquityUnit: 'Requests' }] },
    ],
    ['non-string equity unit', { EquityList: [{ ...creditRight, EquityUnit: 0 }] }],
    ['non-string unit', { EquityList: [{ ...creditRight, Unit: 0 }] }],
    ['negative values', { EquityList: [{ ...creditRight, TotalValue: '-1', SurplusValue: '-1' }] }],
    [
      'partial numeric text',
      { EquityList: [{ ...creditRight, TotalValue: '100foo', SurplusValue: '50foo' }] },
    ],
  ])('keeps all projections unknown for %s', (_name, overrides) => {
    const raw = { Data: { SubscriptionGroupList: [group(overrides)] } };
    const compatibility = projectTokenPlanStatus(
      new Map([['GetSeatSubscriptionSummary', raw]]),
      [],
    );
    expect(compatibility.seatSummary?.groups[0]).toMatchObject({
      totalValue: null,
      surplusValue: null,
    });
    expect(compatibility.diagnostics).toEqual([
      expect.objectContaining({
        api: 'GetSeatSubscriptionSummary',
        errorCode: 'IncompleteCredits',
      }),
    ]);
    const legacyDiagnostics: SubscriptionDiagnostic[] = [];
    const summaryDiagnostics: SubscriptionDiagnostic[] = [];

    expect(parseTeamSeatGroups(raw, legacyDiagnostics)?.[0]).toMatchObject({
      totalValue: null,
      surplusValue: null,
      seats: 2,
    });
    expect(parseTeamSeatTypeSummaries(raw, summaryDiagnostics)?.[0]).toMatchObject({
      totalCredits: null,
      remainingCredits: null,
      seatCount: 2,
    });
    expect(legacyDiagnostics).toContainEqual(
      expect.objectContaining({ errorCode: 'IncompleteCredits' }),
    );
    expect(summaryDiagnostics).toContainEqual(
      expect.objectContaining({ errorCode: 'IncompleteCredits' }),
    );
  });

  it('selects the typed Credits right when a conflicting code precedes it', () => {
    const raw = {
      Data: {
        SubscriptionGroupList: [
          group({
            EquityList: [
              {
                EquityType: 'REQUESTS',
                EquityCode: 'CREDITS',
                TotalValue: '9999',
                SurplusValue: '8888',
              },
              { ...creditRight, EquityCode: 'mock-credit-right' },
            ],
          }),
        ],
      },
    };
    const diagnostics: SubscriptionDiagnostic[] = [];

    expect(parseTeamSeatGroups(raw, diagnostics)?.[0]).toMatchObject({
      totalValue: '100.00',
      surplusValue: '50.0500',
    });
    expect(parseTeamSeatTypeSummaries(raw, diagnostics)?.[0]).toMatchObject({
      totalCredits: '100',
      remainingCredits: '50.05',
    });
    expect(diagnostics).toEqual([]);
  });

  it.each(['EquityType', 'EquityCode'])(
    'accepts a single %s Credits marker and preserves legacy decimal strings',
    (marker) => {
      const raw = {
        Data: {
          SubscriptionGroupList: [
            group({
              Unit: 'Credits',
              UnitName: ' credits ',
              EquityList: [
                {
                  [marker]: 'CREDITS',
                  Unit: 'CREDITS',
                  UnitName: 'Credits',
                  TotalValue: '100.00',
                  SurplusValue: '50.0500',
                },
              ],
            }),
          ],
        },
      };
      const diagnostics: SubscriptionDiagnostic[] = [];

      expect(parseTeamSeatGroups(raw, diagnostics)?.[0]).toMatchObject({
        totalValue: '100.00',
        surplusValue: '50.0500',
      });
      expect(parseTeamSeatTypeSummaries(raw, diagnostics)?.[0]).toMatchObject({
        totalCredits: '100',
        remainingCredits: '50.05',
      });
      expect(diagnostics).toEqual([]);
    },
  );

  it.each([
    ['0', '0'],
    [0, 0],
  ])('preserves real zero amounts: %j, %j', (TotalValue, SurplusValue) => {
    const raw = {
      Data: {
        SubscriptionGroupList: [
          group({ EquityList: [{ EquityCode: 'CREDITS', TotalValue, SurplusValue }] }),
        ],
      },
    };
    const diagnostics: SubscriptionDiagnostic[] = [];
    expect(parseTeamSeatGroups(raw, diagnostics)?.[0]).toMatchObject({
      totalValue: '0',
      surplusValue: '0',
    });
    expect(parseTeamSeatTypeSummaries(raw, diagnostics)?.[0]).toMatchObject({
      totalCredits: '0',
      remainingCredits: '0',
    });
    expect(diagnostics).toEqual([]);
  });

  it.each([undefined, null, 'Credit', 'Credits', ' credit ', 'CREDITS'])(
    'accepts compatible unit aliases without changing zero amounts: %j',
    (unit) => {
      const raw = {
        Data: {
          SubscriptionGroupList: [
            group({
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
                  TotalValue: '100.00',
                  SurplusValue: '0',
                },
              ],
            }),
          ],
        },
      };
      const diagnostics: SubscriptionDiagnostic[] = [];
      expect(parseTeamSeatGroups(raw, diagnostics)?.[0]).toMatchObject({
        totalValue: '100.00',
        surplusValue: '0',
      });
      expect(parseTeamSeatTypeSummaries(raw, diagnostics)?.[0]).toMatchObject({
        totalCredits: '100',
        remainingCredits: '0',
      });
      expect(diagnostics).toEqual([]);
    },
  );

  it('rejects an impossible legacy balance without replacing its confirmed total', () => {
    const raw = {
      Data: {
        SubscriptionGroupList: [group({ EquityList: [{ ...creditRight, SurplusValue: '101' }] })],
      },
    };
    const diagnostics: SubscriptionDiagnostic[] = [];
    expect(parseTeamSeatGroups(raw, diagnostics)?.[0]).toMatchObject({
      totalValue: '100.00',
      surplusValue: null,
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ errorCode: 'InvalidCreditBalance' }),
    );
  });

  it('keeps exact legacy string amounts while enriching the public team result', async () => {
    const seatRaw = {
      Data: {
        PlanName: 'Mock Team Token Plan',
        StartTime: '2026-10-01T00:00:00Z',
        EndTime: '2026-11-01T00:00:00Z',
        SubscriptionGroupList: [
          group({
            EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100.00', SurplusValue: '50.05' }],
          }),
        ],
      },
    };
    const summaryRaw = {
      Data: { TotalCount: 2, TotalValue: '100.00', TotalSurplusValue: '50.0500' },
    };
    const autoRenewRaw = { Data: { AutoRenewal: 0 } };
    const callFlatApi = vi.fn(async (options: { action: string }) => {
      if (options.action === 'QuerySubscriptionGray') return { IsGray: false };
      if (options.action === 'GetSeatSubscriptionSummary') return seatRaw;
      if (options.action === 'GetSubscriptionSummary') return summaryRaw;
      if (options.action === 'CheckTokenPlanAutoRenewal') return autoRenewRaw;
      if (options.action === 'DescribeFrInstances')
        return {
          Data: [
            {
              InstanceId: 'mock-team-instance',
              CommodityCode: 'sfm_tokenplanteams_dp_intl',
              Status: { Code: 'valid' },
              InitCapacityBaseValue: '100.00',
              CurrCapacityBaseValue: '50.05',
              StartTime: '2026-10-01T00:00:00Z',
              EndTime: '2099-11-01T00:00:00Z',
            },
          ],
          TotalCount: 1,
        };
      return {};
    });

    const source = await fetchTeamTokenPlan({ callFlatApi } as unknown as ApiClient);
    const result = enrichTeamTokenPlan(source.team, seatRaw, summaryRaw, autoRenewRaw);

    expect(source.legacy.totalCredits).toBe(100);
    expect(source.legacy.remainingCredits).toBe(50.05);
    expect(result.seatSummary?.groups[0]?.totalValue).toBe('100.00');
    expect(result.seatSummary?.groups[0]?.surplusValue).toBe('50.05');
    expect(result.seatSummary?.total).toEqual({
      seats: 2,
      totalValue: '100.00',
      surplusValue: '50.0500',
      unit: 'Credits',
    });
  });

  it.each([
    ['missing response', undefined, 'Unavailable'],
    [
      'incomplete Credits',
      {
        Data: {
          SubscriptionGroupList: [
            group({ EquityList: [{ EquityType: 'CREDITS', TotalValue: '100' }] }),
          ],
        },
      },
      'IncompleteCredits',
    ],
  ] as const)(
    'reports %s once while enriching both seat projections',
    (_name, seatRaw, errorCode) => {
      const source = unknownTokenPlanEdition('team');
      const before = structuredClone(source);
      const result = enrichTeamTokenPlan(source, seatRaw, {}, { Data: { AutoRenewal: 0 } });
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ api: 'GetSeatSubscriptionSummary', errorCode }),
      ]);
      expect(source).toEqual(before);
    },
  );

  it('keeps independent invalid groups diagnosed once each', () => {
    const seatRaw = {
      Data: {
        SubscriptionGroupList: [
          group({
            SpecType: 'standard',
            EquityList: [{ EquityType: 'CREDITS', TotalValue: '100' }],
          }),
          group({ SpecType: 'pro', EquityList: [{ EquityType: 'CREDITS', TotalValue: '200' }] }),
        ],
      },
    };
    const result = enrichTeamTokenPlan(
      unknownTokenPlanEdition('team'),
      seatRaw,
      {},
      { Data: { AutoRenewal: 0 } },
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        api: 'GetSeatSubscriptionSummary',
        errorCode: 'IncompleteCredits',
      }),
      expect.objectContaining({
        api: 'GetSeatSubscriptionSummary',
        errorCode: 'IncompleteCredits',
      }),
    ]);
    expect(result.seatSummary?.groups).toHaveLength(2);
    expect(result.seatSummaries).toHaveLength(2);
  });

  it('preserves legacy Credits string formatting and leaves diagnostic input untouched', () => {
    const diagnostics: SubscriptionDiagnostic[] = [];
    Object.freeze(diagnostics);
    const raw = {
      Data: {
        SubscriptionGroupList: [
          group({
            EquityList: [
              {
                EquityType: 'CREDITS',
                EquityCode: 'credit_value',
                TotalValue: '100.00',
                SurplusValue: '50.0500',
              },
            ],
          }),
        ],
      },
    };
    const result = projectTokenPlanStatus(
      new Map([['GetSeatSubscriptionSummary', raw]]),
      diagnostics,
    );
    expect(result.seatSummary?.groups[0]).toMatchObject({
      totalValue: '100.00',
      surplusValue: '50.0500',
    });
    expect(result.diagnostics).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('merges the same seat type and window using explicit Credits markers without losing decimals', () => {
    const diagnostics: SubscriptionDiagnostic[] = [];

    const summaries = parseTeamSeatTypeSummaries(
      {
        Data: {
          SubscriptionGroupList: [
            group(),
            group({
              SubscriptionTotalNumber: 1,
              SubscriptionAssignedNumber: 1,
              EquityList: [{ EquityType: 'CREDITS', TotalValue: '200.20', SurplusValue: '100.10' }],
            }),
            group({
              SpecType: 'pro',
              SubscriptionTotalNumber: 1,
              SubscriptionAssignedNumber: 0,
              NextCycleFlushTime: '2026-11-01T00:00:00Z',
              EquityList: [{ EquityType: 'CREDITS', TotalValue: '500', SurplusValue: '0' }],
            }),
          ],
        },
      },
      diagnostics,
    );

    expect(summaries).toEqual([
      {
        seatType: 'standard',
        seatCount: 3,
        assignedCount: 2,
        totalCredits: '300.3',
        remainingCredits: '150.15',
        remainingPct: 50,
        resetAt: '2026-10-30T00:00:00.000Z',
      },
      {
        seatType: 'pro',
        seatCount: 1,
        assignedCount: 0,
        totalCredits: '500',
        remainingCredits: '0',
        remainingPct: 0,
        resetAt: '2026-11-01T00:00:00.000Z',
      },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('leaves quota amounts and reset unknown when the same seat type has conflicting windows', () => {
    const diagnostics: SubscriptionDiagnostic[] = [];

    const summaries = parseTeamSeatTypeSummaries(
      {
        Data: {
          SubscriptionGroupList: [group(), group({ NextCycleFlushTime: '2026-11-01T00:00:00Z' })],
        },
      },
      diagnostics,
    );

    expect(summaries).toEqual([
      {
        seatType: 'standard',
        seatCount: 4,
        assignedCount: 2,
        totalCredits: null,
        remainingCredits: null,
        remainingPct: null,
        resetAt: null,
      },
    ]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        api: 'GetSeatSubscriptionSummary',
        errorCode: expect.stringMatching(/\S/),
      }),
    );
  });

  it('invalidates an impossible balance without clearing the confirmed total or seat count', () => {
    const diagnostics: SubscriptionDiagnostic[] = [];

    const summaries = parseTeamSeatTypeSummaries(
      {
        Data: {
          SubscriptionGroupList: [
            group({
              EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100', SurplusValue: '101' }],
            }),
          ],
        },
      },
      diagnostics,
    );

    expect(summaries).toEqual([
      {
        seatType: 'standard',
        seatCount: 2,
        assignedCount: 1,
        totalCredits: '100',
        remainingCredits: null,
        remainingPct: null,
        resetAt: '2026-10-30T00:00:00.000Z',
      },
    ]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        api: 'GetSeatSubscriptionSummary',
        errorCode: expect.stringMatching(/\S/),
      }),
    );
  });

  it('keeps assigned seats unknown when the reported count exceeds purchased seats', () => {
    const diagnostics: SubscriptionDiagnostic[] = [];

    const summaries = parseTeamSeatTypeSummaries(
      { Data: { SubscriptionGroupList: [group({ SubscriptionAssignedNumber: 3 })] } },
      diagnostics,
    );

    expect(summaries?.[0]).toEqual({
      seatType: 'standard',
      seatCount: 2,
      assignedCount: null,
      totalCredits: '100.1',
      remainingCredits: '50.05',
      remainingPct: 50,
      resetAt: '2026-10-30T00:00:00.000Z',
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        api: 'GetSeatSubscriptionSummary',
        errorCode: expect.stringMatching(/\S/),
      }),
    ]);
  });

  it.each([
    { EquityList: [] },
    { EquityList: [{ EquityType: 'REQUESTS', TotalValue: '100', SurplusValue: '50' }] },
    { EquityList: [{ TotalValue: '100', SurplusValue: '50' }] },
    { EquityList: [{ EquityCode: 'CREDITS' }] },
  ])('does not invent zero Credits from an unconfirmed equity list: %j', ({ EquityList }) => {
    const diagnostics: SubscriptionDiagnostic[] = [];

    const summaries = parseTeamSeatTypeSummaries(
      { Data: { SubscriptionGroupList: [group({ EquityList })] } },
      diagnostics,
    );

    expect(summaries?.[0]).toMatchObject({
      seatCount: 2,
      assignedCount: 1,
      totalCredits: null,
      remainingCredits: null,
      remainingPct: null,
    });
  });
});

describe('Confirmed team auto renewal', () => {
  it.each([0, null, 'false'])(
    'rejects a response whose explicit success marker is %j even when renewal data looks valid',
    (Success) => {
      expect(
        confirmedTeamAutoRenew({
          Success,
          Data: { AutoRenewal: 1, RenewalPeriod: 1, RenewalPeriodUnit: 'M' },
        }),
      ).toBeNull();
    },
  );

  it.each([
    [0, false],
    [1, true],
  ])('accepts documented renewal flag %j', (AutoRenewal, enabled) => {
    expect(
      confirmedTeamAutoRenew({
        Data: { AutoRenewal, RenewalPeriod: 1, RenewalPeriodUnit: 'M' },
      }),
    ).toEqual({ enabled, period: 1, periodUnit: 'M' });
  });

  it.each([null, undefined, 2, '0', '1', 'true', true])(
    'keeps unconfirmed renewal flag %j unknown instead of taking the legacy boolean',
    (AutoRenewal) => {
      expect(confirmedTeamAutoRenew({ EnableRenew: true, Data: { AutoRenewal } })).toBeNull();
    },
  );
});

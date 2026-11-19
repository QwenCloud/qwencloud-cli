import { createElement } from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import type { TokenPlanStatusResult } from '../../../src/types/tokenplan-subscription.js';
import { buildTokenPlanStatusViewModel } from '../../../src/view-models/subscription/tokenplan-status.js';
import { SubscriptionTokenPlanStatusInk } from '../../../src/ui/SubscriptionTokenPlanStatus.js';
import { buildTokenPlanSeatDetailsViewModel } from '../../../src/view-models/subscription/tokenplan-seat-details.js';

function personalResult(): TokenPlanStatusResult {
  return {
    product: 'Token Plan',
    period: null,
    autoRenew: null,
    renewable: null,
    seatSummary: null,
    diagnostics: [],
    individual: {
      edition: 'individual',
      commodityCode: 'sfm_tokenplansolo_public_intl',
      status: 'active',
      type: 'lite',
      name: 'Mock Personal Lite',
      specCode: 'lite',
      period: {
        start: '2026-09-09T09:09:09Z',
        end: '2026-11-20T00:00:00Z',
        remainingDays: 22,
      },
      remainingDays: 22,
      autoRenew: { enabled: true, period: 1, periodUnit: 'Month' },
      subscriptionId: null,
      endAt: '2026-11-20T00:00:00Z',
      tiers: [
        {
          tier: 'lite',
          windowType: 'weekly',
          totalCredits: '200.25',
          remainingCredits: null,
          remainingPct: 75,
          usedPct: 25,
          resetAt: '2026-10-30T00:00:00Z',
        },
      ],
      seatSummary: null,
      completeness: 'complete',
      diagnostics: [],
    },
  };
}

describe('Selected subscription view models', () => {
  it('keeps one row between editions and no trailing section margin', () => {
    const vm = buildTokenPlanStatusViewModel(personalResult(), 'tui');
    vm.editionSections = [
      {
        edition: 'individual',
        title: 'Individual',
        fields: [{ label: 'Subscription', value: 'individual-end' }],
      },
      { edition: 'team', title: 'Team', fields: [{ label: 'Subscription', value: 'team-end' }] },
    ];
    const instance = render(createElement(SubscriptionTokenPlanStatusInk, { vm }));
    try {
      const output = stripAnsi(instance.lastFrame() ?? '');
      expect(output).toMatch(/individual-end\n[^\S\n]*\n\s*Team/);
      expect(output).not.toMatch(/individual-end\n[^\S\n]*\n[^\S\n]*\n\s*Team/);
      expect(output).toMatch(/team-end$/);
    } finally {
      instance.unmount();
    }
  });
  it('sorts seat displays stably without changing response collections', () => {
    const result = personalResult();
    const types = ['max', 'Standard', 'pro', 'custom', 'standard'];
    result.team = {
      ...result.individual!,
      edition: 'team',
      seatSummaries: types.map((seatType) => ({
        seatType,
        seatCount: 1,
        assignedCount: null,
        totalCredits: null,
        remainingCredits: null,
        remainingPct: null,
        resetAt: null,
      })),
      seatDetails: {
        items: types.map((specType, index) => ({
          instanceCode: `mock-seat-${index}`,
          specType,
          status: 'NORMAL',
          assignment: 'unknown',
          totalValue: null,
          surplusValue: null,
        })),
        fetchedCount: 8,
        totalCount: 8,
        historicalCount: 3,
        collectionCompleteness: 'complete',
        completeness: 'partial',
        diagnostics: [],
      },
    };
    result.seatSummary = {
      groups: types.map((specType) => ({
        specType,
        seats: 1,
        assigned: null,
        totalValue: null,
        surplusValue: null,
        unit: 'Credits',
        nextCycleFlushTime: null,
      })),
      total: null,
    };
    const before = structuredClone(result);
    const vm = buildTokenPlanStatusViewModel(result, 'text');
    expect(
      vm.detailTables?.find((table) => table.edition === 'team')?.rows.map((row) => row[0]),
    ).toEqual(['Standard', 'standard', 'pro', 'max', 'custom']);
    expect(vm.seatLines?.map((row) => row.specType)).toEqual([
      'Standard',
      'Standard',
      'Pro',
      'Max',
      'unknown',
    ]);
    expect(vm.table?.rows).toEqual(vm.seatLines);
    expect(vm.seatDetails?.rows.map((row) => row[0])).toEqual([
      'mock-seat-1',
      'mock-seat-4',
      'mock-seat-2',
      'mock-seat-0',
      'mock-seat-3',
    ]);
    expect(vm.seatDetails?.note).not.toContain('Some seat fields are unknown.');
    expect(vm.seatDetails?.note).not.toContain('historical seats hidden');
    expect(vm.team).toEqual(before.team);
    expect(result).toEqual(before);
  });
  it('adds complete seat display fields while keeping machine fields and diagnostics intact', () => {
    const result = personalResult();
    result.team = {
      ...result.individual!,
      edition: 'team',
      commodityCode: 'sfm_tokenplanteams_dp_intl',
    };
    result.team.seatDetails = {
      items: [
        {
          instanceCode: 'mock-seat-\u001b[31m01\u001b[0m\nrow',
          specType: 'pro',
          status: 'NORMAL',
          assignment: 'assigned',
          totalValue: '100.00',
          surplusValue: '0.00',
        },
        {
          instanceCode: 'mock-seat-02',
          specType: null,
          status: null,
          assignment: 'unknown',
          totalValue: null,
          surplusValue: null,
        },
      ],
      fetchedCount: 3,
      totalCount: 3,
      historicalCount: 1,
      collectionCompleteness: 'complete',
      completeness: 'partial',
      diagnostics: [
        {
          api: 'GetSubscriptionDetail',
          errorCode: 'AssignmentConflict',
          errorMessage: 'Seat assignments disagree with the current seat summary.',
        },
      ],
    };
    const before = structuredClone(result);
    const vm = buildTokenPlanStatusViewModel(result, 'json');
    expect(vm.seatDetails?.title).toBe('SEAT DETAILS');
    expect(vm.seatDetails?.headers).toEqual([
      'SEAT ID',
      'SEAT TYPE',
      'STATUS',
      'ASSIGNMENT',
      'CREDITS (REMAINING / TOTAL)',
      'REMAINING (%)',
    ]);
    expect(vm.seatDetails?.rows).toEqual([
      ['mock-seat-01 row', 'Pro', 'active', 'assigned', '0 / 100', '0%'],
      ['mock-seat-02', 'unknown', 'unknown', 'unknown', 'unknown / unknown', '—'],
    ]);
    expect(vm.seatDetails?.note).not.toContain('Some seat fields are unknown.');
    expect(vm.seatDetails?.note).not.toContain('historical seats hidden');
    expect(
      vm.editionSections.find((section) => section.edition === 'individual'),
    ).not.toHaveProperty('seatDetails');
    expect(vm.editionSections.find((section) => section.edition === 'team')?.seatDetails).toEqual(
      vm.seatDetails,
    );
    expect(vm.warnings?.join('')).toContain('Seat assignments disagree');
    expect(vm.team).toEqual(before.team);
    expect(result).toEqual(before);
  });

  it.each([
    { totalValue: '0', surplusValue: '0', percentage: '—' },
    { totalValue: '100', surplusValue: '50.05', percentage: '50.05%' },
    { totalValue: null, surplusValue: '0', percentage: '—' },
  ])(
    'renders remaining percentage for $totalValue / $surplusValue',
    ({ totalValue, surplusValue, percentage }) => {
      const details = buildTokenPlanSeatDetailsViewModel(
        {
          items: [
            {
              instanceCode: 'mock-seat',
              specType: 'constructor',
              status: 'constructor',
              assignment: 'unknown',
              totalValue,
              surplusValue,
            },
          ],
          fetchedCount: 1,
          totalCount: 1,
          historicalCount: 0,
          collectionCompleteness: 'complete',
          completeness: 'partial',
          diagnostics: [],
        },
        'tokenplan',
      );
      expect(details?.rows[0].slice(1, 3)).toEqual(['unknown', 'unknown']);
      expect(details?.rows[0].at(-1)).toBe(percentage);
    },
  );

  it('separates confirmed empty details from an unavailable query', () => {
    const source = {
      items: [],
      fetchedCount: 0,
      totalCount: null,
      historicalCount: 0,
      collectionCompleteness: 'unknown' as const,
      completeness: 'unknown' as const,
      diagnostics: [],
    };
    expect(buildTokenPlanSeatDetailsViewModel(source, 'tokenplan')?.note).toContain(
      'Seat query unavailable',
    );
    expect(
      buildTokenPlanSeatDetailsViewModel(
        { ...source, totalCount: 0, collectionCompleteness: 'complete', completeness: 'complete' },
        'tokenplan',
      )?.note,
    ).toBe('No current seats.');
  });

  it.each([
    ['standard', 'Standard'],
    ['STANDARD', 'Standard'],
    ['Pro', 'Pro'],
    ['mAx', 'Max'],
    ['unknown-type', 'unknown'],
    ['constructor', 'unknown'],
  ])('formats the %s seat label without changing source fields', (specType, label) => {
    const result = personalResult();
    delete result.individual;
    result.seatSummary = {
      groups: [
        {
          specType,
          seats: 1,
          assigned: 0,
          totalValue: '100.00',
          surplusValue: '0.00',
          unit: 'Credits',
          nextCycleFlushTime: null,
        },
      ],
      total: { seats: 1, totalValue: '100.00', surplusValue: '0.00', unit: 'Credits' },
    };
    const before = structuredClone(result);

    for (const format of ['text', 'tui', 'json'] as const) {
      const vm = buildTokenPlanStatusViewModel(result, format);
      expect(vm.seatLines?.[0]?.specType).toBe(label);
      expect(vm.table?.rows[0]?.specType).toBe(label);
      expect(vm.totalLine?.specType).toBe('Total');
      expect(vm.seatSummary).toEqual(before.seatSummary);
      expect(result).toEqual(before);
    }
  });

  it('retains the legacy JSON keys and preserves the new personal field precision', () => {
    const vm = buildTokenPlanStatusViewModel(personalResult(), 'json');

    expect(vm.product).toBe('Token Plan');
    expect(vm.period).toBeNull();
    expect(vm.autoRenew).toBeNull();
    expect(vm.renewable).toBeNull();
    expect(vm.seatSummary).toBeNull();
    expect(vm.diagnostics).toEqual([]);
    expect(vm.individual?.period?.start).toBe('2026-09-09T09:09:09Z');
    expect(vm.individual?.tiers?.[0]).toEqual({
      tier: 'lite',
      windowType: 'weekly',
      totalCredits: '200.25',
      remainingCredits: null,
      remainingPct: 75,
      usedPct: 25,
      resetAt: '2026-10-30T00:00:00Z',
    });
    expect(vm.team).toBeUndefined();
    expect(vm.individual).not.toHaveProperty('harnessAllowances');
  });

  it.each(['text', 'tui'] as const)('omits subscription start from %s display fields', (format) => {
    const vm = buildTokenPlanStatusViewModel(personalResult(), format);
    const displayFields = JSON.stringify(vm.editionSections);

    expect(vm.editionSections).toHaveLength(1);
    expect(displayFields).not.toContain('2026-09-09');
    expect(displayFields).toContain('2026-11-20');
    expect(displayFields).not.toContain('Mock Personal Lite');
    expect(vm.individual?.name).toBe('Mock Personal Lite');
    expect(vm.individual?.period?.start).toBe('2026-09-09T09:09:09Z');
  });

  it('renders personal quota metadata with separate expiry and reset dates', () => {
    const vm = buildTokenPlanStatusViewModel(personalResult(), 'tui');
    const instance = render(createElement(SubscriptionTokenPlanStatusInk, { vm }));
    try {
      const frame = stripAnsi(instance.lastFrame() ?? '');

      expect(frame).not.toContain('Mock Personal Lite');
      expect(frame).toContain('2026-11-20');
      expect(frame).toContain('2026-10-30');
      expect(frame).not.toContain('200.25');
      expect(frame).not.toContain('TOTAL CREDITS');
      expect(frame).not.toContain('REMAINING CREDITS');
      expect(frame).toContain('25%');
      expect(frame).toContain('75');
      expect(frame).not.toContain('Subscription ID');
      expect(frame).not.toContain('2026-09-09');
    } finally {
      instance.unmount();
    }
  });

  it('keeps legacy team period start in JSON while removing it from display', () => {
    const result = personalResult();
    delete result.individual;
    result.product = 'Mock Team Token Plan';
    result.period = {
      start: '2026-09-09T09:09:09Z',
      end: '2026-11-20T00:00:00Z',
      remainingDays: 22,
    };

    const json = buildTokenPlanStatusViewModel(result, 'json');
    const text = buildTokenPlanStatusViewModel(result, 'text');

    expect(json.period).toEqual(result.period);
    expect(text.header?.period).toContain('2026-11-20');
    expect(text.header?.period).not.toContain('2026-09-09');
  });

  it('keeps the not-subscribed view minimal without names or empty placeholder fields', () => {
    const result = personalResult();
    result.individual = {
      edition: 'individual',
      commodityCode: 'sfm_tokenplansolo_public_intl',
      status: 'not_subscribed',
      type: null,
      name: null,
      specCode: null,
      period: null,
      remainingDays: null,
      autoRenew: null,
      subscriptionId: null,
      endAt: null,
      seatSummary: null,
      completeness: 'complete',
      diagnostics: [],
    };
    delete result.team;

    const vm = buildTokenPlanStatusViewModel(result, 'text');
    const fields = vm.editionSections.find((section) => section.edition === 'individual')?.fields;

    expect(fields).toEqual([
      { label: 'Status', value: 'not_subscribed' },
      { label: 'Subscription', value: 'No active Individual Token Plan subscription.' },
    ]);
    for (const label of ['Subscription ID', 'Commodity', 'Edition', 'End At', 'Remaining Days'])
      expect(fields?.some((field) => field.label === label)).toBe(false);
  });

  it('hides the Subscription ID row without a trusted id while keeping the JSON value', () => {
    const result = personalResult();
    const before = structuredClone(result);
    const vm = buildTokenPlanStatusViewModel(result, 'text');
    const fields = vm.editionSections.find((section) => section.edition === 'individual')?.fields;
    expect(fields?.some((field) => field.label === 'Subscription ID')).toBe(false);
    expect(vm.individual?.subscriptionId).toBeNull();

    const withId = personalResult();
    withId.individual = { ...withId.individual!, subscriptionId: 'fixture-subscription' };
    const vmWithId = buildTokenPlanStatusViewModel(withId, 'text');
    const fieldsWithId = vmWithId.editionSections.find(
      (section) => section.edition === 'individual',
    )?.fields;
    expect(fieldsWithId?.find((field) => field.label === 'Subscription ID')?.value).toBe(
      'fixture-subscription',
    );
    expect(vmWithId.individual?.subscriptionId).toBe('fixture-subscription');
    expect(result).toEqual(before);
  });

  it.each([
    { subscriptionId: null, subscriptionIds: [] },
    { subscriptionId: 'mock-team-seat', subscriptionIds: ['mock-team-seat'] },
    { subscriptionId: null, subscriptionIds: ['mock-team-seat', 'mock-team-second'] },
  ])('hides team seat identifiers in status fields for %j', (identity) => {
    const result = personalResult();
    result.team = { ...result.individual!, ...identity, edition: 'team' };
    const before = structuredClone(result);
    for (const format of ['text', 'tui'] as const) {
      const vm = buildTokenPlanStatusViewModel(result, format);
      const fields = vm.editionSections.find((section) => section.edition === 'team')!.fields;
      expect(fields.some((field) => /^Subscription IDs?$/.test(field.label))).toBe(false);
      expect(vm.team).toEqual(before.team);
    }
    expect(result).toEqual(before);
  });

  it.each([160, 40])(
    'renders team Credit guidance without duplicated seats at %s columns',
    (columns) => {
      const result = personalResult();
      result.team = {
        ...result.individual!,
        edition: 'team',
        name: 'Mock Team Name',
        commodityCode: 'sfm_tokenplanteams_dp_intl',
        subscriptionId: 'mock-team-subscription',
        subscriptionIds: ['mock-team-subscription', 'mock-team-second'],
        seatSummaries: [
          {
            seatType: 'pro',
            seatCount: 2,
            assignedCount: 1,
            totalCredits: '100',
            remainingCredits: '50',
            remainingPct: 50,
            resetAt: null,
          },
        ],
        seatDetails: {
          items: [
            {
              instanceCode: 'mock-hidden-seat',
              specType: null,
              status: null,
              assignment: 'unknown',
              totalValue: null,
              surplusValue: null,
            },
          ],
          fetchedCount: 2,
          totalCount: 2,
          historicalCount: 1,
          collectionCompleteness: 'complete',
          completeness: 'partial',
          diagnostics: [],
        },
      };
      const before = structuredClone(result);
      const originalColumns = process.stdout.columns;
      Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
      const vm = buildTokenPlanStatusViewModel(result, 'tui');
      const instance = render(createElement(SubscriptionTokenPlanStatusInk, { vm }));
      try {
        const frame = stripAnsi(instance.lastFrame() ?? '').replace(/\s+/g, ' ');
        expect(frame).not.toContain('Subscription ID');
        expect(frame).toContain('TEAM CREDIT SUMMARY');
        expect(frame).toContain(
          'The total credits is the sum of the credits of all seats of the same seat type.',
        );
        expect(frame).toContain('Only active seats are shown.');
        expect(frame).toContain(
          'Run qwencloud subscription tokenplan seats for per-seat member and quota details.',
        );
        for (const text of [
          'Mock Team Name',
          'Mock Personal Lite',
          'SEAT SUMMARY',
          'SEAT DETAILS',
          'mock-hidden-seat',
          'mock-team-subscription',
          'mock-team-second',
          'Some seat fields are unknown.',
          'historical seats hidden',
        ])
          expect(frame).not.toContain(text);
        expect(vm.team).toEqual(before.team);
        expect(result).toEqual(before);
      } finally {
        instance.unmount();
        Object.defineProperty(process.stdout, 'columns', {
          value: originalColumns,
          configurable: true,
        });
      }
    },
  );
});

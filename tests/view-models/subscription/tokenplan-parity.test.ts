import { describe, expect, it } from 'vitest';
import type { TokenPlanListResult } from '../../../src/types/tokenplan-catalog.js';
import type { TokenPlanStatusResult } from '../../../src/types/tokenplan-subscription.js';
import { buildTokenPlanListViewModel } from '../../../src/view-models/subscription/tokenplan-list.js';
import { buildTokenPlanStatusViewModel } from '../../../src/view-models/subscription/tokenplan-status.js';
import { buildTokenPlanStatusDetails } from '../../../src/view-models/subscription/tokenplan-details.js';
import { formatSubscriptionStatusJson } from '../../../src/view-models/subscription/shared.js';

function catalog(): TokenPlanListResult {
  return {
    authenticated: true,
    edition: 'individual',
    billingCycle: 'monthly',
    completeness: 'complete',
    sections: [
      {
        edition: 'individual',
        billingCycleSupported: true,
        subscriptionStatus: 'active',
        currentPlan: 'Mock Personal Lite',
        currentBillingCycle: 'monthly',
        currentPlanDetails: {
          subscriptionId: null,
          endAt: '2026-11-20T00:00:00Z',
          totalCredits: '200',
          remainingCredits: null,
          remainingPct: 75,
          quotaWindowType: 'weekly',
        },
        subscriptionUrl: 'https://mock-console.test.qwencloud.com/analytics/token-plan/individual',
        diagnostics: [],
        rows: [
          {
            type: 'token_plan_individual_lite',
            specCode: 'lite',
            seatType: null,
            name: 'Lite',
            price: '15.01',
            currency: 'USD',
            inventory: true,
            weeklyCredits: 200,
            monthlyCredits: null,
            status: 'purchasable',
          },
        ],
        plans: [
          {
            tier: 'lite',
            billingTerm: 'monthly',
            listPrice: '20.01',
            promoPrice: '15.01',
            currency: 'USD',
            quotaWindows: [
              { windowType: 'five_hour', totalCredits: '777' },
              { windowType: 'weekly', totalCredits: '200' },
              { windowType: 'monthly', totalCredits: '500' },
            ],
          },
        ],
      },
    ],
  };
}

function status(): TokenPlanStatusResult {
  return {
    product: 'Token Plan Team Edition',
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
        start: '2026-10-01T00:00:00Z',
        end: '2026-11-20T00:00:00Z',
        remainingDays: 22,
      },
      remainingDays: 22,
      autoRenew: { enabled: true, period: 1, periodUnit: 'M' },
      subscriptionId: null,
      endAt: '2026-11-20T00:00:00Z',
      tiers: [
        {
          tier: 'lite',
          windowType: 'weekly',
          totalCredits: '200',
          remainingCredits: null,
          remainingPct: 75,
          usedPct: 25,
          resetAt: '2026-10-30T00:00:00Z',
        },
      ],
      weeklyCredits: {
        total: 200,
        used: null,
        remaining: null,
        usedPct: 25,
        resetTime: '2026-10-30T00:00:00Z',
      },
      seatSummary: null,
      completeness: 'complete',
      diagnostics: [],
    },
  };
}

function teamStatus(): TokenPlanStatusResult {
  const result = status();
  delete result.individual;
  result.team = {
    edition: 'team',
    commodityCode: 'sfm_tokenplanteams_dp_intl',
    status: 'active',
    type: null,
    name: 'Mock Team',
    specCode: null,
    period: null,
    remainingDays: null,
    autoRenew: null,
    seatSummary: null,
    seatSummaries: [
      {
        seatType: 'standard',
        seatCount: 3,
        assignedCount: 2,
        totalCredits: '20',
        remainingCredits: null,
        remainingPct: 0,
        resetAt: null,
      },
      {
        seatType: 'pro',
        seatCount: 1,
        assignedCount: null,
        totalCredits: '100',
        remainingCredits: null,
        remainingPct: null,
        resetAt: null,
      },
      {
        seatType: 'max',
        seatCount: 2,
        assignedCount: 2,
        totalCredits: null,
        remainingCredits: null,
        remainingPct: null,
        resetAt: null,
      },
    ],
    completeness: 'partial',
    diagnostics: [],
  };
  return result;
}

describe('Catalog status and summary parity', () => {
  it.each([
    { usedPct: 0.005, expectedUsed: 0.005, expectedRemaining: 99.995, display: '0.01%' },
    { usedPct: 0.04, expectedUsed: 0.04, expectedRemaining: 99.96, display: '0.04%' },
    { usedPct: 7, expectedUsed: 7, expectedRemaining: 93, display: '7%' },
    { usedPct: 0, expectedUsed: 0, expectedRemaining: 100, display: '0%' },
    { usedPct: 100, expectedUsed: 100, expectedRemaining: 0, display: '100%' },
    { usedPct: null, expectedUsed: null, expectedRemaining: null, display: '—' },
    { usedPct: undefined, expectedUsed: null, expectedRemaining: null, display: '—' },
    { usedPct: NaN, expectedUsed: null, expectedRemaining: null, display: '—' },
    { usedPct: Infinity, expectedUsed: null, expectedRemaining: null, display: '—' },
    { usedPct: -1, expectedUsed: null, expectedRemaining: null, display: '—' },
    { usedPct: 101, expectedUsed: null, expectedRemaining: null, display: '—' },
  ])('preserves native personal percentages for %j', (fixture) => {
    const result = catalog();
    result.sections[0]!.currentPlanDetails!.usedPct = fixture.usedPct;
    const before = structuredClone(result);
    const vm = buildTokenPlanListViewModel(result);
    expect(vm.data.sections[0]!.currentPlanDetails).toEqual({
      subscriptionId: null,
      endAt: '2026-11-20T00:00:00Z',
      usedPct: fixture.expectedUsed,
      remainingPct: fixture.expectedRemaining,
      quotaWindowType: 'weekly',
    });
    expect(vm.sections[0]!.subscriptionDetails.join('\n')).toContain(
      `Used (%): ${fixture.display};`,
    );
    expect(JSON.stringify(vm.data)).not.toMatch(/totalCredits|remainingCredits/);
    expect(result).toEqual(before);
  });

  it.each([false, true])(
    'shows the login guide only when authenticated=%s is false',
    (authenticated) => {
      const result = catalog();
      result.authenticated = authenticated;
      const vm = buildTokenPlanListViewModel(result);
      const guide = 'To view your subscription status and account-specific availability, run:';
      expect(vm.note.includes(guide)).toBe(!authenticated);
      expect(vm.note.includes('  qwencloud auth login')).toBe(!authenticated);
      expect(vm.note).toContain(
        'Your purchase status shown here is for reference only. Your eligibility will be verified again before purchase.',
      );
      expect(vm.note).not.toContain('Log in to also view');
      expect(vm.note).not.toContain('Availability shown here is for reference.');
      expect(vm.note).not.toContain('subscription tokenplan purchase');
    },
  );

  it.each([
    { individual: 'not_subscribed', team: 'not_subscribed', titles: [] },
    { individual: 'not_subscribed', team: 'active', titles: ['TEAM CREDIT SUMMARY'] },
    { individual: 'active', team: 'not_subscribed', titles: ['INDIVIDUAL CREDIT WINDOWS'] },
    {
      individual: 'unknown',
      team: 'unknown',
      titles: ['INDIVIDUAL CREDIT WINDOWS', 'TEAM CREDIT SUMMARY'],
    },
  ] as const)('keeps empty tables only for queried uncertain or active editions: %j', (fixture) => {
    const result = status();
    result.individual!.status = fixture.individual;
    result.individual!.tiers = [];
    result.team = { ...teamStatus().team!, status: fixture.team, seatSummaries: [] };
    const before = structuredClone(result);
    expect(buildTokenPlanStatusDetails(result).map((table) => table.title)).toEqual(fixture.titles);
    expect(
      buildTokenPlanStatusViewModel(result, 'text').detailTables?.map((table) => table.title),
    ).toEqual(fixture.titles);
    expect(result).toEqual(before);
  });
  it.each([
    { edition: 'individual', remainingPct: 75, total: '200', remaining: '199', expected: 75 },
    { edition: 'individual', remainingPct: 0, total: '200', remaining: '199', expected: 0 },
    { edition: 'individual', remainingPct: 100, total: '200', remaining: '199', expected: 100 },
    { edition: 'individual', remainingPct: null, total: '200', remaining: '200', expected: null },
    { edition: 'individual', remainingPct: NaN, total: '200', remaining: '200', expected: null },
    { edition: 'individual', remainingPct: -1, total: '200', remaining: '200', expected: null },
    { edition: 'individual', remainingPct: 101, total: '200', remaining: '200', expected: null },
    { edition: 'team', total: '200', remaining: '150', expected: 75 },
    { edition: 'team', total: '200', remaining: '0', expected: 0 },
    { edition: 'team', total: '200', remaining: '200', expected: 100 },
    { edition: 'team', total: null, remaining: '150', expected: null },
    { edition: 'team', total: '200', remaining: null, expected: null },
    { edition: 'team', total: '0', remaining: '0', expected: null },
    { edition: 'team', total: '200', remaining: '201', expected: null },
    { edition: 'team', total: '-200', remaining: '150', expected: null },
    { edition: 'team', total: '1e3', remaining: '150', expected: null },
    { edition: 'team', total: '9007199254740993', remaining: '9007199254740994', expected: null },
  ] as const)('projects catalog usage ratios without Credit quantities for %j', (fixture) => {
    const result = catalog();
    const section = result.sections[0]!;
    section.edition = fixture.edition;
    section.currentPlanDetails = {
      subscriptionId: null,
      endAt: '2026-11-20T00:00:00Z',
      totalCredits: fixture.total,
      remainingCredits: fixture.remaining,
      ...('remainingPct' in fixture ? { remainingPct: fixture.remainingPct } : {}),
    };
    const before = structuredClone(result);
    const vm = buildTokenPlanListViewModel(result);
    expect(vm.data.sections[0]!.currentPlanDetails).toEqual(
      fixture.edition === 'team'
        ? { subscriptionId: null, endAt: '2026-11-20T00:00:00Z' }
        : {
            subscriptionId: null,
            endAt: '2026-11-20T00:00:00Z',
            usedPct: fixture.expected === null ? null : 100 - fixture.expected,
            remainingPct: fixture.expected,
          },
    );
    if (fixture.edition === 'team')
      expect(vm.sections[0]!.subscriptionDetails.join('\n')).not.toMatch(
        /Used \(%\)|Remaining \(%\)/,
      );
    expect(JSON.stringify(vm.data)).not.toMatch(
      /totalCredits|remainingCredits|weeklyCredits|monthlyCredits/,
    );
    expect(vm.sections[0]!.columns.some((column) => column.key === 'totalCredits')).toBe(false);
    expect(vm.sections[0]!.rows[0]).not.toHaveProperty('totalCredits');
    expect(vm.sections[0]!.subscriptionDetails.join('\n')).not.toMatch(
      /Total Credits|Remaining Credits/,
    );
    expect(result).toEqual(before);
  });

  it.each([
    ['TG', 'Text Generation'],
    ['ASR', 'Speech Recognition'],
    ['TTS', 'Text-to-Speech'],
    ['IU', 'Image Understanding'],
    ['VU', 'Visual Understanding'],
    ['IG', 'Image Generation'],
    ['VG', 'Video Generation'],
    ['IP', 'Image Processing'],
    ['TR', 'Embedding'],
    ['ME', 'Multimodal Embedding'],
    ['RK', 'Reranking'],
    ['AU', 'Audio Understanding'],
    ['OMNI', 'Omni'],
    ['Reasoning', 'Reasoning Model'],
    ['QwQ', 'Reasoning Model'],
    ['Realtime-Text-to-Speech', 'Real-Time Speech Synthesis'],
    ['Realtime-Omni', 'Realtime Omni'],
    ['Realtime-Voice-Replication', 'Realtime Voice Replication'],
    ['Multimodal-Omni', 'Omni'],
    ['Realtime-ASR', 'Realtime ASR'],
    ['Realtime-Audio-Translate', 'Realtime Audio Translate'],
    ['Realtime-Chatting', 'Realtime Chatting'],
  ])(
    'displays the English capability name for %s while preserving its JSON code',
    (code, label) => {
      const result = catalog();
      const models = [
        {
          modelId: 'mock-model-id',
          modelBrand: 'Mock Brand',
          modelName: 'Localized Model Name',
          capabilities: [code!],
        },
      ];
      result.sections[0]!.plans![0]!.supportedModels = models;
      const original = structuredClone(result);

      const vm = buildTokenPlanListViewModel(result);

      expect(vm.sections[0]?.details[0]?.rows).toEqual([
        ['Mock Brand', 'mock-model-id', label, '—'],
      ]);
      expect(vm.data.sections[0]?.plans?.[0]?.supportedModels).toEqual(models);
      expect(result).toEqual(original);
    },
  );

  it.each(['individual', 'team'] as const)(
    'deduplicates translated aliases and displays ordered tags for %s',
    (edition) => {
      const result = catalog();
      result.edition = edition;
      result.sections[0]!.edition = edition;
      const models = [
        {
          modelId: 'mock-model-id',
          modelBrand: 'Mock Brand',
          modelName: 'Localized Model Name',
          capabilities: ['TG', 'Reasoning', 'QwQ', 'OMNI', 'Multimodal-Omni', 'mock-future'],
          isNew: true,
          badgeLabel: 'Limited Offer',
          badgeDescription: 'Available this month',
        },
        {
          modelId: 'mock-existing',
          modelBrand: 'Mock Brand',
          modelName: 'Existing Model',
          capabilities: [],
          isNew: false,
          badgeLabel: '',
          badgeDescription: '',
        },
        {
          modelId: 'mock-promo',
          modelBrand: 'Mock Brand',
          modelName: 'Promo Model',
          capabilities: [],
          badgeLabel: 'Promo',
          badgeDescription: 'Tooltip only',
        },
        {
          modelId: 'mock-new',
          modelBrand: 'Mock Brand',
          modelName: 'New Model',
          capabilities: [],
          isNew: true,
        },
      ];
      result.sections[0]!.plans![0]!.supportedModels = models;
      const original = structuredClone(result);

      const vm = buildTokenPlanListViewModel(result);

      expect(vm.sections[0]?.details[0]?.headers).toEqual([
        'MODEL BRAND',
        'MODEL NAME',
        'CAPABILITIES',
        'TAG',
      ]);
      expect(vm.sections[0]?.details[0]?.rows).toEqual([
        [
          'Mock Brand',
          'mock-model-id',
          'Text Generation, Reasoning Model, Omni, mock-future',
          'New, Limited Offer',
        ],
        ['Mock Brand', 'mock-existing', '', '—'],
        ['Mock Brand', 'mock-promo', '', 'Promo'],
        ['Mock Brand', 'mock-new', '', 'New'],
      ]);
      expect(vm.data.sections[0]?.plans?.[0]?.supportedModels).toEqual(models);
      expect(vm.data.sections[0]?.plans?.[0]?.quotaWindows).not.toContainEqual({
        windowType: 'five_hour',
        totalCredits: '777',
      });
      expect(result).toEqual(original);
    },
  );

  it.each([
    ['purchasable', 'purchasable'],
    ['unavailable', 'not_subscribable'],
    ['subscribed', 'current_plan'],
    ['upgrade', 'upgrade_on_web'],
    ['unknown', 'unknown'],
  ] as const)('keeps the individual Status column and maps %s to %s', (rawStatus, expected) => {
    const result = catalog();
    result.sections[0]!.rows[0]!.status = rawStatus;
    const original = structuredClone(result);

    const vm = buildTokenPlanListViewModel(result);

    expect(vm.sections[0]?.columns).toContainEqual({ key: 'status', header: 'Status' });
    expect(vm.sections[0]?.rows[0]?.status).toBe(expected);
    expect(result).toEqual(original);
  });

  it.each(['active', 'not_subscribed', 'unknown'] as const)(
    'shows row Status for team state %s only when the subscription is not active',
    (subscriptionStatus) => {
      const result = catalog();
      result.edition = 'team';
      result.sections[0]!.edition = 'team';
      result.sections[0]!.subscriptionStatus = subscriptionStatus;
      result.sections[0]!.rows[0]!.seatType = 'standard';
      result.sections[0]!.rows[0]!.specCode = 'standard';
      result.sections[0]!.rows[0]!.type = 'token_plan_team_standard';
      result.sections[0]!.plans = [
        {
          seatType: 'standard',
          billingTerm: 'monthly',
          listPrice: '20.01',
          promoPrice: '15.01',
          currency: 'USD',
          quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
        },
      ];

      const vm = buildTokenPlanListViewModel(result);

      expect(vm.sections[0]?.columns.some((column) => column.key === 'status')).toBe(
        subscriptionStatus !== 'active',
      );
    },
  );

  it('places View subscription after the other current-plan summary fields', () => {
    const vm = buildTokenPlanListViewModel(catalog());
    const summary = vm.sections[0]!.subscriptionDetails;

    expect(summary.at(-1)).toBe(
      'View subscription: https://mock-console.test.qwencloud.com/analytics/token-plan/individual',
    );
    expect(vm.data.sections[0]?.subscriptionUrl).toBe(
      'https://mock-console.test.qwencloud.com/analytics/token-plan/individual',
    );
    expect(summary).toContain('End At: 2026-11-20 00:00:00 (UTC)');
  });
});

describe('Confirmed renewal and JSON compatibility', () => {
  it('preserves every legacy timestamp while normalizing added edition timestamps', () => {
    const source = {
      ...status(),
      period: { start: '2026-10-01T00:00:00+08:00', end: '2026-11-20T00:00:00Z' },
      seatSummary: { groups: [{ nextCycleFlushTime: '2026-10-30T00:00:00+08:00' }], total: null },
      recentOrders: [{ orderTime: '2026-10-01T00:00:00Z' }],
      creditPacks: [{ expiresAt: '2026-11-20T00:00:00+08:00' }],
    };
    const before = structuredClone(source);
    const result = formatSubscriptionStatusJson(source) as typeof source;
    expect(result.period).toEqual(before.period);
    expect(result.seatSummary).toEqual(before.seatSummary);
    expect(result.recentOrders).toEqual(before.recentOrders);
    expect(result.creditPacks).toEqual(before.creditPacks);
    expect(result.individual?.period?.start).toBe('2026-10-01T00:00:00.000Z');
    expect(source).toEqual(before);
  });

  it.each(['text', 'tui'] as const)(
    'keeps explicit unconfirmed renewal unknown in %s while allowing legacy fallback only when absent',
    (format) => {
      const confirmedUnknown = status();
      confirmedUnknown.individual!.confirmedAutoRenew = null;
      const vm = buildTokenPlanStatusViewModel(confirmedUnknown, format);
      const fields = vm.editionSections![0]!.fields;

      expect(fields.find((field) => /auto.*renew/i.test(field.label))?.value).toBe('unknown');

      const legacy = buildTokenPlanStatusViewModel(status(), format);
      expect(
        legacy.editionSections![0]!.fields.find((field) => /auto.*renew/i.test(field.label))?.value,
      ).toBe('On');
    },
  );

  it('hides personal absolute usage in JSON without inventing Credits or mutating input', () => {
    const result = status();
    result.individual!.monthlyCredits = {
      total: 500,
      used: null,
      remaining: null,
      usedPct: 25,
      resetTime: '2026-10-30T00:00:00Z',
    };
    const monthlyTier = {
      ...result.individual!.tiers![0]!,
      windowType: 'monthly' as const,
      totalCredits: '500',
    };
    result.individual!.tiers!.push(monthlyTier);
    const original = structuredClone(result);

    const json = formatSubscriptionStatusJson(result) as Record<string, unknown> & {
      individual: Record<string, unknown> & {
        monthlyCredits: Record<string, unknown>;
        tiers: Array<Record<string, unknown>>;
        period: { start: string; end: string };
      };
    };

    expect(json).toMatchObject({
      product: 'Token Plan Team Edition',
      period: null,
      autoRenew: null,
      renewable: null,
      seatSummary: null,
      diagnostics: [],
    });
    expect(json.individual.weeklyCredits).toEqual({
      usedPct: 25,
      remainingPct: 75,
      resetTime: '2026-10-30T00:00:00.000Z',
    });
    expect(json.individual.monthlyCredits).toEqual({
      usedPct: 25,
      remainingPct: 75,
      resetTime: '2026-10-30T00:00:00.000Z',
    });
    expect(json.individual.tiers).toEqual([
      {
        tier: 'lite',
        windowType: 'weekly',
        usedPct: 25,
        remainingPct: 75,
        resetAt: '2026-10-30T00:00:00Z',
      },
      {
        tier: 'lite',
        windowType: 'monthly',
        usedPct: 25,
        remainingPct: 75,
        resetAt: '2026-10-30T00:00:00Z',
      },
    ]);
    expect(json.individual.period.start).toBe('2026-10-01T00:00:00.000Z');
    expect(json.individual.period.end).toBe('2026-11-20T00:00:00.000Z');
    expect(json).not.toHaveProperty('team');
    expect(json.individual).not.toHaveProperty('harnessAllowances');
    expect(result).toEqual(original);
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, 101, '25'])(
    'keeps invalid personal usedPct %s unknown without deriving from Credits quantities',
    (usedPct) => {
      expect(
        formatSubscriptionStatusJson({
          edition: 'individual',
          monthlyCredits: { total: 100, used: 0, remaining: 100, usedPct },
        }),
      ).toEqual({ edition: 'individual', monthlyCredits: { usedPct: null, remainingPct: null } });
    },
  );
});

describe('Team remaining Credits column', () => {
  it.each(['null', 'absent'] as const)(
    'omits the remaining Credits column and every row cell when all balances are unknown (%s)',
    (unknownShape) => {
      const result = teamStatus();
      if (unknownShape === 'absent') {
        Reflect.deleteProperty(result.team!.seatSummaries![1]!, 'remainingCredits');
      }
      const original = structuredClone(result);

      const tables = buildTokenPlanStatusDetails(result);

      expect(tables).toHaveLength(1);
      expect(tables[0]!.title).toBe('TEAM CREDIT SUMMARY');
      expect(tables[0]!.headers).toEqual([
        'SEAT TYPE',
        'SEAT COUNT',
        'TOTAL CREDITS',
        'REMAINING (%)',
        'RESET AT',
      ]);
      expect(tables[0]!.rows).toEqual([
        ['standard', '3', '20', '0%', '—'],
        ['pro', '1', '100', '—', '—'],
        ['max', '2', '—', '—', '—'],
      ]);
      expect(formatSubscriptionStatusJson(result)).toHaveProperty('team', original.team);
      expect(result).toEqual(original);
    },
  );

  it('keeps the column for a trustworthy zero and preserves placeholders for null and absent rows', () => {
    const result = teamStatus();
    result.team!.seatSummaries![0]!.remainingCredits = '0';
    Reflect.deleteProperty(result.team!.seatSummaries![1]!, 'remainingCredits');
    const original = structuredClone(result);

    const tables = buildTokenPlanStatusDetails(result);

    expect(tables).toHaveLength(1);
    expect(tables[0]!.title).toBe('TEAM CREDIT SUMMARY');
    expect(tables[0]!.headers).toEqual([
      'SEAT TYPE',
      'SEAT COUNT',
      'TOTAL CREDITS',
      'REMAINING CREDITS',
      'REMAINING (%)',
      'RESET AT',
    ]);
    expect(tables[0]!.rows).toEqual([
      ['standard', '3', '20', '0', '0%', '—'],
      ['pro', '1', '100', '—', '—', '—'],
      ['max', '2', '—', '—', '—', '—'],
    ]);
    expect(formatSubscriptionStatusJson(result)).toHaveProperty('team', original.team);
    expect(result).toEqual(original);
  });
});

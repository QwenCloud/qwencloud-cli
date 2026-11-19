import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../../src/cli.js';
import * as clientModule from '../../../src/api/client.js';
import type {
  TokenPlanCatalogPlan,
  TokenPlanListResult,
} from '../../../src/types/tokenplan-catalog.js';
import type { TokenPlanStatusResult } from '../../../src/types/tokenplan-subscription.js';
import type { TokenPlanListService } from '../../../src/services/tokenplan-list-service.js';
import { SubscriptionTokenPlanService } from '../../../src/services/subscription-tokenplan-service.js';
import type { ApiClient } from '../../../src/api/api-client.js';
import { registerSubscriptionTokenPlanCommands } from '../../../src/commands/subscription/tokenplan/index.js';
import { registerSubscriptionCommands } from '../../../src/commands/subscription/index.js';
import { formatSubscriptionStatusJson } from '../../../src/view-models/subscription/shared.js';
import {
  buildTokenPlanListViewModel,
  type TokenPlanListJsonResult,
} from '../../../src/view-models/subscription/tokenplan-list.js';
import { renderTextTokenPlanList } from '../../../src/output/text/tokenplan-list.js';
import { TokenPlanListInk } from '../../../src/ui/TokenPlanList.js';
import { SubscriptionTokenPlanStatusInk } from '../../../src/ui/SubscriptionTokenPlanStatus.js';
import { buildTokenPlanStatusViewModel } from '../../../src/view-models/subscription/tokenplan-status.js';
import { CliError } from '../../../src/utils/errors.js';
import {
  registerCommandInterrupt,
  interruptActiveCommand,
} from '../../../src/utils/command-interrupt.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import { runCommand } from '../../helpers/run-command.js';

describe('Command cancellation registration lifecycle', () => {
  it('does not restore a completed handler after out-of-order cleanup', () => {
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    const cleanupFirst = registerCommandInterrupt(first);
    const cleanupSecond = registerCommandInterrupt(second);
    const cleanupThird = registerCommandInterrupt(third);
    try {
      cleanupSecond();
      cleanupFirst();
      expect(interruptActiveCommand()).toBe(true);
      expect(third).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
      cleanupThird();
      cleanupThird();
      expect(interruptActiveCommand()).toBe(false);
    } finally {
      cleanupFirst();
      cleanupSecond();
      cleanupThird();
    }
  });

  it('tracks separate registrations of the same callback and idempotent cleanup', () => {
    const shared = vi.fn();
    const later = vi.fn();
    const cleanupFirst = registerCommandInterrupt(shared);
    const cleanupSecond = registerCommandInterrupt(shared);
    const cleanupLater = registerCommandInterrupt(later);
    try {
      cleanupFirst();
      cleanupFirst();
      cleanupLater();
      expect(interruptActiveCommand()).toBe(true);
      expect(shared).toHaveBeenCalledTimes(1);
      expect(later).not.toHaveBeenCalled();
      cleanupSecond();
      expect(interruptActiveCommand()).toBe(false);
    } finally {
      cleanupFirst();
      cleanupSecond();
      cleanupLater();
    }
  });
});

const { ensureAuthenticated, resolveCredentials } = vi.hoisted(() => ({
  ensureAuthenticated: vi.fn(() => ({})),
  resolveCredentials: vi.fn(() => null),
}));
vi.mock('../../../src/auth/credentials.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ensureAuthenticated,
  resolveCredentials,
  readCredentials: vi.fn(() => null),
  isTokenExpired: vi.fn(() => false),
}));
vi.mock('../../../src/config/manager.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getEffectiveConfig: vi.fn(() => ({})),
  getConfigValue: vi.fn(() => undefined),
}));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, run: () => Promise<unknown>) => run(),
}));

describe('Token Plan option validation through the command parser', () => {
  it.each([
    ['list', '--edition'],
    ['status', '--edition'],
    ['list', '--billing-cycle'],
  ])('returns an argument error for a missing %s %s value', async (action, flag) => {
    const factory = vi.spyOn(clientModule, 'createClient').mockImplementation(() => {
      throw new Error('Unexpected client creation');
    });
    for (const flags of [
      ['--format', 'json', flag],
      [flag, '--format', 'json'],
    ]) {
      await expect(
        createProgram().parseAsync(['subscription', 'tokenplan', action, ...flags], {
          from: 'user',
        }),
      ).rejects.toMatchObject({ code: 'commander.optionMissingArgument', exitCode: 4 });
    }
    expect(factory).not.toHaveBeenCalled();
    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  it.each([
    ['subscription', 'tokenplan', 'list', '--format'],
    ['subscription', 'tokenplan', 'status', '--format'],
    ['models', 'info'],
    ['subscription', 'tokenplan', 'list', '--unknown-option'],
  ])('preserves the existing parser exit code for %j', async (...args) => {
    await expect(createProgram().parseAsync(args, { from: 'user' })).rejects.toMatchObject({
      exitCode: 1,
    });
  });

  it.each([
    ['list', '--edition', 'invalid'],
    ['status', '--edition', 'invalid'],
    ['list', '--billing-cycle', 'all'],
  ])('retains the invalid enumeration error for %s %s %s', async (action, flag, value) => {
    const factory = vi.spyOn(clientModule, 'createClient').mockImplementation(() => {
      throw new Error('Unexpected client creation');
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(
        createProgram().parseAsync(
          ['subscription', 'tokenplan', action, flag, value, '--format', 'json'],
          { from: 'user' },
        ),
      ).rejects.toMatchObject({ exitCode: 4 });
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(JSON.parse(output).error).toMatchObject({
        code: 'INVALID_ARGUMENT',
        exit_code: 4,
      });
      expect(factory).not.toHaveBeenCalled();
      expect(resolveCredentials).not.toHaveBeenCalled();
      expect(ensureAuthenticated).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });
});

function catalogResult(): TokenPlanListResult {
  return {
    authenticated: false,
    edition: 'individual',
    billingCycle: 'quarterly',
    completeness: 'complete',
    sections: [
      {
        edition: 'individual',
        billingCycleSupported: true,
        subscriptionStatus: 'not_subscribed',
        currentPlan: null,
        currentBillingCycle: null,
        currentPlanDetails: null,
        subscriptionUrl: null,
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
            billingTerm: 'quarterly',
            listPrice: '20.01',
            promoPrice: '15.01',
            currency: 'USD',
            quotaWindows: [
              { windowType: 'five_hour', totalCredits: '0' },
              { windowType: 'weekly', totalCredits: '200' },
              { windowType: 'monthly', totalCredits: '500' },
            ],
          },
        ],
      },
    ],
  };
}

function personalStatus(): TokenPlanStatusResult {
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
      period: { start: '2026-09-09T09:09:09Z', end: '2026-11-20T00:00:00Z', remainingDays: 22 },
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

function partialTeamClient(seatResponse: unknown, summaryResponse: unknown) {
  const callFlatApi = vi.fn(async (options: { action: string }) => {
    if (options.action === 'DescribeFrInstances')
      throw new CliError({
        code: 'NETWORK_ERROR',
        message: 'Mock instance query unavailable',
        exitCode: 3,
      });
    if (options.action === 'GetSeatSubscriptionSummary') return seatResponse;
    if (options.action === 'GetSubscriptionSummary') return summaryResponse;
    if (options.action === 'CheckTokenPlanAutoRenewal') return { Data: { AutoRenewal: 0 } };
    return {};
  });
  const callCsDataApi = vi.fn(async (options: { parse: (raw: unknown) => unknown }) =>
    options.parse({ code: 'SUCCESS', success: true, data: null }),
  );
  const api = { callFlatApi, callCsDataApi } as unknown as ApiClient;
  return {
    client: makeMockApiClient({
      subscriptionTokenPlanService: new SubscriptionTokenPlanService(api),
    }),
    callFlatApi,
    callCsDataApi,
  };
}

describe('Selected team partial status through validated service responses', () => {
  it.each(['json', 'text'])(
    'preserves selected team seat details in JSON and omits them from %s display',
    async (format) => {
      const result = personalStatus();
      delete result.individual;
      result.team = {
        edition: 'team',
        commodityCode: 'sfm_tokenplanteams_dp_intl',
        status: 'active',
        type: 'token_plan_team',
        name: 'Mock Team',
        specCode: null,
        period: null,
        remainingDays: null,
        autoRenew: null,
        seatSummary: null,
        completeness: 'complete',
        diagnostics: [],
        seatDetails: {
          items: [
            {
              instanceCode: 'mock-seat-0123456789',
              specType: 'pro',
              status: 'NORMAL',
              assignment: 'assigned',
              totalValue: '100.00',
              surplusValue: '50.05',
            },
          ],
          fetchedCount: 1,
          totalCount: 1,
          historicalCount: 0,
          collectionCompleteness: 'complete',
          completeness: 'complete',
          diagnostics: [],
        },
      };
      const service = new SubscriptionTokenPlanService({} as ApiClient);
      const getTokenPlanStatus = vi.spyOn(service, 'getTokenPlanStatus').mockResolvedValue(result);
      const client = makeMockApiClient({ subscriptionTokenPlanService: service });
      const before = structuredClone(result);
      const output = await runCommand(
        (program) =>
          registerSubscriptionTokenPlanCommands(
            program.command('subscription'),
            async () => client,
          ),
        ['subscription', 'tokenplan', 'status', '--edition', 'team', '--format', format],
      );
      expect(output.exitCode).toBeUndefined();
      expect(output.stderr).toBe('');
      expect(getTokenPlanStatus).toHaveBeenCalledWith({
        edition: 'team',
        signal: expect.any(AbortSignal),
      });
      if (format === 'json') {
        const json = JSON.parse(output.stdout);
        expect(json.team.seatDetails).toEqual(before.team?.seatDetails);
        expect(Object.keys(json).sort()).toEqual(
          [
            'product',
            'period',
            'autoRenew',
            'renewable',
            'seatSummary',
            'diagnostics',
            'team',
          ].sort(),
        );
        expect(json).not.toHaveProperty('seatDetails');
        expect(json.team.seatDetails.items[0]).not.toHaveProperty('remainingPct');
      } else {
        expect(output.stdout).not.toContain('SEAT DETAILS');
        expect(output.stdout).not.toContain('mock-seat-0123456789');
        expect(output.stdout).not.toContain('CREDITS (REMAINING / TOTAL)');
        expect(output.stdout).not.toContain('Some seat fields are unknown.');
        expect(output.stdout).not.toContain('historical seats hidden');
        expect(output.stdout).not.toMatch(/\x1b/);
      }
      expect(result).toEqual(before);
    },
  );

  const validGroup = {
    SpecType: 'standard',
    SubscriptionTotalNumber: 2,
    SubscriptionAssignedNumber: 1,
    EquityList: [{ EquityCode: 'CREDITS', TotalValue: '100.00', SurplusValue: '50.00' }],
  };
  const successfulReads = [
    { name: 'seat quotas', seat: { Data: { SubscriptionGroupList: [validGroup] } }, summary: {} },
    {
      name: 'total quotas',
      seat: {},
      summary: { Data: { TotalCount: 2, TotalValue: '100', TotalSurplusValue: '50' } },
    },
    {
      name: 'period',
      seat: { Data: { StartTime: '2026-10-01T00:00:00Z', EndTime: '2026-12-01T00:00:00Z' } },
      summary: {},
    },
    {
      name: 'zero quotas',
      seat: {
        Data: {
          SubscriptionGroupList: [
            {
              ...validGroup,
              SubscriptionTotalNumber: 0,
              EquityList: [{ EquityType: 'CREDITS', TotalValue: '0', SurplusValue: '0' }],
            },
          ],
        },
      },
      summary: {},
    },
  ];
  for (const format of ['json', 'text'] as const) {
    for (const edition of ['team', 'all'] as const) {
      it.each(successfulReads)(
        `retains $name as partial success in ${edition}/${format}`,
        async ({ seat, summary }) => {
          const { client, callCsDataApi } = partialTeamClient(seat, summary);
          const output = await runCommand(
            (program) =>
              registerSubscriptionTokenPlanCommands(
                program.command('subscription'),
                async () => client,
              ),
            ['subscription', 'tokenplan', 'status', '--edition', edition, '--format', format],
          );
          expect(output.exitCode).toBeUndefined();
          expect(output.stderr).toBe('');
          if (format === 'json') {
            const data = JSON.parse(output.stdout) as TokenPlanStatusResult;
            expect(data.team?.status).toBe('unknown');
            expect(data.team?.diagnostics).toContainEqual(
              expect.objectContaining({ errorCode: 'NETWORK_ERROR' }),
            );
            expect(data.team?.period !== null || data.team?.seatSummary !== null).toBe(true);
          } else {
            expect(output.stdout).toContain('unknown');
            expect(output.stdout).toContain('diagnostic(s), see --format json for details');
          }
          if (edition === 'team') expect(callCsDataApi).not.toHaveBeenCalled();
        },
      );
    }

    it.each([
      { name: 'empty objects', seat: {}, summary: {} },
      { name: 'empty groups', seat: { Data: { SubscriptionGroupList: [] } }, summary: {} },
      {
        name: 'rejected seat response',
        seat: { Success: false, Data: { SubscriptionGroupList: [validGroup] } },
        summary: {},
      },
      {
        name: 'malformed numeric fields',
        seat: {
          Data: {
            SubscriptionGroupList: [
              {
                SpecType: 'standard',
                SubscriptionTotalNumber: 'invalid',
                EquityList: [
                  { EquityCode: 'CREDITS', TotalValue: 'invalid', SurplusValue: 'invalid' },
                ],
              },
            ],
          },
        },
        summary: {},
      },
      { name: 'invalid period', seat: { Data: { StartTime: 'bad', EndTime: 'bad' } }, summary: {} },
    ])(`keeps $name a failure in ${format} despite renewal fields`, async ({ seat, summary }) => {
      const { client } = partialTeamClient(seat, summary);
      const output = await runCommand(
        (program) =>
          registerSubscriptionTokenPlanCommands(
            program.command('subscription'),
            async () => client,
          ),
        ['subscription', 'tokenplan', 'status', '--edition', 'team', '--format', format],
      );
      expect(output.exitCode).toBe(3);
      if (format === 'json') {
        expect(JSON.parse(output.stdout).team.status).toBe('unknown');
        expect(JSON.parse(output.stderr).error.exit_code).toBe(3);
      } else expect(output.stderr).toContain('network connection');
    });
  }

  it('does not use an unselected team summary to rescue a failed personal query', async () => {
    const { client } = partialTeamClient({ Data: { SubscriptionGroupList: [validGroup] } }, {});
    const output = await runCommand(
      (program) =>
        registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client),
      ['subscription', 'tokenplan', 'status', '--edition', 'individual', '--format', 'json'],
    );
    expect(output.exitCode).toBe(4);
    expect(JSON.parse(output.stdout).team).toBeUndefined();
    expect(JSON.parse(output.stdout).individual.status).toBe('unknown');
  });
});

const mainQuotaCases: Array<{
  name: string;
  edition: 'individual' | 'team';
  windows: TokenPlanCatalogPlan['quotaWindows'];
  weeklyCredits?: number;
  monthlyCredits: string | null;
  labels: string[];
  hiddenLabels: string[];
  credits: string | null;
  hiddenCredits: string[];
  diagnostic?: TokenPlanListResult['sections'][number]['diagnostics'][number];
  warning?: string;
}> = [
  {
    name: 'weekly-first with all windows',
    edition: 'individual',
    windows: [
      { windowType: 'five_hour', totalCredits: '777' },
      { windowType: 'weekly', totalCredits: '222' },
      { windowType: 'monthly', totalCredits: '555' },
    ],
    weeklyCredits: 222,
    monthlyCredits: null,
    labels: ['weekly'],
    hiddenLabels: ['monthly'],
    credits: '222',
    hiddenCredits: ['777', '555'],
  },
  {
    name: 'zero weekly quota beside other windows',
    edition: 'individual',
    windows: [
      { windowType: 'five_hour', totalCredits: '777' },
      { windowType: 'weekly', totalCredits: '0' },
      { windowType: 'monthly', totalCredits: '555' },
    ],
    weeklyCredits: 0,
    monthlyCredits: null,
    labels: ['weekly'],
    hiddenLabels: ['monthly'],
    credits: '0',
    hiddenCredits: ['777', '555'],
  },
  {
    name: 'invalid weekly quota beside valid other windows',
    edition: 'individual',
    windows: [
      { windowType: 'five_hour', totalCredits: '777' },
      { windowType: 'monthly', totalCredits: '555' },
    ],
    monthlyCredits: '555',
    labels: ['monthly'],
    hiddenLabels: ['weekly'],
    credits: '555',
    hiddenCredits: ['777'],
    diagnostic: {
      api: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config',
      errorCode: 'INVALID_WEEKLY_QUOTA',
      errorMessage: 'Mock invalid weekly quota',
    },
    warning: 'Mock invalid weekly quota',
  },
  {
    name: 'monthly fallback beside a five-hour window',
    edition: 'individual',
    windows: [
      { windowType: 'five_hour', totalCredits: '777' },
      { windowType: 'monthly', totalCredits: '555' },
    ],
    monthlyCredits: '555',
    labels: ['monthly'],
    hiddenLabels: ['weekly'],
    credits: '555',
    hiddenCredits: ['777'],
  },
  {
    name: 'only a five-hour window',
    edition: 'individual',
    windows: [{ windowType: 'five_hour', totalCredits: '777' }],
    monthlyCredits: null,
    labels: [],
    hiddenLabels: ['weekly', 'monthly'],
    credits: null,
    hiddenCredits: ['777'],
  },
  {
    name: 'no reported quota windows',
    edition: 'individual',
    windows: [],
    monthlyCredits: null,
    labels: [],
    hiddenLabels: ['weekly', 'monthly'],
    credits: null,
    hiddenCredits: ['777', '222', '555'],
  },
  {
    name: 'team monthly quota',
    edition: 'team',
    windows: [{ windowType: 'monthly', totalCredits: '600' }],
    monthlyCredits: '600',
    labels: ['monthly'],
    hiddenLabels: ['weekly'],
    credits: '600',
    hiddenCredits: ['777', '222', '555'],
  },
];

async function humanCatalog(
  result: TokenPlanListResult,
  format: 'text' | 'table',
): Promise<string> {
  const vm = buildTokenPlanListViewModel(result);
  if (format === 'text') {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderTextTokenPlanList(vm);
      return output.mock.calls.flat().join('\n');
    } finally {
      output.mockRestore();
    }
  }
  const instance = render(createElement(TokenPlanListInk, { vm }));
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    return instance.lastFrame() ?? '';
  } finally {
    instance.unmount();
  }
}

function pricingBlock(output: string): string {
  const pricing = output.split('PRICING')[1];
  expect(pricing).toBeDefined();
  return pricing!.split(/\bNOTES\b|You can view Token Plan prices without logging in\./)[0]!;
}

describe('Supported model presentation', () => {
  it.each([
    ['individual', 'text', 160],
    ['individual', 'text', 40],
    ['individual', 'table', 160],
    ['individual', 'table', 40],
    ['team', 'text', 160],
    ['team', 'text', 40],
    ['team', 'table', 160],
    ['team', 'table', 40],
  ] as const)(
    'keeps full model information for %s in %s at width %s',
    async (edition, format, columns) => {
      const previous = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
      Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
      try {
        const result = catalogResult();
        result.edition = edition;
        result.sections[0]!.edition = edition;
        result.sections[0]!.plans![0]!.supportedModels = [
          {
            modelId: 'mock-supported-model',
            modelBrand: 'Mock Brand',
            modelName: 'Localized Model Name',
            capabilities: ['TG', 'Reasoning', 'QwQ', 'VU'],
            isNew: true,
            badgeLabel: 'Limited Offer',
            badgeDescription: 'Tooltip only',
          },
        ];

        const output = await humanCatalog(result, format);
        const plain = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
        const joined = plain.replace(/\s+/g, ' ');

        expect(joined).toContain('mock-supported-model');
        expect(joined).toContain('Text Generation, Reasoning Model, Visual Understanding');
        expect(joined).toContain('New, Limited Offer');
        expect(joined).toContain('TAG');
        expect(joined).not.toContain('Localized Model Name');
        expect(joined).not.toContain('Tooltip only');
        expect(joined).not.toContain('TG,');
      } finally {
        if (previous) Object.defineProperty(process.stdout, 'columns', previous);
        else Reflect.deleteProperty(process.stdout, 'columns');
      }
    },
  );
});

const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
});
afterEach(() => {
  if (originalTty) Object.defineProperty(process.stdout, 'isTTY', originalTty);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
  vi.restoreAllMocks();
});

describe('Token Plan command output', () => {
  describe.each(['individual', 'team'] as const)('Catalog percentage output in %s', (edition) => {
    it.each(['json', 'text', 'table'] as const)(
      'omits all Credit quantities in %s',
      async (format) => {
        const result = catalogResult();
        result.edition = edition;
        result.authenticated = true;
        const section = result.sections[0]!;
        section.edition = edition;
        section.subscriptionStatus = 'active';
        section.currentPlanDetails = {
          subscriptionId: null,
          endAt: '2026-11-20T00:00:00Z',
          totalCredits: '98334',
          remainingCredits: '78667.2',
          ...(edition === 'individual' ? { remainingPct: 80 } : {}),
        };
        const before = structuredClone(result);
        let output: string;
        if (format === 'json') {
          const client = makeMockApiClient({
            tokenPlanListService: {
              getTokenPlanList: async () => result,
            } as unknown as TokenPlanListService,
          });
          const command = await runCommand(
            (program) => registerSubscriptionCommands(program, async () => client),
            ['subscription', 'tokenplan', 'list', '--edition', edition, '--format', format],
          );
          expect(command.exitCode).toBeUndefined();
          expect(command.stderr).toBe('');
          output = command.stdout;
          expect(JSON.parse(output).sections[0].currentPlanDetails).toEqual(
            edition === 'team'
              ? { subscriptionId: null, endAt: '2026-11-20T00:00:00Z' }
              : {
                  subscriptionId: null,
                  endAt: '2026-11-20T00:00:00Z',
                  usedPct: 20,
                  remainingPct: 80,
                },
          );
          expect(output).not.toMatch(/totalCredits|remainingCredits|weeklyCredits|monthlyCredits/);
        } else {
          output = await humanCatalog(result, format);
          if (edition === 'individual')
            expect(output.replace(/\s+/g, ' ')).toContain('Used (%): 20%; Remaining (%): 80%');
          else expect(output).not.toMatch(/Used \(%\)|Remaining \(%\)/);
          expect(output).not.toMatch(/Total Credits|Remaining Credits/);
        }
        expect(output).not.toContain('98334');
        expect(output).not.toContain('78667.2');
        expect(output).toContain('20.01');
        expect(output).toContain('15.01');
        expect(result).toEqual(before);
      },
    );
  });

  it.each(['individual', 'team'] as const)(
    'omits five-hour tiers and personal quantities from %s status JSON and keeps Coding Plan windows',
    (edition) => {
      const weekly = { windowType: 'weekly', totalCredits: '200' };
      const monthly = { windowType: 'monthly', totalCredits: '500' };
      const codingPlan = { windows: { per_5h: { total: 50 }, weekly: { total: 100 } } };
      const source = {
        tokenPlan: {
          edition,
          fiveHourCredits: { total: 999, used: 9, remaining: 990 },
          tiers: [weekly, { windowType: 'five_hour', totalCredits: '999' }, monthly],
        },
        codingPlan,
      };
      const before = structuredClone(source);
      expect(formatSubscriptionStatusJson(source)).toEqual({
        tokenPlan: {
          edition,
          tiers:
            edition === 'individual'
              ? [{ windowType: 'weekly' }, { windowType: 'monthly' }]
              : [weekly, monthly],
        },
        codingPlan,
      });
      expect(source).toEqual(before);
    },
  );

  describe.each(['individual', 'team'] as const)('Five-hour output in %s', (edition) => {
    it.each(['json', 'text', 'table'] as const)(
      'hides current five-hour quota and catalog windows in %s',
      async (format) => {
        const result = catalogResult();
        result.edition = edition;
        result.authenticated = true;
        const section = result.sections[0]!;
        section.edition = edition;
        section.subscriptionStatus = 'active';
        section.currentPlan = 'lite';
        section.currentPlanDetails = {
          subscriptionId: 'mock-current-subscription',
          endAt: '2026-11-20T00:00:00Z',
          quotaWindowType: 'five_hour',
          totalCredits: '987654321',
          remainingCredits: '987654320',
          remainingPct: 99,
        };
        section.plans![0]!.quotaWindows[0]!.totalCredits = '987654321';
        const before = structuredClone(result);
        let output: string;
        if (format === 'json') {
          const client = makeMockApiClient({
            tokenPlanListService: {
              getTokenPlanList: async () => result,
            } as unknown as TokenPlanListService,
          });
          const command = await runCommand(
            (program) => registerSubscriptionCommands(program, async () => client),
            ['subscription', 'tokenplan', 'list', '--edition', edition, '--format', format],
          );
          expect(command.exitCode).toBeUndefined();
          expect(command.stderr).toBe('');
          output = command.stdout;
          const json = JSON.parse(output);
          expect(json.sections[0].currentPlanDetails).toEqual({
            subscriptionId: 'mock-current-subscription',
            endAt: '2026-11-20T00:00:00Z',
          });
          expect(json.sections[0].plans[0].quotaWindows).toEqual([
            { windowType: 'weekly' },
            { windowType: 'monthly' },
          ]);
          expect(json.sections[0].rows[0]).not.toHaveProperty('weeklyCredits');
        } else {
          output = await humanCatalog(result, format);
          expect(output).toContain('End At');
          expect(output).toContain('2026-11-20');
        }
        expect(output).not.toContain('five_hour');
        expect(output).not.toContain('Five Hours');
        expect(output).not.toContain('987654321');
        expect(output).not.toContain('987654320');
        expect(result).toEqual(before);
      },
    );

    it.each(['text', 'table'] as const)(
      'hides compatibility five-hour status fields in %s while preserving weekly usage',
      async (format) => {
        const result = personalStatus();
        const node = result.individual!;
        node.fiveHourCredits = { total: 987654321, used: 9, remaining: 987654312 };
        if (edition === 'team') {
          node.edition = edition;
          node.commodityCode = 'sfm_tokenplanteams_dp_intl';
          node.tiers = undefined;
          result.team = node;
          delete result.individual;
        }
        const before = structuredClone(result);
        let output: string;
        if (format === 'text') {
          const client = makeMockApiClient({
            subscriptionTokenPlanService: {
              getTokenPlanStatus: async () => result,
            } as unknown as SubscriptionTokenPlanService,
          });
          const command = await runCommand(
            (program) => registerSubscriptionCommands(program, async () => client),
            ['subscription', 'tokenplan', 'status', '--edition', edition, '--format', format],
          );
          expect(command.exitCode).toBeUndefined();
          expect(command.stderr).toBe('');
          output = command.stdout;
        } else {
          const instance = render(
            createElement(SubscriptionTokenPlanStatusInk, {
              vm: buildTokenPlanStatusViewModel(result, 'tui'),
            }),
          );
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
            output = instance.lastFrame() ?? '';
          } finally {
            instance.unmount();
          }
        }
        expect(output).not.toContain('five_hour');
        expect(output).not.toContain('Five Hours');
        expect(output).not.toContain('987654321');
        expect(output).not.toContain('987654312');
        if (edition === 'individual') {
          expect(output).toContain('weekly');
          expect(output).not.toContain('200.25');
          expect(output).toContain('25%');
          expect(output).toContain('75%');
        } else expect(output).toContain('Team');
        expect(result).toEqual(before);
      },
    );
  });

  describe.each(['individual', 'team'])('Weekly Credits in %s status JSON', (edition) => {
    it.each([
      [null, undefined],
      [
        { total: 0, used: 0, remaining: 0 },
        { total: 0, used: 0, remaining: 0 },
      ],
      [{ total: null, used: null, remaining: null }, { total: null }],
    ])(
      'preserves weekly ratios and team quantities for %j without modifying the source',
      (weeklyCredits, personalCredits) => {
        const source = {
          edition,
          weeklyCredits,
          monthlyCredits: { total: 500, used: 100, remaining: 400 },
          fiveHourCredits: { total: 999, used: 99, remaining: 900 },
        };
        const before = structuredClone(source);
        const output = formatSubscriptionStatusJson(source);
        expect(output).toEqual({
          edition,
          monthlyCredits:
            edition === 'team' ? source.monthlyCredits : { usedPct: null, remainingPct: null },
          ...(edition === 'team'
            ? { weeklyCredits }
            : personalCredits === undefined
              ? {}
              : { weeklyCredits: { usedPct: null, remainingPct: null } }),
        });
        expect(source).toEqual(before);
      },
    );
  });

  it.each([
    ['subscription', 'tokenplan', 'status', '--edition', 'individual'],
    ['subscription', 'tokenplan', 'status', '--edition', 'team'],
    ['subscription', 'tokenplan', 'status', '--edition', 'all'],
    ['subscription', 'status', '--plan', 'token'],
    ['subscription', 'status'],
  ])(
    'preserves weekly ratios in %j JSON and omits personal quantities and five-hour windows',
    async (...args) => {
      const result = personalStatus();
      result.individual!.weeklyCredits = { total: 200, used: 50, remaining: 150 };
      result.individual!.monthlyCredits = { total: 500, used: 100, remaining: 400 };
      result.individual!.fiveHourCredits = { total: 777, used: 7, remaining: 770 };
      const monthlyTier = {
        ...result.individual!.tiers![0]!,
        windowType: 'monthly' as const,
        totalCredits: '500',
        remainingPct: 80,
        usedPct: 20,
      };
      result.individual!.tiers!.push(monthlyTier);
      result.team = {
        ...structuredClone(result.individual!),
        edition: 'team',
        commodityCode: 'sfm_tokenplanteams_dp_intl',
        type: 'token_plan_team',
        name: 'Mock Team',
        tiers: undefined,
        weeklyCredits: { total: 1000, used: 100, remaining: 900 },
        monthlyCredits: { total: 5000, used: 500, remaining: 4500 },
        fiveHourCredits: { total: 500, used: 50, remaining: 450 },
      };
      const before = structuredClone(result);
      const client = makeMockApiClient({
        subscriptionTokenPlanService: {
          getTokenPlanStatus: async () => result,
        } as unknown as SubscriptionTokenPlanService,
        getSubscriptionStatus: async () => ({
          data: {
            individual: result.individual,
            team: result.team,
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
        }),
      });
      const output = await runCommand(
        (program) => registerSubscriptionCommands(program, async () => client),
        [...args, '--format', 'json'],
      );
      expect(output.exitCode).toBeUndefined();
      expect(output.stderr).toBe('');
      const json = JSON.parse(output.stdout);
      expect(json.team.weeklyCredits).toEqual(before.team!.weeklyCredits);
      expect(json.team.monthlyCredits).toEqual(before.team!.monthlyCredits);
      expect(json.team).not.toHaveProperty('fiveHourCredits');
      expect(json.individual.weeklyCredits).toEqual({ usedPct: null, remainingPct: null });
      expect(json.individual).not.toHaveProperty('fiveHourCredits');
      expect(json.individual.monthlyCredits).toEqual({ usedPct: null, remainingPct: null });
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
          usedPct: 20,
          remainingPct: 80,
          resetAt: '2026-10-30T00:00:00Z',
        },
      ]);
      expect(result).toEqual(before);
    },
  );

  it.each([
    ['team', 'active'],
    ['team', 'not_subscribed'],
    ['all', 'active'],
    ['all', 'not_subscribed'],
  ] as const)(
    'preserves catalog window types and omits Credit quantities for edition %s and status %s',
    async (edition, status) => {
      const result = catalogResult();
      const individual = result.sections[0]!;
      individual.plans![0]!.billingTerm = 'monthly';
      const team: TokenPlanListResult['sections'][number] = {
        ...structuredClone(individual),
        edition: 'team',
        subscriptionStatus: status,
        rows: [
          {
            ...individual.rows[0]!,
            type: 'token_plan_team',
            specCode: 'standard',
            seatType: 'standard',
            monthlyCredits: '25000',
            weeklyCredits: 200,
          },
        ],
        plans: [
          {
            seatType: 'standard',
            billingTerm: 'monthly',
            listPrice: '120',
            promoPrice: null,
            currency: 'USD',
            quotaWindows: [
              { windowType: 'five_hour', totalCredits: '5000' },
              { windowType: 'weekly', totalCredits: '200' },
              { windowType: 'monthly', totalCredits: '25000' },
            ],
          },
        ],
      };
      result.edition = edition;
      result.billingCycle = 'monthly';
      result.sections = edition === 'team' ? [team] : [individual, team];
      const before = structuredClone(result);
      const client = makeMockApiClient({
        tokenPlanListService: {
          getTokenPlanList: async () => result,
        } as unknown as TokenPlanListService,
      });
      const output = await runCommand(
        (program) => registerSubscriptionCommands(program, async () => client),
        ['subscription', 'tokenplan', 'list', '--edition', edition, '--format', 'json'],
      );
      expect(output.exitCode).toBeUndefined();
      expect(output.stderr).toBe('');
      const sections = JSON.parse(output.stdout).sections as TokenPlanListJsonResult['sections'];
      const teamOutput = sections.find((section) => section.edition === 'team')!;
      expect(teamOutput.rows[0]).not.toHaveProperty('weeklyCredits');
      expect(teamOutput.rows[0]).not.toHaveProperty('monthlyCredits');
      expect(teamOutput.plans![0]!.quotaWindows).toEqual([
        { windowType: 'weekly' },
        { windowType: 'monthly' },
      ]);
      if (edition === 'all') {
        const expectedIndividual: TokenPlanListJsonResult['sections'][number] = structuredClone(
          before.sections[0]!,
        );
        expectedIndividual.plans![0]!.quotaWindows = [
          { windowType: 'weekly' },
          { windowType: 'monthly' },
        ];
        Reflect.deleteProperty(expectedIndividual.rows[0]!, 'weeklyCredits');
        Reflect.deleteProperty(expectedIndividual.rows[0]!, 'monthlyCredits');
        expect(sections[0]).toEqual(expectedIndividual);
      }
      expect(result).toEqual(before);
    },
  );

  it.each([
    {
      name: 'positive limits',
      windows: [
        { windowType: 'five_hour', totalCredits: '700' },
        { windowType: 'weekly', totalCredits: '200' },
        { windowType: 'monthly', totalCredits: '11500' },
      ],
      expectedWindows: [{ windowType: 'weekly' }, { windowType: 'monthly' }],
    },
    {
      name: 'zero limits',
      windows: [
        { windowType: 'five_hour', totalCredits: '0' },
        { windowType: 'weekly', totalCredits: '0' },
        { windowType: 'monthly', totalCredits: '0' },
      ],
      expectedWindows: [{ windowType: 'weekly' }, { windowType: 'monthly' }],
    },
    {
      name: 'no monthly limit',
      windows: [
        { windowType: 'five_hour', totalCredits: '700' },
        { windowType: 'weekly', totalCredits: '200' },
      ],
      expectedWindows: [{ windowType: 'weekly' }],
    },
  ] satisfies Array<{
    name: string;
    windows: TokenPlanCatalogPlan['quotaWindows'];
    expectedWindows: Array<{ windowType: 'weekly' | 'monthly' }>;
  }>)(
    'omits individual Credit quantities and five-hour windows for $name without modifying source',
    async (testCase) => {
      const result = catalogResult();
      result.sections[0]!.plans![0]!.quotaWindows = structuredClone(testCase.windows);
      const before = structuredClone(result);
      const client = makeMockApiClient({
        tokenPlanListService: {
          getTokenPlanList: async () => result,
        } as unknown as TokenPlanListService,
      });
      const output = await runCommand(
        (program) => registerSubscriptionCommands(program, async () => client),
        ['subscription', 'tokenplan', 'list', '--edition', 'individual', '--format', 'json'],
      );
      expect(output.exitCode).toBeUndefined();
      expect(output.stderr).toBe('');
      const json = JSON.parse(output.stdout);
      expect(json.sections[0].plans[0].quotaWindows).toEqual(testCase.expectedWindows);
      expect(json.sections[0].plans[0].listPrice).toBe('20.01');
      expect(json.sections[0].plans[0].promoPrice).toBe('15.01');
      expect(json.sections[0].rows[0]).not.toHaveProperty('weeklyCredits');
      expect(result).toEqual(before);
    },
  );

  it.each([
    ['weekly', '222'],
    ['weekly', '0'],
    ['weekly', null],
    ['monthly', '555'],
    ['monthly', '0'],
    ['monthly', null],
  ] as const)(
    'projects current %s usage ratios without exposing quota %s',
    async (quotaWindowType, totalCredits) => {
      const result = catalogResult();
      const section = result.sections[0]!;
      result.authenticated = true;
      section.subscriptionStatus = 'active';
      section.currentPlan = 'lite';
      section.currentPlanDetails = {
        subscriptionId: 'mock-personal-subscription',
        endAt: '2026-11-20T00:00:00Z',
        totalCredits,
        remainingCredits: null,
        remainingPct: totalCredits === null ? null : 75,
        quotaWindowType,
      };
      section.rows[0]!.monthlyCredits = '555';
      const before = structuredClone(result);
      const client = makeMockApiClient({
        tokenPlanListService: {
          getTokenPlanList: async () => result,
        } as unknown as TokenPlanListService,
      });
      const output = await runCommand(
        (program) => registerSubscriptionCommands(program, async () => client),
        ['subscription', 'tokenplan', 'list', '--edition', 'individual', '--format', 'json'],
      );
      expect(output.exitCode).toBeUndefined();
      expect(output.stderr).toBe('');
      const json = JSON.parse(output.stdout);
      expect(json.sections[0].currentPlanDetails).toEqual({
        subscriptionId: 'mock-personal-subscription',
        endAt: '2026-11-20T00:00:00Z',
        remainingPct: totalCredits === null ? null : 75,
        usedPct: totalCredits === null ? null : 25,
        quotaWindowType,
      });
      expect(json.sections[0].rows[0]).not.toHaveProperty('monthlyCredits');
      expect(json.sections[0].rows[0]).not.toHaveProperty('weeklyCredits');
      const vm = buildTokenPlanListViewModel(result);
      expect(vm.sections[0]!.subscriptionDetails).toContain(
        `Used (%): ${totalCredits === null ? '—' : '25%'}; Remaining (%): ${totalCredits === null ? '—' : '75%'} (${quotaWindowType})`,
      );
      expect(result).toEqual(before);
    },
  );

  it.each([false, true])(
    'formats team labels with edition sections = %s while preserving JSON',
    async (withEdition) => {
      const result = personalStatus();
      const template = result.individual!;
      delete result.individual;
      result.seatSummary = {
        groups: [
          {
            specType: 'standard',
            seats: 1,
            assigned: 0,
            totalValue: '100',
            surplusValue: '50',
            unit: 'Credits',
            nextCycleFlushTime: null,
          },
          {
            specType: 'pro',
            seats: 1,
            assigned: 0,
            totalValue: '100',
            surplusValue: '0',
            unit: 'Credits',
            nextCycleFlushTime: null,
          },
          {
            specType: 'max',
            seats: 1,
            assigned: 0,
            totalValue: '100',
            surplusValue: null,
            unit: 'Credits',
            nextCycleFlushTime: null,
          },
        ],
        total: { seats: 3, totalValue: '300', surplusValue: null, unit: 'Credits' },
      };
      if (withEdition)
        result.team = {
          ...template,
          edition: 'team',
          commodityCode: 'sfm_tokenplanteams_dp_intl',
          period: null,
          remainingDays: null,
          endAt: null,
          tiers: undefined,
          seatSummary: result.seatSummary,
        };
      const before = structuredClone(result);
      const getTokenPlanStatus = vi.fn(async () => result);
      const client = makeMockApiClient({
        subscriptionTokenPlanService: {
          getTokenPlanStatus,
        } as unknown as SubscriptionTokenPlanService,
      });
      const register = (program: import('commander').Command) =>
        registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client);

      const text = await runCommand(register, [
        'subscription',
        'tokenplan',
        'status',
        '--edition',
        withEdition ? 'team' : 'all',
        '--format',
        'text',
      ]);
      expect(text.exitCode).toBeUndefined();
      expect(text.stderr).toBe('');
      if (withEdition) {
        expect(text.stdout).not.toContain('SEAT SUMMARY');
        expect(text.stdout).not.toContain('QUANTITY');
      } else {
        expect(text.stdout).toMatch(/Standard +1/);
        expect(text.stdout).toMatch(/Pro +1/);
        expect(text.stdout).toMatch(/Max +1/);
      }
      expect(text.stdout).not.toMatch(/(?:Standard|Pro|Max) Seat/);

      const json = await runCommand(register, [
        'subscription',
        'tokenplan',
        'status',
        '--edition',
        withEdition ? 'team' : 'all',
        '--format',
        'json',
      ]);
      expect(json.exitCode).toBeUndefined();
      expect(json.stderr).toBe('');
      expect(JSON.parse(json.stdout)).toEqual(JSON.parse(JSON.stringify(before)));
      expect(result).toEqual(before);
      expect(getTokenPlanStatus).toHaveBeenCalledTimes(2);
    },
  );

  it('prints team Credit guidance while retaining names and seat details only in JSON', async () => {
    const result = personalStatus();
    result.team = {
      ...result.individual!,
      edition: 'team',
      name: 'Mock Team Name',
      commodityCode: 'sfm_tokenplanteams_dp_intl',
      subscriptionId: 'mock-team-subscription',
      tiers: undefined,
      seatSummaries: [
        {
          seatType: 'pro',
          seatCount: 1,
          assignedCount: 0,
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
    const client = makeMockApiClient({
      subscriptionTokenPlanService: {
        getTokenPlanStatus: vi.fn(async () => result),
      } as unknown as SubscriptionTokenPlanService,
    });
    const register = (program: import('commander').Command) =>
      registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client);
    const text = await runCommand(register, [
      'subscription',
      'tokenplan',
      'status',
      '--format',
      'text',
    ]);
    expect(text.exitCode).toBeUndefined();
    expect(text.stderr).toBe('');
    expect(text.stdout).toContain('TEAM CREDIT SUMMARY');
    expect(text.stdout).toContain(
      'The total credits is the sum of the credits of all seats of the same seat type.',
    );
    expect(text.stdout).toContain('Only active seats are shown.');
    expect(text.stdout).toContain(
      'Run qwencloud subscription tokenplan seats for per-seat member and quota details.',
    );
    for (const value of [
      'Mock Team Name',
      result.individual!.name!,
      'SEAT SUMMARY',
      'SEAT DETAILS',
      'mock-hidden-seat',
      'mock-team-subscription',
      'Subscription IDs',
      'Some seat fields are unknown.',
      'historical seats hidden',
    ])
      expect(text.stdout).not.toContain(value);
    const json = await runCommand(register, [
      'subscription',
      'tokenplan',
      'status',
      '--format',
      'json',
    ]);
    expect(json.stderr).toBe('');
    expect(JSON.parse(json.stdout)).toEqual(
      JSON.parse(JSON.stringify(formatSubscriptionStatusJson(result))),
    );
  });

  it('writes one native catalog JSON object and passes the selected flags to the service', async () => {
    const result = catalogResult();
    const expected: TokenPlanListJsonResult = structuredClone(result);
    expected.sections[0]!.plans![0]!.quotaWindows = [
      { windowType: 'weekly' },
      { windowType: 'monthly' },
    ];
    Reflect.deleteProperty(expected.sections[0]!.rows[0]!, 'weeklyCredits');
    Reflect.deleteProperty(expected.sections[0]!.rows[0]!, 'monthlyCredits');
    const getTokenPlanList = vi.fn(async () => result);
    const client = makeMockApiClient({
      tokenPlanListService: { getTokenPlanList } as unknown as TokenPlanListService,
    });
    const output = await runCommand(
      (program) =>
        registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client),
      [
        'subscription',
        'tokenplan',
        'list',
        '--edition',
        'individual',
        '--billing-cycle',
        'quarterly',
        '--include-models',
        '--format',
        'json',
      ],
    );

    expect(output.exitCode).toBeUndefined();
    expect(JSON.parse(output.stdout)).toEqual(expected);
    expect(JSON.parse(output.stdout).sections[0].plans[0].quotaWindows).toEqual([
      { windowType: 'weekly' },
      { windowType: 'monthly' },
    ]);
    expect(output.stderr).toBe('');
    expect(getTokenPlanList).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        authenticated: false,
        edition: 'individual',
        billingCycle: 'quarterly',
        includeModels: true,
      }),
    );
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  it('prints an active selected individual even when all legacy team fields are null', async () => {
    const result = personalStatus();
    const expected = structuredClone(result);
    expected.individual!.period = {
      start: '2026-09-09T09:09:09.000Z',
      end: '2026-11-20T00:00:00.000Z',
      remainingDays: 22,
    };
    const getTokenPlanStatus = vi.fn(async () => result);
    const client = makeMockApiClient({
      subscriptionTokenPlanService: {
        getTokenPlanStatus,
      } as unknown as SubscriptionTokenPlanService,
    });
    const output = await runCommand(
      (program) =>
        registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client),
      ['subscription', 'tokenplan', 'status', '--edition', 'individual', '--format', 'json'],
    );

    expect(output.exitCode).toBeUndefined();
    expect(JSON.parse(output.stdout)).toEqual({
      ...expected,
      individual: {
        ...expected.individual,
        tiers: [
          {
            tier: 'lite',
            windowType: 'weekly',
            usedPct: 25,
            remainingPct: 75,
            resetAt: '2026-10-30T00:00:00Z',
          },
        ],
      },
    });
    expect(result.individual?.period?.start).toBe('2026-09-09T09:09:09Z');
    expect(output.stderr).toBe('');
    expect(getTokenPlanStatus).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ edition: 'individual' }),
    );
  });

  it('renders list text with precise USD prices and the weekly main quota', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    renderTextTokenPlanList(buildTokenPlanListViewModel(catalogResult()));
    const text = output.mock.calls.flat().join('\n');

    expect(text).toContain('USD');
    expect(text).toContain('20.01');
    expect(text).toContain('15.01');
    expect(text).toContain('weekly');
    expect(text).not.toContain('Total Credits');
    expect(text).not.toContain('200');
    expect(pricingBlock(text)).not.toContain('monthly');
    expect(text).not.toContain('Five Hours');
    expect(text).not.toContain('500');
    expect(text).toContain('quarterly');
  });

  it('renders the same catalog values in the table component without recalculating them', () => {
    const vm = buildTokenPlanListViewModel(catalogResult());
    const instance = render(createElement(TokenPlanListInk, { vm }));
    try {
      const frame = instance.lastFrame() ?? '';
      expect(frame).toContain('USD');
      expect(frame).toContain('20.01');
      expect(frame).toContain('15.01');
      expect(frame).toContain('weekly');
      expect(frame).not.toContain('Total Credits');
      expect(frame).not.toContain('200');
      expect(pricingBlock(frame)).not.toContain('monthly');
      expect(frame).not.toContain('Five Hours');
      expect(frame).not.toContain('500');
      expect(frame).toContain('quarterly');
    } finally {
      instance.unmount();
    }
  });

  describe.each(['text', 'table'] as const)('Main quota selection in %s output', (format) => {
    it.each(mainQuotaCases)(
      'renders $name window selection and prices without Credit quantities',
      async (testCase) => {
        const result = catalogResult();
        const section = result.sections[0]!;
        const row = section.rows[0]!;
        const plan = section.plans![0]!;
        result.edition = testCase.edition;
        section.edition = testCase.edition;
        plan.quotaWindows = structuredClone(testCase.windows);
        delete row.weeklyCredits;
        if (testCase.weeklyCredits !== undefined) row.weeklyCredits = testCase.weeklyCredits;
        row.monthlyCredits = testCase.monthlyCredits;
        if (testCase.diagnostic) {
          result.completeness = 'partial';
          section.diagnostics = [testCase.diagnostic];
        }
        if (testCase.edition === 'team') {
          result.billingCycle = 'yearly';
          row.type = 'token_plan_team_standard';
          row.specCode = 'standard';
          row.seatType = 'standard';
          row.name = 'Standard';
          delete plan.tier;
          plan.seatType = 'standard';
          plan.billingTerm = 'yearly';
        }
        const original = structuredClone(result);

        const output = await humanCatalog(result, format);

        expect(output).toContain('USD');
        expect(output).toContain('20.01');
        expect(output).toContain('15.01');
        expect(output).not.toContain('Five Hours');
        expect(output).not.toContain('five_hour');
        const pricing = pricingBlock(output);
        for (const label of testCase.labels) expect(pricing).toContain(label);
        for (const label of testCase.hiddenLabels) expect(pricing).not.toContain(label);
        expect(output).not.toContain('Total Credits');
        expect(output).not.toContain('Remaining Credits');
        if (testCase.credits !== null && testCase.credits !== '0')
          expect(output).not.toContain(testCase.credits);
        if (testCase.warning) {
          expect(output).toContain(testCase.warning);
          if (testCase.credits === null) {
            if (format === 'text') expect(output).toMatch(/\bUSD\s+—/);
            else {
              expect(output).toMatch(/Quota Window:\s*—/);
            }
          }
        }
        for (const credits of testCase.hiddenCredits) expect(output).not.toContain(credits);
        expect(result).toEqual(original);
      },
    );
  });

  it('preserves the monthly fallback and invalid weekly diagnosis in machine output', async () => {
    const result = catalogResult();
    const section = result.sections[0]!;
    result.completeness = 'partial';
    delete section.rows[0]!.weeklyCredits;
    section.rows[0]!.monthlyCredits = '555';
    section.plans![0]!.quotaWindows = [
      { windowType: 'five_hour', totalCredits: '777' },
      { windowType: 'monthly', totalCredits: '555' },
    ];
    section.diagnostics = [
      {
        api: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config',
        errorCode: 'INVALID_WEEKLY_QUOTA',
        errorMessage: 'Mock invalid weekly quota',
      },
    ];
    const original = structuredClone(result);
    const expected: TokenPlanListJsonResult = structuredClone(result);
    expected.sections[0]!.plans![0]!.quotaWindows = [{ windowType: 'monthly' }];
    Reflect.deleteProperty(expected.sections[0]!.rows[0]!, 'weeklyCredits');
    Reflect.deleteProperty(expected.sections[0]!.rows[0]!, 'monthlyCredits');
    const client = makeMockApiClient({
      tokenPlanListService: {
        getTokenPlanList: vi.fn(async () => result),
      } as unknown as TokenPlanListService,
    });

    const output = await runCommand(
      (program) =>
        registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client),
      ['subscription', 'tokenplan', 'list', '--edition', 'individual', '--format', 'json'],
    );

    expect(output.exitCode).toBeUndefined();
    expect(output.stderr).toBe('');
    expect(JSON.parse(output.stdout)).toEqual(expected);
    expect(result).toEqual(original);
    expect(output.stdout).not.toContain('credit limit is temporarily unavailable');
  });

  describe.each(['text', 'table'] as const)(
    'Subscription diagnosis in %s catalog output',
    (format) => {
      it.each([
        ['AUTH_REQUIRED', 'Authentication failed', 'auth login'],
        ['NETWORK_ERROR', 'service could not be reached', 'Check your network connection'],
        ['TIMEOUT', 'did not respond in time', 'Try again later'],
        ['PROTOCOL_ERROR', 'response could not be verified', 'Try again later'],
        ['UNCONFIRMED_SUBSCRIPTION', 'did not confirm the subscription state', 'Try again later'],
      ])(
        'shows the cause and action for %s while preserving available prices',
        async (code, cause, action) => {
          const result = catalogResult();
          result.authenticated = true;
          result.completeness = 'partial';
          const section = result.sections[0]!;
          section.subscriptionStatus = 'unknown';
          section.diagnostics = [
            {
              api: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription',
              errorCode: code,
              errorMessage: 'Mock subscription diagnosis',
            },
          ];
          const original = structuredClone(result);

          const output = await humanCatalog(result, format);

          expect(output).toContain(cause);
          expect(output).toContain(action);
          expect(output).toContain('unknown');
          expect(output).toContain('20.01');
          expect(output).toContain('15.01');
          expect(output).toContain('USD');
          expect(output).not.toContain('zeldaHttp');
          expect(output).not.toContain('Mock subscription diagnosis');
          expect(result).toEqual(original);
        },
      );

      it('explains an unknown state without inventing an error or a recovery action', async () => {
        const result = catalogResult();
        result.authenticated = true;
        result.completeness = 'partial';
        result.sections[0]!.subscriptionStatus = 'unknown';
        const original = structuredClone(result);

        const output = await humanCatalog(result, format);

        expect(output).toContain('state could not be confirmed');
        expect(output).not.toContain('Authentication failed');
        expect(output).not.toContain('auth login');
        expect(output).not.toContain('service could not be reached');
        expect(output).not.toContain('network connection');
        expect(output).not.toContain('Try again later');
        expect(output).toContain('15.01');
        expect(result).toEqual(original);
      });

      it('does not show unrelated recovery advice for a confirmed subscription state', async () => {
        const result = catalogResult();
        result.authenticated = true;
        const output = await humanCatalog(result, format);

        expect(output).not.toContain('state could not be confirmed');
        expect(output).not.toContain('Authentication failed');
        expect(output).not.toContain('auth login');
        expect(output).not.toContain('network connection');
        expect(output).not.toContain('Try again later');
      });
    },
  );

  it.each([
    'AUTH_REQUIRED',
    'NETWORK_ERROR',
    'TIMEOUT',
    'PROTOCOL_ERROR',
    'UNCONFIRMED_SUBSCRIPTION',
  ])(
    'preserves native catalog JSON diagnosis %s without adding human recovery text',
    async (code) => {
      const result = catalogResult();
      result.completeness = 'partial';
      result.sections[0]!.subscriptionStatus = 'unknown';
      result.sections[0]!.diagnostics = [
        {
          api: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription',
          errorCode: code,
          errorMessage: 'Mock raw diagnosis retained',
        },
      ];
      const original = structuredClone(result);
      const expected: TokenPlanListJsonResult = structuredClone(result);
      expected.sections[0]!.plans![0]!.quotaWindows = [
        { windowType: 'weekly' },
        { windowType: 'monthly' },
      ];
      Reflect.deleteProperty(expected.sections[0]!.rows[0]!, 'weeklyCredits');
      Reflect.deleteProperty(expected.sections[0]!.rows[0]!, 'monthlyCredits');
      const client = makeMockApiClient({
        tokenPlanListService: {
          getTokenPlanList: vi.fn(async () => result),
        } as unknown as TokenPlanListService,
      });

      const output = await runCommand(
        (program) =>
          registerSubscriptionTokenPlanCommands(
            program.command('subscription'),
            async () => client,
          ),
        ['subscription', 'tokenplan', 'list', '--edition', 'individual', '--format', 'json'],
      );

      expect(output.exitCode).toBeUndefined();
      expect(output.stderr).toBe('');
      expect(JSON.parse(output.stdout)).toEqual(expected);
      expect(result).toEqual(original);
      expect(output.stdout).not.toContain('auth login');
      expect(output.stdout).not.toContain('Check your network connection');
      expect(output.stdout).not.toContain('Try again later');
    },
  );

  it('shows a successful empty catalog message without drawing an empty price table', () => {
    const result = catalogResult();
    result.sections[0]!.rows = [];
    result.sections[0]!.plans = [];
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    renderTextTokenPlanList(buildTokenPlanListViewModel(result));
    const text = output.mock.calls.flat().join('\n');

    expect(text).toContain(
      'No Token Plan tiers are available for the selected edition and billing cycle.',
    );
    expect(text).not.toContain('List Price');
    expect(text).not.toContain('0 USD');
  });

  it.each([
    ['AUTH_REQUIRED', 2],
    ['NETWORK_ERROR', 3],
    ['PROTOCOL_ERROR', 4],
  ] as const)(
    'classifies %s when every selected catalog section is unavailable',
    async (errorCode, exitCode) => {
      const result = catalogResult();
      result.completeness = 'unknown';
      result.sections[0] = {
        ...result.sections[0]!,
        billingCycleSupported: null,
        subscriptionStatus: 'unknown',
        rows: [],
        plans: [],
        diagnostics: [
          { api: 'GetCommodity', errorCode, errorMessage: 'Mock catalog response malformed' },
        ],
      };
      const getTokenPlanList = vi.fn(async () => result);
      const client = makeMockApiClient({
        tokenPlanListService: { getTokenPlanList } as unknown as TokenPlanListService,
      });

      const output = await runCommand(
        (program) =>
          registerSubscriptionTokenPlanCommands(
            program.command('subscription'),
            async () => client,
          ),
        ['subscription', 'tokenplan', 'list', '--edition', 'individual', '--format', 'json'],
      );

      expect(output.exitCode).toBe(exitCode);
      expect(JSON.parse(output.stdout)).toEqual(result);
      expect(JSON.parse(output.stderr).error.exit_code).toBe(exitCode);
    },
  );

  it.each([
    ['AUTH_REQUIRED', 2],
    ['NETWORK_ERROR', 3],
    ['PROTOCOL_ERROR', 4],
  ] as const)(
    'classifies %s when the selected status edition is unknown and all core data failed',
    async (errorCode, exitCode) => {
      const result = personalStatus();
      result.individual = {
        ...result.individual!,
        status: 'unknown',
        period: null,
        endAt: null,
        autoRenew: null,
        tiers: [],
        completeness: 'unknown',
        diagnostics: [
          {
            api: 'mock-subscription',
            errorCode,
            errorMessage: 'Mock malformed selected subscription',
          },
        ],
      };
      result.diagnostics = result.individual.diagnostics;
      const getTokenPlanStatus = vi.fn(async () => result);
      const client = makeMockApiClient({
        subscriptionTokenPlanService: {
          getTokenPlanStatus,
        } as unknown as SubscriptionTokenPlanService,
      });

      const output = await runCommand(
        (program) =>
          registerSubscriptionTokenPlanCommands(
            program.command('subscription'),
            async () => client,
          ),
        ['subscription', 'tokenplan', 'status', '--edition', 'individual', '--format', 'json'],
      );

      expect(output.exitCode).toBe(exitCode);
      expect(JSON.parse(output.stdout)).toEqual(result);
      expect(JSON.parse(output.stderr).error.exit_code).toBe(exitCode);
      expect(getTokenPlanStatus).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ edition: 'individual' }),
      );
    },
  );

  it.each([
    ['AUTH_REQUIRED', 2],
    ['NETWORK_ERROR', 3],
  ] as const)(
    'retains the %s failure exit code and writes its error only to stderr',
    async (code, exitCode) => {
      const getTokenPlanStatus = vi.fn(async () => {
        throw new CliError({ code, message: 'Mock selected subscription failure', exitCode });
      });
      const client = makeMockApiClient({
        subscriptionTokenPlanService: {
          getTokenPlanStatus,
        } as unknown as SubscriptionTokenPlanService,
      });

      const output = await runCommand(
        (program) =>
          registerSubscriptionTokenPlanCommands(
            program.command('subscription'),
            async () => client,
          ),
        ['subscription', 'tokenplan', 'status', '--edition', 'individual', '--format', 'json'],
      );

      expect(output.exitCode).toBe(exitCode);
      expect(output.stdout).toBe('');
      expect(JSON.parse(output.stderr)).toEqual({
        error: { code, message: 'Mock selected subscription failure', exit_code: exitCode },
      });
    },
  );

  it('downgrades explicit table output to text in a non-TTY and emits the notice on stderr', async () => {
    vi.stubEnv('VITEST', undefined);
    const stdinRead = vi.spyOn(process.stdin, 'read').mockImplementation(() => {
      throw new Error('The command must not read stdin');
    });
    const getTokenPlanList = vi.fn(async () => catalogResult());
    const client = makeMockApiClient({
      tokenPlanListService: { getTokenPlanList } as unknown as TokenPlanListService,
    });

    try {
      const output = await runCommand(
        (program) =>
          registerSubscriptionTokenPlanCommands(
            program.command('subscription'),
            async () => client,
          ),
        ['subscription', 'tokenplan', 'list', '--format', 'table'],
      );
      expect(output.exitCode).toBeUndefined();
      expect(output.stdout).toContain('USD');
      expect(output.stderr).toMatch(/falling back to text/i);
      expect(stdinRead).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('retains a successful selected edition and diagnostics when another selected edition fails', async () => {
    const result = personalStatus();
    result.team = {
      ...result.individual!,
      edition: 'team',
      commodityCode: 'sfm_tokenplanteams_dp_intl',
      status: 'unknown',
      period: null,
      tiers: undefined,
      endAt: null,
      autoRenew: null,
      completeness: 'unknown',
      diagnostics: [
        {
          api: 'GetSeatSubscriptionSummary',
          errorCode: 'NETWORK_ERROR',
          errorMessage: 'Mock failed team query',
        },
      ],
    };
    result.diagnostics = result.team.diagnostics;
    const expected = structuredClone(result);
    expected.individual!.period = {
      start: '2026-09-09T09:09:09.000Z',
      end: '2026-11-20T00:00:00.000Z',
      remainingDays: 22,
    };
    const getTokenPlanStatus = vi.fn(async () => result);
    const client = makeMockApiClient({
      subscriptionTokenPlanService: {
        getTokenPlanStatus,
      } as unknown as SubscriptionTokenPlanService,
    });

    const output = await runCommand(
      (program) =>
        registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client),
      ['subscription', 'tokenplan', 'status', '--edition', 'all', '--format', 'json'],
    );

    expect(output.exitCode).toBeUndefined();
    expect(JSON.parse(output.stdout)).toEqual({
      ...expected,
      individual: {
        ...expected.individual,
        tiers: [
          {
            tier: 'lite',
            windowType: 'weekly',
            usedPct: 25,
            remainingPct: 75,
            resetAt: '2026-10-30T00:00:00Z',
          },
        ],
      },
    });
  });

  it('terminates the active query with exit 130 when its SIGINT handler is invoked', async () => {
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let signal: AbortSignal | undefined;
    let rejectRequest: (error: Error) => void = () => {};
    let sigintHandler: (() => void) | undefined;
    const originalOnce = process.once.bind(process);
    const originalOn = process.on.bind(process);
    vi.spyOn(process, 'once').mockImplementation(((
      event: string | symbol,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') {
        sigintHandler = listener;
        return process;
      }
      return originalOnce(event, listener);
    }) as typeof process.once);
    vi.spyOn(process, 'on').mockImplementation(((
      event: string | symbol,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') {
        sigintHandler = listener;
        return process;
      }
      return originalOn(event, listener);
    }) as typeof process.on);
    const getTokenPlanStatus = vi.fn(async (options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      markStarted();
      return new Promise<TokenPlanStatusResult>((_resolve, reject) => {
        rejectRequest = reject;
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Mock query interrupted', 'AbortError')),
          { once: true },
        );
      });
    });
    const client = makeMockApiClient({
      subscriptionTokenPlanService: {
        getTokenPlanStatus,
      } as unknown as SubscriptionTokenPlanService,
    });
    const pending = runCommand(
      (program) =>
        registerSubscriptionTokenPlanCommands(program.command('subscription'), async () => client),
      ['subscription', 'tokenplan', 'status', '--edition', 'individual', '--format', 'json'],
    );
    try {
      await started;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(sigintHandler).toEqual(expect.any(Function));
      sigintHandler!();

      const output = await pending;
      expect(output.exitCode).toBe(130);
      expect(output.stdout).toBe('');
      expect(signal?.aborted).toBe(true);
    } finally {
      rejectRequest(new DOMException('Mock query cleanup', 'AbortError'));
      await pending;
    }
  });
});

/**
 * Command-level tests for `subscription status`.
 *
 * The Service layer is responsible for the multi-API orchestration (timeout,
 * partial failure, diagnostics array). The command layer must:
 *  - parse --plan flag,
 *  - dispatch tri-format output,
 *  - propagate the diagnostics array verbatim into JSON,
 *  - exit non-zero only when data is fully unavailable (data === null).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import {
  renderInkForTest,
  clearRenderedFrames,
  lastRenderedFrame,
} from '../../helpers/ink-render-mock.js';
import type {
  SubscriptionStatusResult,
  SubscriptionStatus,
  SubscriptionDiagnostic,
} from '../../../src/types/subscription.js';
import type { TokenPlanEditionStatus } from '../../../src/types/tokenplan-subscription.js';

const holder = {
  subscriptionService: {
    getStatus: vi.fn(),
    listOrders: vi.fn(),
  },
  subscriptionTokenPlanService: { getTokenPlanStatus: vi.fn() },
};
const { renderInteractiveSpy, renderWithInkSpy } = vi.hoisted(() => ({
  renderInteractiveSpy: vi.fn<(el: Parameters<typeof renderInkForTest>[0]) => Promise<void>>(),
  renderWithInkSpy: vi.fn<(el: Parameters<typeof renderInkForTest>[0]) => Promise<void>>(),
}));

vi.mock('../../../src/services/index.js', () => ({
  createServices: () => ({
    subscriptionService: holder.subscriptionService,
    subscriptionTokenPlanService: holder.subscriptionTokenPlanService,
    billingService: {
      getUsageLimit: vi.fn(),
      getConsumeBreakdown: vi.fn(),
      getSettleBillSummary: vi.fn(),
    },
    apiClient: {},
    authClient: {},
    cache: {},
    freetierService: {},
    codingplanService: {},
    tokenplanService: {},
    modelsService: {},
    usageService: {},
    authService: {},
  }),
}));
vi.mock('../../../src/auth/credentials.js', () => ({ ensureAuthenticated: () => ({}) }));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_l: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: renderWithInkSpy,
  renderInteractive: renderInteractiveSpy,
  renderWithInkSync: vi.fn(),
}));

const { subscriptionStatusAction } = await import('../../../src/commands/subscription/status.js');
const { subscriptionTokenPlanStatusAction } =
  await import('../../../src/commands/subscription/tokenplan/status.js');
const { createClient } = await import('../../../src/api/client.js');

const getClient = () => createClient();

function makeStatus(overrides: Partial<SubscriptionStatus> = {}): SubscriptionStatus {
  return {
    isGray: false,
    plan: 'Token Plan Team (Monthly)',
    period: { start: '2026-04-01T00:00:00Z', end: '2026-04-30T23:59:59Z' },
    quota: { remaining: 750_000, total: 1_000_000, usedPct: 25 },
    autoRenew: true,
    renewable: true,
    ...overrides,
  } as SubscriptionStatus;
}

function diag(api: string, code = 'ServiceError', msg = 'failed'): SubscriptionDiagnostic {
  return { api, errorCode: code, errorMessage: msg };
}

function personalEdition(): TokenPlanEditionStatus {
  return {
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
    autoRenew: null,
    confirmedAutoRenew: null,
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
  };
}

beforeEach(() => {
  holder.subscriptionService.getStatus.mockReset();
  holder.subscriptionService.listOrders.mockReset();
  holder.subscriptionTokenPlanService.getTokenPlanStatus.mockReset();
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest);
  renderWithInkSpy.mockReset();
  renderWithInkSpy.mockImplementation(renderInkForTest);
  clearRenderedFrames();
});

function buildStatus(program: import('commander').Command) {
  const sub = program.command('subscription');
  const cmd = sub.command('status').option('--plan <p>');
  cmd.action(subscriptionStatusAction(cmd, getClient));
}

function buildDedicatedStatus(program: import('commander').Command) {
  const cmd = program.command('subscription').command('tokenplan').command('status');
  cmd.action(subscriptionTokenPlanStatusAction(cmd, getClient));
}

it('rejects an invalid plan with the argument exit code before calling the service', async () => {
  const result = await runCommand(buildStatus, ['subscription', 'status', '--plan', 'bogus']);
  expect(result.exitCode).toBe(4);
  expect(result.stderr).toContain('--plan must be token or coding.');
  expect(holder.subscriptionService.getStatus).not.toHaveBeenCalled();
});

describe.each([40, 120])('personal subscription ratios at %s columns', (columns) => {
  it.each([
    ['aggregate', 'json'],
    ['aggregate', 'text'],
    ['aggregate', 'table'],
    ['token', 'json'],
    ['token', 'text'],
    ['token', 'table'],
    ['dedicated', 'json'],
    ['dedicated', 'text'],
    ['dedicated', 'table'],
  ] as const)('hides absolute Credits in %s %s output', async (entry, format) => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
    try {
      for (const enhanced of [false, true]) {
        const individual = personalEdition();
        individual.monthlyCredits = {
          total: 424242123,
          used: 106060530.75,
          remaining: 318181592.25,
          usedPct: 25,
          resetTime: '2026-12-01T00:00:00Z',
        };
        individual.weeklyCredits = { total: 424242123, used: 0, remaining: 424242123, usedPct: 0 };
        if (enhanced)
          individual.tiers = [
            {
              tier: 'lite',
              windowType: 'monthly',
              totalCredits: '424242123',
              remainingCredits: '318181592.25',
              usedPct: 25,
              remainingPct: 75,
              resetAt: null,
            },
            {
              tier: 'lite',
              windowType: 'weekly',
              totalCredits: '424242123',
              remainingCredits: '424242123',
              usedPct: 0,
              remainingPct: 100,
              resetAt: null,
            },
          ];
        const team: TokenPlanEditionStatus = {
          ...personalEdition(),
          edition: 'team',
          commodityCode: 'sfm_tokenplanteams_dp_intl',
          weeklyCredits: { total: 90, used: 10, remaining: 80, usedPct: 10 },
          seatSummaries: [
            {
              seatType: 'pro',
              seatCount: 1,
              assignedCount: 1,
              totalCredits: '90',
              remainingCredits: '80',
              remainingPct: 88.89,
              resetAt: null,
            },
          ],
        };
        const data = makeStatus({ individual, team, codingPlanStatus: 'VALID' });
        const dedicated = {
          individual,
          team,
          product: 'Token Plan',
          period: null,
          autoRenew: null,
          renewable: null,
          seatSummary: null,
          diagnostics: [],
        };
        const before = structuredClone({ data, dedicated });
        holder.subscriptionService.getStatus.mockResolvedValue({ data, diagnostics: [] });
        holder.subscriptionTokenPlanService.getTokenPlanStatus.mockResolvedValue(dedicated);
        const result = await runCommand(
          entry === 'dedicated' ? buildDedicatedStatus : buildStatus,
          [
            'subscription',
            ...(entry === 'dedicated' ? ['tokenplan'] : []),
            'status',
            ...(entry === 'token' ? ['--plan', 'token'] : []),
            '--format',
            format,
          ],
        );
        expect(result.exitCode).toBeUndefined();
        if (format === 'json') {
          const json = JSON.parse(result.stdout);
          expect(json.individual.monthlyCredits).toEqual({
            usedPct: 25,
            remainingPct: 75,
            resetTime: '2026-12-01T00:00:00.000Z',
          });
          expect(json.individual.weeklyCredits).toEqual({ usedPct: 0, remainingPct: 100 });
          if (enhanced)
            expect(json.individual.tiers).toEqual([
              { tier: 'lite', windowType: 'monthly', usedPct: 25, remainingPct: 75, resetAt: null },
              { tier: 'lite', windowType: 'weekly', usedPct: 0, remainingPct: 100, resetAt: null },
            ]);
          else expect(json.individual).not.toHaveProperty('tiers');
          expect(json.team.weeklyCredits).toEqual(team.weeklyCredits);
          expect(json.team.seatSummaries).toEqual(team.seatSummaries);
          expect(JSON.stringify(json.individual)).not.toContain('424242123');
          if (entry !== 'dedicated') {
            expect(json.quota).toEqual(data.quota);
            expect(json.codingPlanStatus).toBe('VALID');
          }
        } else {
          const output = format === 'text' ? result.stdout : lastRenderedFrame()!;
          const personal = output.slice(output.indexOf('Individual'), output.indexOf('Team'));
          expect(personal).not.toContain('TOTAL CREDITS');
          expect(personal).not.toContain('REMAINING CREDITS');
          expect(personal).not.toMatch(/424242123|424,242,123|318181592|318,181,592/);
          for (const percentage of ['25%', '75%', '0%', '100%'])
            expect(personal).toContain(percentage);
          expect(output.slice(output.indexOf('Team'))).toContain('TOTAL CREDITS');
        }
        expect({ data, dedicated }).toEqual(before);
      }
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'columns', descriptor);
      else Reflect.deleteProperty(process.stdout, 'columns');
    }
  });
});

describe('subscription status command', () => {
  it.each(['all', 'coding', 'token'] as const)(
    'preserves legacy timestamps while formatting added editions for %s',
    async (plan) => {
      const data = makeStatus({
        codingPlanStatus: 'VALID',
        plan: 'Coding Plan Pro',
        period: {
          start: '2026-10-01T00:00:00+08:00',
          end: '2026-12-01T00:00:00+08:00',
        },
        ...(plan !== 'coding' ? { individual: personalEdition() } : {}),
      });
      const original = structuredClone(data);
      holder.subscriptionService.getStatus.mockResolvedValue({ data, diagnostics: [] });

      const result = await runCommand(buildStatus, [
        'subscription',
        'status',
        ...(plan === 'all' ? [] : ['--plan', plan]),
        '--format',
        'json',
      ]);
      const payload = JSON.parse(result.stdout);

      expect(result.exitCode).toBeUndefined();
      expect(payload.period).toEqual({
        start: '2026-10-01T00:00:00+08:00',
        end: '2026-12-01T00:00:00+08:00',
      });
      expect(payload.codingPlanStatus).toBe('VALID');
      if (plan !== 'coding') {
        expect(payload.individual.period.start).toBe('2026-10-01T00:00:00.000Z');
        expect(payload.individual.weeklyCredits).toEqual({
          usedPct: 25,
          remainingPct: 75,
          resetTime: '2026-10-30T00:00:00.000Z',
        });
      } else {
        expect(payload).not.toHaveProperty('individual');
      }
      expect(data).toEqual(original);
    },
  );

  it('preserves personal edition fields and hides absolute Credits from the native JSON object', async () => {
    const individual = personalEdition();
    individual.monthlyCredits = {
      total: 500,
      used: null,
      remaining: null,
      usedPct: 25,
      resetTime: '2026-10-30T00:00:00Z',
    };
    const data = makeStatus({ individual });
    const original = structuredClone(data);
    holder.subscriptionService.getStatus.mockResolvedValue({ data, diagnostics: [] });

    const result = await runCommand(buildStatus, [
      'subscription',
      'status',
      '--plan',
      'token',
      '--format',
      'json',
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(payload).not.toHaveProperty('data');
    expect(payload).toMatchObject({ plan: 'Token Plan Team (Monthly)', autoRenew: true });
    expect(payload.individual).toMatchObject({
      edition: 'individual',
      status: 'active',
      specCode: 'lite',
      period: {
        start: '2026-10-01T00:00:00.000Z',
        end: '2026-11-20T00:00:00.000Z',
        remainingDays: 22,
      },
      confirmedAutoRenew: null,
      monthlyCredits: {
        usedPct: 25,
        remainingPct: 75,
        resetTime: '2026-10-30T00:00:00.000Z',
      },
    });
    expect(payload.individual.weeklyCredits).toEqual({
      usedPct: 25,
      remainingPct: 75,
      resetTime: '2026-10-30T00:00:00.000Z',
    });
    expect(payload.individual.monthlyCredits).not.toHaveProperty('used');
    expect(payload.individual.monthlyCredits).not.toHaveProperty('remaining');
    expect(payload.individual).not.toHaveProperty('harnessAllowances');
    expect(data).toEqual(original);
  });

  it.each([2, 3, 4] as const)(
    'preserves classified exit %s for a complete subscription failure',
    async (failureExitCode) => {
      const diagnostics = [diag('mock-subscription', 'SERVICE_UNAVAILABLE')];
      holder.subscriptionService.getStatus.mockResolvedValue({
        data: null,
        diagnostics,
        failureExitCode,
      } satisfies SubscriptionStatusResult);

      const result = await runCommand(buildStatus, [
        'subscription',
        'status',
        '--plan',
        'token',
        '--format',
        'json',
      ]);

      expect(result.exitCode).toBe(failureExitCode);
      expect(JSON.parse(result.stdout)).toEqual({ data: null, diagnostics });
      expect(result.stdout).not.toContain('not_subscribed');
    },
  );

  it('all-success → exit 0, JSON data is non-null and diagnostics is []', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: makeStatus(),
      diagnostics: [],
    } as SubscriptionStatusResult);
    const r = await runCommand(buildStatus, ['subscription', 'status', '--format', 'json']);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.data).toBeUndefined();
    expect(payload.diagnostics).toEqual([]);
  });

  it('partial failure → exit 0, JSON.diagnostics has the failed-API entries', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: makeStatus({ autoRenew: null }),
      diagnostics: [diag('CheckTokenPlanAutoRenewal')],
    } as SubscriptionStatusResult);
    const r = await runCommand(buildStatus, ['subscription', 'status', '--format', 'json']);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.autoRenew).toBeNull();
    expect(payload.diagnostics).toHaveLength(1);
    expect(payload.diagnostics[0].api).toBe('CheckTokenPlanAutoRenewal');
  });

  it('total failure (data === null) → exit 1, JSON.data is null', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: null,
      diagnostics: Array.from({ length: 6 }, (_, i) => diag(`api-${i}`)),
    } as SubscriptionStatusResult);
    const r = await runCommand(buildStatus, ['subscription', 'status', '--format', 'json']);
    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stdout);
    expect(payload.data).toBeNull();
    expect(payload.diagnostics).toHaveLength(6);
  });

  it('overall timeout sentinel → exit 1, diagnostics carry timeout markers', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: null,
      diagnostics: Array.from({ length: 6 }, (_, i) =>
        diag(`api-${i}`, 'TIMEOUT', 'overall timeout'),
      ),
    } as SubscriptionStatusResult);
    const r = await runCommand(buildStatus, ['subscription', 'status', '--format', 'json']);
    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stdout);
    expect(
      payload.diagnostics.every((d: SubscriptionDiagnostic) => d.errorCode === 'TIMEOUT'),
    ).toBe(true);
  });

  it('--plan token → service receives { plan: "token" }', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: makeStatus(),
      diagnostics: [],
    } as SubscriptionStatusResult);
    await runCommand(buildStatus, [
      'subscription',
      'status',
      '--plan',
      'token',
      '--format',
      'json',
    ]);
    const opts = holder.subscriptionService.getStatus.mock.calls[0][0] ?? {};
    expect(opts.plan).toBe('token');
  });

  it('--plan coding → service receives { plan: "coding" }', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: makeStatus(),
      diagnostics: [],
    } as SubscriptionStatusResult);
    await runCommand(buildStatus, [
      'subscription',
      'status',
      '--plan',
      'coding',
      '--format',
      'json',
    ]);
    const opts = holder.subscriptionService.getStatus.mock.calls[0][0] ?? {};
    expect(opts.plan).toBe('coding');
  });
});

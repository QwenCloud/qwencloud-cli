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
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';
import type {
  SubscriptionStatusResult,
  SubscriptionStatus,
  SubscriptionDiagnostic,
} from '../../../src/types/subscription.js';

const holder = {
  subscriptionService: {
    getStatus: vi.fn(),
    listOrders: vi.fn(),
  },
};
const { renderInteractiveSpy } = vi.hoisted(() => ({
  renderInteractiveSpy: vi.fn<(el: unknown) => Promise<void>>(),
}));

vi.mock('../../../src/services/index.js', () => ({
  createServices: () => ({
    subscriptionService: holder.subscriptionService,
    billingService: { getUsageLimit: vi.fn(), getConsumeBreakdown: vi.fn(), getSettleBillSummary: vi.fn() },
    apiClient: {}, authClient: {}, cache: {},
    freetierService: {}, codingplanService: {}, tokenplanService: {},
    modelsService: {}, usageService: {}, authService: {},
  }),
}));
vi.mock('../../../src/auth/credentials.js', () => ({ ensureAuthenticated: () => ({}) }));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_l: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: vi.fn(),
  renderInteractive: renderInteractiveSpy,
  renderWithInkSync: vi.fn(),
}));

const { subscriptionStatusAction } = await import('../../../src/commands/subscription/status.js');
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

beforeEach(() => {
  holder.subscriptionService.getStatus.mockReset();
  holder.subscriptionService.listOrders.mockReset();
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest);
  clearRenderedFrames();
});

function buildStatus(program: import('commander').Command) {
  const sub = program.command('subscription');
  const cmd = sub.command('status').option('--plan <p>');
  cmd.action(subscriptionStatusAction(cmd, getClient));
}

describe('subscription status command', () => {
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
      diagnostics: Array.from({ length: 6 }, (_, i) => diag(`api-${i}`, 'TIMEOUT', 'overall timeout')),
    } as SubscriptionStatusResult);
    const r = await runCommand(buildStatus, ['subscription', 'status', '--format', 'json']);
    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stdout);
    expect(payload.diagnostics.every((d: SubscriptionDiagnostic) => d.errorCode === 'TIMEOUT')).toBe(true);
  });

  it('--plan token → service receives { plan: "token" }', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: makeStatus(),
      diagnostics: [],
    } as SubscriptionStatusResult);
    await runCommand(buildStatus, ['subscription', 'status', '--plan', 'token', '--format', 'json']);
    const opts = holder.subscriptionService.getStatus.mock.calls[0][0] ?? {};
    expect(opts.plan).toBe('token');
  });

  it('--plan coding → service receives { plan: "coding" }', async () => {
    holder.subscriptionService.getStatus.mockResolvedValue({
      data: makeStatus(),
      diagnostics: [],
    } as SubscriptionStatusResult);
    await runCommand(buildStatus, ['subscription', 'status', '--plan', 'coding', '--format', 'json']);
    const opts = holder.subscriptionService.getStatus.mock.calls[0][0] ?? {};
    expect(opts.plan).toBe('coding');
  });
});

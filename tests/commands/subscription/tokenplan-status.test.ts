/**
 * Command-level tests for `subscription tokenplan status`.
 *
 * The Service layer is responsible for 4-API orchestration (timeout, partial
 * failure, diagnostics array). The command layer must:
 *  - default format to tui,
 *  - dispatch tri-format output,
 *  - propagate diagnostics array verbatim into JSON,
 *  - exit non-zero only when ALL data is unavailable,
 *  - handle auth failures gracefully.
 */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';

// ────────────────────────────────────────────────────────────────────
// Type stubs
// ────────────────────────────────────────────────────────────────────

interface TokenPlanDiagnostic {
  api: string;
  errorCode: string;
  errorMessage: string;
}

interface TokenPlanStatusResult {
  product: string | null;
  period: { start: string; end: string; remainingDays: number } | null;
  autoRenew: { enabled: boolean; period: number; periodUnit: string } | null;
  renewable: { canRenew: boolean; interceptCode: string } | null;
  seatSummary: {
    groups: Array<{
      specType: string;
      seats: number;
      assigned: number;
      totalValue: string;
      surplusValue: string;
      unit: string;
      nextCycleFlushTime: string;
    }>;
    total: { seats: number; totalValue: string; surplusValue: string; unit: string };
  } | null;
  diagnostics: TokenPlanDiagnostic[];
}

// ────────────────────────────────────────────────────────────────────
// Mock setup
// ────────────────────────────────────────────────────────────────────

const holder = {
  subscriptionTokenPlanService: {
    getTokenPlanStatus: vi.fn(),
  },
};

const { renderInteractiveSpy, renderWithInkSpy } = vi.hoisted(() => ({
  renderInteractiveSpy: vi.fn<(el: ReactElement) => Promise<void>>(),
  renderWithInkSpy: vi.fn<(el: ReactElement) => Promise<void>>(),
}));

vi.mock('../../../src/services/index.js', () => ({
  createServices: () => ({
    subscriptionTokenPlanService: holder.subscriptionTokenPlanService,
    subscriptionService: { getStatus: vi.fn(), listOrders: vi.fn() },
    billingService: {},
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

const { subscriptionTokenPlanStatusAction } = await import(
  '../../../src/commands/subscription/tokenplan/status.js'
);
const { createClient } = await import('../../../src/api/client.js');

const getClient = () => createClient();

// ────────────────────────────────────────────────────────────────────
// Factories
// ────────────────────────────────────────────────────────────────────

function makeFullResult(): TokenPlanStatusResult {
  return {
    product: 'Token Plan Team Edition',
    period: {
      start: '2026-06-14T00:00:00+08:00',
      end: '2026-07-14T00:00:00+08:00',
      remainingDays: 41,
    },
    autoRenew: { enabled: true, period: 1, periodUnit: 'M' },
    renewable: { canRenew: false, interceptCode: 'PENDING_RENEWAL' },
    seatSummary: {
      groups: [
        {
          specType: 'standard',
          seats: 7,
          assigned: 7,
          totalValue: '175000',
          surplusValue: '174999.75',
          unit: 'Credits',
          nextCycleFlushTime: '2026-06-14T00:00:00+08:00',
        },
        {
          specType: 'pro',
          seats: 4,
          assigned: 4,
          totalValue: '400000',
          surplusValue: '391284.56',
          unit: 'Credits',
          nextCycleFlushTime: '2026-06-14T00:00:00+08:00',
        },
      ],
      total: { seats: 11, totalValue: '575000', surplusValue: '566284.3192002', unit: 'Credits' },
    },
    diagnostics: [],
  };
}

function makeDiag(api: string, msg = 'failed'): TokenPlanDiagnostic {
  return { api, errorCode: 'ServiceError', errorMessage: msg };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  holder.subscriptionTokenPlanService.getTokenPlanStatus.mockReset();
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest);
  clearRenderedFrames();
});

function buildCommand(program: import('commander').Command) {
  const sub = program.command('subscription');
  const tokenplan = sub.command('tokenplan');
  const cmd = tokenplan.command('status');
  cmd.action(subscriptionTokenPlanStatusAction(cmd, getClient));
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('subscription tokenplan status command', () => {
  it('all-success → exit 0, JSON output is valid and complete', async () => {
    holder.subscriptionTokenPlanService.getTokenPlanStatus.mockResolvedValue(makeFullResult());
    const r = await runCommand(buildCommand, [
      'subscription', 'tokenplan', 'status', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.product).toBe('Token Plan Team Edition');
    expect(payload.period.remainingDays).toBe(41);
    expect(payload.autoRenew.enabled).toBe(true);
    expect(payload.seatSummary.groups).toHaveLength(2);
    expect(payload.diagnostics).toEqual([]);
  });

  it('partial failure → exit 0, JSON.diagnostics has failed API entries', async () => {
    const result = makeFullResult();
    result.autoRenew = null;
    result.diagnostics = [makeDiag('CheckTokenPlanAutoRenewal')];
    holder.subscriptionTokenPlanService.getTokenPlanStatus.mockResolvedValue(result);
    const r = await runCommand(buildCommand, [
      'subscription', 'tokenplan', 'status', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.autoRenew).toBeNull();
    expect(payload.diagnostics).toHaveLength(1);
    expect(payload.diagnostics[0].api).toBe('CheckTokenPlanAutoRenewal');
  });

  it('total failure → exit 1', async () => {
    const result: TokenPlanStatusResult = {
      product: null,
      period: null,
      autoRenew: null,
      renewable: null,
      seatSummary: null,
      diagnostics: [
        makeDiag('GetSeatSubscriptionSummary'),
        makeDiag('GetSubscriptionSummary'),
        makeDiag('CheckTokenPlanAutoRenewal'),
        makeDiag('CheckInstancesRenewable'),
      ],
    };
    holder.subscriptionTokenPlanService.getTokenPlanStatus.mockResolvedValue(result);
    const r = await runCommand(buildCommand, [
      'subscription', 'tokenplan', 'status', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(1);
  });

  it('--format text → produces non-JSON text output', async () => {
    holder.subscriptionTokenPlanService.getTokenPlanStatus.mockResolvedValue(makeFullResult());
    const r = await runCommand(buildCommand, [
      'subscription', 'tokenplan', 'status', '--format', 'text',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('Token Plan');
    // Should not be valid JSON
    expect(() => JSON.parse(r.stdout)).toThrow();
  });

  it('default format is tui (renders Ink component)', async () => {
    holder.subscriptionTokenPlanService.getTokenPlanStatus.mockResolvedValue(makeFullResult());
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    try {
      await runCommand(buildCommand, [
        'subscription', 'tokenplan', 'status',
      ]);
      // TUI mode should invoke renderInteractive or renderWithInk
      expect(renderInteractiveSpy.mock.calls.length + renderWithInkSpy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('service throws → graceful error handling (non-zero exit)', async () => {
    holder.subscriptionTokenPlanService.getTokenPlanStatus.mockRejectedValue(
      new Error('Connection refused'),
    );
    const r = await runCommand(buildCommand, [
      'subscription', 'tokenplan', 'status', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(1);
  });
});

describe('subscription tokenplan status — auth failure', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('unauthenticated user → error message and non-zero exit', async () => {
    vi.doMock('../../../src/auth/credentials.js', () => ({
      ensureAuthenticated: () => {
        throw new Error('Not authenticated. Run "qwencloud login" first.');
      },
    }));

    const { subscriptionTokenPlanStatusAction: freshAction } = await import(
      '../../../src/commands/subscription/tokenplan/status.js'
    );

    function localBuildCommand(program: import('commander').Command) {
      const sub = program.command('subscription');
      const tokenplan = sub.command('tokenplan');
      const cmd = tokenplan.command('status');
      cmd.action(freshAction(cmd, getClient));
    }

    holder.subscriptionTokenPlanService.getTokenPlanStatus.mockResolvedValue(makeFullResult());
    const r = await runCommand(localBuildCommand, [
      'subscription', 'tokenplan', 'status', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(1);
  });
});

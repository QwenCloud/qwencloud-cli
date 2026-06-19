/**
 * Command-level tests for `subscription tokenplan seats`.
 *
 * The Service is responsible for paging contract enforcement, double-JSON
 * Config parsing, and per-row diagnostic recording. The command layer must:
 *  - default format=tui, page=1, pageSize=20,
 *  - dispatch tri-format output (tui/text/json),
 *  - propagate filter (--spec-type) and pagination flags into the service
 *    call,
 *  - exit non-zero on infrastructure errors,
 *  - handle auth failures gracefully.
 */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';

// ────────────────────────────────────────────────────────────────────
// Type stubs
// ────────────────────────────────────────────────────────────────────

interface SeatCycle {
  startTime: string;
  endTime: string;
  totalValue: string;
  surplusValue: string;
  unit: string;
}

interface SeatConfig {
  planType: string;
  creditValue: number;
  seatNum: number;
  quotaCycle: string;
}

interface SeatItem {
  instanceCode: string;
  specType: string;
  status: string;
  memberId: string;
  assignable: boolean;
  assignment: string;
  payMode: string;
  productType: string;
  cycle: SeatCycle | null;
  config: SeatConfig | null;
}

interface TokenPlanSeatsResult {
  page: { current: number; size: number; total: number };
  filter: { specType: string | null };
  items: SeatItem[];
  diagnostics: Array<{ api: string; errorCode: string; errorMessage: string }>;
}

// ────────────────────────────────────────────────────────────────────
// Mock setup
// ────────────────────────────────────────────────────────────────────

const holder = {
  subscriptionTokenPlanService: {
    getTokenPlanStatus: vi.fn(),
    listTokenPlanSeats: vi.fn<(opts?: unknown) => Promise<TokenPlanSeatsResult>>(),
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

const { subscriptionTokenPlanSeatsAction } =
  await import('../../../src/commands/subscription/tokenplan-seats.js');
const { createClient } = await import('../../../src/api/client.js');

const getClient = () => createClient();

// ────────────────────────────────────────────────────────────────────
// Factories
// ────────────────────────────────────────────────────────────────────

function makeSeat(overrides: Partial<SeatItem> = {}): SeatItem {
  return {
    instanceCode: 'subs-03a5xxxx9x2g',
    specType: 'pro',
    status: 'NORMAL',
    memberId: 'acc_12345678abcdefgh9012',
    assignable: true,
    assignment: 'Assigned',
    payMode: 'Subscription',
    productType: 'TokenPlan',
    cycle: {
      startTime: '2026-06-14T00:00:00+08:00',
      endTime: '2026-07-14T00:00:00+08:00',
      totalValue: '100000.00000000',
      surplusValue: '91284.56267396',
      unit: 'Credits',
    },
    config: {
      planType: 'pro',
      creditValue: 100000,
      seatNum: 1,
      quotaCycle: 'monthly',
    },
    ...overrides,
  };
}

function makeResult(
  items: SeatItem[],
  page: number = 1,
  size: number = 20,
  total: number = items.length,
  filterSpec: string | null = null,
): TokenPlanSeatsResult {
  return {
    page: { current: page, size, total },
    filter: { specType: filterSpec },
    items,
    diagnostics: [],
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  holder.subscriptionTokenPlanService.listTokenPlanSeats.mockReset();
  renderInteractiveSpy.mockReset();
  renderWithInkSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest);
  renderWithInkSpy.mockImplementation(renderInkForTest);
  clearRenderedFrames();
});

function buildCommand(program: import('commander').Command) {
  const sub = program.command('subscription');
  const tokenplan = sub.command('tokenplan');
  const cmd = tokenplan.command('seats');
  cmd.action(subscriptionTokenPlanSeatsAction(cmd, getClient));
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('subscription tokenplan seats command', () => {
  it('default: format=tui, calls service with page=1, pageSize=20, no filter', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat()]),
    );
    await runCommand(buildCommand, ['subscription', 'tokenplan', 'seats']);
    const call = holder.subscriptionTokenPlanService.listTokenPlanSeats.mock.calls[0];
    expect(call).toBeDefined();
    const opts = (call?.[0] ?? {}) as {
      page?: number;
      pageSize?: number;
      specType?: string;
    };
    expect(opts.page ?? 1).toBe(1);
    expect(opts.pageSize ?? 20).toBe(20);
    expect(opts.specType ?? undefined).toBeUndefined();
    // TUI mode invoked an Ink render entry
    expect(
      renderInteractiveSpy.mock.calls.length + renderWithInkSpy.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it('--format json → exit 0, valid JSON containing page/items/diagnostics', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat({ instanceCode: 'subs-A' })], 1, 20, 12),
    );
    const r = await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--format',
      'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.page).toEqual({ current: 1, size: 20, total: 12 });
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items[0].instanceCode).toBe('subs-A');
    expect(payload.diagnostics).toEqual([]);
  });

  it('--format json preserves unmasked memberId', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat({ memberId: 'acc_12345678abcdefgh9012' })]),
    );
    const r = await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--format',
      'json',
    ]);
    const payload = JSON.parse(r.stdout);
    expect(payload.items[0].memberId).toBe('acc_12345678abcdefgh9012');
    expect(payload.items[0].memberId).not.toContain('…');
  });

  it('--format text → human-readable non-JSON output', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat()]),
    );
    const r = await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--format',
      'text',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(() => JSON.parse(r.stdout)).toThrow();
    // Text output should reference the seat domain
    expect(r.stdout.toLowerCase()).toMatch(/seat|page|total/);
  });

  it('--spec-type pro → forwarded to service.listTokenPlanSeats', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat({ specType: 'pro' })], 1, 20, 4, 'pro'),
    );
    await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--spec-type',
      'pro',
      '--format',
      'json',
    ]);
    const opts = (holder.subscriptionTokenPlanService.listTokenPlanSeats.mock.calls[0]?.[0] ??
      {}) as {
      specType?: string;
    };
    expect(opts.specType).toBe('pro');
  });

  it('--spec-type standard → forwarded to service', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat({ specType: 'standard' })], 1, 20, 7, 'standard'),
    );
    await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--spec-type',
      'standard',
      '--format',
      'json',
    ]);
    const opts = (holder.subscriptionTokenPlanService.listTokenPlanSeats.mock.calls[0]?.[0] ??
      {}) as {
      specType?: string;
    };
    expect(opts.specType).toBe('standard');
  });

  it('--page 2 --page-size 50 → forwarded to service as numbers', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat()], 2, 50, 100),
    );
    await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--page',
      '2',
      '--page-size',
      '50',
      '--format',
      'json',
    ]);
    const opts = (holder.subscriptionTokenPlanService.listTokenPlanSeats.mock.calls[0]?.[0] ??
      {}) as {
      page?: number;
      pageSize?: number;
    };
    expect(opts.page).toBe(2);
    expect(opts.pageSize).toBe(50);
  });

  it('JSON output reflects filter.specType=null when no filter passed', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat()], 1, 20, 1, null),
    );
    const r = await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--format',
      'json',
    ]);
    const payload = JSON.parse(r.stdout);
    expect(payload.filter.specType).toBeNull();
  });

  it('JSON output reflects filter.specType=pro when --spec-type pro passed', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat()], 1, 20, 1, 'pro'),
    );
    const r = await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--spec-type',
      'pro',
      '--format',
      'json',
    ]);
    const payload = JSON.parse(r.stdout);
    expect(payload.filter.specType).toBe('pro');
  });

  it('service throws → graceful error, non-zero exit', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockRejectedValue(
      new Error('Connection refused to mock-api.test.qwencloud.com'),
    );
    const r = await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--format',
      'json',
    ]);
    expect(r.exitCode).toBe(1);
  });

  it('empty list → exit 0, payload.items=[]', async () => {
    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([], 1, 20, 0),
    );
    const r = await runCommand(buildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--format',
      'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.items).toEqual([]);
    expect(payload.page.total).toBe(0);
  });
});

describe('subscription tokenplan seats — auth failure', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('unauthenticated user → non-zero exit', async () => {
    vi.doMock('../../../src/auth/credentials.js', () => ({
      ensureAuthenticated: () => {
        throw new Error('Not authenticated. Run "qwencloud login" first.');
      },
    }));

    const { subscriptionTokenPlanSeatsAction: freshAction } = await import(
      '../../../src/commands/subscription/tokenplan-seats.js'
    );

    function localBuildCommand(program: import('commander').Command) {
      const sub = program.command('subscription');
      const tokenplan = sub.command('tokenplan');
      const cmd = tokenplan.command('seats');
      cmd.action(freshAction(cmd, getClient));
    }

    holder.subscriptionTokenPlanService.listTokenPlanSeats.mockResolvedValue(
      makeResult([makeSeat()]),
    );
    const r = await runCommand(localBuildCommand, [
      'subscription',
      'tokenplan',
      'seats',
      '--format',
      'json',
    ]);
    expect(r.exitCode).toBe(1);
  });
});

/** Command-level tests for `billing breakdown`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';
import type { ConsumeBreakdown, ConsumeBreakdownByPeriods } from '../../../src/types/billing-extra.js';

const holder = {
  billingService: {
    getUsageLimit: vi.fn(),
    getConsumeBreakdown: vi.fn(),
    getConsumeBreakdownByPeriods: vi.fn(),
    getSettleBillSummary: vi.fn(),
  },
};

const { renderInteractiveSpy } = vi.hoisted(() => ({
  renderInteractiveSpy: vi.fn<(el: unknown) => Promise<void>>(),
}));

vi.mock('../../../src/services/index.js', () => ({
  createServices: () => ({
    billingService: holder.billingService,
    subscriptionService: { getStatus: vi.fn(), listOrders: vi.fn() },
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

const { billingBreakdownAction } = await import('../../../src/commands/billing/breakdown.js');
const { createClient } = await import('../../../src/api/client.js');

const getClient = () => createClient();

function makeBreakdown(overrides: Partial<ConsumeBreakdown> = {}): ConsumeBreakdown {
  return {
    groupBy: 'model',
    period: { from: '2026-04-01', to: '2026-04-30' },
    chargeType: 'all',
    rows: [
      { groupKey: 'qwen3-max', groupLabel: 'Qwen3 Max', amount: '12.34' },
      { groupKey: 'qwen3-mini', groupLabel: 'Qwen3 Mini', amount: '0.56' },
      { groupKey: '__tax__', groupLabel: 'Tax', amount: '0.77' },
    ],
    totalRows: 2,
    totalAmount: '13.67',
    currency: 'USD',
    ...overrides,
  } as ConsumeBreakdown;
}

function makeBreakdownByPeriods(overrides: Partial<ConsumeBreakdownByPeriods> = {}): ConsumeBreakdownByPeriods {
  return {
    groupBy: 'model',
    dateRange: { from: '2026-01-01', to: '2026-06-30' },
    granularity: 'month',
    chargeType: 'all',
    slices: [
      {
        period: '2026-01',
        rows: [{ groupKey: 'qwen3-max', groupLabel: 'Qwen3 Max', amount: '10.00' }],
        totalAmount: '10.00',
      },
    ],
    currency: 'USD',
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(holder.billingService).forEach((m) => m.mockReset());
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest as any);
  clearRenderedFrames();
});

function buildBreakdown(program: import('commander').Command) {
  const billing = program.command('billing');
  const cmd = billing.command('breakdown')
    .option('--granularity <g>', 'Granularity: day | month', 'month')
    .option('--group-by <g>')
    .option('--from <d>')
    .option('--to <d>')
    .option('--period <p>')
    .option('--charge-type <t>')
    .option('--top <n>');
  cmd.action(billingBreakdownAction(cmd, getClient));
}

describe('billing breakdown command', () => {
  it('default --group-by model → invokes service with model groupBy', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown());
    const r = await runCommand(buildBreakdown, ['billing', 'breakdown', '--format', 'json']);
    expect(r.exitCode).toBeUndefined();
    expect(holder.billingService.getConsumeBreakdown).toHaveBeenCalled();
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    expect(opts.groupBy ?? 'model').toBe('model');
  });

  it('--top 5 → service receives top: 5', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown());
    await runCommand(buildBreakdown, ['billing', 'breakdown', '--top', '5', '--format', 'json']);
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    expect(opts.top).toBe(5);
  });

  it('--from + --to passes through; absent --period', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown());
    await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--from', '2026-04-01', '--to', '2026-04-15', '--format', 'json',
    ]);
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    expect(opts.from).toBe('2026-04-01');
    expect(opts.to).toBe('2026-04-15');
    expect(opts.period).toBeUndefined();
  });

  it('--period and --from together → --from takes priority (no error)', async () => {
    holder.billingService.getConsumeBreakdownByPeriods.mockResolvedValue(makeBreakdownByPeriods());
    await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--period', 'thisMonth', '--from', '2026-04-01', '--format', 'json',
    ]);
    expect(holder.billingService.getConsumeBreakdownByPeriods).toHaveBeenCalled();
    const opts = holder.billingService.getConsumeBreakdownByPeriods.mock.calls[0][0];
    expect(opts.from).toBe('2026-04-01');
  });

  it('--charge-type postpaid → rejected as invalid', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--charge-type', 'postpaid', '--format', 'json',
    ]);
    expect(r.exitCode).not.toBe(0);
  });

  it('--charge-type subscription → service receives chargeType: prepaid', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown({ chargeType: 'prepaid' }));
    await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--charge-type', 'subscription', '--format', 'json',
    ]);
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    expect(opts.chargeType).toBe('prepaid');
  });

  it('--charge-type payg → service receives chargeType: postpaid', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown({ chargeType: 'postpaid' }));
    await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--charge-type', 'payg', '--format', 'json',
    ]);
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    expect(opts.chargeType).toBe('postpaid');
  });

  it('--charge-type prepaid → rejected as invalid', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--charge-type', 'prepaid', '--format', 'json',
    ]);
    expect(r.exitCode).not.toBe(0);
  });

  it('JSON mode → returns total + items, items[].amount as string', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown());
    const r = await runCommand(buildBreakdown, ['billing', 'breakdown', '--format', 'json']);
    const payload = JSON.parse(r.stdout);
    expect(payload.totalAmount).toBe('13.67');
    expect(typeof payload.rows[0].amount).toBe('string');
    expect(payload.rows.some((r: { groupKey: string }) => r.groupKey === '__tax__')).toBe(true);
  });

  it('401 → exit 1', async () => {
    holder.billingService.getConsumeBreakdown.mockRejectedValue(
      Object.assign(new Error('401'), { status: 401 }),
    );
    const r = await runCommand(buildBreakdown, ['billing', 'breakdown', '--format', 'json']);
    expect(r.exitCode).toBe(1);
  });

  it('default --granularity month → service receives granularity: month', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown());
    await runCommand(buildBreakdown, ['billing', 'breakdown', '--format', 'json']);
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    expect(opts.granularity).toBe('month');
  });

  it('default month granularity → from/to is current month (YYYY-MM)', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown());
    await runCommand(buildBreakdown, ['billing', 'breakdown', '--format', 'json']);
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(opts.from).toContain(ym);
    expect(opts.to).toContain(ym);
  });

  it('--granularity day → service receives granularity: day', async () => {
    holder.billingService.getConsumeBreakdownByPeriods.mockResolvedValue(makeBreakdownByPeriods({ granularity: 'day' }));
    await runCommand(buildBreakdown, ['billing', 'breakdown', '--granularity', 'day', '--format', 'json']);
    const opts = holder.billingService.getConsumeBreakdownByPeriods.mock.calls[0][0];
    expect(opts.granularity).toBe('day');
  });

  it('time range exceeding 12 months (month granularity) → exit 1', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown());
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--from', '2024-01', '--to', '2025-06', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(1);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('time range exactly 12 months (month granularity) → passes through', async () => {
    holder.billingService.getConsumeBreakdownByPeriods.mockResolvedValue(makeBreakdownByPeriods());
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--from', '2025-06', '--to', '2026-06', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(holder.billingService.getConsumeBreakdownByPeriods).toHaveBeenCalled();
  });

  it('invalid date format --from 20250 (month granularity) → exit 4', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--from', '20250', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('invalid date format --from 2025-1 (month granularity) → exit 4', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--from', '2025-1', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('invalid date format --from 202506 (month granularity) → exit 4', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--from', '202506', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('invalid date format --from 2025-13 (month granularity) → exit 4', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--from', '2025-13', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('invalid date format --from 2025-1-01 (day granularity) → exit 4', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--granularity', 'day', '--from', '2025-1-01', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('day granularity: time range exceeding 31 days → exit 4', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--granularity', 'day', '--from', '2026-05-01', '--to', '2026-06-18', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('day granularity: time range within 31 days → passes through', async () => {
    holder.billingService.getConsumeBreakdownByPeriods.mockResolvedValue(makeBreakdownByPeriods({ granularity: 'day' }));
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--granularity', 'day', '--from', '2026-06-01', '--to', '2026-06-18', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(holder.billingService.getConsumeBreakdownByPeriods).toHaveBeenCalled();
  });

  it('--group-by api-key → service receives groupBy: api-key', async () => {
    holder.billingService.getConsumeBreakdown.mockResolvedValue(makeBreakdown({ groupBy: 'api-key' }));
    await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--group-by', 'api-key', '--format', 'json',
    ]);
    const opts = holder.billingService.getConsumeBreakdown.mock.calls[0][0];
    expect(opts.groupBy).toBe('api-key');
  });

  it('--group-by workspace (invalid) → exit INVALID_ARGUMENT', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--group-by', 'workspace', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('--group-by workflow-type (invalid) → exit INVALID_ARGUMENT', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--group-by', 'workflow-type', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  // -- Period-granularity interaction tests --

  it('--period week (< 31 days) without --granularity → auto day', async () => {
    holder.billingService.getConsumeBreakdownByPeriods.mockResolvedValue(makeBreakdownByPeriods({ granularity: 'day' }));
    await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--period', 'week', '--format', 'json',
    ]);
    expect(holder.billingService.getConsumeBreakdownByPeriods).toHaveBeenCalled();
    const opts = holder.billingService.getConsumeBreakdownByPeriods.mock.calls[0][0];
    expect(opts.granularity).toBe('day');
  });

  it('--period week + --granularity day → no conflict', async () => {
    holder.billingService.getConsumeBreakdownByPeriods.mockResolvedValue(makeBreakdownByPeriods({ granularity: 'day' }));
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--period', 'week', '--granularity', 'day', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(holder.billingService.getConsumeBreakdownByPeriods).toHaveBeenCalled();
    const opts = holder.billingService.getConsumeBreakdownByPeriods.mock.calls[0][0];
    expect(opts.granularity).toBe('day');
  });

  it('--period week + --granularity month → conflict error', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--period', 'week', '--granularity', 'month', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('Parameter conflict');
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('--period quarter (>= 31 days) without --granularity → stays month', async () => {
    holder.billingService.getConsumeBreakdownByPeriods.mockResolvedValue(makeBreakdownByPeriods());
    await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--period', 'quarter', '--format', 'json',
    ]);
    expect(holder.billingService.getConsumeBreakdownByPeriods).toHaveBeenCalled();
    const opts = holder.billingService.getConsumeBreakdownByPeriods.mock.calls[0][0];
    expect(opts.granularity).toBe('month');
  });

  it('--period quarter + --granularity day → conflict error', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--period', 'quarter', '--granularity', 'day', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('Parameter conflict');
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });

  it('--period today + --granularity month → conflict error', async () => {
    const r = await runCommand(buildBreakdown, [
      'billing', 'breakdown', '--period', 'today', '--granularity', 'month', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('Parameter conflict');
    expect(holder.billingService.getConsumeBreakdown).not.toHaveBeenCalled();
  });
});

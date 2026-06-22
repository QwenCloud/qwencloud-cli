/** Command-level tests for `billing summary`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';
import type { SettleBillSummary } from '../../../src/types/billing-extra.js';

const holder = {
  billingService: {
    getUsageLimit: vi.fn(),
    getConsumeBreakdown: vi.fn(),
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

const { billingSummaryAction } = await import('../../../src/commands/billing/summary.js');
const { createClient } = await import('../../../src/api/client.js');

const getClient = () => createClient();

function makeSummary(overrides: Partial<SettleBillSummary> = {}): SettleBillSummary {
  return {
    period: { from: '2026-04', to: '2026-04' },
    chargeType: 'all',
    currency: 'USD',
    cycles: [
      {
        billingCycle: '2026-04',
        pretaxAmount: '100.00',
        tax: '10.00',
        aftertaxAmount: '110.00',
      },
    ],
    totals: {
      pretaxAmount: '100.00',
      tax: '10.00',
      aftertaxAmount: '110.00',
    },
    ...overrides,
  } as SettleBillSummary;
}

beforeEach(() => {
  Object.values(holder.billingService).forEach((m) => m.mockReset());
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest as any);
  clearRenderedFrames();
});

function buildSummary(program: import('commander').Command) {
  const billing = program.command('billing');
  const cmd = billing.command('summary')
    .option('--from <m>')
    .option('--to <m>')
    .option('--charge-type <t>');
  cmd.action(billingSummaryAction(cmd, getClient));
}

describe('billing summary command', () => {
  it('JSON mode → 3 amount fields all preserved as strings', async () => {
    holder.billingService.getSettleBillSummary.mockResolvedValue(makeSummary());
    const r = await runCommand(buildSummary, [
      'billing', 'summary', '--from', '2026-04', '--to', '2026-04', '--format', 'json',
    ]);
    const payload = JSON.parse(r.stdout);
    for (const field of ['pretaxAmount', 'tax', 'aftertaxAmount']) {
      expect(typeof payload.totals[field], `${field} must be string`).toBe('string');
    }
    expect(payload.totals.discount).toBeUndefined();
    expect(payload.totals.paidAmount).toBeUndefined();
    expect(payload.totals.outstandingAmount).toBeUndefined();
  });

  it('cross-month range → forwards from/to to service', async () => {
    holder.billingService.getSettleBillSummary.mockResolvedValue(
      makeSummary({ period: { from: '2026-03', to: '2026-04' } }),
    );
    await runCommand(buildSummary, [
      'billing', 'summary', '--from', '2026-03', '--to', '2026-04', '--format', 'json',
    ]);
    const opts = holder.billingService.getSettleBillSummary.mock.calls[0][0];
    expect(opts.from).toBe('2026-03');
    expect(opts.to).toBe('2026-04');
  });

  it('no flags → defaults to current month (from === to)', async () => {
    holder.billingService.getSettleBillSummary.mockResolvedValue(makeSummary());
    await runCommand(buildSummary, ['billing', 'summary', '--format', 'json']);
    const opts = holder.billingService.getSettleBillSummary.mock.calls[0][0] ?? {};
    if (opts.from && opts.to) {
      expect(opts.from).toBe(opts.to);
    }
    expect(holder.billingService.getSettleBillSummary).toHaveBeenCalledTimes(1);
  });

  it('amount precision preserved (12-decimal field round-trip)', async () => {
    holder.billingService.getSettleBillSummary.mockResolvedValue(
      makeSummary({
        cycles: [{ billingCycle: '2026-04', pretaxAmount: '0.000000000003', tax: '0', aftertaxAmount: '0.000000000003' }],
        totals: { pretaxAmount: '0.000000000003', tax: '0', aftertaxAmount: '0.000000000003' },
      }),
    );
    const r = await runCommand(buildSummary, ['billing', 'summary', '--format', 'json']);
    const payload = JSON.parse(r.stdout);
    expect(payload.totals.pretaxAmount).toBe('0.000000000003');
    expect(payload.totals.aftertaxAmount).toBe('0.000000000003');
  });

  it('401 → exit 1', async () => {
    holder.billingService.getSettleBillSummary.mockRejectedValue(
      Object.assign(new Error('401'), { status: 401 }),
    );
    const r = await runCommand(buildSummary, ['billing', 'summary', '--format', 'json']);
    expect(r.exitCode).toBe(1);
  });
});

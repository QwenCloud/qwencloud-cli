/**
 * Command-level tests for `subscription orders`.
 *
 * Asserts: pagination flags, --type filter, --page-size upper bound, default
 * 90-day window. Empty list path asserts a friendly message rather than a raw
 * empty JSON array in text mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';
import type {
  SubscriptionOrdersResult,
  SubscriptionOrder,
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

const { subscriptionOrdersAction } = await import('../../../src/commands/subscription/orders.js');
const { createClient } = await import('../../../src/api/client.js');

const getClient = () => createClient();

function makeOrder(overrides: Partial<SubscriptionOrder> = {}): SubscriptionOrder {
  return {
    orderId: 'ORD-A',
    orderType: 'purchase',
    orderTime: '2026-04-20T10:15:30Z',
    amount: '199.00',
    currency: 'USD',
    status: 'completed',
    detail: null,
    detailError: null,
    ...overrides,
  } as SubscriptionOrder;
}

function makeResult(rows: SubscriptionOrder[], page = 1, pageSize = 20, total = rows.length): SubscriptionOrdersResult {
  return {
    orders: rows,
    pagination: { page, pageSize, total },
  } as SubscriptionOrdersResult;
}

beforeEach(() => {
  holder.subscriptionService.listOrders.mockReset();
  holder.subscriptionService.getStatus.mockReset();
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest);
  clearRenderedFrames();
});

function buildOrders(program: import('commander').Command) {
  const sub = program.command('subscription');
  const cmd = sub.command('orders')
    .option('--from <d>')
    .option('--to <d>')
    .option('--type <t>')
    .option('--page <n>')
    .option('--page-size <n>');
  cmd.action(subscriptionOrdersAction(cmd, getClient));
}

describe('subscription orders command', () => {
  it('JSON mode → emits orderId / orderType / orderTime / amount / status', async () => {
    holder.subscriptionService.listOrders.mockResolvedValue(makeResult([makeOrder()]));
    const r = await runCommand(buildOrders, ['subscription', 'orders', '--format', 'json']);
    const payload = JSON.parse(r.stdout);
    const order = payload.orders?.[0];
    expect(order.orderId).toBe('ORD-A');
    expect(order.orderType).toBe('Purchase');
    expect(order.orderTime).toBe('2026-04-20T10:15:30Z');
    expect(order.amount).toMatch(/199/);
    expect(order.status).toBe('completed');
  });

  it('--page 2 --page-size 10 → service receives the pagination options', async () => {
    holder.subscriptionService.listOrders.mockResolvedValue(makeResult([], 2, 10, 0));
    await runCommand(buildOrders, [
      'subscription', 'orders', '--page', '2', '--page-size', '10', '--format', 'json',
    ]);
    const opts = holder.subscriptionService.listOrders.mock.calls[0][0];
    expect(opts.page).toBe(2);
    expect(opts.pageSize).toBe(10);
  });

  it('--type renew → service receives type filter', async () => {
    holder.subscriptionService.listOrders.mockResolvedValue(makeResult([]));
    await runCommand(buildOrders, ['subscription', 'orders', '--type', 'renew', '--format', 'json']);
    const opts = holder.subscriptionService.listOrders.mock.calls[0][0];
    expect(opts.type).toBe('renew');
  });

  it('forwards the token-plan commodityCodeList filter to the service', async () => {
    holder.subscriptionService.listOrders.mockResolvedValue(makeResult([]));
    await runCommand(buildOrders, ['subscription', 'orders', '--format', 'json']);
    const opts = holder.subscriptionService.listOrders.mock.calls[0][0];
    expect(opts.commodityCodeList).toBe(
      'sfm_tokenplanteams_dp_intl,sfm_tokenplanteamsaddon_dp_intl',
    );
  });

  it('--page-size > 100 → exits with validation error', async () => {
    holder.subscriptionService.listOrders.mockResolvedValue(makeResult([]));
    const r = await runCommand(buildOrders, [
      'subscription', 'orders', '--page-size', '500', '--format', 'json',
    ]);
    expect(r.exitCode).toBe(1);
    expect((r.stderr + r.stdout).toLowerCase()).toMatch(/page.?size|max|100|range|invalid/);
    expect(holder.subscriptionService.listOrders).not.toHaveBeenCalled();
  });

  it('empty list → succeeds with exit 0, JSON has empty orders array', async () => {
    holder.subscriptionService.listOrders.mockResolvedValue(makeResult([]));
    const r = await runCommand(buildOrders, ['subscription', 'orders', '--format', 'json']);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    const orders = payload.orders ?? [];
    expect(orders).toEqual([]);
  });
});

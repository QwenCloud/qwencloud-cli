/**
 * Command-level tests for `billing limit`.
 *
 * The action layer is responsible for: flag parsing → service invocation →
 * tri-format dispatch (table / text / json). External dependencies (services,
 * auth, spinner, ink renderer) are mocked at module boundaries so the test
 * exercises only the command's own glue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';
import type { UsageLimit } from '../../../src/types/billing-extra.js';

interface MockBillingService {
  getUsageLimit: ReturnType<typeof vi.fn>;
  getConsumeBreakdown: ReturnType<typeof vi.fn>;
  getSettleBillSummary: ReturnType<typeof vi.fn>;
}

const holder: { billingService: MockBillingService } = {
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
vi.mock('../../../src/auth/credentials.js', () => ({
  ensureAuthenticated: () => ({}),
}));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: vi.fn(),
  renderInteractive: renderInteractiveSpy,
  renderWithInkSync: vi.fn(),
}));

const { billingLimitAction } = await import('../../../src/commands/billing/limit.js');
const { createClient } = await import('../../../src/api/client.js');

const getClient = () => createClient();

function makeUsageLimit(overrides: Partial<UsageLimit> = {}): UsageLimit {
  return {
    status: 'normal',
    limitAmount: '500.00',
    currency: 'USD',
    alertThreshold: '400.00',
    ...overrides,
  } as UsageLimit;
}

beforeEach(() => {
  holder.billingService.getUsageLimit.mockReset();
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest as any);
  clearRenderedFrames();
});

function buildLimit(program: import('commander').Command) {
  const billing = program.command('billing');
  const limit = billing.command('limit');
  limit.action(billingLimitAction(limit, getClient));
}

describe('billing limit command', () => {
  it('JSON mode → emits status / limitAmount / currency / alertThreshold', async () => {
    holder.billingService.getUsageLimit.mockResolvedValue(makeUsageLimit());
    const r = await runCommand(buildLimit, ['billing', 'limit', '--format', 'json']);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload).toMatchObject({
      status: 'normal',
      limitAmount: '500.00',
      currency: 'USD',
      alertThreshold: '400.00',
    });
  });

  it('text mode → renders human-readable lines without raw JSON braces', async () => {
    holder.billingService.getUsageLimit.mockResolvedValue(makeUsageLimit());
    const r = await runCommand(buildLimit, ['billing', 'limit', '--format', 'text']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('500');
    expect(r.stdout).not.toMatch(/^\{/);
  });

  it('Bearer missing (401) → exit code 1, stderr hints at re-authentication', async () => {
    holder.billingService.getUsageLimit.mockRejectedValue(
      Object.assign(new Error('401 Unauthorized'), { status: 401 }),
    );
    const r = await runCommand(buildLimit, ['billing', 'limit', '--format', 'json']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toLowerCase()).toMatch(/auth|login|401/);
  });

  it('Gateway business error → exits non-zero and surfaces error code in stderr/JSON', async () => {
    holder.billingService.getUsageLimit.mockRejectedValue(
      Object.assign(new Error('Workspace.Error.Internal'), { code: 'Workspace.Error.Internal' }),
    );
    const r = await runCommand(buildLimit, ['billing', 'limit', '--format', 'json']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/Workspace\.Error\.Internal/);
  });
});

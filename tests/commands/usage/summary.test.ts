import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';
import { renderInkForTest, clearRenderedFrames, lastRenderedFrame } from '../../helpers/ink-render-mock.js';

const holder: { client: ApiClient } = { client: makeMockApiClient() };

// hoisted: shared spy for renderWithInk so we can swap impl per-test
const { renderWithInkSpy } = vi.hoisted(() => ({
  renderWithInkSpy: vi.fn<(el: any) => Promise<void>>(),
}));

vi.mock('../../../src/api/client.js', () => ({
  createClient: async () => holder.client,
}));
vi.mock('../../../src/auth/credentials.js', () => ({
  ensureAuthenticated: () => ({}),
}));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: renderWithInkSpy,
  renderInteractive: vi.fn(),
  renderWithInkSync: renderWithInkSpy,
}));

const { usageSummaryAction } = await import('../../../src/commands/usage/summary.js');

const getClient = async () => holder.client as any;

beforeEach(() => {
  holder.client = makeMockApiClient();
  renderWithInkSpy.mockReset();
  renderWithInkSpy.mockImplementation(renderInkForTest);
  clearRenderedFrames();
});

function buildSummary(program: import('commander').Command) {
  const usage = program.command('usage');
  const summary = usage
    .command('summary')
    .option('--from <date>')
    .option('--to <date>')
    .option('--period <p>');
  summary.action(usageSummaryAction(summary, getClient));
}

describe('usage summary command (one-shot)', () => {
  describe('JSON mode', () => {
    it('empty data → returns full payload structure with empty arrays, exit 0', async () => {
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'json']);
      expect(r.exitCode).toBeUndefined();
      expect(r.stderr).toBe('');
      const payload = JSON.parse(r.stdout);
      expect(payload).toHaveProperty('period');
      expect(payload).toHaveProperty('free_tier');
      expect(payload).toHaveProperty('coding_plan');
      expect(payload).toHaveProperty('pay_as_you_go');
    });

    it('with free-tier + payg data → renders both, exit 0', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [
            { model_id: 'qwen3-max', quota: { remaining: 500_000, total: 1_000_000, unit: 'tokens', used_pct: 50 } } as any,
          ],
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: {
            models: [
              {
                model_id: 'qwen3-max',
                usage: { tokens: 60_000 },
                cost: 0.42,
                currency: 'USD',
              },
            ],
            total: { cost: 0.42, currency: 'USD' },
          },
        }),
      });

      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'json']);
      expect(r.exitCode).toBeUndefined();
      const payload = JSON.parse(r.stdout);
      expect(payload.free_tier).toHaveLength(1);
      expect(payload.pay_as_you_go.models).toHaveLength(1);
    });
  });

  describe('text mode', () => {
    it('empty data → renders period header (no crash), exit 0', async () => {
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'text']);
      expect(r.exitCode).toBeUndefined();
      expect(r.stderr).toBe('');
    });

    it('with data → renders period and table-like output to stdout, exit 0', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [
            { model_id: 'qwen3-max', quota: { remaining: 500_000, total: 1_000_000, unit: 'tokens', used_pct: 50 } } as any,
          ],
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'text']);
      expect(r.exitCode).toBeUndefined();
      expect(r.stdout).toContain('qwen3-max');
    });
  });

  describe('date range', () => {
    it('--from/--to passed through to API client', async () => {
      let captured: { from?: string; to?: string } = {};
      holder.client = makeMockApiClient({
        getUsageSummary: async (opts) => {
          captured = { from: opts?.from, to: opts?.to };
          return {
            period: { from: opts?.from ?? '', to: opts?.to ?? '' },
            free_tier: [],
            coding_plan: { subscribed: false },
            token_plan: { subscribed: false },
            pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
          };
        },
      });
      const r = await runCommand(buildSummary, [
        'usage', 'summary', '--from', '2026-03-01', '--to', '2026-03-31', '--format', 'json',
      ]);
      expect(r.exitCode).toBeUndefined();
      expect(captured.from).toBe('2026-03-01');
      expect(captured.to).toBe('2026-03-31');
    });
  });

  // ── extended branches: text rendering and section variants ─────────
  describe('text mode rendering', () => {
    it('coding_plan section renders when subscribed', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [],
          coding_plan: {
            subscribed: true,
            plan: 'pro',
            price: { amount: 50, currency: 'USD', cycle: 'monthly' },
            included_models: ['qwen3.5-plus', 'qwen3-max'],
            windows: {
              per_5h: { remaining: 800, total: 1000, used_pct: 20, next_reset_at: '2026-04-21T00:00:00Z' },
              weekly: { remaining: 4000, total: 5000, used_pct: 20, next_reset_at: '2026-04-27T00:00:00Z' },
              monthly: { remaining: 80000, total: 100000, used_pct: 20, next_reset_at: '2026-05-01T00:00:00Z' },
            },
          } as any,
          token_plan: { subscribed: false },
          pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'text']);
      expect(r.exitCode).toBeUndefined();
      // Coding Plan title appears in text rendering
      expect(r.stdout).toMatch(/Coding Plan|pro/i);
    });

    it('payg-only data → renders Pay-as-you-go section', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [],
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: {
            models: [
              {
                model_id: 'qwen3-max',
                usage: { tokens: 12_000 },
                cost: 0.12,
                currency: 'USD',
              },
            ],
            total: { cost: 0.12, currency: 'USD' },
          },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'text']);
      expect(r.exitCode).toBeUndefined();
      expect(r.stdout).toContain('qwen3-max');
    });

    it('all-three sections together → all model ids appear', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [
            { model_id: 'qwen-free', quota: { remaining: 800_000, total: 1_000_000, unit: 'tokens', used_pct: 20, resetDate: null } },
          ],
          coding_plan: {
            subscribed: true,
            plan: 'starter',
            price: { amount: 20, currency: 'USD', cycle: 'monthly' },
            included_models: ['qwen3-coder'],
            windows: {
              per_5h: { remaining: 200, total: 1000, used_pct: 80, next_reset_at: '2026-04-21T00:00:00Z' },
              weekly: { remaining: 1000, total: 5000, used_pct: 80, next_reset_at: '2026-04-27T00:00:00Z' },
              monthly: { remaining: 5000, total: 50000, used_pct: 90, next_reset_at: '2026-05-01T00:00:00Z' },
            },
          } as any,
          token_plan: { subscribed: false },
          pay_as_you_go: {
            models: [{ model_id: 'qwen-payg', usage: { tokens: 150 }, cost: 0.01, currency: 'USD' }],
            total: { cost: 0.01, currency: 'USD' },
          },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'text']);
      expect(r.exitCode).toBeUndefined();
      expect(r.stdout).toContain('qwen-free');
      expect(r.stdout).toContain('qwen-payg');
    });
  });

  describe('error path', () => {
    it('API client throws → exit 1, error to stderr', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => {
          throw new Error('boom');
        },
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'json']);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('boom');
    });
  });

  // ── Ink rendering branches (table/TTY mode) ──────────────────────
  // These tests exercise the local Ink components inside summary.tsx
  // (UsageSummaryInk / FreeTierSection / CodingPlanSection / PayAsYouGoSection)
  // by replacing renderWithInk with a real ink-testing-library render.
  describe('Ink rendering (table mode)', () => {
    it('renders all three sections (free_tier + payg + coding_plan)', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [
            { model_id: 'qwen3-max', quota: { remaining: 500_000, total: 1_000_000, unit: 'tokens', used_pct: 50 } } as any,
          ],
          coding_plan: {
            subscribed: true,
            plan: 'pro',
            price: { amount: 50, currency: 'USD', cycle: 'monthly' },
            included_models: ['qwen3.5-plus'],
            windows: {
              per_5h: { remaining: 800, total: 1000, used_pct: 20, next_reset_at: '2026-04-21T00:00:00Z' },
              weekly: { remaining: 4000, total: 5000, used_pct: 20, next_reset_at: '2026-04-27T00:00:00Z' },
              monthly: { remaining: 80000, total: 100000, used_pct: 20, next_reset_at: '2026-05-01T00:00:00Z' },
            },
          } as any,
          token_plan: { subscribed: false },
          pay_as_you_go: {
            models: [
              { model_id: 'qwen3-payg', usage: { tokens: 150 }, cost: 0.01, currency: 'USD' },
            ],
            total: { cost: 0.01, currency: 'USD' },
          },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
      const el = renderWithInkSpy.mock.calls[0][0];
      // Element wraps a vm prop with all three sections present
      expect(el.props.vm.freeTier).toBeTruthy();
      expect(el.props.vm.payAsYouGo).toBeTruthy();
      expect(el.props.vm.codingPlan).toBeTruthy();
      // Verify rendered output contains key business data
      const frame = lastRenderedFrame();
      expect(frame).toBeDefined();
      expect(frame).toContain('qwen3-max');
      expect(frame).toContain('qwen3-payg');
    });

    it('renders FreeTierSection with isFreeOnly row (mode=only / quota null)', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [
            { model_id: 'qwen-free-only', quota: null } as any,
          ],
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
      // Verify rendered output includes the free-only model
      const frame = lastRenderedFrame();
      expect(frame).toBeDefined();
      expect(frame).toContain('qwen-free-only');
    });

    it('renders FreeTierSection with hidden-count footer when >10 rows', async () => {
      const manyRows = Array.from({ length: 12 }, (_, i) => ({
        model_id: `qwen-free-${i}`,
        quota: { remaining: 500, total: 1000, unit: 'tokens', used_pct: 50 },
      })) as any[];
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: manyRows,
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
      const el = renderWithInkSpy.mock.calls[0][0];
      expect(el.props.vm.freeTier.totalCount).toBe(12);
    });

    it('renders CodingPlanSection with empty includedModels', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [],
          coding_plan: {
            subscribed: true,
            plan: 'starter',
            price: { amount: 20, currency: 'USD', cycle: 'monthly' },
            included_models: [],
            windows: {
              per_5h: { remaining: 200, total: 1000, used_pct: 80, next_reset_at: '2026-04-21T00:00:00Z' },
              weekly: { remaining: 1000, total: 5000, used_pct: 80, next_reset_at: '2026-04-27T00:00:00Z' },
              monthly: { remaining: 5000, total: 50000, used_pct: 90, next_reset_at: '2026-05-01T00:00:00Z' },
            },
          } as any,
          token_plan: { subscribed: false },
          pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
      // Verify rendered output includes Coding Plan section data
      const frame = lastRenderedFrame();
      expect(frame).toBeDefined();
      expect(frame).toMatch(/Coding Plan|starter/i);
    });

    it('renders PayAsYouGoSection isEmpty branch (subscribed=true gives codingPlan, payg empty)', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [],
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: {
            models: [],
            total: { cost: 0, currency: 'USD' },
          },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      // No sections triggered Ink (vm has no freeTier/payAsYouGo/codingPlan)
      // but renderWithInk is still called with the bare UsageSummaryInk wrapper
      expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
      // Verify rendered frame exists (empty state renders period header)
      const frame = lastRenderedFrame();
      expect(frame).toBeDefined();
      expect(frame).toContain('2026-04-01');
    });

    it('renders PayAsYouGoSection with hidden-count footer when >10 rows', async () => {
      const manyPayg = Array.from({ length: 12 }, (_, i) => ({
        model_id: `qwen-payg-${i}`,
        usage: { tokens: 150 },
        cost: 0.01,
        currency: 'USD',
      }));
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [],
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: {
            models: manyPayg,
            total: { cost: 0.12, currency: 'USD' },
          },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
      const el = renderWithInkSpy.mock.calls[0][0];
      expect(el.props.vm.payAsYouGo.totalCount).toBe(12);
    });

    it('renders only FreeTierSection (no payg, no coding) — single section path', async () => {
      holder.client = makeMockApiClient({
        getUsageSummary: async () => ({
          period: { from: '2026-04-01', to: '2026-04-20' },
          free_tier: [
            { model_id: 'qwen-only-ft', quota: { remaining: 100, total: 1000, unit: 'tokens', used_pct: 90 } } as any,
          ],
          coding_plan: { subscribed: false },
          token_plan: { subscribed: false },
          pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
        }),
      });
      const r = await runCommand(buildSummary, ['usage', 'summary', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
      // Verify rendered output includes the free-tier model
      const frame = lastRenderedFrame();
      expect(frame).toBeDefined();
      expect(frame).toContain('qwen-only-ft');
    });
  });
});

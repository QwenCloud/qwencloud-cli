/**
 * Unit tests for the `workspace limit` command (one-shot mode).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';
import type { WorkspaceLimitResult } from '../../../src/types/workspace.js';

const holder: { client: ApiClient } = { client: makeMockApiClient() };
const authHolder: { ensureAuthenticated: () => unknown } = {
  ensureAuthenticated: () => ({}),
};

vi.mock('../../../src/api/client.js', () => ({
  createClient: async () => holder.client,
}));
vi.mock('../../../src/auth/credentials.js', () => ({
  ensureAuthenticated: () => authHolder.ensureAuthenticated(),
}));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));
const mockRenderWithInk = vi.fn();
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: mockRenderWithInk,
  renderInteractive: vi.fn(),
  renderWithInkSync: vi.fn(),
}));

const { workspaceLimitAction } = await import('../../../src/commands/workspace/limit.js');

const getClient = async () => holder.client as any;

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
  mockRenderWithInk.mockReset();
});

function buildWorkspaceLimit(program: import('commander').Command) {
  const ws = program.command('workspace');
  const limit = ws.command('limit');
  limit.action(workspaceLimitAction(limit, getClient));
}

describe('workspace limit (JSON mode)', () => {
  it('renders { current, max } on success', async () => {
    const SAMPLE: WorkspaceLimitResult = { current: 3, max: 10 };
    holder.client = makeMockApiClient({
      getWorkspaceLimit: async () => SAMPLE,
    });

    const r = await runCommand(buildWorkspaceLimit, ['workspace', 'limit', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toBe('');
    const payload = JSON.parse(r.stdout) as WorkspaceLimitResult;
    expect(payload.current).toBe(3);
    expect(payload.max).toBe(10);
  });

  it('renders { current: 0, max: 0 } when account has no quota', async () => {
    holder.client = makeMockApiClient({
      getWorkspaceLimit: async () => ({ current: 0, max: 0 }),
    });

    const r = await runCommand(buildWorkspaceLimit, ['workspace', 'limit', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout) as WorkspaceLimitResult;
    expect(payload.current).toBe(0);
    expect(payload.max).toBe(0);
  });
});

describe('workspace limit — error routing', () => {
  it('business error → exit 1, JSON includes type=business', async () => {
    holder.client = makeMockApiClient({
      getWorkspaceLimit: async () => {
        throw Object.assign(new Error('Workspace internal error'), {
          name: 'GatewayBusinessError',
          code: 'Workspace.Error.Internal',
        });
      },
    });

    const r = await runCommand(buildWorkspaceLimit, ['workspace', 'limit', '--format', 'json']);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as {
      error: { type: string; code: string };
    };
    expect(payload.error.type).toBe('business');
    expect(payload.error.code).toBe('Workspace.Error.Internal');
  });

  it('gateway error → exit 1, JSON includes type=gateway', async () => {
    holder.client = makeMockApiClient({
      getWorkspaceLimit: async () => {
        throw Object.assign(new Error('upstream 502'), { name: 'GatewayEnvelopeError' });
      },
    });

    const r = await runCommand(buildWorkspaceLimit, ['workspace', 'limit', '--format', 'json']);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { type: string } };
    expect(payload.error.type).toBe('gateway');
  });
});

describe('workspace limit — table format rendering', () => {
  it('calls renderWithInk with correct data when format=table', async () => {
    holder.client = makeMockApiClient({
      getWorkspaceLimit: async () => ({ current: 3, max: 10 }),
    });

    await runCommand(buildWorkspaceLimit, ['workspace', 'limit', '--format', 'table']);

    expect(mockRenderWithInk).toHaveBeenCalledTimes(1);
    const element = mockRenderWithInk.mock.calls[0][0] as { props: { vm: { current: number; max: number; remaining: number; utilizationPct: number } } };
    expect(element.props.vm.current).toBe(3);
    expect(element.props.vm.max).toBe(10);
    expect(element.props.vm.remaining).toBe(7);
    expect(element.props.vm.utilizationPct).toBe(30);
  });
});

describe('workspace limit — auth failure', () => {
  it('exits 2 when ensureAuthenticated throws', async () => {
    authHolder.ensureAuthenticated = () => {
      throw Object.assign(new Error('not authenticated'), {
        name: 'AuthenticationRequiredError',
      });
    };

    const r = await runCommand(buildWorkspaceLimit, ['workspace', 'limit', '--format', 'json']);

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not authenticated');
  });
});

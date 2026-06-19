/**
 * Unit tests for the `workspace list` command (one-shot mode).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';
import type { WorkspaceListResult } from '../../../src/types/workspace.js';

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

const { workspaceListAction } = await import('../../../src/commands/workspace/list.js');

const getClient = async () => holder.client as any;

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
  mockRenderWithInk.mockReset();
});

function buildWorkspaceList(program: import('commander').Command) {
  const ws = program.command('workspace');
  const list = ws.command('list');
  list.action(workspaceListAction(list, getClient));
}

const SAMPLE: WorkspaceListResult = {
  total: 2,
  limit: 10,
  items: [
    {
      id: 'ws-001',
      name: 'default',
      region: 'cn-beijing',
      endpoint: 'https://default.test.qwencloud.com',
      createdAt: '2026-01-01T00:00:00Z',
      isDefault: true,
    },
    {
      id: 'ws-002',
      name: 'staging',
      region: 'cn-hangzhou',
      endpoint: 'https://staging.test.qwencloud.com',
      createdAt: '2026-02-01T00:00:00Z',
      isDefault: false,
    },
  ],
};

describe('workspace list (JSON mode)', () => {
  it('renders the full WorkspaceListResult shape on success', async () => {
    holder.client = makeMockApiClient({
      listWorkspaces: async () => SAMPLE,
    });

    const r = await runCommand(buildWorkspaceList, ['workspace', 'list', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toBe('');
    const payload = JSON.parse(r.stdout) as WorkspaceListResult;
    expect(payload.total).toBe(2);
    expect(payload.limit).toBe(10);
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].isDefault).toBe(true);
  });

  it('renders an empty list when the account has no workspaces', async () => {
    holder.client = makeMockApiClient({
      listWorkspaces: async () => ({ total: 0, limit: 10, items: [] }),
    });

    const r = await runCommand(buildWorkspaceList, ['workspace', 'list', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout) as WorkspaceListResult;
    expect(payload.total).toBe(0);
    expect(payload.items).toEqual([]);
  });
});

describe('workspace list — error routing', () => {
  it('business error Workspace.Error.Internal → exit 1, JSON includes hint', async () => {
    holder.client = makeMockApiClient({
      listWorkspaces: async () => {
        throw Object.assign(new Error('Workspace internal error'), {
          name: 'GatewayBusinessError',
          code: 'Workspace.Error.Internal',
        });
      },
    });

    const r = await runCommand(buildWorkspaceList, ['workspace', 'list', '--format', 'json']);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as {
      error: { type: string; code: string; hint?: string };
    };
    expect(payload.error.type).toBe('business');
    expect(payload.error.code).toBe('Workspace.Error.Internal');
  });

  it('gateway error → exit 1', async () => {
    holder.client = makeMockApiClient({
      listWorkspaces: async () => {
        throw Object.assign(new Error('upstream 502'), { name: 'GatewayEnvelopeError' });
      },
    });

    const r = await runCommand(buildWorkspaceList, ['workspace', 'list', '--format', 'json']);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { type: string } };
    expect(payload.error.type).toBe('gateway');
  });
});

describe('workspace list — table format rendering', () => {
  it('calls renderWithInk with correct data when format=table', async () => {
    holder.client = makeMockApiClient({
      listWorkspaces: async () => SAMPLE,
    });

    await runCommand(buildWorkspaceList, ['workspace', 'list', '--format', 'table']);

    expect(mockRenderWithInk).toHaveBeenCalledTimes(1);
    const element = mockRenderWithInk.mock.calls[0][0] as { props: { vm: { rows: Array<{ id: string; name: string; isDefault: boolean }>; total: number; limit: number } } };
    expect(element.props.vm.rows).toHaveLength(2);
    expect(element.props.vm.rows[0].id).toBe('ws-001');
    expect(element.props.vm.rows[0].name).toBe('default');
    expect(element.props.vm.rows[0].isDefault).toBe(true);
    expect(element.props.vm.rows[1].id).toBe('ws-002');
    expect(element.props.vm.total).toBe(2);
    expect(element.props.vm.limit).toBe(10);
  });

  it('does not call renderWithInk when result is empty', async () => {
    holder.client = makeMockApiClient({
      listWorkspaces: async () => ({ total: 0, limit: 10, items: [] }),
    });

    await runCommand(buildWorkspaceList, ['workspace', 'list', '--format', 'table']);

    expect(mockRenderWithInk).not.toHaveBeenCalled();
  });
});

describe('workspace list — auth failure', () => {
  it('exits 2 when ensureAuthenticated throws', async () => {
    authHolder.ensureAuthenticated = () => {
      throw Object.assign(new Error('not authenticated'), {
        name: 'AuthenticationRequiredError',
      });
    };

    const r = await runCommand(buildWorkspaceList, ['workspace', 'list', '--format', 'json']);

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not authenticated');
  });
});

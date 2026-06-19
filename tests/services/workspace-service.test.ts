/**
 * Unit tests for WorkspaceService.
 *
 * Covers:
 *   - list(): success / empty / business error (Workspace.Error.Internal).
 *   - limit(): success / business error.
 *   - Gateway error transparency for both methods.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import type {
  WorkspaceListResult,
  WorkspaceLimitResult,
} from '../../src/types/workspace.js';
import { WorkspaceService } from '../../src/services/workspace-service.js';

interface MockApiClient {
  callEnvelopeApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callEnvelopeApi: vi.fn() };
}

const RAW_WORKSPACE_LIST = {
  total: 2,
  limit: 10,
  items: [
    {
      id: 'ws-001',
      name: 'default',
      region: 'cn-beijing',
      createdAt: '2026-01-01T00:00:00Z',
      isDefault: true,
    },
    {
      id: 'ws-002',
      name: 'staging',
      region: 'cn-hangzhou',
      createdAt: '2026-02-01T00:00:00Z',
      isDefault: false,
    },
  ],
};

describe('WorkspaceService.list', () => {
  let apiClient: MockApiClient;
  let service: WorkspaceService;

  const LIMIT_API = 'zeldaEasy.bailian-dash-workspace.space.getWorkspaceLimitNumber';
  const LIST_API = 'zeldaEasy.bailian-dash-workspace.space.listWorkspaces4Agent';

  /**
   * list() now fans out to both LIST_API and LIMIT_API in parallel so the
   * `limit` field carries the real per-account quota; route mock responses
   * by the envelope `api` argument.
   */
  function routeMock(routes: { limit?: unknown; list?: unknown }): void {
    apiClient.callEnvelopeApi.mockImplementation(async (req: { api: string }) => {
      if (req.api === LIMIT_API) return routes.limit;
      if (req.api === LIST_API) return routes.list;
      throw new Error(`Unexpected api: ${req.api}`);
    });
  }

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new WorkspaceService(apiClient as unknown as ApiClient);
  });

  it('normalizes a successful response into WorkspaceListResult shape', async () => {
    routeMock({ limit: { max: 10 }, list: RAW_WORKSPACE_LIST });

    const result: WorkspaceListResult = await service.list();

    expect(result.total).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: 'ws-001',
      name: 'default',
      isDefault: true,
    });
    expect(result.items[1].region).toBe('cn-hangzhou');
  });

  it('returns an empty items array when the account has no workspaces', async () => {
    routeMock({ limit: { max: 10 }, list: { total: 0, items: [] } });

    const result = await service.list();

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('targets the listWorkspaces4Agent envelope action', async () => {
    routeMock({ limit: { max: 10 }, list: { total: 0, items: [] } });

    await service.list();

    const calledApis = apiClient.callEnvelopeApi.mock.calls.map(
      (c) => (c[0] as { api?: string }).api,
    );
    expect(calledApis).toContain(LIST_API);
    expect(calledApis).toContain(LIMIT_API);
  });

  it('surfaces business error Workspace.Error.Internal with explanatory hint', async () => {
    const businessErr = Object.assign(new Error('Workspace internal error'), {
      name: 'GatewayBusinessError',
      code: 'Workspace.Error.Internal',
    });
    apiClient.callEnvelopeApi.mockRejectedValue(businessErr);

    let caught: unknown;
    try {
      await service.list();
    } catch (e) {
      caught = e;
    }
    const err = caught as { code?: string; message?: string };
    expect(err.code).toBe('Workspace.Error.Internal');
    expect(typeof err.message).toBe('string');
  });

  it('propagates gateway errors transparently', async () => {
    const gatewayErr = Object.assign(new Error('connection reset'), {
      name: 'GatewayEnvelopeError',
    });
    apiClient.callEnvelopeApi.mockRejectedValue(gatewayErr);

    await expect(service.list()).rejects.toThrow('connection reset');
  });
});

describe('WorkspaceService.limit', () => {
  let apiClient: MockApiClient;
  let service: WorkspaceService;

  const LIMIT_API = 'zeldaEasy.bailian-dash-workspace.space.getWorkspaceLimitNumber';
  const LIST_API = 'zeldaEasy.bailian-dash-workspace.space.listWorkspaces4Agent';

  /**
   * Route mock responses by the envelope `api` argument so a single
   * apiClient instance can serve both the quota endpoint and the list
   * endpoint that limit() now fans out to in parallel.
   */
  function routeMock(routes: { limit?: unknown; list?: unknown }): void {
    apiClient.callEnvelopeApi.mockImplementation(async (req: { api: string }) => {
      if (req.api === LIMIT_API) return routes.limit;
      if (req.api === LIST_API) return routes.list;
      throw new Error(`Unexpected api: ${req.api}`);
    });
  }

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new WorkspaceService(apiClient as unknown as ApiClient);
  });

  it('derives current from the list API total when the quota endpoint omits current', async () => {
    routeMock({
      limit: { max: 10 },
      list: { totalCount: 3, items: [] },
    });

    const result: WorkspaceLimitResult = await service.limit();

    expect(result).toEqual({ current: 3, max: 10 });
  });

  it('derives current from the list API total when the quota endpoint returns a bare number', async () => {
    routeMock({
      limit: 10,
      list: { totalCount: 5, items: [] },
    });

    const result: WorkspaceLimitResult = await service.limit();

    expect(result).toEqual({ current: 5, max: 10 });
  });

  it('prefers the quota endpoint current field when present (forward compat)', async () => {
    routeMock({
      limit: { current: 7, max: 10 },
      list: { totalCount: 3, items: [] },
    });

    const result: WorkspaceLimitResult = await service.limit();

    expect(result).toEqual({ current: 7, max: 10 });
  });

  it('falls back to result field for max when neither max nor current is exposed', async () => {
    routeMock({
      limit: { result: 8 },
      list: { totalCount: 2, items: [] },
    });

    const result: WorkspaceLimitResult = await service.limit();

    expect(result).toEqual({ current: 2, max: 8 });
  });

  it('targets both the quota and list envelope actions', async () => {
    routeMock({
      limit: { max: 10 },
      list: { totalCount: 0, items: [] },
    });

    await service.limit();

    const calledApis = apiClient.callEnvelopeApi.mock.calls.map(
      (c) => (c[0] as { api?: string }).api,
    );
    expect(calledApis).toContain(LIMIT_API);
    expect(calledApis).toContain(LIST_API);
  });

  it('propagates business errors with their code intact', async () => {
    const businessErr = Object.assign(new Error('limit not configured'), {
      name: 'GatewayBusinessError',
      code: 'Workspace.Limit.NotConfigured',
    });
    apiClient.callEnvelopeApi.mockRejectedValue(businessErr);

    let caught: unknown;
    try {
      await service.limit();
    } catch (e) {
      caught = e;
    }
    const err = caught as { code?: string };
    expect(err.code).toBe('Workspace.Limit.NotConfigured');
  });
});

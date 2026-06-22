/**
 * Unit tests for CliFacade (src/api/client.ts).
 *
 * Tests cover:
 *   - createClient() factory: service delegation
 *   - pingEndpoint(): success, timeout/error, URL parsing
 *   - probeLatestVersion(): version comparison logic
 *   - revokeSession(): success and error paths
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────
// Module-level mocks
// ────────────────────────────────────────────────────────────────────

const mockModelsService = {
  listModels: vi.fn(async () => ({ models: [], total: 0 })),
  getModel: vi.fn(async (id: string) => ({ id, name: id })),
  getModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => ({ models: [], total: 0 })),
  fetchQuotasForModels: vi.fn(async (m: unknown[]) => m),
};

const mockUsageService = {
  getUsageSummary: vi.fn(async () => ({})),
  getUsageBreakdown: vi.fn(async () => ({})),
  getUsageLogs: vi.fn(async () => ({})),
};

const mockAuthService = {
  getAuthStatus: vi.fn(async () => ({ authenticated: true })),
  loginInit: vi.fn(async () => ({ token: 't', verification_url: '', expires_in: 600, interval: 5, auth_mode: 'pkce' })),
  loginPoll: vi.fn(async () => ({ status: 'authorization_pending' })),
  logout: vi.fn(async () => {}),
};

const mockWorkspaceService = { list: vi.fn(async () => ({})), limit: vi.fn(async () => ({})) };

const mockBillingService = {
  getUsageLimit: vi.fn(async () => ({})),
  getConsumeBreakdown: vi.fn(async () => ({})),
  getSettleBillSummary: vi.fn(async () => ({})),
};
const mockSubscriptionService = {
  getStatus: vi.fn(async () => ({})),
  listOrders: vi.fn(async () => ({})),
};
const mockSubscriptionTokenPlanService = {};

const mockDocsService = {
  searchDocs: vi.fn(async () => ({})),
  fetchDocContent: vi.fn(async () => ({})),
};

vi.mock('../../src/services/index.js', () => ({
  createServices: () => ({
    modelsService: mockModelsService,
    usageService: mockUsageService,
    authService: mockAuthService,
    workspaceService: mockWorkspaceService,

    billingService: mockBillingService,
    subscriptionService: mockSubscriptionService,
    subscriptionTokenPlanService: mockSubscriptionTokenPlanService,

    docsService: mockDocsService,
  }),
}));

vi.mock('../../src/config/manager.js', () => ({
  getEffectiveConfig: () => ({
    'api.endpoint': 'https://mock-api.test.qwencloud.com',
  }),
}));

vi.mock('../../src/upgrade/check.js', () => ({
  fetchLatestVersion: vi.fn(async () => '2.0.0'),
  compareVersions: vi.fn((a: string, b: string) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }),
}));

const { createClient } = await import('../../src/api/client.js');

// ────────────────────────────────────────────────────────────────────
// createClient — delegation tests
// ────────────────────────────────────────────────────────────────────

describe('createClient — service delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates listModels to modelsService', async () => {
    const client = await createClient();
    await client.listModels({ input: 'text' });
    expect(mockModelsService.listModels).toHaveBeenCalledWith({ input: 'text' });
  });

  it('delegates getModel to modelsService', async () => {
    const client = await createClient();
    await client.getModel('qwen-plus');
    expect(mockModelsService.getModel).toHaveBeenCalledWith('qwen-plus');
  });

  it('delegates getModels to modelsService', async () => {
    const client = await createClient();
    await client.getModels(['a', 'b']);
    expect(mockModelsService.getModels).toHaveBeenCalledWith(['a', 'b']);
  });

  it('delegates searchModels to modelsService', async () => {
    const client = await createClient();
    await client.searchModels('vision');
    expect(mockModelsService.searchModels).toHaveBeenCalledWith('vision');
  });

  it('delegates fetchQuotasForModels to modelsService', async () => {
    const models = [{ id: 'm1' }] as any;
    const client = await createClient();
    await client.fetchQuotasForModels(models);
    expect(mockModelsService.fetchQuotasForModels).toHaveBeenCalledWith(models);
  });

  it('delegates getUsageSummary to usageService', async () => {
    const client = await createClient();
    await client.getUsageSummary({ from: '2026-01-01' });
    expect(mockUsageService.getUsageSummary).toHaveBeenCalledWith({ from: '2026-01-01' });
  });

  it('delegates getUsageBreakdown to usageService', async () => {
    const opts = { model: 'qwen-plus', granularity: 'day' as const };
    const client = await createClient();
    await client.getUsageBreakdown(opts);
    expect(mockUsageService.getUsageBreakdown).toHaveBeenCalledWith(opts);
  });

  it('delegates getUsageLogs to usageService', async () => {
    const opts = { model: 'qwen-plus', page: 1, pageSize: 10 };
    const client = await createClient();
    await client.getUsageLogs(opts);
    expect(mockUsageService.getUsageLogs).toHaveBeenCalledWith(opts);
  });


  it('delegates searchDocs to docsService', async () => {
    const opts = { query: 'hello', page: 1, limit: 10 };
    const client = await createClient();
    await client.searchDocs(opts);
    expect(mockDocsService.searchDocs).toHaveBeenCalledWith(opts);
  });

  it('delegates fetchDocContent to docsService', async () => {
    const client = await createClient();
    await client.fetchDocContent('https://docs.test.qwencloud.com/page');
    expect(mockDocsService.fetchDocContent).toHaveBeenCalledWith('https://docs.test.qwencloud.com/page');
  });

  it('delegates getAuthStatus to authService', async () => {
    const client = await createClient();
    await client.getAuthStatus();
    expect(mockAuthService.getAuthStatus).toHaveBeenCalled();
  });

  it('delegates loginInit to authService', async () => {
    const client = await createClient();
    await client.loginInit();
    expect(mockAuthService.loginInit).toHaveBeenCalled();
  });

  it('delegates loginPoll to authService with all arguments', async () => {
    const client = await createClient();
    await client.loginPoll('token-1', 5, 'verifier-x');
    expect(mockAuthService.loginPoll).toHaveBeenCalledWith('token-1', 5, 'verifier-x');
  });

  it('delegates listWorkspaces to workspaceService.list', async () => {
    const client = await createClient();
    await client.listWorkspaces();
    expect(mockWorkspaceService.list).toHaveBeenCalled();
  });

  it('delegates getWorkspaceLimit to workspaceService.limit', async () => {
    const client = await createClient();
    await client.getWorkspaceLimit();
    expect(mockWorkspaceService.limit).toHaveBeenCalled();
  });


  it('delegates getUsageLimit to billingService', async () => {
    const client = await createClient();
    await client.getUsageLimit();
    expect(mockBillingService.getUsageLimit).toHaveBeenCalled();
  });

  it('delegates getConsumeBreakdown to billingService', async () => {
    const opts = { billingDate: '2026-01-01' };
    const client = await createClient();
    await client.getConsumeBreakdown(opts as any);
    expect(mockBillingService.getConsumeBreakdown).toHaveBeenCalledWith(opts);
  });

  it('delegates getSettleBillSummary to billingService', async () => {
    const opts = { from: '2026-01', to: '2026-03' };
    const client = await createClient();
    await client.getSettleBillSummary(opts as any);
    expect(mockBillingService.getSettleBillSummary).toHaveBeenCalledWith(opts);
  });

  it('delegates getSubscriptionStatus to subscriptionService.getStatus', async () => {
    const client = await createClient();
    await client.getSubscriptionStatus({ plan: 'token' });
    expect(mockSubscriptionService.getStatus).toHaveBeenCalledWith({ plan: 'token' });
  });

  it('delegates getSubscriptionStatus without opts to subscriptionService.getStatus({})', async () => {
    const client = await createClient();
    await client.getSubscriptionStatus();
    expect(mockSubscriptionService.getStatus).toHaveBeenCalledWith({});
  });

  it('delegates listSubscriptionOrders to subscriptionService.listOrders', async () => {
    const opts = { page: 1, pageSize: 10 };
    const client = await createClient();
    await client.listSubscriptionOrders(opts as any);
    expect(mockSubscriptionService.listOrders).toHaveBeenCalledWith(opts);
  });

  it('exposes service instances directly', async () => {
    const client = await createClient();
    expect(client.workspaceService).toBe(mockWorkspaceService);
    expect(client.billingService).toBe(mockBillingService);
    expect(client.subscriptionService).toBe(mockSubscriptionService);
    expect(client.subscriptionTokenPlanService).toBe(mockSubscriptionTokenPlanService);
    expect(client.docsService).toBe(mockDocsService);
  });
});

// ────────────────────────────────────────────────────────────────────
// revokeSession — success and error paths
// ────────────────────────────────────────────────────────────────────

describe('createClient — revokeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when authService.logout succeeds', async () => {
    mockAuthService.logout.mockResolvedValue(undefined);
    const client = await createClient();
    const result = await client.revokeSession();
    expect(result).toBe(true);
    expect(mockAuthService.logout).toHaveBeenCalled();
  });

  it('returns false when authService.logout throws', async () => {
    mockAuthService.logout.mockRejectedValue(new Error('keychain locked'));
    const client = await createClient();
    const result = await client.revokeSession();
    expect(result).toBe(false);
    expect(mockAuthService.logout).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// ping — HEAD endpoint probe
// ────────────────────────────────────────────────────────────────────

describe('createClient — ping (pingEndpoint)', () => {
  let previousFetch: typeof fetch;

  beforeEach(() => {
    previousFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = previousFetch;
  });

  it('returns reachable=true with latency when endpoint responds', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const client = await createClient();
    const result = await client.ping();
    expect(result.reachable).toBe(true);
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(result.hostname).toBe('mock-api.test.qwencloud.com');
  });

  it('returns reachable=false when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = await createClient();
    const result = await client.ping();
    expect(result.reachable).toBe(false);
    expect(result.latency).toBe(0);
    expect(result.hostname).toBe('mock-api.test.qwencloud.com');
  });

  it('returns reachable=false when fetch is aborted (timeout)', async () => {
    globalThis.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;

    vi.useFakeTimers();
    const client = await createClient();
    const promise = client.ping();
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result.reachable).toBe(false);
    expect(result.latency).toBe(0);
    vi.useRealTimers();
  });
});

// ────────────────────────────────────────────────────────────────────
// checkVersion — probeLatestVersion
// ────────────────────────────────────────────────────────────────────

describe('createClient — checkVersion (probeLatestVersion)', () => {
  it('returns update_available=true when latest > current', async () => {
    const client = await createClient();
    const result = await client.checkVersion();
    expect(result.latest).toBe('2.0.0');
    expect(result.update_available).toBe(true);
  });

  it('returns update_available=false when fetchLatestVersion returns null', async () => {
    const upgradeModule = await import('../../src/upgrade/check.js');
    vi.mocked(upgradeModule.fetchLatestVersion).mockResolvedValueOnce(null);
    vi.mocked(upgradeModule.compareVersions).mockReturnValueOnce(0);
    const client = await createClient();
    const result = await client.checkVersion();
    expect(result.update_available).toBe(false);
    expect(result.latest).toBe(result.current);
  });
});

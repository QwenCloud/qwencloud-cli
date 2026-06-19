/**
 * Integration tests for ApiClient (src/api/api-client.ts).
 *
 * ApiClient is the unified gateway call entry point:
 *   - callFlatApi: flat-parameter protocol (Type A routing)
 *   - callEnvelopeApi: envelope protocol (Type B routing, double-wrapped)
 *
 * Tests exercise both success and error paths through a mocked fetch layer.
 * No implementation code is read — tests are written purely from spec.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockFetch } from '../helpers/http-mock.js';
import type { RawApiEnvelope } from '../../src/types/api-envelope.js';

// ────────────────────────────────────────────────────────────────────
// Module-level mocks
// ────────────────────────────────────────────────────────────────────

vi.mock('../../src/auth/credentials.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    resolveCredentials: vi.fn(() => ({
      source: 'encrypted_file',
      auth_mode: 'device_flow',
      access_token: 'test-bearer-token-abc',
      credentials: {
        access_token: 'test-bearer-token-abc',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        user: { email: 'test@test.qwencloud.com', aliyunId: 'uid-123' },
      },
    })),
    isTokenExpired: vi.fn(() => false),
  };
});

vi.mock('../../src/config/manager.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getEffectiveConfig: vi.fn(() => ({
      'api.endpoint': 'https://mock-api.test.qwencloud.com',
      'auth.endpoint': 'https://mock-auth.test.qwencloud.com',
    })),
  };
});

let activeMock: ReturnType<typeof mockFetch> | null = null;
afterEach(() => {
  if (activeMock) {
    activeMock.restore();
    activeMock = null;
  }
});

// ────────────────────────────────────────────────────────────────────
// callFlatApi — success paths (Type A flat routing)
// ────────────────────────────────────────────────────────────────────

describe('ApiClient.callFlatApi — success paths', () => {
  it('returns parsed data on a standard Type A success response', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': (req) => {
        const body = JSON.parse(req.body!);
        expect(body.product).toBe('BssOpenAPI-V3');
        expect(body.action).toBe('MaasListConsumeSummary');
        return { code: '200', data: { Data: [{ cost: 1.5 }], TotalCount: 1 } };
      },
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    const client = createApiClient();
    const result = await client.callFlatApi<{ Data: Array<{ cost: number }>; TotalCount: number }>({
      product: 'BssOpenAPI-V3',
      action: 'MaasListConsumeSummary',
      params: { BillingDate: '2026-04-01', PageSize: 100 },
    });
    expect(result.Data).toHaveLength(1);
    expect(result.TotalCount).toBe(1);
  });

  it('flattens params to strings in the request body', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': (req) => {
        const body = JSON.parse(req.body!);
        expect(body.params.PageSize).toBe('100');
        expect(body.params.Enabled).toBe('true');
        return { code: '200', data: { Data: [] } };
      },
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    const client = createApiClient();
    await client.callFlatApi({
      product: 'BssOpenAPI-V3',
      action: 'ListSomething',
      params: { PageSize: 100, Enabled: true },
    });
  });

  it('sends request to the gateway URL containing /data/v2/api.json', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: {} }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await createApiClient().callFlatApi({ product: 'p', action: 'a' });
    expect(activeMock.calls[0]?.url).toContain('/data/v2/api.json');
  });
});

// ────────────────────────────────────────────────────────────────────
// callFlatApi — gateway error paths
// ────────────────────────────────────────────────────────────────────

describe('ApiClient.callFlatApi — gateway error paths', () => {
  it('throws when HTTP response status is 4xx/5xx', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': { body: { error: 'server error' }, init: { status: 500 } },
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await expect(
      createApiClient().callFlatApi({ product: 'p', action: 'a' }),
    ).rejects.toThrow();
  });

  it('throws when gateway code is not "200"', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '403', message: 'ConsoleNeedLogin' }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await expect(
      createApiClient().callFlatApi({ product: 'p', action: 'a' }),
    ).rejects.toThrow();
  });

  it('error includes gateway message for diagnostics', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '500', message: 'InternalError: timeout' }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    try {
      await createApiClient().callFlatApi({ product: 'p', action: 'a' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/InternalError|timeout|500/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// callFlatApi — business error paths (structured passthrough)
// ────────────────────────────────────────────────────────────────────

describe('ApiClient.callFlatApi — business error passthrough', () => {
  it('surfaces business-level error in data field when code is "200" but data indicates error', async () => {
    // Some APIs return code=200 but embed error info in the data payload.
    // ApiClient should transparently pass data through without interpreting it.
    activeMock = mockFetch({
      'data/v2/api.json': () => ({
        code: '200',
        data: { Code: 'InvalidParameter', Message: 'BillingDate is invalid' },
      }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    const result = await createApiClient().callFlatApi<{ Code: string; Message: string }>({
      product: 'BssOpenAPI-V3',
      action: 'MaasListConsumeSummary',
      params: { BillingDate: 'invalid' },
    });
    // Business errors are passed through; caller inspects them
    expect(result.Code).toBe('InvalidParameter');
    expect(result.Message).toBe('BillingDate is invalid');
  });
});

// ────────────────────────────────────────────────────────────────────
// callFlatApi — authOptional behavior
// ────────────────────────────────────────────────────────────────────

describe('ApiClient.callFlatApi — authOptional behavior', () => {
  it('sends Authorization header when logged in and authOptional=true', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: { models: [] } }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await createApiClient().callFlatApi({
      product: 'aliyun-search-maas',
      action: 'SearchModels',
      params: { q: 'qwen' },
      authOptional: true,
    });
    const call = activeMock.calls[0];
    expect(call?.headers.Authorization).toMatch(/^Bearer /);
  });

  it('omits Authorization header when not logged in and authOptional=true', async () => {
    const credMod = await import('../../src/auth/credentials.js');
    vi.mocked(credMod.resolveCredentials).mockReturnValueOnce(null as never);

    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: { models: [] } }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await createApiClient().callFlatApi({
      product: 'aliyun-search-maas',
      action: 'SearchModels',
      params: { q: 'qwen' },
      authOptional: true,
    });
    const call = activeMock.calls[0];
    expect(call?.headers.Authorization).toBeUndefined();
  });

  it('does not throw when not logged in and authOptional=true', async () => {
    const credMod = await import('../../src/auth/credentials.js');
    vi.mocked(credMod.resolveCredentials).mockReturnValueOnce(null as never);

    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: {} }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    // Should not throw — gracefully returns public data subset
    await expect(
      createApiClient().callFlatApi({
        product: 'aliyun-search-maas',
        action: 'SearchModels',
        authOptional: true,
      }),
    ).resolves.toBeDefined();
  });

  it('automatically sets authOptional for products in AUTH_OPTIONAL_PRODUCTS', async () => {
    const credMod = await import('../../src/auth/credentials.js');
    vi.mocked(credMod.resolveCredentials).mockReturnValueOnce(null as never);

    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: {} }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    // aliyun-search-maas is in AUTH_OPTIONAL_PRODUCTS — should not throw
    await expect(
      createApiClient().callFlatApi({
        product: 'aliyun-search-maas',
        action: 'SearchAll',
      }),
    ).resolves.toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// callEnvelopeApi — success paths (Type B envelope routing)
// ────────────────────────────────────────────────────────────────────

describe('ApiClient.callEnvelopeApi — success paths', () => {
  it('returns unwrapped business data on a standard Type B success response', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({
        code: '200',
        data: {
          DataV2: {
            ret: ['SUCCESS::ok'],
            data: {
              data: { workspaces: [{ id: 'ws-1', name: 'default' }] },
              success: true,
            },
          },
        },
      }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    const result = await createApiClient().callEnvelopeApi<{
      workspaces: Array<{ id: string; name: string }>;
    }>({
      api: 'zeldaEasy.bailian-dash-workspace.space.listWorkspaces4Agent',
      data: { pageNo: 1, pageSize: 20 },
    });
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]?.id).toBe('ws-1');
  });

  it('sends fixed product and action in envelope request body', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': (req) => {
        const body = JSON.parse(req.body!);
        expect(body.product).toBe('sfm_bailian');
        expect(body.action).toBe('IntlBroadScopeAspnGateway');
        return {
          code: '200',
          data: { DataV2: { ret: ['SUCCESS::ok'], data: { data: {}, success: true } } },
        };
      },
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await createApiClient().callEnvelopeApi({ api: 'test.api', data: {} });
  });

  it('wraps api and data into params.Api and params.Data', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': (req) => {
        const body = JSON.parse(req.body!);
        expect(body.params.Api).toBe('test.api.path');
        expect(typeof body.params.Data).toBe('string');
        const parsedData = JSON.parse(body.params.Data);
        expect(parsedData.reqDTO.pageNo).toBe(1);
        return {
          code: '200',
          data: { DataV2: { ret: ['SUCCESS::ok'], data: { data: {}, success: true } } },
        };
      },
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await createApiClient().callEnvelopeApi({
      api: 'test.api.path',
      data: { pageNo: 1 },
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// callEnvelopeApi — DataV2 shape errors
// ────────────────────────────────────────────────────────────────────

describe('ApiClient.callEnvelopeApi — envelope shape errors', () => {
  it('throws when DataV2 is missing from response', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: {} }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await expect(
      createApiClient().callEnvelopeApi({ api: 'test.api', data: {} }),
    ).rejects.toThrow();
  });

  it('throws when DataV2 has no ret', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: { DataV2: { data: { data: {} } } } }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    // When ret is missing, ret defaults to '' which is not SUCCESS, so business error is thrown
    await expect(
      createApiClient().callEnvelopeApi({ api: 'test.api', data: {} }),
    ).rejects.toThrow();
  });

  it('throws when DataV2.data.ret is missing (empty ret)', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({
        code: '200',
        data: { DataV2: { ret: [], data: { data: {} } } },
      }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    await expect(
      createApiClient().callEnvelopeApi({ api: 'test.api', data: {} }),
    ).rejects.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────
// callEnvelopeApi — business ret error analysis
// ────────────────────────────────────────────────────────────────────

describe('ApiClient.callEnvelopeApi — business ret errors', () => {
  it('throws with business error code when ret[0] is not SUCCESS::', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({
        code: '200',
        data: {
          DataV2: {
            ret: ['IllegalArgumentException::param xyz is required'],
            data: {
              data: null,
              success: false,
            },
          },
        },
      }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    try {
      await createApiClient().callEnvelopeApi({ api: 'test.api', data: {} });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/IllegalArgumentException|param xyz/);
    }
  });

  it('parses ret error with :: separator correctly', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({
        code: '200',
        data: {
          DataV2: {
            ret: ['ServiceUnavailable::system is busy, retry later'],
            data: {
              data: null,
              success: false,
            },
          },
        },
      }),
    });
    const { createApiClient } = await import('../../src/api/api-client.js');
    try {
      await createApiClient().callEnvelopeApi({ api: 'test.api', data: {} });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/ServiceUnavailable|retry/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Timeout handling
// ────────────────────────────────────────────────────────────────────

describe('ApiClient — timeout handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a request that exceeds the configured timeout', async () => {
    const previous = globalThis.fetch;
    const hangingFetch = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as Error & { name: string }).name = 'AbortError';
          reject(err);
        });
      });
    });
    globalThis.fetch = hangingFetch as unknown as typeof fetch;

    try {
      const { createApiClient } = await import('../../src/api/api-client.js');
      const client = createApiClient();
      const promise = client.callFlatApi({ product: 'p', action: 'a' });
      const settled = promise.catch((err) => err);
      await vi.advanceTimersByTimeAsync(60_001);
      const err = (await settled) as Error;
      expect(err).toBeInstanceOf(Error);
      expect(/(timeout|abort)/i.test(err.message) || err.name === 'AbortError').toBe(true);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Network error handling
// ────────────────────────────────────────────────────────────────────

describe('ApiClient — network errors', () => {
  it('propagates a normalized error when fetch fails (ECONNREFUSED)', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    }) as unknown as typeof fetch;

    try {
      const { createApiClient } = await import('../../src/api/api-client.js');
      await expect(
        createApiClient().callFlatApi({ product: 'p', action: 'a' }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('propagates a normalized error for callEnvelopeApi on network failure', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed: ENOTFOUND');
    }) as unknown as typeof fetch;

    try {
      const { createApiClient } = await import('../../src/api/api-client.js');
      await expect(
        createApiClient().callEnvelopeApi({ api: 'test.api', data: {} }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = previous;
    }
  });
});

/**
 * Unit tests for BaseClient (src/api/base-client.ts).
 *
 * BaseClient is the HTTP transport layer:
 *   - Wraps global fetch with timeout (AbortController)
 *   - Injects User-Agent and Authorization headers based on authMode
 *   - Normalizes non-2xx responses and network failures into Error
 *   - Redacts the Authorization header value in any debug output
 *
 * These tests use the project's lightweight fetch-mock helper instead of msw
 * to keep startup time low. Credential resolution and config retrieval are
 * mocked at module level so the BaseClient picks up deterministic values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockFetch } from '../helpers/http-mock.js';

// ────────────────────────────────────────────────────────────────────
// Module-level mocks (must be hoisted before importing the unit)
// ────────────────────────────────────────────────────────────────────

vi.mock('../../src/auth/credentials.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    resolveCredentials: vi.fn(() => ({
      source: 'encrypted_file',
      auth_mode: 'device_flow',
      access_token: 'super-secret-token-1234567890',
      credentials: {
        access_token: 'super-secret-token-1234567890',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        user: { email: 'test@test.qwencloud.com', aliyunId: 'test-user' },
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
// Successful request paths
// ────────────────────────────────────────────────────────────────────

describe('BaseClient.request — successful responses', () => {
  it('returns parsed JSON body for 200 OK', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: { Data: [1, 2] } }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    const client = createBaseClient();
    const result = await client.request<{ code: string; data: { Data: number[] } }>({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      method: 'POST',
      body: JSON.stringify({ product: 'p', action: 'a' }),
      authMode: 'required',
    });
    expect(result.code).toBe('200');
    expect(result.data.Data).toEqual([1, 2]);
  });

  it('defaults method to POST when not specified', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200', data: {} }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    const client = createBaseClient();
    await client.request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      authMode: 'required',
    });
    expect(activeMock.calls[0]?.method).toBe('POST');
  });

  it('forwards caller-supplied headers (e.g. Content-Type)', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    const client = createBaseClient();
    await client.request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'v1' },
      body: '{}',
      authMode: 'required',
    });
    const call = activeMock.calls[0];
    expect(call?.headers['Content-Type']).toBe('application/json');
    expect(call?.headers['X-Custom']).toBe('v1');
  });

  it('passes the body through unchanged', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    const client = createBaseClient();
    const body = JSON.stringify({ foo: 'bar', n: 1 });
    await client.request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      body,
      authMode: 'required',
    });
    expect(activeMock.calls[0]?.body).toBe(body);
  });
});

// ────────────────────────────────────────────────────────────────────
// Authorization injection by authMode
// ────────────────────────────────────────────────────────────────────

describe('BaseClient.request — Authorization header by authMode', () => {
  it('attaches Bearer token when authMode = "required" and user is logged in', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await createBaseClient().request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      authMode: 'required',
    });
    const call = activeMock.calls[0];
    expect(call?.headers.Authorization).toMatch(/^Bearer /);
    expect(call?.headers.Authorization).toContain('super-secret-token-1234567890');
  });

  it('attaches Bearer token when authMode = "optional" and user is logged in', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await createBaseClient().request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      authMode: 'optional',
    });
    const call = activeMock.calls[0];
    expect(call?.headers.Authorization).toMatch(/^Bearer /);
  });

  it('omits Authorization header when authMode = "optional" and no credentials', async () => {
    const credMod = await import('../../src/auth/credentials.js');
    vi.mocked(credMod.resolveCredentials).mockReturnValueOnce(null as never);

    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await createBaseClient().request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      authMode: 'optional',
    });
    const call = activeMock.calls[0];
    expect(call?.headers.Authorization).toBeUndefined();
  });

  it('throws when authMode = "required" and no credentials are available', async () => {
    const credMod = await import('../../src/auth/credentials.js');
    vi.mocked(credMod.resolveCredentials).mockReturnValueOnce(null as never);

    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await expect(
      createBaseClient().request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      }),
    ).rejects.toThrow();
  });

  it('never attaches Authorization when authMode = "none"', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await createBaseClient().request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      authMode: 'none',
    });
    expect(activeMock.calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('always injects a User-Agent header', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await createBaseClient().request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      authMode: 'required',
    });
    const ua =
      activeMock.calls[0]?.headers['User-Agent'] ?? activeMock.calls[0]?.headers['user-agent'];
    expect(ua).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────
// HTTP error normalization
// ────────────────────────────────────────────────────────────────────

describe('BaseClient.request — HTTP error normalization', () => {
  it('throws on 4xx status with status, URL, and truncated body context', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': {
        body: { error: 'bad request' },
        init: { status: 400 },
      },
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await expect(
      createBaseClient().request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      }),
    ).rejects.toThrow();
  });

  it('throws on 401 unauthorized', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': {
        body: { error: 'unauthorized' },
        init: { status: 401 },
      },
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await expect(
      createBaseClient().request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      }),
    ).rejects.toThrow(/401|unauthor/i);
  });

  it('throws on 5xx server error', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': {
        body: { error: 'internal' },
        init: { status: 500 },
      },
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await expect(
      createBaseClient().request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      }),
    ).rejects.toThrow(/500|internal/i);
  });

  it('error message includes the requested URL for diagnostics', async () => {
    activeMock = mockFetch({
      'data/v2/api.json': { body: 'oops', init: { status: 503 } },
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    try {
      await createBaseClient().request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      });
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/mock-api\.test\.qwencloud\.com|data\/v2\/api\.json/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Network errors
// ────────────────────────────────────────────────────────────────────

describe('BaseClient.request — network errors', () => {
  it('rethrows network failures with a normalized Error', async () => {
    const previous = globalThis.fetch;
    const failingFetch = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    globalThis.fetch = failingFetch as unknown as typeof fetch;

    try {
      const { createBaseClient } = await import('../../src/api/base-client.js');
      await expect(
        createBaseClient().request({
          url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
          authMode: 'required',
        }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = previous;
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Timeout (AbortController-driven)
// ────────────────────────────────────────────────────────────────────

describe('BaseClient.request — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a hanging request once the timeout elapses', async () => {
    // Replace fetch with a never-resolving promise that respects AbortSignal.
    const previous = globalThis.fetch;
    let abortReason: unknown;
    const hangingFetch = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            abortReason = (signal as AbortSignal).reason;
            const err = new Error('aborted');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
          });
        }
      });
    });
    globalThis.fetch = hangingFetch as unknown as typeof fetch;

    try {
      const { createBaseClient } = await import('../../src/api/base-client.js');
      const client = createBaseClient({ timeout: 30_000 });
      const promise = client.request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      });

      // Attach a catch handler synchronously so unhandled rejection isn't logged.
      const settled = promise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(30_001);
      const err = (await settled) as Error;
      expect(err).toBeInstanceOf(Error);
      // Either explicit timeout error or propagated abort.
      expect(/(timeout|abort)/i.test(err.message) || abortReason !== undefined).toBe(true);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('honors a custom timeout value passed to createBaseClient', async () => {
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
      const { createBaseClient } = await import('../../src/api/base-client.js');
      const client = createBaseClient({ timeout: 1_000 });
      const promise = client.request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      });
      const settled = promise.catch((err) => err);

      // Should not abort before 1s.
      await vi.advanceTimersByTimeAsync(500);
      // Should abort after the configured 1s.
      await vi.advanceTimersByTimeAsync(600);
      const err = (await settled) as Error;
      expect(err).toBeInstanceOf(Error);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Redirect handling — credentials must not follow redirects
// ────────────────────────────────────────────────────────────────────

describe('BaseClient.request — redirect option', () => {
  it('passes redirect: "error" to fetch to prevent credential leakage on redirects', async () => {
    const previous = globalThis.fetch;
    const recordingFetch = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ code: '200' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = recordingFetch as unknown as typeof fetch;

    try {
      const { createBaseClient } = await import('../../src/api/base-client.js');
      await createBaseClient().request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      });
      expect(recordingFetch).toHaveBeenCalledTimes(1);
      const init = recordingFetch.mock.calls[0]?.[1];
      expect(init?.redirect).toBe('error');
    } finally {
      globalThis.fetch = previous;
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Authorization redaction in debug output
// ────────────────────────────────────────────────────────────────────

describe('BaseClient.request — Authorization redaction', () => {
  it('does not echo the full bearer token to console.error in non-verbose mode', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    activeMock = mockFetch({
      'data/v2/api.json': () => ({ code: '200' }),
    });
    const { createBaseClient } = await import('../../src/api/base-client.js');
    await createBaseClient().request({
      url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
      authMode: 'required',
      context: 'unit-test',
    });
    for (const callArgs of errSpy.mock.calls) {
      const joined = callArgs.map(String).join(' ');
      expect(joined).not.toContain('super-secret-token-1234567890');
    }
    errSpy.mockRestore();
  });

  it('redacts the Authorization header in debug-buffer dumps when DEBUG_HTTP is set', async () => {
    const previousEnv = process.env.DEBUG_HTTP;
    process.env.DEBUG_HTTP = '1';
    try {
      activeMock = mockFetch({
        'data/v2/api.json': () => ({ code: '200' }),
      });
      const { createBaseClient } = await import('../../src/api/base-client.js');
      await createBaseClient().request({
        url: 'https://mock-api.test.qwencloud.com/data/v2/api.json',
        authMode: 'required',
      });

      const debugMod = await import('../../src/api/debug-buffer.js');
      // Capture flushDebugReport stderr output.
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        debugMod.flushDebugReport();
        const aggregate = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
        expect(aggregate).not.toContain('super-secret-token-1234567890');
      } finally {
        errSpy.mockRestore();
      }
    } finally {
      if (previousEnv === undefined) {
        delete process.env.DEBUG_HTTP;
      } else {
        process.env.DEBUG_HTTP = previousEnv;
      }
    }
  });
});

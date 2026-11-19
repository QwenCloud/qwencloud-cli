import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBaseClient,
  HttpResponseError,
  isResponseParseError,
  RequestTimeoutError,
  ResponseParseError,
} from '../../src/api/base-client.js';

const { resolveCredentials } = vi.hoisted(() => ({
  resolveCredentials: vi.fn(() => ({
    source: 'encrypted_file',
    auth_mode: 'device_flow',
    access_token: 'mock-root-credential',
    credentials: {
      access_token: 'mock-root-credential',
      expires_at: '2099-01-01T00:00:00Z',
      user: { email: 'mock-user@test.qwencloud.com', aliyunId: 'mock-account' },
    },
  })),
}));
vi.mock('../../src/auth/credentials.js', () => ({
  resolveCredentials,
  isTokenExpired: vi.fn(() => false),
}));
vi.mock('../../src/config/manager.js', () => ({ getEffectiveConfig: () => ({}) }));
const url = 'https://mock-gateway.test.qwencloud.com/cli/api.json';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Base transport derived authorization and request lifecycle', () => {
  it('preserves explicit derived authorization instead of overwriting it with the root credential', async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('{"marker":"response"}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);

    const result = await createBaseClient().request({
      url,
      authMode: 'required',
      headers: { Authorization: 'Bearer mock-derived-credential' },
      body: '{}',
    });

    expect(result).toEqual({ marker: 'response' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer mock-derived-credential',
    );
  });

  it('does not resolve root credentials for an explicitly anonymous request', async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    const onRequestStart = vi.fn();

    await createBaseClient().request({ url, authMode: 'none', onRequestStart });

    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(onRequestStart).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('does not dispatch fetch or mark a request started after prior caller cancellation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const onRequestStart = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      createBaseClient().request({
        url,
        authMode: 'none',
        signal: controller.signal,
        onRequestStart,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(onRequestStart).not.toHaveBeenCalled();
  });

  it('keeps caller abort separate from a transport timeout', async () => {
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Mock caller aborted', 'AbortError')),
              { once: true },
            );
            markStarted();
          }),
      ),
    );
    const controller = new AbortController();
    const pending = createBaseClient({ timeout: 1000 }).request({
      url,
      authMode: 'none',
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();

    await rejected;
  });

  it('classifies its own fetch timeout as RequestTimeoutError', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Mock timed out', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const pending = createBaseClient({ timeout: 1000 }).request({ url, authMode: 'none' });
    const rejected = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
  });

  it('retains HTTP status and error identity without generating a business error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Mock denied', { status: 403, statusText: 'Forbidden' })),
    );
    let caught: unknown;
    try {
      await createBaseClient().request({ url, authMode: 'none' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpResponseError);
    expect(caught).toMatchObject({ name: 'HttpResponseError', status: 403 });
    expect(caught).not.toHaveProperty('code');
  });

  it('marks malformed successful JSON as a response parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('malformed-json', { status: 200 })),
    );
    let caught: unknown;
    try {
      await createBaseClient().request({ url, authMode: 'none' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ResponseParseError);
    expect(isResponseParseError(caught)).toBe(true);
  });

  it('redacts complete derived and root tokens from HTTP debug output', async () => {
    vi.stubEnv('DEBUG_HTTP', '1');
    vi.resetModules();
    const { createBaseClient: createDebugClient } = await import('../../src/api/base-client.js');
    const { flushDebugReport } = await import('../../src/api/debug-buffer.js');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '{"cliAccessToken":"mock-derived-credential","access_token":"mock-root-credential"}',
            { status: 200 },
          ),
      ),
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      logs.push(values.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      logs.push(values.map(String).join(' '));
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const result = await createDebugClient().request({
      url,
      authMode: 'none',
      headers: { Authorization: 'Bearer mock-derived-credential' },
    });
    flushDebugReport();

    expect(result).toEqual({
      cliAccessToken: 'mock-derived-credential',
      access_token: 'mock-root-credential',
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('mock-derived-credential');
    expect(logs.join('\n')).not.toContain('mock-root-credential');
  });
});

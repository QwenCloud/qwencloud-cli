import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials, CsDataContext } from '../../src/types/auth.js';
import type { BaseClient, RequestOptions } from '../../src/api/base-client.js';

const { state, resolveCredentials, readEncryptedCredentials, writeEncryptedCredentials } =
  vi.hoisted(() => {
    const state = {
      credentials: null as Credentials | null,
      store: new Map<string, Record<string, unknown>>(),
    };
    return {
      state,
      resolveCredentials: vi.fn(() =>
        state.credentials
          ? {
              source: 'encrypted_file',
              auth_mode: 'device_flow',
              access_token: state.credentials.access_token,
              credentials: state.credentials,
            }
          : null,
      ),
      readEncryptedCredentials: vi.fn((path: string) => state.store.get(path) ?? null),
      writeEncryptedCredentials: vi.fn((data: Record<string, unknown>, path: string) => {
        state.store.set(path, data);
      }),
    };
  });
vi.mock('../../src/auth/credentials.js', () => ({
  resolveCredentials,
  clearCredentialsCache: vi.fn(),
  isTokenExpired: vi.fn(() => false),
}));
vi.mock('../../src/auth/crypto-store.js', () => ({
  readEncryptedCredentials,
  writeEncryptedCredentials,
}));
vi.mock('../../src/auth/keychain.js', () => ({ isPlaintextMode: vi.fn(() => false) }));
vi.mock('../../src/config/paths.js', async () => {
  const { resolve } = await import('node:path');
  return { getCredentialsPath: () => resolve('tests/mock-files/client-credentials') };
});
vi.mock('../../src/config/manager.js', () => ({
  getConfigValue: vi.fn(() => undefined),
  getEffectiveConfig: vi.fn(() => ({})),
}));
vi.mock('fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn((path: string) => {
    state.store.delete(path);
  }),
  renameSync: vi.fn((source: string, target: string) => {
    const value = state.store.get(source);
    if (value) state.store.set(target, value);
    state.store.delete(source);
  }),
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn((path: string) => {
    state.store.delete(path);
  }),
  renameSync: vi.fn((source: string, target: string) => {
    const value = state.store.get(source);
    if (value) state.store.set(target, value);
    state.store.delete(source);
  }),
}));

const QUOTA = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config';
const SUBSCRIPTION = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription';
const MODELS = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listTokenPlanModels';
const context: CsDataContext = {
  issuer: 'https://cli.qwencloud.com/data/v2/api.json',
  gateway: 'https://ap-southeast-1-cs-data.qwencloud.com/cli/api.json',
  environment: 'production',
  region: 'ap-southeast-1',
  site: 'qwencloud',
};
function successEnvelope(code = 'SUCCESS') {
  return {
    code: '200',
    successResponse: true,
    data: {
      success: true,
      errorCode: '',
      DataV2: {
        ret: ['SUCCESS::ok'],
        data: { code, success: true, data: { marker: 'business-result' } },
      },
    },
  };
}
function parseBusiness(raw: unknown) {
  return (raw as { data: { marker: string } }).data;
}
let clientApi: typeof import('../../src/api/api-client.js');
let baseApi: typeof import('../../src/api/base-client.js');

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  state.store.clear();
  state.credentials = {
    access_token: 'mock-root-credential',
    expires_at: '2099-01-01T00:00:00Z',
    user: { email: 'mock-user@test.qwencloud.com', aliyunId: 'mock-account' },
  };
  clientApi = await import('../../src/api/api-client.js');
  baseApi = await import('../../src/api/base-client.js');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Real orchestration ApiClient dispatch contract', () => {
  it.each([
    ['/data/publicCustom.json', 'none', 'GetCommodity'],
    ['/data/publicCustom.json', 'optional', 'QueryOrderLight'],
    ['/data/custom.json', 'required', 'QueryInstance'],
  ] as const)('dispatches %s with %s authentication for %s', async (path, authMode, action) => {
    const data = { marker: 'mock-orchestration-result' };
    const params = { commodityCode: 'sfm_tokenplansolo_public_intl' };
    const request = vi.fn(async (_options: RequestOptions) => ({
      code: '200',
      successResponse: true,
      data,
    }));
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });
    const parse = vi.fn((raw: unknown) => ({ native: raw }));

    const result = await client.callOrchestrationApi({ action, params, path, authMode, parse });

    expect(request).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledExactlyOnceWith(data);
    expect(result).toEqual({ native: data });
    const options = request.mock.calls[0]![0];
    const url = new URL(options.url);
    const form = new URLSearchParams(options.body);
    expect(url.pathname).toBe(path);
    expect(url.searchParams.getAll('product')).toEqual(['occa-payment']);
    expect(url.searchParams.getAll('action')).toEqual([action]);
    expect(url.searchParams.has('params')).toBe(false);
    expect(options.method).toBe('POST');
    expect(options.authMode).toBe(authMode);
    expect(options.headers?.['Content-Type']).toContain('application/x-www-form-urlencoded');
    expect(form.get('product')).toBe('occa-payment');
    expect(form.get('action')).toBe(action);
    expect(form.get('region')).toBe('ap-southeast-1');
    expect(JSON.parse(form.get('params') ?? 'null')).toEqual(params);
  });
});

describe('Real cs-data ApiClient authentication contract', () => {
  it.each([
    ['mock*root-credential.test', 'mock-derived-credential'],
    ['mock-root-credential', 'mock*derived-credential.test'],
    ['mock*root-credential.test', 'mock*derived-credential.test'],
  ])(
    'dispatches and reuses a personal session for opaque tokens %s and %s',
    async (root, derived) => {
      state.credentials = { ...state.credentials!, access_token: root };
      const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
        const requestUrl = input instanceof Request ? input.url : String(input);
        const envelope =
          requestUrl === context.issuer
            ? { code: '200', successResponse: true, data: { cliAccessToken: derived } }
            : successEnvelope();
        return new Response(JSON.stringify(envelope), { status: 200 });
      });
      vi.stubGlobal('fetch', fetch);
      const client = clientApi.createApiClient({
        baseClient: baseApi.createBaseClient(),
        csDataContext: context,
      });
      const parse = vi.fn(parseBusiness);

      const first = await client.callCsDataApi({
        api: SUBSCRIPTION,
        data: { commodityCode: 'sfm_tokenplansolo_public_intl' },
        parse,
      });
      const second = await client.callCsDataApi({
        api: SUBSCRIPTION,
        data: { commodityCode: 'sfm_tokenplansolo_public_intl' },
        parse,
      });

      expect(first).toEqual({ marker: 'business-result' });
      expect(second).toEqual(first);
      expect(parse).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
        `Bearer ${root}`,
      );
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
        action: 'GenerateCLIAccessToken',
        product: 'ModelStudioRegional',
      });
      for (const index of [1, 2]) {
        const call = fetch.mock.calls[index]!;
        expect(new Headers(call[1]?.headers).get('Authorization')).toBe(`Bearer ${derived}`);
        expect(new URL(String(call[0])).searchParams.get('api')).toBe(SUBSCRIPTION);
      }
      expect(writeEncryptedCredentials).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['***', '[REDACTED]', '<REDACTED>', 'REDACTED', '<omitted>', 'omitted'])(
    'rejects root placeholder %s before issuing or querying a personal subscription',
    async (root) => {
      state.credentials = { ...state.credentials!, access_token: root };
      const fetch = vi.fn(async () => new Response(JSON.stringify(successEnvelope())));
      vi.stubGlobal('fetch', fetch);
      const client = clientApi.createApiClient({
        baseClient: baseApi.createBaseClient(),
        csDataContext: context,
      });
      const parse = vi.fn(parseBusiness);

      await expect(
        client.callCsDataApi({
          api: SUBSCRIPTION,
          data: { commodityCode: 'sfm_tokenplansolo_public_intl' },
          parse,
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

      expect(fetch).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expect(writeEncryptedCredentials).not.toHaveBeenCalled();
    },
  );

  it.each(['***', '[REDACTED]', '<REDACTED>', 'REDACTED', '<omitted>', 'omitted'])(
    'rejects issued placeholder %s before querying or caching a personal session',
    async (derived) => {
      const fetch = vi.fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              code: '200',
              successResponse: true,
              data: { cliAccessToken: derived },
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal('fetch', fetch);
      const client = clientApi.createApiClient({
        baseClient: baseApi.createBaseClient(),
        csDataContext: context,
      });
      const parse = vi.fn(parseBusiness);

      await expect(
        client.callCsDataApi({
          api: SUBSCRIPTION,
          data: { commodityCode: 'sfm_tokenplansolo_public_intl' },
          parse,
        }),
      ).rejects.toThrow();

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(context.issuer);
      expect(parse).not.toHaveBeenCalled();
      expect(writeEncryptedCredentials).not.toHaveBeenCalled();
    },
  );

  it('replaces a root token in the matching cache before dispatching the personal request', async () => {
    const firstFetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      return new Response(
        JSON.stringify(
          requestUrl === context.issuer
            ? {
                code: '200',
                successResponse: true,
                data: { cliAccessToken: 'mock-original-derived' },
              }
            : successEnvelope(),
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', firstFetch);
    const firstClient = clientApi.createApiClient({
      baseClient: baseApi.createBaseClient(),
      csDataContext: context,
    });
    await firstClient.callCsDataApi({
      api: SUBSCRIPTION,
      data: { commodityCode: 'sfm_tokenplansolo_public_intl' },
      parse: parseBusiness,
    });
    const record = state.store.values().next().value;
    expect(record).toMatchObject({ token: 'mock-original-derived' });
    record!.token = state.credentials!.access_token;
    vi.resetModules();
    const reloadedClientApi = await import('../../src/api/api-client.js');
    const reloadedBaseApi = await import('../../src/api/base-client.js');
    const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      return new Response(
        JSON.stringify(
          requestUrl === context.issuer
            ? {
                code: '200',
                successResponse: true,
                data: { cliAccessToken: 'mock-replacement-derived' },
              }
            : successEnvelope(),
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetch);
    const client = reloadedClientApi.createApiClient({
      baseClient: reloadedBaseApi.createBaseClient(),
      csDataContext: context,
    });

    const result = await client.callCsDataApi({
      api: SUBSCRIPTION,
      data: { commodityCode: 'sfm_tokenplansolo_public_intl' },
      parse: parseBusiness,
    });

    expect(result).toEqual({ marker: 'business-result' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(context.issuer);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer mock-replacement-derived',
    );
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(2);
  });

  it('runs an anonymous model request without reading or issuing an account session', async () => {
    const request = vi.fn(async (_options: RequestOptions) => successEnvelope('200'));
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });

    const result = await client.callCsDataApi({
      api: MODELS,
      data: { input: { pageNo: 1, pageSize: 100, edition: 'PERSONAL' } },
      authMode: 'none',
      parse: parseBusiness,
    });

    expect(result).toEqual({ marker: 'business-result' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(readEncryptedCredentials).not.toHaveBeenCalled();
    expect(writeEncryptedCredentials).not.toHaveBeenCalled();
    const options = request.mock.calls[0]?.[0] as RequestOptions;
    expect(options.authMode).toBe('none');
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('issues with the versioned root action and sends only the derived bearer to the gateway', async () => {
    const request = vi.fn(async (options: RequestOptions) =>
      options.url === context.issuer
        ? {
            code: '200',
            successResponse: true,
            data: { cliAccessToken: 'mock-derived-credential' },
          }
        : successEnvelope(),
    );
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });

    const result = await client.callCsDataApi({ api: QUOTA, parse: parseBusiness });

    expect(result).toEqual({ marker: 'business-result' });
    expect(request).toHaveBeenCalledTimes(2);
    const issuer = request.mock.calls[0]?.[0];
    const gateway = request.mock.calls[1]?.[0];
    expect(JSON.parse(issuer?.body ?? 'null')).toMatchObject({
      product: 'ModelStudioRegional',
      action: 'GenerateCLIAccessToken',
      version: '2026-02-10',
      params: {},
    });
    expect(gateway?.headers?.Authorization).toBe('Bearer mock-derived-credential');
    expect(gateway?.headers?.Authorization).not.toContain('mock-root-credential');
    const form = new URLSearchParams(gateway?.body);
    const params = JSON.parse(form.get('params') ?? 'null') as { Data: Record<string, unknown> };
    expect(params.Data).toEqual({
      cornerstoneParam: {
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        xsp_lang: 'en-US',
        productCode: 'p_efm',
        switchUserType: 3,
        consoleSite: 'QWENCLOUD',
      },
    });
    expect(gateway?.authMode).toBe('none');
  });

  it('refreshes a rejected old cached bearer once and retries the same business request', async () => {
    let issuerCalls = 0;
    let gatewayCalls = 0;
    const request = vi.fn(async (options: RequestOptions) => {
      if (options.url === context.issuer) {
        issuerCalls += 1;
        return {
          code: '200',
          successResponse: true,
          data: { cliAccessToken: issuerCalls === 1 ? 'mock-old-derived' : 'mock-new-derived' },
        };
      }
      gatewayCalls += 1;
      if (gatewayCalls === 2)
        return {
          code: '200',
          successResponse: true,
          data: { success: false, errorCode: 'BailianGateway.Login.NotLogined' },
        };
      return successEnvelope();
    });
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });
    await client.callCsDataApi({ api: QUOTA, parse: parseBusiness });

    const result = await client.callCsDataApi({ api: QUOTA, parse: parseBusiness });

    expect(result).toEqual({ marker: 'business-result' });
    expect(issuerCalls).toBe(2);
    expect(gatewayCalls).toBe(3);
    expect(request.mock.calls[4]?.[0]?.headers?.Authorization).toBe('Bearer mock-new-derived');
    expect(
      new URL(request.mock.calls[4]?.[0]?.url ?? context.gateway).searchParams.get('api'),
    ).toBe(QUOTA);
  });

  it('does not keep issuing new credentials when a newly issued bearer is rejected', async () => {
    const request = vi.fn(async (options: RequestOptions) => {
      if (options.url === context.issuer)
        return { code: '200', successResponse: true, data: { cliAccessToken: 'mock-new-derived' } };
      return {
        code: '200',
        successResponse: true,
        data: { success: false, errorCode: 'BailianGateway.Login.NotLogined' },
      };
    });
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });

    await expect(client.callCsDataApi({ api: QUOTA, parse: parseBusiness })).rejects.toThrow();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not refresh cached credentials merely because HTTP returned 401', async () => {
    let gatewayCalls = 0;
    const request = vi.fn(async (options: RequestOptions) => {
      if (options.url === context.issuer)
        return {
          code: '200',
          successResponse: true,
          data: { cliAccessToken: 'mock-cached-derived' },
        };
      gatewayCalls += 1;
      if (gatewayCalls > 1)
        throw new baseApi.HttpResponseError(401, 'Mock unauthorized HTTP response');
      return successEnvelope();
    });
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });
    await client.callCsDataApi({ api: QUOTA, parse: parseBusiness });

    await expect(client.callCsDataApi({ api: QUOTA, parse: parseBusiness })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
    expect(gatewayCalls).toBe(2);
  });

  it('does not retry a model business success-code mismatch', async () => {
    const request = vi.fn(async (_options: RequestOptions) => successEnvelope('SUCCESS'));
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });

    await expect(
      client.callCsDataApi({
        api: MODELS,
        data: { input: { pageNo: 1, pageSize: 100, edition: 'TEAM' } },
        authMode: 'none',
        parse: parseBusiness,
      }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(resolveCredentials).not.toHaveBeenCalled();
  });

  it('prevents all requests when the caller has already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn(async (_options: RequestOptions) => successEnvelope());
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });

    await expect(
      client.callCsDataApi({ api: QUOTA, signal: controller.signal, parse: parseBusiness }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('lets a later request finish a shared refresh after the earlier request times out', async () => {
    vi.useFakeTimers();
    let issuerCalls = 0;
    let oldGatewayCalls = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      if (requestUrl === context.issuer) {
        issuerCalls += 1;
        if (issuerCalls === 2)
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 600);
          });
        return new Response(
          JSON.stringify({
            code: '200',
            successResponse: true,
            data: { cliAccessToken: issuerCalls === 1 ? 'mock-old-derived' : 'mock-new-derived' },
          }),
        );
      }
      if (new Headers(init?.headers).get('Authorization') === 'Bearer mock-old-derived') {
        oldGatewayCalls += 1;
        if (oldGatewayCalls === 2)
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 600);
          });
        if (oldGatewayCalls > 1)
          return new Response(
            JSON.stringify({
              code: '200',
              successResponse: true,
              data: { success: false, errorCode: 'BailianGateway.Login.NotLogined' },
            }),
          );
      }
      return new Response(JSON.stringify(successEnvelope()));
    });
    vi.stubGlobal('fetch', fetch);
    const client = clientApi.createApiClient({ csDataContext: context, timeoutMs: 1000 });
    await client.callCsDataApi({ api: QUOTA, parse: parseBusiness });
    const earlier = client.callCsDataApi({ api: QUOTA, parse: parseBusiness });
    const timedOut = expect(earlier).rejects.toMatchObject({
      name: 'RequestTimeoutError',
      timeoutMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(600);
    expect(issuerCalls).toBe(2);
    const later = client.callCsDataApi({ api: QUOTA, parse: parseBusiness });
    const results = Promise.allSettled([earlier, later]);
    await vi.advanceTimersByTimeAsync(400);
    await timedOut;
    expect(fetch.mock.calls[3]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const settled = await results;

    expect(settled[1]).toEqual({ status: 'fulfilled', value: { marker: 'business-result' } });
    expect(issuerCalls).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(new Headers(fetch.mock.calls[5]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer mock-new-derived',
    );
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one total timeout budget across issuance and the business query', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (options: RequestOptions) => {
      if (options.url === context.issuer) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 600);
        });
        return {
          code: '200',
          successResponse: true,
          data: { cliAccessToken: 'mock-derived-credential' },
        };
      }
      return new Promise<unknown>(() => {});
    });
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
      timeoutMs: 1000,
    });
    const promise = client.callCsDataApi({ api: QUOTA, parse: parseBusiness });
    const rejected = expect(promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]?.signal?.aborted).toBe(true);
  });

  it('does not expose complete root or derived credentials in surfaced errors', async () => {
    const request = vi.fn(async (options: RequestOptions) => {
      if (options.url === context.issuer)
        return {
          code: '200',
          successResponse: true,
          data: { cliAccessToken: 'mock-derived-credential' },
        };
      throw new baseApi.HttpResponseError(
        403,
        'Authorization: Bearer mock-derived-credential; access_token=mock-root-credential',
      );
    });
    const client = clientApi.createApiClient({
      baseClient: { request } as unknown as BaseClient,
      csDataContext: context,
    });
    let caught: unknown;
    try {
      await client.callCsDataApi({ api: QUOTA, parse: parseBusiness });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(request).toHaveBeenCalledTimes(2);
    expect(new URL(request.mock.calls[1]?.[0]?.url ?? context.issuer).origin).toBe(
      'https://ap-southeast-1-cs-data.qwencloud.com',
    );
    expect(String(caught)).not.toContain('mock-root-credential');
    expect(String(caught)).not.toContain('mock-derived-credential');
  });
});

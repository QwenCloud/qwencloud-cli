import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsDataContext } from '../../src/types/auth.js';

const { credentialSpies, fetchSpy } = vi.hoisted(() => ({
  credentialSpies: {
    readCredentials: vi.fn(() => {
      throw new Error('Credentials must not be read');
    }),
    resolveCredentials: vi.fn(() => {
      throw new Error('Credentials must not be resolved');
    }),
    ensureAuthenticated: vi.fn(() => {
      throw new Error('Authentication must not be requested');
    }),
    getCurrentUser: vi.fn(() => {
      throw new Error('The current user must not be read');
    }),
  },
  fetchSpy: vi.fn(() => {
    throw new Error('Network must not be requested');
  }),
}));

vi.mock('../../src/auth/credentials.js', () => credentialSpies);

const productionContext: CsDataContext = {
  issuer: 'https://cli.qwencloud.com/data/v2/api.json',
  gateway: 'https://ap-southeast-1-cs-data.qwencloud.com/cli/api.json',
  environment: 'production',
  region: 'ap-southeast-1',
  site: 'qwencloud',
};

beforeEach(() => {
  Object.values(credentialSpies).forEach((spy) => spy.mockClear());
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('__NODE_ENV__', 'development');
  vi.stubEnv('QWENCLOUD_API_ENDPOINT', undefined);
  vi.resetModules();
});

afterEach(() => {
  try {
    expect(fetchSpy).not.toHaveBeenCalled();
    Object.values(credentialSpies).forEach((spy) => {
      expect(spy).not.toHaveBeenCalled();
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

describe('defaultCsDataContext', () => {
  it('returns the international production context from the default endpoint', async () => {
    const { defaultCsDataContext } = await import('../../src/api/cs-data-context.js');
    const { buildRequest } = await import('../../src/api/request-adapter.js');

    const context = defaultCsDataContext();

    expect(context).toEqual(productionContext);
    expect(buildRequest('A', { product: 'p', action: 'a' }).url).toBe(context.issuer);
  });

  it.each(['https://cli.qwencloud.com', 'https://cli.qwencloud.com/'])(
    'accepts the production endpoint override %s without duplicating the separator',
    async (endpoint) => {
      vi.stubEnv('QWENCLOUD_API_ENDPOINT', endpoint);
      const { defaultCsDataContext } = await import('../../src/api/cs-data-context.js');
      const { buildRequest } = await import('../../src/api/request-adapter.js');

      const context = defaultCsDataContext();

      expect(context).toEqual(productionContext);
      expect(buildRequest('A', { product: 'p', action: 'a' }).url).toBe(context.issuer);
    },
  );

  it.each([
    'https://mock-api.test.qwencloud.com',
    'https://pre-cli.test.qwencloud.com',
    'http://cli.qwencloud.com',
    'https://cli.qwencloud.com/custom',
    'https://cli.qwencloud.com?environment=pre',
    'https://cli.qwencloud.com#pre',
  ])('rejects an endpoint without an issuance contract: %s', async (endpoint) => {
    vi.stubEnv('QWENCLOUD_API_ENDPOINT', endpoint);
    const { defaultCsDataContext } = await import('../../src/api/cs-data-context.js');
    const { CliError } = await import('../../src/utils/errors.js');

    try {
      defaultCsDataContext();
      throw new Error('Expected an unsupported endpoint error');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(error).toMatchObject({ code: 'CS_DATA_ENDPOINT_UNSUPPORTED', exitCode: 4 });
    }
  });

  it('uses the same active endpoint as the request adapter in development', async () => {
    vi.stubEnv('QWENCLOUD_API_ENDPOINT', 'https://mock-api.test.qwencloud.com');
    const { defaultCsDataContext } = await import('../../src/api/cs-data-context.js');
    const { buildRequest } = await import('../../src/api/request-adapter.js');

    expect(buildRequest('A', { product: 'p', action: 'a' }).url).toBe(
      'https://mock-api.test.qwencloud.com/data/v2/api.json',
    );
    expect(defaultCsDataContext).toThrow(
      expect.objectContaining({ code: 'CS_DATA_ENDPOINT_UNSUPPORTED', exitCode: 4 }),
    );
  });

  it('ignores a development endpoint override in a production build', async () => {
    vi.stubGlobal('__NODE_ENV__', 'production');
    vi.stubEnv('QWENCLOUD_API_ENDPOINT', 'https://pre-cli.test.qwencloud.com');
    const { defaultCsDataContext } = await import('../../src/api/cs-data-context.js');
    const { buildRequest } = await import('../../src/api/request-adapter.js');

    const context = defaultCsDataContext();

    expect(context).toEqual(productionContext);
    expect(buildRequest('A', { product: 'p', action: 'a' }).url).toBe(context.issuer);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import { createTokenPlanBenefitsReader } from '../../src/services/tokenplan-benefits.js';

const MODELS = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listTokenPlanModels';
const PROVIDERS = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listModelProviders';

interface ModelCall {
  api: string;
  data?: { input?: { pageNo: number; pageSize: number; edition: string } };
  authMode?: 'required' | 'none';
  signal?: AbortSignal;
  parse: (raw: unknown) => unknown;
}

function model(modelId: string, provider = 'mock-provider-a') {
  return {
    modelId,
    provider,
    name: JSON.stringify({ 'en-US': `Name ${modelId}`, 'zh-CN': `Localized ${modelId}` }),
    capabilities: ['tool-call', 'thinking'],
  };
}

function makeApiClient(pages: Record<number, unknown>, providers: unknown = []) {
  const callCsDataApi = vi.fn(async (options: ModelCall) => {
    const payload = options.api === PROVIDERS ? providers : pages[options.data?.input?.pageNo ?? 1];
    return options.parse({ code: '200', success: true, data: payload });
  });
  return { client: { callCsDataApi } as unknown as ApiClient, callCsDataApi };
}

describe('Token Plan supported model reader', () => {
  it.each(['individual', 'team'] as const)(
    'preserves optional model badge metadata for %s without requiring it',
    async (edition) => {
      const api = makeApiClient({
        1: {
          total: 3,
          pageNo: 1,
          pageSize: 100,
          list: [
            {
              ...model('mock-new'),
              isNew: true,
              badgeLabel: 'Limited Offer',
              badgeDescription: 'Available this month',
            },
            { ...model('mock-existing'), isNew: false, badgeLabel: '', badgeDescription: '' },
            model('mock-untagged'),
          ],
        },
      });

      const result = await createTokenPlanBenefitsReader(api.client).loadModels(edition);

      expect(result).toEqual([
        {
          modelId: 'mock-new',
          modelBrand: 'mock-provider-a',
          modelName: 'Name mock-new',
          capabilities: ['tool-call', 'thinking'],
          isNew: true,
          badgeLabel: 'Limited Offer',
          badgeDescription: 'Available this month',
        },
        {
          modelId: 'mock-existing',
          modelBrand: 'mock-provider-a',
          modelName: 'Name mock-existing',
          capabilities: ['tool-call', 'thinking'],
          isNew: false,
          badgeLabel: '',
          badgeDescription: '',
        },
        {
          modelId: 'mock-untagged',
          modelBrand: 'mock-provider-a',
          modelName: 'Name mock-untagged',
          capabilities: ['tool-call', 'thinking'],
        },
      ]);
      expect(api.callCsDataApi).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { isNew: 'true', badgeLabel: 42, badgeDescription: [] },
    { isNew: 1, badgeLabel: false, badgeDescription: {} },
    { isNew: null, badgeLabel: null, badgeDescription: null },
  ])('ignores incorrectly typed optional badge metadata: %j', async (metadata) => {
    const api = makeApiClient({
      1: {
        total: 1,
        pageNo: 1,
        pageSize: 100,
        list: [{ ...model('mock-invalid-tag'), ...metadata }],
      },
    });

    const result = await createTokenPlanBenefitsReader(api.client).loadModels('individual');

    expect(result).toEqual([
      {
        modelId: 'mock-invalid-tag',
        modelBrand: 'mock-provider-a',
        modelName: 'Name mock-invalid-tag',
        capabilities: ['tool-call', 'thinking'],
      },
    ]);
  });

  it('loads every page and follows provider-tree order without changing model order within a brand', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => model(`mock-a-${index + 1}`));
    const api = makeApiClient(
      {
        1: { total: 102, pageNo: 1, pageSize: 100, list: firstPage },
        2: {
          total: 102,
          pageNo: 2,
          pageSize: 100,
          list: [model('mock-z-1', 'mock-provider-z'), model('mock-z-2', 'mock-provider-z')],
        },
      },
      [
        {
          providerId: 'mock-provider-group',
          displayName: 'Mock Group',
          items: [
            { providerId: 'mock-provider-z', displayName: 'Mock Brand Z' },
            { providerId: 'mock-provider-a', displayName: 'Mock Brand A' },
          ],
        },
      ],
    );

    const result = await createTokenPlanBenefitsReader(api.client).loadModels('individual');

    expect(result).toHaveLength(102);
    expect(result[0]).toEqual({
      modelId: 'mock-z-1',
      modelBrand: 'Mock Brand Z',
      modelName: 'Name mock-z-1',
      capabilities: ['tool-call', 'thinking'],
    });
    expect(result[1]?.modelId).toBe('mock-z-2');
    expect(result[2]?.modelId).toBe('mock-a-1');
    expect(result[101]?.modelId).toBe('mock-a-100');
    expect(api.callCsDataApi).toHaveBeenCalledWith(
      expect.objectContaining({
        api: MODELS,
        authMode: 'none',
        data: { input: { pageNo: 1, pageSize: 100, edition: 'PERSONAL' } },
      }),
    );
    expect(api.callCsDataApi).toHaveBeenCalledWith(
      expect.objectContaining({
        api: MODELS,
        data: { input: { pageNo: 2, pageSize: 100, edition: 'PERSONAL' } },
      }),
    );
    expect(api.callCsDataApi).toHaveBeenCalledTimes(3);
  });

  it('reuses providers within one reader while querying each selected edition separately', async () => {
    const api = makeApiClient(
      { 1: { total: 1, pageNo: 1, pageSize: 100, list: [model('mock-model')] } },
      [{ providerId: 'mock-provider-a', displayName: 'Mock Brand A' }],
    );
    const reader = createTokenPlanBenefitsReader(api.client);

    const individual = await reader.loadModels('individual');
    const team = await reader.loadModels('team');

    expect(individual[0]?.modelBrand).toBe('Mock Brand A');
    expect(team[0]?.modelBrand).toBe('Mock Brand A');
    expect(api.callCsDataApi).toHaveBeenCalledWith(
      expect.objectContaining({
        api: MODELS,
        data: { input: { pageNo: 1, pageSize: 100, edition: 'TEAM' } },
      }),
    );
    expect(api.callCsDataApi).toHaveBeenCalledTimes(3);
  });

  it('keeps the original provider and model ID when their display names are missing', async () => {
    const api = makeApiClient({
      1: {
        total: 1,
        pageNo: 1,
        pageSize: 100,
        list: [{ modelId: 'mock-nameless-model', provider: 'mock-unknown-provider' }],
      },
    });

    const result = await createTokenPlanBenefitsReader(api.client).loadModels('team');

    expect(result).toEqual([
      {
        modelId: 'mock-nameless-model',
        modelBrand: 'mock-unknown-provider',
        modelName: 'mock-nameless-model',
        capabilities: [],
      },
    ]);
  });

  it('returns an empty array only for a successful empty model page', async () => {
    const api = makeApiClient({ 1: { total: 0, pageNo: 1, pageSize: 100, list: [] } });

    const result = await createTokenPlanBenefitsReader(api.client).loadModels('individual');

    expect(result).toEqual([]);
    expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: MODELS }));
  });

  it('rejects model request failure instead of returning a successful empty array', async () => {
    const api = makeApiClient({});
    api.callCsDataApi.mockRejectedValue(new Error('Mock model transport failure'));

    await expect(
      createTokenPlanBenefitsReader(api.client).loadModels('individual'),
    ).rejects.toThrow('Mock model transport failure');
  });

  it.each([
    { total: 1, pageNo: 2, pageSize: 100, list: [model('mock-model')] },
    { total: 1, pageNo: 1, pageSize: 20, list: [model('mock-model')] },
    { total: 1, pageNo: 1, pageSize: 100, list: [] },
    { total: 2, pageNo: 1, pageSize: 100, list: [model('mock-model'), model('mock-model')] },
  ])('rejects untrustworthy model pagination: %j', async (page) => {
    const api = makeApiClient({ 1: page });

    await expect(
      createTokenPlanBenefitsReader(api.client).loadModels('individual'),
    ).rejects.toThrow();
  });

  it('passes the caller cancellation signal to model and provider requests', async () => {
    const controller = new AbortController();
    const api = makeApiClient({
      1: { total: 1, pageNo: 1, pageSize: 100, list: [model('mock-model')] },
    });

    const result = await createTokenPlanBenefitsReader(api.client, controller.signal).loadModels(
      'team',
    );

    expect(result).toHaveLength(1);
    expect(api.callCsDataApi).toHaveBeenCalledWith(
      expect.objectContaining({ api: MODELS, signal: controller.signal }),
    );
    expect(api.callCsDataApi).toHaveBeenCalledWith(
      expect.objectContaining({ api: PROVIDERS, signal: controller.signal }),
    );
  });
});

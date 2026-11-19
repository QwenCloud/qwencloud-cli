import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type { CodingPlanInstance, CodingPlanApiResponse } from '../../src/types/api-models.js';
import { CodingplanService, createGatewayAdapter } from '../../src/services/codingplan-service.js';
import type { ApiClient, CallFlatApiOptions } from '../../src/api/api-client.js';
import { addDiagnostic } from '../../src/api/debug-buffer.js';

vi.mock('../../src/config/manager.js', () => ({
  getEffectiveConfig: vi.fn(() => ({ 'api.endpoint': 'https://mock-api.test.qwencloud.com/' })),
}));
vi.mock('../../src/site.js', () => ({
  site: {
    apiEndpoint: 'https://mock-api.test.qwencloud.com',
    features: { codingPlanCommodityCode: 'sfm_codingplan_public_intl', currency: 'USD' },
    defaults: { language: 'en-US', region: 'ap-southeast-1' },
  },
}));
vi.mock('../../src/api/debug-buffer.js', () => ({ addDiagnostic: vi.fn() }));

function instance(overrides: Partial<CodingPlanInstance> = {}): CodingPlanInstance {
  return {
    instanceType: 'pro',
    status: 'VALID',
    codingPlanQuotaInfo: {
      per5HourTotalQuota: 500,
      per5HourUsedQuota: 100,
      per5HourQuotaNextRefreshTime: 1700000000000,
      perWeekTotalQuota: 3000,
      perWeekUsedQuota: 500,
      perWeekQuotaNextRefreshTime: 1700100000000,
      perBillMonthTotalQuota: 10000,
      perBillMonthUsedQuota: 2000,
      perBillMonthQuotaNextRefreshTime: 1700500000000,
    },
    ...overrides,
  };
}
function response(instances: CodingPlanInstance[]): CodingPlanApiResponse {
  return {
    Success: true,
    DataV2: {
      ret: ['SUCCESS::OK'],
      data: {
        success: true,
        failed: false,
        data: { codingPlanInstanceInfos: instances },
      },
    },
  };
}

describe('CodingplanService', () => {
  const apiClient = {
    callFlatApi: vi.fn<(options: CallFlatApiOptions) => Promise<unknown>>(),
    callEnvelopeApi: vi.fn<ApiClient['callEnvelopeApi']>(),
  };
  const cache: CachedFetcher = {
    getOrFetch: (_key, _ttl, fetcher) => fetcher(),
    invalidate: vi.fn(),
  };
  let service: CodingplanService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new CodingplanService(
      { callFlatApi: apiClient.callFlatApi as unknown as ApiClient['callFlatApi'] },
      createGatewayAdapter(),
      cache,
    );
  });

  it('returns a fully populated CodingPlan DTO for a pro instance', async () => {
    apiClient.callFlatApi.mockResolvedValue(response([instance()]));
    const result = await service.fetchCodingPlan();
    expect(result.subscribed).toBe(true);
    expect(result.plan).toBe('pro');
    expect(result.price).toEqual({ amount: 50, currency: 'USD', cycle: 'monthly' });
    expect(result.windows).toBeDefined();
    expect(result.windows!.per_5h.remaining).toBe(400);
    expect(result.windows!.per_5h.total).toBe(500);
    expect(result.windows!.per_5h.used_pct).toBe(20);
    expect(result.windows!.weekly.remaining).toBe(2500);
    expect(result.windows!.weekly.total).toBe(3000);
    expect(result.windows!.monthly.remaining).toBe(8000);
    expect(result.windows!.monthly.total).toBe(10000);
    expect(result.windows!.monthly.used_pct).toBe(20);
    expect(addDiagnostic).not.toHaveBeenCalled();
  });

  it('returns starter plan pricing for starter instanceType', async () => {
    apiClient.callFlatApi.mockResolvedValue(response([instance({ instanceType: 'starter' })]));
    const result = await service.fetchCodingPlan();
    expect(result.subscribed).toBe(true);
    expect(result.plan).toBe('starter');
    expect(result.price).toEqual({ amount: 10, currency: 'USD', cycle: 'monthly' });
  });
  it('omits price for unknown instance types', async () => {
    apiClient.callFlatApi.mockResolvedValue(response([instance({ instanceType: 'enterprise' })]));
    const result = await service.fetchCodingPlan();
    expect(result.subscribed).toBe(true);
    expect(result.plan).toBe('enterprise');
    expect(result.price).toBeUndefined();
  });
  it('passes the flat Coding Plan request without using envelope wrapping', async () => {
    apiClient.callFlatApi.mockResolvedValue(response([]));
    await service.fetchCodingPlan();
    expect(apiClient.callFlatApi).toHaveBeenCalledExactlyOnceWith({
      product: 'sfm_bailian',
      action: 'IntlBroadScopeAspnGateway',
      params: {
        Api: 'zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2',
        V: '1.0',
        Data: JSON.stringify({
          queryCodingPlanInstanceInfoRequest: {
            commodityCode: 'sfm_codingplan_public_intl',
            onlyLatestOne: true,
          },
          cornerstoneParam: {
            domain: 'mock-api.test.qwencloud.com',
            consoleSite: 'QWENCLOUD',
            console: 'ONE_CONSOLE',
            xsp_lang: 'en-US',
            protocol: 'V2',
            productCode: 'p_efm',
          },
        }),
      },
    });
    expect(apiClient.callEnvelopeApi).not.toHaveBeenCalled();
  });
  it('converts quota refresh timestamps to ISO strings', async () => {
    apiClient.callFlatApi.mockResolvedValue(response([instance()]));
    const result = await service.fetchCodingPlan();
    expect(result.windows!.per_5h.next_reset_at).toBe(new Date(1700000000000).toISOString());
    expect(result.windows!.weekly.next_reset_at).toBe(new Date(1700100000000).toISOString());
    expect(result.windows!.monthly.next_reset_at).toBe(new Date(1700500000000).toISOString());
  });
  it('returns subscribed=false when no instances are returned', async () => {
    apiClient.callFlatApi.mockResolvedValue(response([]));
    const result = await service.fetchCodingPlan();
    expect(result.subscribed).toBe(false);
    expect(result.plan).toBeUndefined();
    expect(result.windows).toBeUndefined();
    expect(addDiagnostic).not.toHaveBeenCalled();
  });
  it.each(['EXPIRED', 'INVALID'])(
    'returns subscribed=false for a confirmed %s instance',
    async (status) => {
      apiClient.callFlatApi.mockResolvedValue(response([instance({ status })]));
      expect(await service.fetchCodingPlan()).toEqual({ subscribed: false });
      expect(addDiagnostic).not.toHaveBeenCalled();
    },
  );
  it('diagnoses a null instances array', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      DataV2: {
        ret: ['SUCCESS::OK'],
        data: { success: true, data: { codingPlanInstanceInfos: null } },
      },
    });
    expect(await service.fetchCodingPlan()).toEqual({ subscribed: false });
    expect(addDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'CodingPlan',
      'Quota query failed (PROTOCOL_ERROR); Coding Plan availability could not be verified.',
      'warn',
    );
  });
  it('degrades to subscribed=false on API error without exposing the message', async () => {
    apiClient.callFlatApi.mockRejectedValue(new Error('private@mock.test.qwencloud.com'));
    expect(await service.fetchCodingPlan()).toEqual({ subscribed: false });
    expect(addDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'CodingPlan',
      'Quota query failed (QUERY_FAILED); Coding Plan availability could not be verified.',
      'warn',
    );
  });
  it('degrades to subscribed=false when response validation throws', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    expect(await service.fetchCodingPlan()).toEqual({ subscribed: false });
    expect(addDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'CodingPlan',
      'Quota query failed (PROTOCOL_ERROR); Coding Plan availability could not be verified.',
      'warn',
    );
  });
  it('handles zero total quota without division-by-zero', async () => {
    apiClient.callFlatApi.mockResolvedValue(
      response([
        instance({
          codingPlanQuotaInfo: {
            per5HourTotalQuota: 0,
            per5HourUsedQuota: 0,
            perWeekTotalQuota: 0,
            perWeekUsedQuota: 0,
            perBillMonthTotalQuota: 0,
            perBillMonthUsedQuota: 0,
          },
        }),
      ]),
    );
    const result = await service.fetchCodingPlan();
    expect(result.subscribed).toBe(true);
    expect(result.windows!.per_5h.used_pct).toBe(0);
    expect(result.windows!.weekly.used_pct).toBe(0);
    expect(result.windows!.monthly.used_pct).toBe(0);
  });
  it('handles missing quotaInfo gracefully', async () => {
    apiClient.callFlatApi.mockResolvedValue(
      response([instance({ codingPlanQuotaInfo: undefined })]),
    );
    const result = await service.fetchCodingPlan();
    expect(result.subscribed).toBe(true);
    expect(result.windows!.per_5h.total).toBe(0);
    expect(result.windows!.per_5h.remaining).toBe(0);
  });
  it('returns empty next_reset_at when refresh time is undefined', async () => {
    apiClient.callFlatApi.mockResolvedValue(
      response([
        instance({
          codingPlanQuotaInfo: {
            per5HourTotalQuota: 100,
            per5HourUsedQuota: 10,
            perWeekTotalQuota: 500,
            perWeekUsedQuota: 50,
            perBillMonthTotalQuota: 2000,
            perBillMonthUsedQuota: 200,
          },
        }),
      ]),
    );
    const result = await service.fetchCodingPlan();
    expect(result.windows!.per_5h.next_reset_at).toBe('');
    expect(result.windows!.weekly.next_reset_at).toBe('');
    expect(result.windows!.monthly.next_reset_at).toBe('');
  });
  it('defaults instanceType to unknown when absent', async () => {
    apiClient.callFlatApi.mockResolvedValue(response([instance({ instanceType: undefined })]));
    const result = await service.fetchCodingPlan();
    expect(result.subscribed).toBe(true);
    expect(result.plan).toBe('unknown');
  });
  it('reports business failure despite gateway SUCCESS without exposing server messages', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      DataV2: {
        ret: ['SUCCESS::OK'],
        data: {
          success: false,
          failed: true,
          errorCode: '100005',
          errorMsg: 'private@mock.test.qwencloud.com',
        },
      },
    });
    expect(await service.fetchCodingPlan()).toEqual({ subscribed: false });
    expect(addDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'CodingPlan',
      'Quota query failed (100005); Coding Plan availability could not be verified.',
      'warn',
    );
  });
  it('keeps first-instance selection when a later instance is valid', async () => {
    apiClient.callFlatApi.mockResolvedValue(
      response([instance({ status: 'INVALID' }), instance()]),
    );
    expect(await service.fetchCodingPlan()).toEqual({ subscribed: false });
    expect(addDiagnostic).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { Success: false, DataV2: { ret: ['SUCCESS::OK'] } },
    { DataV2: { ret: [] } },
    { DataV2: { ret: ['MOCK_FAILURE::private response'] } },
    { DataV2: { ret: ['SUCCESS::OK'], data: { data: { codingPlanInstanceInfos: [] } } } },
    {
      DataV2: {
        ret: ['SUCCESS::OK'],
        data: { success: true, failed: true, data: { codingPlanInstanceInfos: [] } },
      },
    },
    { DataV2: { ret: ['SUCCESS::OK'], data: { success: true, data: {} } } },
    {
      DataV2: {
        ret: ['SUCCESS::OK'],
        data: {
          success: true,
          data: { DataV2: { data: { data: { codingPlanInstanceInfos: [] } } } },
        },
      },
    },
    {
      DataV2: {
        ret: ['SUCCESS::OK'],
        data: { success: true, data: { codingPlanInstanceInfos: [null] } },
      },
    },
    response([{ instanceType: 'pro' }]),
    response([instance({ codingPlanQuotaInfo: { per5HourTotalQuota: NaN } })]),
    response([instance({ codingPlanQuotaInfo: { per5HourTotalQuota: Infinity } })]),
    {
      DataV2: {
        ret: ['SUCCESS::OK'],
        data: {
          success: true,
          data: {
            codingPlanInstanceInfos: [
              { status: 'VALID', codingPlanQuotaInfo: { per5HourTotalQuota: '100' } },
            ],
          },
        },
      },
    },
  ])('warns on an unverified response: %#', async (raw) => {
    apiClient.callFlatApi.mockResolvedValue(raw);
    expect(await service.fetchCodingPlan()).toEqual({ subscribed: false });
    expect(addDiagnostic).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addDiagnostic).mock.calls[0]?.[2]).toBe('warn');
  });
});

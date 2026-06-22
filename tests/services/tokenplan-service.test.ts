/** Unit tests for TokenplanService. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import type {
  FrInstanceItem,
  FrInstanceResponse,
  GetSeatSubscriptionSummaryResponse,
  QuerySubscriptionGrayResponse,
} from '../../src/types/api-models.js';
import { TokenplanService } from '../../src/services/tokenplan-service.js';
import type { ApiClient } from '../../src/api/api-client.js';

// Mock site module for tokenPlanCommodityCodes
vi.mock('../../src/site.js', () => ({
  site: {
    features: {
      tokenPlanCommodityCodes: {
        teams: 'sfm_tokenplanteams_dp_intl',
        personal: 'sfm_tokenplanpersonal_dp_intl',
        addon: 'sfm_tokenplanteamsaddon_dp_intl',
      },
    },
  },
}));

vi.mock('../../src/api/debug-buffer.js', () => ({
  addDiagnostic: vi.fn(),
}));

// ────────────────────────────────────────────────────────────────────
// Mock factory helpers
// ────────────────────────────────────────────────────────────────────

function makeFrInstanceItem(overrides: Partial<FrInstanceItem> = {}): FrInstanceItem {
  return {
    InstanceId: 'inst-001',
    CommodityCode: 'sfm_tokenplanteams_dp_intl',
    CommodityName: 'Token Plan Team (Monthly)',
    TemplateName: 'Team Plan Monthly',
    Status: { Code: 'valid', Name: 'Active' },
    InitCapacityBaseValue: '10000000',
    CurrCapacityBaseValue: '7500000',
    periodCapacityBaseValue: '10000000',
    CapacityTypeCode: 'token',
    EndTime: Date.now() + 86400000 * 30,
    EnableRenew: true,
    ...overrides,
  };
}

function makeCachedFetcher(): CachedFetcher {
  return {
    getOrFetch: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()) as CachedFetcher['getOrFetch'],
    invalidate: vi.fn(),
  };
}

function makeMockApiClient() {
  return { callFlatApi: vi.fn() };
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe('TokenplanService', () => {
  let apiClient: ReturnType<typeof makeMockApiClient>;
  let cache: CachedFetcher;
  let service: TokenplanService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    cache = makeCachedFetcher();
    service = new TokenplanService(apiClient as unknown as ApiClient, cache);
    // Default: non-gray path — consumed by the initial QuerySubscriptionGray call
    apiClient.callFlatApi.mockResolvedValueOnce({ IsGray: false } as QuerySubscriptionGrayResponse);
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchTokenPlan — success paths
  // ──────────────────────────────────────────────────────────────────

  describe('fetchTokenPlan — success paths', () => {
    it('selects the first valid instance and computes capacity correctly', async () => {
      const validInstance = makeFrInstanceItem({
        InstanceId: 'team-valid',
        Status: { Code: 'valid' },
        InitCapacityBaseValue: '10000000',
        CurrCapacityBaseValue: '7500000',
        CapacityTypeCode: 'token',
        EndTime: 1800000000000,
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [validInstance] } as FrInstanceResponse) // teams
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse) // personal
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse); // addon

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.planName).toBe('Team Plan Monthly');
      expect(result.status).toBe('valid');
      expect(result.totalCredits).toBe(10000000);
      expect(result.remainingCredits).toBe(7500000);
      expect(result.usedPct).toBe(25);
      expect(result.resetDate).toBe(new Date(1800000000000).toISOString());
    });

    it('issues gray check plus three concurrent API calls for teams, personal, addon', async () => {
      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      await service.fetchTokenPlan();

      expect(apiClient.callFlatApi).toHaveBeenCalledTimes(4);
      expect(apiClient.callFlatApi).toHaveBeenCalledWith(
        expect.objectContaining({
          product: 'BssOpenAPI-V3',
          action: 'QuerySubscriptionGray',
        }),
      );
      expect(apiClient.callFlatApi).toHaveBeenCalledWith(
        expect.objectContaining({
          product: 'BssOpenAPI-V3',
          action: 'DescribeFrInstances',
          params: expect.objectContaining({ CommodityCode: 'sfm_tokenplanteams_dp_intl' }),
        }),
      );
      expect(apiClient.callFlatApi).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ CommodityCode: 'sfm_tokenplanpersonal_dp_intl' }),
        }),
      );
      expect(apiClient.callFlatApi).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ CommodityCode: 'sfm_tokenplanteamsaddon_dp_intl' }),
        }),
      );
    });

    it('selects valid instance from personal when teams has no valid', async () => {
      const expiredTeam = makeFrInstanceItem({ Status: { Code: 'expired' } });
      const validPersonal = makeFrInstanceItem({
        InstanceId: 'personal-valid',
        Status: { Code: 'valid' },
        TemplateName: 'Personal Monthly',
        CommodityName: undefined,
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [expiredTeam] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [validPersonal] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.planName).toBe('Personal Monthly');
    });

    it('sums addon remaining capacity across all addon instances', async () => {
      const validInstance = makeFrInstanceItem({ Status: { Code: 'valid' } });
      const addon1 = makeFrInstanceItem({ CurrCapacityBaseValue: '1000000' });
      const addon2 = makeFrInstanceItem({ CurrCapacityBaseValue: '500000' });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [validInstance] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [addon1, addon2] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.addonRemaining).toBe(1500000);
    });

    it('uses periodCapacityBaseValue for periodMonthlyShift capacity type', async () => {
      const instance = makeFrInstanceItem({
        Status: { Code: 'valid' },
        CapacityTypeCode: 'periodMonthlyShift',
        InitCapacityBaseValue: '5000000',
        periodCapacityBaseValue: '4000000',
        CurrCapacityBaseValue: '3000000',
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [instance] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.remainingCredits).toBe(4000000);
      expect(result.totalCredits).toBe(5000000);
      expect(result.usedPct).toBe(20);
    });

    it('handles Status as string format (legacy)', async () => {
      const instance = makeFrInstanceItem({
        Status: 'valid' as unknown as FrInstanceItem['Status'],
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [instance] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.status).toBe('valid');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchTokenPlan — no valid instance
  // ──────────────────────────────────────────────────────────────────

  describe('fetchTokenPlan — no valid instance', () => {
    it('returns subscribed=false when all commodities return empty data', async () => {
      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(false);
      expect(result.planName).toBeUndefined();
    });

    it('returns subscribed=false with addonRemaining when only addon has capacity', async () => {
      const addon = makeFrInstanceItem({ CurrCapacityBaseValue: '2000000' });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [addon] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(false);
      expect(result.addonRemaining).toBe(2000000);
    });

    it('falls back to first instance when none has valid status', async () => {
      const expired = makeFrInstanceItem({
        Status: { Code: 'expired' },
        TemplateName: 'Expired Plan',
        InitCapacityBaseValue: '5000000',
        CurrCapacityBaseValue: '0',
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [expired] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(false);
      expect(result.planName).toBe('Expired Plan');
      expect(result.status).toBe('expired');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchTokenPlan — error handling
  // ──────────────────────────────────────────────────────────────────

  describe('fetchTokenPlan — error handling', () => {
    it('degrades to subscribed=false when API throws', async () => {
      apiClient.callFlatApi.mockRejectedValue(new Error('API rate limited'));

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(false);
    });

    it('degrades gracefully when one commodity call fails but others succeed', async () => {
      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse) // teams OK
        .mockRejectedValueOnce(new Error('timeout')) // personal fails
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse); // addon OK

      const result = await service.fetchTokenPlan();

      // Promise.all rejects if any one fails, so entire fetch degrades
      expect(result.subscribed).toBe(false);
    });

    it('handles null API response gracefully', async () => {
      apiClient.callFlatApi
        .mockResolvedValueOnce(null) // teams returns null
        .mockResolvedValueOnce(null) // personal returns null
        .mockResolvedValueOnce(null); // addon returns null

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchTokenPlan — edge cases
  // ──────────────────────────────────────────────────────────────────

  describe('fetchTokenPlan — edge cases', () => {
    it('handles zero total capacity without division-by-zero', async () => {
      const instance = makeFrInstanceItem({
        Status: { Code: 'valid' },
        InitCapacityBaseValue: '0',
        CurrCapacityBaseValue: '0',
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [instance] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.usedPct).toBe(0);
      expect(result.totalCredits).toBe(0);
    });

    it('omits resetDate when EndTime is undefined', async () => {
      const instance = makeFrInstanceItem({
        Status: { Code: 'valid' },
        EndTime: undefined,
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [instance] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.resetDate).toBeUndefined();
    });

    it('uses CommodityName over TemplateName for planName', async () => {
      const instance = makeFrInstanceItem({
        Status: { Code: 'valid' },
        TemplateName: 'Template A',
        CommodityName: 'Commodity B',
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [instance] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.planName).toBe('Template A');
    });

    it('falls back to CommodityName when TemplateName is absent', async () => {
      const instance = makeFrInstanceItem({
        Status: { Code: 'valid' },
        TemplateName: undefined,
        CommodityName: 'Fallback Name',
      });

      apiClient.callFlatApi
        .mockResolvedValueOnce({ Data: [instance] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.planName).toBe('Fallback Name');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // fetchTokenPlan — gray-scale path
  // ──────────────────────────────────────────────────────────────────

  describe('fetchTokenPlan — gray-scale path', () => {
    it('routes to GetSeatSubscriptionSummary when gray and aggregates multi-group credits', async () => {
      // Override the default non-gray mock by resetting and re-mocking
      apiClient.callFlatApi.mockReset();
      apiClient.callFlatApi
        // gray check
        .mockResolvedValueOnce({ IsGray: true } as QuerySubscriptionGrayResponse)
        // GetSeatSubscriptionSummary
        .mockResolvedValueOnce({
          Data: {
            PlanName: 'Team Pro',
            EndTime: 1800000000000,
            SubscriptionGroupList: [
              {
                SpecType: 'standard',
                EquityList: [{ TotalValue: '175000', SurplusValue: '100000' }],
              },
              {
                SpecType: 'pro',
                EquityList: [{ TotalValue: '400000', SurplusValue: '300000' }],
              },
            ],
          },
        } as GetSeatSubscriptionSummaryResponse)
        // addon (DescribeFrInstances)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.planName).toBe('Team Pro');
      expect(result.status).toBe('valid');
      expect(result.totalCredits).toBe(575000);
      expect(result.remainingCredits).toBe(400000);
      expect(result.usedPct).toBe(30);
      expect(result.resetDate).toBe(new Date(1800000000000).toISOString());
    });

    it('includes addon remaining from DescribeFrInstances in gray path', async () => {
      apiClient.callFlatApi.mockReset();
      apiClient.callFlatApi
        .mockResolvedValueOnce({ IsGray: true } as QuerySubscriptionGrayResponse)
        .mockResolvedValueOnce({
          Data: {
            PlanName: 'Team Plan',
            SubscriptionGroupList: [
              { SpecType: 'standard', EquityList: [{ TotalValue: '100000', SurplusValue: '80000' }] },
            ],
          },
        } as GetSeatSubscriptionSummaryResponse)
        .mockResolvedValueOnce({
          Data: [
            makeFrInstanceItem({ CurrCapacityBaseValue: '50000' }),
            makeFrInstanceItem({ CurrCapacityBaseValue: '30000' }),
          ],
        } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.addonRemaining).toBe(80000);
    });

    it('falls back to legacy path when QuerySubscriptionGray fails', async () => {
      apiClient.callFlatApi.mockReset();
      apiClient.callFlatApi
        // gray check fails
        .mockRejectedValueOnce(new Error('network error'))
        // legacy path: teams, personal, addon
        .mockResolvedValueOnce({ Data: [makeFrInstanceItem({ Status: { Code: 'valid' } })] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
    });

    it('returns subscribed=false when gray path has empty SubscriptionGroupList', async () => {
      apiClient.callFlatApi.mockReset();
      apiClient.callFlatApi
        .mockResolvedValueOnce({ IsGray: true } as QuerySubscriptionGrayResponse)
        .mockResolvedValueOnce({
          Data: { PlanName: 'Empty Plan', SubscriptionGroupList: [] },
        } as GetSeatSubscriptionSummaryResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(false);
      expect(result.planName).toBe('Empty Plan');
      expect(result.totalCredits).toBe(0);
    });

    it('uses group-level TotalValue/SurplusValue when EquityList is empty', async () => {
      apiClient.callFlatApi.mockReset();
      apiClient.callFlatApi
        .mockResolvedValueOnce({ IsGray: true } as QuerySubscriptionGrayResponse)
        .mockResolvedValueOnce({
          Data: {
            PlanName: 'Legacy Shape',
            SubscriptionGroupList: [
              { SpecType: 'standard', TotalValue: '200000', SurplusValue: '150000' },
            ],
          },
        } as GetSeatSubscriptionSummaryResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.subscribed).toBe(true);
      expect(result.totalCredits).toBe(200000);
      expect(result.remainingCredits).toBe(150000);
      expect(result.usedPct).toBe(25);
    });

    it('defaults planName to Token Plan when PlanName is absent', async () => {
      apiClient.callFlatApi.mockReset();
      apiClient.callFlatApi
        .mockResolvedValueOnce({ IsGray: true } as QuerySubscriptionGrayResponse)
        .mockResolvedValueOnce({
          Data: {
            SubscriptionGroupList: [
              { SpecType: 'basic', EquityList: [{ TotalValue: '100', SurplusValue: '50' }] },
            ],
          },
        } as GetSeatSubscriptionSummaryResponse)
        .mockResolvedValueOnce({ Data: [] } as FrInstanceResponse);

      const result = await service.fetchTokenPlan();

      expect(result.planName).toBe('Token Plan');
    });
  });
});

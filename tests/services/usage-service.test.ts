/**
 * Unit tests for UsageService (src/services/usage-service.ts).
 *
 * Covers:
 *   - getUsageSummary: concurrent fan-out to 4 sub-services
 *   - getUsageBreakdown: delegation to BillingService
 *   - getUsageLogs: direct API call + response normalization
 *   - splitIntoMonths: date-range slicing utility (re-exported)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageService, splitIntoMonths } from '../../src/services/usage-service.js';
import type { ApiClient } from '../../src/api/api-client.js';
import type { BillingService } from '../../src/services/billing-service.js';
import type { FreetierService } from '../../src/services/freetier-service.js';
import type { CodingplanService } from '../../src/services/codingplan-service.js';
import type { TokenplanService } from '../../src/services/tokenplan-service.js';
import type { FreeTierUsage, CodingPlan, TokenPlan, PayAsYouGo } from '../../src/types/usage.js';

// ────────────────────────────────────────────────────────────────────
// Mock factory helpers
// ────────────────────────────────────────────────────────────────────

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
  callEnvelopeApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return {
    callFlatApi: vi.fn(),
    callEnvelopeApi: vi.fn(),
  };
}

interface MockBillingService {
  getPaygSummary: ReturnType<typeof vi.fn>;
  getPaygBreakdown: ReturnType<typeof vi.fn>;
}

function makeMockBillingService(): MockBillingService {
  return {
    getPaygSummary: vi.fn(),
    getPaygBreakdown: vi.fn(),
  };
}

interface MockFreetierService {
  fetchFreeTierUsageList: ReturnType<typeof vi.fn>;
}

function makeMockFreetierService(): MockFreetierService {
  return {
    fetchFreeTierUsageList: vi.fn(),
  };
}

interface MockCodingplanService {
  fetchCodingPlan: ReturnType<typeof vi.fn>;
}

function makeMockCodingplanService(): MockCodingplanService {
  return { fetchCodingPlan: vi.fn() };
}

interface MockTokenplanService {
  fetchTokenPlan: ReturnType<typeof vi.fn>;
}

function makeMockTokenplanService(): MockTokenplanService {
  return { fetchTokenPlan: vi.fn() };
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe('UsageService', () => {
  let apiClient: MockApiClient;
  let billingService: MockBillingService;
  let freetierService: MockFreetierService;
  let codingplanService: MockCodingplanService;
  let tokenplanService: MockTokenplanService;
  let service: UsageService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    billingService = makeMockBillingService();
    freetierService = makeMockFreetierService();
    codingplanService = makeMockCodingplanService();
    tokenplanService = makeMockTokenplanService();
    service = new UsageService(
      apiClient as unknown as ApiClient,
      billingService as unknown as BillingService,
      freetierService as unknown as FreetierService,
      codingplanService as unknown as CodingplanService,
      tokenplanService as unknown as TokenplanService,
    );
  });

  // ──────────────────────────────────────────────────────────────────
  // getUsageSummary
  // ──────────────────────────────────────────────────────────────────

  describe('getUsageSummary', () => {
    const mockFreeTier: FreeTierUsage[] = [
      { model_id: 'qwen-plus', quota: { remaining: 900000, total: 1000000, unit: 'tokens', used_pct: 10, status: 'valid', resetDate: '2026-06-01T00:00:00Z' } },
    ];
    const mockCodingPlan: CodingPlan = { subscribed: false };
    const mockTokenPlan: TokenPlan = { subscribed: false };
    const mockPayg: PayAsYouGo = {
      models: [{ model_id: 'qwen-plus', usage: { tokens_in: 1000, tokens_out: 500 }, cost: 0.05, currency: 'USD' }],
      total: { cost: 0.05, currency: 'USD' },
    };

    it('aggregates all sub-service results into a unified summary', async () => {
      freetierService.fetchFreeTierUsageList.mockResolvedValue(mockFreeTier);
      codingplanService.fetchCodingPlan.mockResolvedValue(mockCodingPlan);
      tokenplanService.fetchTokenPlan.mockResolvedValue(mockTokenPlan);
      billingService.getPaygSummary.mockResolvedValue(mockPayg);

      const result = await service.getUsageSummary({ from: '2026-05-01', to: '2026-05-23' });

      expect(result.period).toEqual({ from: '2026-05-01', to: '2026-05-23' });
      expect(result.free_tier).toEqual(mockFreeTier);
      expect(result.coding_plan).toEqual(mockCodingPlan);
      expect(result.token_plan).toEqual(mockTokenPlan);
      expect(result.pay_as_you_go).toEqual(mockPayg);
    });

    it('calls all sub-services concurrently', async () => {
      freetierService.fetchFreeTierUsageList.mockResolvedValue([]);
      codingplanService.fetchCodingPlan.mockResolvedValue({ subscribed: false });
      tokenplanService.fetchTokenPlan.mockResolvedValue({ subscribed: false });
      billingService.getPaygSummary.mockResolvedValue({ models: [], total: { cost: 0, currency: 'USD' } });

      await service.getUsageSummary({ from: '2026-05-01', to: '2026-05-31' });

      expect(freetierService.fetchFreeTierUsageList).toHaveBeenCalledTimes(1);
      expect(codingplanService.fetchCodingPlan).toHaveBeenCalledTimes(1);
      expect(tokenplanService.fetchTokenPlan).toHaveBeenCalledTimes(1);
      expect(billingService.getPaygSummary).toHaveBeenCalledWith({ from: '2026-05-01', to: '2026-05-31' });
    });

    it('returns empty data when all sub-services return empty', async () => {
      freetierService.fetchFreeTierUsageList.mockResolvedValue([]);
      codingplanService.fetchCodingPlan.mockResolvedValue({ subscribed: false });
      tokenplanService.fetchTokenPlan.mockResolvedValue({ subscribed: false });
      billingService.getPaygSummary.mockResolvedValue({ models: [], total: { cost: 0, currency: 'USD' } });

      const result = await service.getUsageSummary({ from: '2026-05-01', to: '2026-05-31' });

      expect(result.free_tier).toHaveLength(0);
      expect(result.pay_as_you_go.models).toHaveLength(0);
      expect(result.pay_as_you_go.total.cost).toBe(0);
    });

    it('propagates errors from sub-services', async () => {
      freetierService.fetchFreeTierUsageList.mockRejectedValue(new Error('freetier failure'));
      codingplanService.fetchCodingPlan.mockResolvedValue({ subscribed: false });
      tokenplanService.fetchTokenPlan.mockResolvedValue({ subscribed: false });
      billingService.getPaygSummary.mockResolvedValue({ models: [], total: { cost: 0, currency: 'USD' } });

      await expect(service.getUsageSummary()).rejects.toThrow('freetier failure');
    });

    it('defaults to month-to-date when no dates specified', async () => {
      freetierService.fetchFreeTierUsageList.mockResolvedValue([]);
      codingplanService.fetchCodingPlan.mockResolvedValue({ subscribed: false });
      tokenplanService.fetchTokenPlan.mockResolvedValue({ subscribed: false });
      billingService.getPaygSummary.mockResolvedValue({ models: [], total: { cost: 0, currency: 'USD' } });

      const result = await service.getUsageSummary();

      // period.from should be first of current month (YYYY-MM-01)
      expect(result.period.from).toMatch(/^\d{4}-\d{2}-01$/);
      // period.to should be today (YYYY-MM-DD)
      expect(result.period.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // getUsageBreakdown
  // ──────────────────────────────────────────────────────────────────

  describe('getUsageBreakdown', () => {
    it('delegates to billingService.getPaygBreakdown with correct params', async () => {
      const breakdownResponse = {
        model_id: 'qwen-plus',
        period: { from: '2026-05-01', to: '2026-05-31' },
        granularity: 'day' as const,
        rows: [{ period: '2026-05-01', tokens_in: 100, tokens_out: 50, cost: 0.001, currency: 'USD' }],
        total: { tokens_in: 100, tokens_out: 50, cost: 0.001, currency: 'USD' },
      };
      billingService.getPaygBreakdown.mockResolvedValue(breakdownResponse);

      const result = await service.getUsageBreakdown({
        model: 'qwen-plus',
        from: '2026-05-01',
        to: '2026-05-31',
        granularity: 'day',
      });

      expect(result).toEqual(breakdownResponse);
      expect(billingService.getPaygBreakdown).toHaveBeenCalledWith({
        from: '2026-05-01',
        to: '2026-05-31',
        granularity: 'day',
        modelFilter: 'qwen-plus',
      });
    });

    it('defaults granularity to day when not specified', async () => {
      billingService.getPaygBreakdown.mockResolvedValue({
        model_id: 'qwen-plus',
        period: { from: '2026-05-01', to: '2026-05-31' },
        granularity: 'day',
        rows: [],
        total: {},
      });

      await service.getUsageBreakdown({ model: 'qwen-plus', from: '2026-05-01', to: '2026-05-31' });

      expect(billingService.getPaygBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({ granularity: 'day' }),
      );
    });

    it('supports monthly granularity', async () => {
      billingService.getPaygBreakdown.mockResolvedValue({
        model_id: 'qwen-plus',
        period: { from: '2026-01-01', to: '2026-05-31' },
        granularity: 'month',
        rows: [
          { period: '2026-04', cost: 0.5 },
          { period: '2026-05', cost: 0.4 },
        ],
        total: { cost: 0.9 },
      });

      const result = await service.getUsageBreakdown({
        model: 'qwen-plus',
        from: '2026-01-01',
        to: '2026-05-31',
        granularity: 'month',
      });

      expect(result.rows).toHaveLength(2);
    });

    it('propagates errors from billingService', async () => {
      billingService.getPaygBreakdown.mockRejectedValue(new Error('billing timeout'));

      await expect(
        service.getUsageBreakdown({ model: 'qwen-plus', from: '2026-05-01', to: '2026-05-31' }),
      ).rejects.toThrow('billing timeout');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // getUsageLogs
  // ──────────────────────────────────────────────────────────────────

  describe('getUsageLogs', () => {
    it('returns normalized log items from API response', async () => {
      const ms = Date.UTC(2026, 4, 20, 14, 30, 0, 123);
      apiClient.callEnvelopeApi.mockResolvedValue({
        totalCount: 1,
        maxResults: 20,
        list: [{
          originLog: {
            request_id: 'req-123',
            model: 'qwen-plus',
            start_unix_timestamp: String(ms),
            start_time: '2026-05-20 14:30:00.123',
            status_code: '200',
            duration: '150',
          },
          formattedUsages: [
            { key: 'input_tokens', unit: 'tokens', value: 100 },
            { key: 'output_tokens', unit: 'tokens', value: 50 },
          ],
        }],
      });

      const result = await service.getUsageLogs({ from: '2026-05-20', to: '2026-05-21' });

      expect(result.totalCount).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].requestId).toBe('req-123');
      expect(result.items[0].model).toBe('qwen-plus');
      // createdAt is the local-timezone ISO8601 form derived from start_unix_timestamp.
      expect(result.items[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/,
      );
      // Round-trips to the original epoch (timezone-agnostic).
      expect(new Date(result.items[0].createdAt).getTime()).toBe(
        Math.floor(ms / 1000) * 1000,
      );
      expect(result.items[0].statusCode).toBe(200);
      expect(result.items[0].durationMs).toBe(150);
      expect(result.items[0].usages).toHaveLength(2);
      expect(result.items[0].usages[0]).toEqual({ key: 'input', value: 100 });
      expect(result.items[0].usages[1]).toEqual({ key: 'output', value: 50 });
    });

    it('falls back to start_time when start_unix_timestamp is missing', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({
        totalCount: 1,
        maxResults: 20,
        list: [{
          originLog: {
            request_id: 'req-legacy',
            model: 'qwen-plus',
            start_time: '2026-05-20 14:30:00.123',
            status_code: '200',
            duration: '150',
          },
          formattedUsages: [],
        }],
      });

      const result = await service.getUsageLogs({ from: '2026-05-20', to: '2026-05-21' });

      expect(result.items[0].createdAt).toBe('2026-05-20T14:30:00Z');
    });

    it('handles empty API response', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue(null);

      const result = await service.getUsageLogs({ from: '2026-05-01', to: '2026-05-31' });

      expect(result.totalCount).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('clamps page and pageSize to valid ranges', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({ totalCount: 0, maxResults: 20, list: [] });

      const result = await service.getUsageLogs({ from: '2026-05-01', to: '2026-05-31', page: -1, pageSize: 999 });

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      const callArgs = apiClient.callEnvelopeApi.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArgs.data.maxResults).toBe(100);
      expect(callArgs.data.skip).toBe(0);
    });

    it('passes modelRequestId when specified (short-circuits filters)', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({ totalCount: 1, maxResults: 20, list: [] });

      await service.getUsageLogs({
        from: '2026-05-01',
        to: '2026-05-31',
        modelRequestId: 'req-abc',
        models: ['qwen-plus'],
      });

      const callArgs = apiClient.callEnvelopeApi.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArgs.data.modelRequestId).toBe('req-abc');
      expect(callArgs.data.models).toBeUndefined();
    });

    it('passes models and statusCodeTypes filters when no requestId', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({ totalCount: 0, maxResults: 20, list: [] });

      await service.getUsageLogs({
        from: '2026-05-01',
        to: '2026-05-31',
        models: ['qwen-plus', 'qwen-max'],
        statusCodeTypes: ['SUCCESS', 'CLIENT_ERROR'],
      });

      const callArgs = apiClient.callEnvelopeApi.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArgs.data.models).toEqual(['qwen-plus', 'qwen-max']);
      expect(callArgs.data.statusCodeTypes).toEqual(['SUCCESS', 'CLIENT_ERROR']);
    });

    it('filters out zero-value usages', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({
        totalCount: 1,
        maxResults: 20,
        list: [{
          originLog: { request_id: 'req-1', model: 'qwen-plus', start_time: '2026-05-20 10:00:00', status_code: '200', duration: '100' },
          formattedUsages: [
            { key: 'input_tokens', unit: 'tokens', value: 100 },
            { key: 'output_tokens', unit: 'tokens', value: 0 },
            { key: 'total_tokens', unit: 'tokens', value: -5 },
          ],
        }],
      });

      const result = await service.getUsageLogs({ from: '2026-05-20', to: '2026-05-21' });

      expect(result.items[0].usages).toHaveLength(1);
      expect(result.items[0].usages[0].key).toBe('input');
    });

    it('normalizes usage keys (strips _tokens/_count suffix)', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({
        totalCount: 1,
        maxResults: 20,
        list: [{
          originLog: { request_id: 'req-1', model: 'm', start_time: '2026-05-20 10:00:00', status_code: '200', duration: '50' },
          formattedUsages: [
            { key: 'total_tokens', unit: 'tokens', value: 200 },
            { key: 'image_count', unit: 'images', value: 3 },
          ],
        }],
      });

      const result = await service.getUsageLogs({ from: '2026-05-20', to: '2026-05-21' });

      expect(result.items[0].usages[0].key).toBe('total');
      expect(result.items[0].usages[1].key).toBe('image');
    });

    it('echoes the query period in response', async () => {
      apiClient.callEnvelopeApi.mockResolvedValue({ totalCount: 0, maxResults: 20, list: [] });

      const result = await service.getUsageLogs({ from: '2026-05-10', to: '2026-05-20' });

      expect(result.period).toEqual({ from: '2026-05-10', to: '2026-05-20' });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // splitIntoMonths — date range slicing algorithm
  // ──────────────────────────────────────────────────────────────────

  describe('splitIntoMonths', () => {
    it('returns a single slice when both dates are in the same month', () => {
      expect(splitIntoMonths('2026-05-01', '2026-05-31')).toEqual([
        ['2026-05-01', '2026-05-31'],
      ]);
    });

    it('returns a single slice for a partial month', () => {
      expect(splitIntoMonths('2026-05-10', '2026-05-20')).toEqual([
        ['2026-05-10', '2026-05-20'],
      ]);
    });

    it('splits a range spanning two months', () => {
      expect(splitIntoMonths('2026-04-15', '2026-05-10')).toEqual([
        ['2026-04-15', '2026-04-30'],
        ['2026-05-01', '2026-05-10'],
      ]);
    });

    it('splits a range spanning three months', () => {
      expect(splitIntoMonths('2026-01-15', '2026-03-10')).toEqual([
        ['2026-01-15', '2026-01-31'],
        ['2026-02-01', '2026-02-28'],
        ['2026-03-01', '2026-03-10'],
      ]);
    });

    it('handles leap-year February correctly', () => {
      expect(splitIntoMonths('2024-01-15', '2024-03-05')).toEqual([
        ['2024-01-15', '2024-01-31'],
        ['2024-02-01', '2024-02-29'],
        ['2024-03-01', '2024-03-05'],
      ]);
    });

    it('handles a year-boundary crossing', () => {
      expect(splitIntoMonths('2025-12-25', '2026-01-05')).toEqual([
        ['2025-12-25', '2025-12-31'],
        ['2026-01-01', '2026-01-05'],
      ]);
    });

    it('handles a single-day range', () => {
      expect(splitIntoMonths('2026-05-15', '2026-05-15')).toEqual([
        ['2026-05-15', '2026-05-15'],
      ]);
    });
  });
});

/**
 * Unit tests for BillingService.getOuterPaymentMethods().
 *
 * Validates: API parameter construction with hardcoded PageSize=100,
 * PascalCase→camelCase DTO conversion, security field exclusion,
 * and empty/undefined list handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedFetcher } from '../../src/types/cache.js';
import { BillingService } from '../../src/services/billing-service.js';
import type { ApiClient } from '../../src/api/api-client.js';

// ─── Mock factories ──────────────────────────────────────────────────────────

function makeCachedFetcher(): CachedFetcher & {
  getOrFetch: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
} {
  return {
    getOrFetch: vi.fn(async <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) => fetcher()),
    invalidate: vi.fn(),
  };
}

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn() };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let apiClient: MockApiClient;
let cache: ReturnType<typeof makeCachedFetcher>;
let service: BillingService;

beforeEach(() => {
  apiClient = makeMockApiClient();
  cache = makeCachedFetcher();
  service = new BillingService(apiClient as unknown as ApiClient, undefined as never, cache);
});

// ─── Fixtures (simulating raw API response) ──────────────────────────────────

const FULL_API_RESPONSE = {
  TotalCount: 2,
  CurrentPage: 1,
  PageSize: 100,
  Data: [
    {
      PaymentMethodId: 'enc_abc123_secret',
      PaymentTypeName: 'Credit Card',
      CardBrand: 'CREDIT',
      PaymentMethodName: '000000******0001',
      Status: 'VALID',
      IsDefault: true,
      Currency: 'USD',
      GmtCreate: '2025-01-15T10:00:00Z',
      PaymentType: 'CARD',
      UserId: 123456789,
      PId: 9876,
      Bid: 'bid_internal_xyz',
    },
    {
      PaymentMethodId: 'enc_def456_secret',
      PaymentTypeName: 'Credit Card',
      CardBrand: 'DEBIT',
      PaymentMethodName: '000000******0002',
      Status: 'EXPIRED',
      IsDefault: false,
      Currency: 'USD',
      GmtCreate: '2025-03-20T14:30:00Z',
      PaymentType: 'CARD',
      UserId: 123456789,
      PId: 9876,
      Bid: 'bid_internal_xyz',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Normal response conversion
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingService.getOuterPaymentMethods — normal response', () => {
  it('converts PascalCase DTO to camelCase business model', async () => {
    apiClient.callFlatApi.mockResolvedValue(FULL_API_RESPONSE);
    const result = await service.getOuterPaymentMethods();

    expect(result.items).toHaveLength(2);

    expect(result.items[0]).toMatchObject({
      paymentTypeName: 'Credit Card',
      cardBrand: 'CREDIT',
      paymentMethodName: '000000******0001',
      status: 'VALID',
    });
  });

  it('excludes security-sensitive fields from result items', async () => {
    apiClient.callFlatApi.mockResolvedValue(FULL_API_RESPONSE);
    const result = await service.getOuterPaymentMethods();

    const item = result.items[0] as Record<string, unknown>;
    expect(item).not.toHaveProperty('PaymentMethodId');
    expect(item).not.toHaveProperty('paymentMethodId');
    expect(item).not.toHaveProperty('UserId');
    expect(item).not.toHaveProperty('userId');
    expect(item).not.toHaveProperty('PId');
    expect(item).not.toHaveProperty('pId');
    expect(item).not.toHaveProperty('Bid');
    expect(item).not.toHaveProperty('bid');
  });

  it('preserves multiple items with distinct statuses', async () => {
    apiClient.callFlatApi.mockResolvedValue(FULL_API_RESPONSE);
    const result = await service.getOuterPaymentMethods();

    expect(result.items[0].status).toBe('VALID');
    expect(result.items[1].status).toBe('EXPIRED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty list handling
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingService.getOuterPaymentMethods — empty list', () => {
  it('handles TotalCount=0 with empty Data array', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      TotalCount: 0,
      CurrentPage: 1,
      PageSize: 100,
      Data: [],
    });
    const result = await service.getOuterPaymentMethods();
    expect(result.items).toEqual([]);
  });

  it('handles undefined Data field gracefully', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      TotalCount: 0,
      CurrentPage: 1,
      PageSize: 100,
    });
    const result = await service.getOuterPaymentMethods();
    expect(result.items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardcoded PageSize=100
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingService.getOuterPaymentMethods — fixed PageSize', () => {
  beforeEach(() => {
    apiClient.callFlatApi.mockResolvedValue({
      TotalCount: 0,
      CurrentPage: 1,
      PageSize: 100,
      Data: [],
    });
  });

  it('always passes PageSize=100 to the API', async () => {
    await service.getOuterPaymentMethods();

    expect(apiClient.callFlatApi).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ PageSize: 100 }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API call parameters
// ─────────────────────────────────────────────────────────────────────────────

describe('BillingService.getOuterPaymentMethods — API call contract', () => {
  it('calls callFlatApi with product=BssOpenAPI-V3, action=GetOuterPaymentMethod', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      TotalCount: 0,
      CurrentPage: 1,
      PageSize: 100,
      Data: [],
    });
    await service.getOuterPaymentMethods();

    expect(apiClient.callFlatApi).toHaveBeenCalledTimes(1);
    expect(apiClient.callFlatApi).toHaveBeenCalledWith(
      expect.objectContaining({
        product: 'BssOpenAPI-V3',
        action: 'GetOuterPaymentMethod',
      }),
    );
  });
});

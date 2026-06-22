/** Unit tests for SubscriptionTokenPlanService.listTokenPlanSeats. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';

// ────────────────────────────────────────────────────────────────────
// Type stubs aligned with the iteration scope (Field Mapping / JSON Output)
// ────────────────────────────────────────────────────────────────────

interface SeatCycle {
  startTime: string;
  endTime: string;
  totalValue: string;
  surplusValue: string;
  unit: string;
}

interface SeatConfig {
  planType: string;
  creditValue: number;
  seatNum: number;
  quotaCycle: string;
}

interface SeatItem {
  instanceCode: string;
  specType: string;
  status: string;
  memberId: string;
  assignable: boolean;
  assignment: string;
  payMode: string;
  productType: string;
  cycle: SeatCycle | null;
  config: SeatConfig | null;
}

interface SeatsPage {
  current: number;
  size: number;
  total: number;
}

interface SeatsFilter {
  specType: string | null;
}

interface SeatsDiagnostic {
  api: string;
  errorCode: string;
  errorMessage: string;
}

interface TokenPlanSeatsResult {
  page: SeatsPage;
  filter: SeatsFilter;
  items: SeatItem[];
  diagnostics: SeatsDiagnostic[];
}

interface ListTokenPlanSeatsOptions {
  specType?: 'pro' | 'standard';
  page?: number;
  pageSize?: number;
}

// ────────────────────────────────────────────────────────────────────
// Mock infrastructure
// ────────────────────────────────────────────────────────────────────

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn() };
}

/**
 * Build a Config string the way the upstream wire serializes it: the outer
 * JSON.stringify produces a JSON-encoded string whose contents are themselves
 * JSON. The Service must JSON.parse twice to recover the object.
 */
function makeWireConfig(inner: Record<string, unknown>): string {
  return JSON.stringify(JSON.stringify(inner));
}

interface RawEquity {
  CycleStartTime?: string;
  CycleEndTime?: string;
  CycleTotalValue?: string;
  CycleSurplusValue?: string;
  Unit?: string;
}

interface RawSeat {
  InstanceCode?: string;
  SpecType?: string;
  Status?: string;
  MemberId?: string;
  Assignable?: boolean;
  PayMode?: string;
  ProductType?: string;
  EquityList?: RawEquity[];
  Config?: string;
}

function makeRawSeat(overrides: Partial<RawSeat> = {}): RawSeat {
  return {
    InstanceCode: 'subs-03a5xxxx9x2g',
    SpecType: 'pro',
    Status: 'NORMAL',
    MemberId: 'acc_12345678abcdefgh9012',
    Assignable: true,
    PayMode: 'Subscription',
    ProductType: 'TokenPlan',
    EquityList: [
      {
        CycleStartTime: '2026-06-14T00:00:00+08:00',
        CycleEndTime: '2026-07-14T00:00:00+08:00',
        CycleTotalValue: '100000.00000000',
        CycleSurplusValue: '91284.56267396',
        Unit: 'Credits',
      },
    ],
    Config: makeWireConfig({
      plan_type: 'pro',
      credit_value: 100000,
      seat_num: 1,
      quota_cycle: 'monthly',
    }),
    ...overrides,
  };
}

function makeRawResponse(
  seats: RawSeat[],
  total: number = seats.length,
): { Data: { SubscriptionList: RawSeat[]; TotalCount: number } } {
  return { Data: { SubscriptionList: seats, TotalCount: total } };
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe('SubscriptionTokenPlanService.listTokenPlanSeats — orchestration', () => {
  let apiClient: MockApiClient;
  let service: {
    listTokenPlanSeats: (opts?: ListTokenPlanSeatsOptions) => Promise<TokenPlanSeatsResult>;
  };

  beforeEach(async () => {
    apiClient = makeMockApiClient();
    apiClient.callFlatApi = vi.fn(async () => makeRawResponse([makeRawSeat()], 1));
    const mod = await import('../../src/services/subscription-tokenplan-service.js');
    const ServiceClass = mod.SubscriptionTokenPlanService;
    service = new ServiceClass(apiClient as unknown as ApiClient) as unknown as typeof service;
  });

  // ──────── Happy path ────────

  it('returns full seats page when API succeeds', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse(
        [
          makeRawSeat({ InstanceCode: 'subs-A', SpecType: 'pro' }),
          makeRawSeat({ InstanceCode: 'subs-B', SpecType: 'standard' }),
        ],
        12,
      ),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items).toHaveLength(2);
    expect(result.page.total).toBe(12);
    expect(result.diagnostics).toEqual([]);
    expect(result.items[0].instanceCode).toBe('subs-A');
    expect(result.items[1].instanceCode).toBe('subs-B');
  });

  it('strips the BSS Data envelope (C23-1) before mapping', async () => {
    // If the service forgets to read response.Data, items would be empty.
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse([makeRawSeat({ InstanceCode: 'subs-only' })], 1),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].instanceCode).toBe('subs-only');
  });

  it('maps every documented seat field to camelCase DTO', async () => {
    apiClient.callFlatApi = vi.fn(async () => makeRawResponse([makeRawSeat()], 1));
    const result = await service.listTokenPlanSeats();
    const seat = result.items[0];
    expect(seat.instanceCode).toBe('subs-03a5xxxx9x2g');
    expect(seat.specType).toBe('pro');
    expect(seat.status).toBe('NORMAL');
    expect(seat.memberId).toBe('acc_12345678abcdefgh9012');
    expect(seat.assignable).toBe(true);
    expect(seat.assignment).toBe('Assigned');
    expect(seat.payMode).toBe('Subscription');
    expect(seat.productType).toBe('TokenPlan');
  });

  it('passes through MemberId verbatim at the service layer (no masking)', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse([makeRawSeat({ MemberId: 'acc_12345678abcdefgh9012' })], 1),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].memberId).toBe('acc_12345678abcdefgh9012');
    // No ellipsis or truncation at service boundary
    expect(result.items[0].memberId).not.toContain('…');
  });

  // ──────── Pagination parameter handling ────────

  it('uses defaults page=1, pageSize=20 when no options passed', async () => {
    await service.listTokenPlanSeats();
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    expect(call.params?.pageNo).toBe(1);
    expect(call.params?.pageSize).toBe(20);
    const result = await service.listTokenPlanSeats();
    expect(result.page.current).toBe(1);
    expect(result.page.size).toBe(20);
  });

  it('rejects or rewrites page=0 to satisfy the BSS pageNo>=1 contract', async () => {
    await service.listTokenPlanSeats({ page: 0 });
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    const sentPageNo = call.params?.pageNo as number;
    expect(sentPageNo).toBeGreaterThanOrEqual(1);
  });

  it('clamps pageSize > 100 down to the documented upper bound 100', async () => {
    await service.listTokenPlanSeats({ pageSize: 500 });
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    expect(call.params?.pageSize).toBeLessThanOrEqual(100);
  });

  it('passes page and pageSize through unchanged when within valid range', async () => {
    await service.listTokenPlanSeats({ page: 3, pageSize: 50 });
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    expect(call.params?.pageNo).toBe(3);
    expect(call.params?.pageSize).toBe(50);
  });

  it('echoes the resolved page/size into the result.page object', async () => {
    apiClient.callFlatApi = vi.fn(async () => makeRawResponse([makeRawSeat()], 12));
    const result = await service.listTokenPlanSeats({ page: 2, pageSize: 30 });
    expect(result.page.current).toBe(2);
    expect(result.page.size).toBe(30);
    expect(result.page.total).toBe(12);
  });

  // ──────── Filter parameter ────────

  it('passes specType=pro to the upstream API when filter is set', async () => {
    await service.listTokenPlanSeats({ specType: 'pro' });
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    expect(call.params?.specType).toBe('pro');
  });

  it('omits specType (or sends null) when filter is unset', async () => {
    await service.listTokenPlanSeats();
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    const v = call.params?.specType;
    expect(v === undefined || v === null || v === '').toBe(true);
  });

  it('reflects the filter value into result.filter.specType', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse([makeRawSeat({ SpecType: 'pro' })], 1),
    );
    const result = await service.listTokenPlanSeats({ specType: 'pro' });
    expect(result.filter.specType).toBe('pro');
  });

  it('records null filter when no specType passed', async () => {
    const result = await service.listTokenPlanSeats();
    expect(result.filter.specType).toBeNull();
  });

  // ──────── Empty response ────────

  it('returns empty items + total=0 when API yields no SubscriptionList', async () => {
    apiClient.callFlatApi = vi.fn(async () => ({
      Data: { SubscriptionList: [], TotalCount: 0 },
    }));
    const result = await service.listTokenPlanSeats();
    expect(result.items).toEqual([]);
    expect(result.page.total).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('treats missing SubscriptionList as empty (defensive)', async () => {
    apiClient.callFlatApi = vi.fn(async () => ({ Data: { TotalCount: 0 } }));
    const result = await service.listTokenPlanSeats();
    expect(result.items).toEqual([]);
    expect(result.page.total).toBe(0);
  });

  // ──────── Config double-JSON parse ────────

  it('double-parses the Config wire string into a camelCase object', async () => {
    apiClient.callFlatApi = vi.fn(async () => makeRawResponse([makeRawSeat()], 1));
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].config).toEqual({
      planType: 'pro',
      creditValue: 100000,
      seatNum: 1,
      quotaCycle: 'monthly',
    });
  });

  it('returns config=null + diagnostic when Config is empty string', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse([makeRawSeat({ InstanceCode: 'subs-empty', Config: '' })], 1),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].config).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.some((d) => /subs-empty/.test(d.errorMessage))).toBe(true);
  });

  it('returns config=null + diagnostic when outer Config is non-JSON garbage', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse([makeRawSeat({ InstanceCode: 'subs-bad', Config: 'not-a-json-string' })], 1),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].config).toBeNull();
    expect(result.diagnostics.some((d) => /subs-bad/.test(d.errorMessage))).toBe(true);
  });

  it('returns config=null + diagnostic when inner JSON is malformed', async () => {
    // Outer is valid JSON-encoded string, but inner content is not JSON.
    const malformedInner = JSON.stringify('{not-valid-inner');
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse([makeRawSeat({ InstanceCode: 'subs-inner', Config: malformedInner })], 1),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].config).toBeNull();
    expect(result.diagnostics.some((d) => /subs-inner/.test(d.errorMessage))).toBe(true);
  });

  it('does not abort batch when one row has a bad Config (others survive)', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse(
        [
          makeRawSeat({ InstanceCode: 'subs-good' }),
          makeRawSeat({ InstanceCode: 'subs-bad', Config: 'garbage' }),
          makeRawSeat({ InstanceCode: 'subs-good2' }),
        ],
        3,
      ),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items).toHaveLength(3);
    expect(result.items[0].config).not.toBeNull();
    expect(result.items[1].config).toBeNull();
    expect(result.items[2].config).not.toBeNull();
  });

  // ──────── EquityList handling ────────

  it('maps EquityList[0] to cycle when present', async () => {
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].cycle).toEqual({
      startTime: '2026-06-14T00:00:00+08:00',
      endTime: '2026-07-14T00:00:00+08:00',
      totalValue: '100000.00000000',
      surplusValue: '91284.56267396',
      unit: 'Credits',
    });
  });

  it('returns cycle=null + diagnostic when EquityList is empty array', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse([makeRawSeat({ InstanceCode: 'subs-no-equity', EquityList: [] })], 1),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].cycle).toBeNull();
    expect(result.diagnostics.some((d) => /subs-no-equity/.test(d.errorMessage))).toBe(true);
  });

  it('returns cycle=null when EquityList property is missing entirely', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse(
        [makeRawSeat({ InstanceCode: 'subs-undef-equity', EquityList: undefined })],
        1,
      ),
    );
    const result = await service.listTokenPlanSeats();
    expect(result.items[0].cycle).toBeNull();
  });

  it('tolerates partial EquityList[0] fields by emitting empty strings or nulls', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse(
        [
          makeRawSeat({
            InstanceCode: 'subs-partial',
            EquityList: [
              {
                CycleStartTime: '2026-06-14T00:00:00+08:00',
                // CycleEndTime / CycleTotalValue / CycleSurplusValue absent
                Unit: 'Credits',
              },
            ],
          }),
        ],
        1,
      ),
    );
    const result = await service.listTokenPlanSeats();
    const cycle = result.items[0].cycle;
    expect(cycle).not.toBeNull();
    expect(cycle!.startTime).toBe('2026-06-14T00:00:00+08:00');
    // Missing fields fall back to null/empty — implementation choice but must be
    // serializable (no `undefined`).
    expect(cycle!.endTime === null || typeof cycle!.endTime === 'string').toBe(true);
    expect(cycle!.totalValue === null || typeof cycle!.totalValue === 'string').toBe(true);
  });

  // ──────── Amount precision ────────

  it('preserves CycleTotalValue / CycleSurplusValue as strings (full precision)', async () => {
    apiClient.callFlatApi = vi.fn(async () =>
      makeRawResponse(
        [
          makeRawSeat({
            EquityList: [
              {
                CycleStartTime: '2026-06-14T00:00:00+08:00',
                CycleEndTime: '2026-07-14T00:00:00+08:00',
                CycleTotalValue: '100000.00000000',
                CycleSurplusValue: '91284.56267396',
                Unit: 'Credits',
              },
            ],
          }),
        ],
        1,
      ),
    );
    const result = await service.listTokenPlanSeats();
    const cycle = result.items[0].cycle!;
    expect(typeof cycle.totalValue).toBe('string');
    expect(typeof cycle.surplusValue).toBe('string');
    expect(cycle.totalValue).toBe('100000.00000000');
    expect(cycle.surplusValue).toBe('91284.56267396');
  });

  // ──────── API failure ────────

  it('surfaces network errors as a thrown rejection (caller handles)', async () => {
    apiClient.callFlatApi = vi.fn(async () => {
      throw new Error('Network error');
    });
    await expect(service.listTokenPlanSeats()).rejects.toThrow(/network/i);
  });

  it('throws when API returns Success=false envelope (strict contract)', async () => {
    // Per C23-1 the BSS Type A envelope surfaces business errors at top level
    // (Code/Message). Under the strict contract the service must reject so the
    // caller can map the error rather than consume an empty SubscriptionList.
    apiClient.callFlatApi = vi.fn(async () => ({
      Code: 'InternalError',
      Message: 'Backend unavailable',
      Success: false,
    }));
    await expect(service.listTokenPlanSeats()).rejects.toThrow(
      /Backend unavailable|InternalError/i,
    );
  });

  // ──────── Param identity ────────

  it('targets product=BssOpenAPI-V3 and action=GetSubscriptionDetail', async () => {
    await service.listTokenPlanSeats();
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      product?: string;
      action?: string;
    };
    expect(call.product).toMatch(/BssOpenAPI/i);
    expect(call.action).toBe('GetSubscriptionDetail');
  });

  it('passes a non-empty productCode in lowercase', async () => {
    await service.listTokenPlanSeats();
    const call = apiClient.callFlatApi.mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    const code = call.params?.productCode;
    expect(typeof code).toBe('string');
    expect((code as string).length).toBeGreaterThan(0);
    expect(code).toBe((code as string).toLowerCase());
  });
});

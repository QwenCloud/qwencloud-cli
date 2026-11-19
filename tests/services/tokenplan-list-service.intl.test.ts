import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import { TokenPlanListService } from '../../src/services/tokenplan-list-service.js';
import { buildTokenPlanListViewModel } from '../../src/view-models/subscription/tokenplan-list.js';

const { credentialRead } = vi.hoisted(() => ({
  credentialRead: vi.fn(() => {
    throw new Error('The anonymous service must not read credentials');
  }),
}));
vi.mock('../../src/auth/credentials.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveCredentials: credentialRead,
  readCredentials: credentialRead,
}));

const QUOTA = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config';
const MODELS = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listTokenPlanModels';
const PROVIDERS = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listModelProviders';
const SUBSCRIPTION = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription';
const USAGE = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage';

function article(tier: string, totalPrice: number, discountedTotalPrice: number) {
  return {
    price: { totalPrice, discountedTotalPrice },
    settlement: { pricingCurrency: 'USD' },
    moduleResults: [
      { moduleCode: 'subscription_type', moduleAttributeMap: { subscription_type: tier } },
    ],
  };
}

interface QuoteComponent {
  componentCode: string;
  instanceProperty: Array<{ code: string; value: string }>;
}
function requestedTier(params?: Record<string, unknown>): string {
  const components = params?.components as QuoteComponent[] | undefined;
  const property =
    components
      ?.find((component) => component.componentCode === 'subscription_type')
      ?.instanceProperty.find((item) => item.code === 'subscription_type') ??
    components
      ?.find((component) => component.componentCode === 'subscription_spec')
      ?.instanceProperty.find((item) => item.code === 'plan_type');
  if (!property) throw new Error('Quotation request must include a declared tier');
  return property.value;
}
const personalPrices: Record<string, unknown> = {
  lite: article('lite', 1001, 801),
  essential: article('essential', 2002, 1602),
  standard: article('standard', 3003, 2403),
  pro: article('pro', 4004, 3204),
};
function teamArticle(tier: string, monthlyCredits: string, standPrice: number) {
  return {
    standPrice,
    moduleResults: [
      {
        moduleCode: 'subscription_spec',
        moduleAttributeMap: {
          plan_type: tier,
          credit_value: monthlyCredits,
          quota_cycle: 'byDynamicMonth',
          seat_num: '1',
        },
      },
    ],
  };
}
const teamPrices: Record<string, unknown> = {
  standard: teamArticle('standard', '25000', 12001),
  pro: teamArticle('pro', '100000', 24001),
  max: teamArticle('max', '250000', 60001),
};

interface OrchestrationCall {
  action: string;
  params?: Record<string, unknown>;
  path: '/data/custom.json' | '/data/publicCustom.json';
  authMode: 'required' | 'optional' | 'none';
  parse: (raw: unknown) => unknown;
  signal?: AbortSignal;
}
interface CsCall {
  api: string;
  data?: Record<string, unknown>;
  authMode?: 'required' | 'none';
  parse: (raw: unknown) => unknown;
  signal?: AbortSignal;
}

function makeApiClient() {
  const callOrchestrationApi = vi.fn(async (options: OrchestrationCall) => {
    if (options.action === 'GetCommodity')
      throw new Error('Pricing page quotations must not query commodity metadata');
    if (options.action === 'QueryOrderLight') {
      const tier = requestedTier(options.params);
      if (options.params?.commodityCode === 'sfm_tokenplansolo_public_intl') {
        if (!personalPrices[tier]) throw new Error('Undeclared personal quotation tier');
        return options.parse({ price: { articleItemResults: [personalPrices[tier]] } });
      }
      if (options.params?.commodityCode === 'sfm_tokenplanteams_dp_intl') {
        if (!teamPrices[tier]) throw new Error('Undeclared team quotation tier');
        return options.parse({
          price: {
            order: { standPrice: 240.01, currency: 'USD' },
            articleItemResults: [teamPrices[tier]],
          },
        });
      }
      throw new Error('Undeclared quotation commodity');
    }
    if (options.action === 'CheckInventory') {
      if (
        options.params?.commodityCode !== 'sfm_tokenplansolo_public_intl' &&
        options.params?.commodityCode !== 'sfm_tokenplanteams_dp_intl'
      )
        throw new Error('Undeclared inventory commodity');
      return options.parse({ available: true });
    }
    throw new Error(`Unexpected orchestration action ${options.action}`);
  });
  const callCsDataApi = vi.fn(async (options: CsCall) => {
    if (options.api === QUOTA)
      return options.parse({
        code: 'SUCCESS',
        success: true,
        data: {
          lite: { five_hour: 0, weekly: 200, monthly: 500 },
          essential: { weekly: 400, monthly: 1000 },
          standard: { weekly: 600, monthly: 1500 },
          pro: { weekly: 800, monthly: 2000 },
        },
      });
    if (options.api === MODELS)
      return options.parse({
        code: '200',
        success: true,
        data: {
          total: 1,
          pageNo: 1,
          pageSize: 100,
          list: [
            {
              modelId: 'mock-supported-model',
              provider: 'mock-provider',
              name: '{"en-US":"Mock Model"}',
              capabilities: ['tool-call'],
            },
          ],
        },
      });
    if (options.api === PROVIDERS)
      return options.parse({
        code: '200',
        success: true,
        data: [{ providerId: 'mock-provider', displayName: 'Mock Brand' }],
      });
    throw new Error(`Anonymous catalog must not request ${options.api}`);
  });
  const callFlatApi = vi.fn(
    async (_options: { action: string; signal?: AbortSignal }): Promise<unknown> => {
      throw new Error('Anonymous catalog must not query an account');
    },
  );
  return {
    client: { callOrchestrationApi, callCsDataApi, callFlatApi } as unknown as ApiClient,
    callOrchestrationApi,
    callCsDataApi,
    callFlatApi,
  };
}

function useStandardTeamArticle(api: ReturnType<typeof makeApiClient>, quotedArticle: unknown) {
  const original = api.callOrchestrationApi.getMockImplementation()!;
  api.callOrchestrationApi.mockImplementation(async (options) => {
    if (
      options.action === 'QueryOrderLight' &&
      options.params?.commodityCode === 'sfm_tokenplanteams_dp_intl' &&
      requestedTier(options.params) === 'standard'
    ) {
      return options.parse({
        price: { order: { standPrice: 15, currency: 'USD' }, articleItemResults: [quotedArticle] },
      });
    }
    return original(options);
  });
}

function usePersonalQuota(api: ReturnType<typeof makeApiClient>, data: Record<string, unknown>) {
  const original = api.callCsDataApi.getMockImplementation()!;
  api.callCsDataApi.mockImplementation(async (options) =>
    options.api === QUOTA
      ? options.parse({ code: 'SUCCESS', success: true, data })
      : original(options),
  );
}

describe('Anonymous international Token Plan catalog', () => {
  it.each([
    ['empty quota configuration', {}],
    ['missing tier quotas', { lite: { weekly: 200 } }],
  ])('marks %s partial while preserving public quotations', async (_name, quota) => {
    const api = makeApiClient();
    usePersonalQuota(api, quota);

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      edition: 'individual',
    });

    expect(result.completeness).toBe('partial');
    expect(result.sections[0]!.rows.map((row) => row.price)).toEqual([
      '8.01',
      '16.02',
      '24.03',
      '32.04',
    ]);
    expect(result.sections[0]!.rows[1]).toMatchObject({ monthlyCredits: null });
    expect(result.sections[0]!.rows[1]).not.toHaveProperty('weeklyCredits');
    expect(result.sections[0]!.diagnostics.map((entry) => entry.errorCode)).toEqual([
      'INCOMPLETE_FIELDS',
    ]);
    expect(api.callCsDataApi).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ api: QUOTA, data: {}, authMode: 'none' }),
    );
    expect(api.callFlatApi).not.toHaveBeenCalled();
  });

  it('diagnoses an invalid monthly main quota without substituting a five-hour limit', async () => {
    const api = makeApiClient();
    usePersonalQuota(api, {
      lite: { five_hour: 100, monthly: -1 },
      essential: { weekly: 400 },
      standard: { weekly: 600 },
      pro: { weekly: 800 },
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      edition: 'individual',
    });
    const section = result.sections[0]!;

    expect(result.completeness).toBe('partial');
    expect(section.rows[0]).toMatchObject({ price: '8.01', monthlyCredits: null });
    expect(section.rows[0]).not.toHaveProperty('weeklyCredits');
    expect(section.plans![0]!.quotaWindows).toEqual([
      { windowType: 'five_hour', totalCredits: '100' },
    ]);
    expect(section.diagnostics.map((entry) => entry.errorCode)).toEqual([
      'INVALID_MONTHLY_QUOTA',
      'INCOMPLETE_FIELDS',
    ]);
    expect(buildTokenPlanListViewModel(result).sections[0]!.diagnostics).toContain(
      'Lite credit limit is temporarily unavailable. Try again later.',
    );
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 'invalid', {}, []])(
    'falls back from invalid weekly value %j to a valid monthly quota with diagnosis',
    async (weekly) => {
      const api = makeApiClient();
      usePersonalQuota(api, {
        lite: { five_hour: 100, weekly, monthly: 500 },
        essential: { weekly: 400 },
        standard: { weekly: 600 },
        pro: { weekly: 800 },
      });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'individual',
      });
      const section = result.sections[0]!;
      const vm = buildTokenPlanListViewModel(result);

      expect(result.completeness).toBe('partial');
      expect(section.rows[0]).toMatchObject({ price: '8.01', monthlyCredits: '500' });
      expect(section.rows[0]).not.toHaveProperty('weeklyCredits');
      expect(section.plans![0]!.quotaWindows).toEqual([
        { windowType: 'five_hour', totalCredits: '100' },
        { windowType: 'monthly', totalCredits: '500' },
      ]);
      expect(section.diagnostics.map((entry) => entry.errorCode)).toEqual(['INVALID_WEEKLY_QUOTA']);
      expect(vm.sections[0]!.rows[0]).toMatchObject({
        quotaWindow: 'monthly',
      });
      expect(vm.sections[0]!.rows[0]).not.toHaveProperty('totalCredits');
      expect(vm.sections[0]!.diagnostics).toContain('The weekly credit limit is invalid.');
      expect(vm.sections[0]!.diagnostics).not.toContain(
        'Lite credit limit is temporarily unavailable. Try again later.',
      );
    },
  );

  it.each([
    ['five-hour', { five_hour: -1, weekly: 200 }, 'INVALID_FIVE_HOUR_QUOTA'],
    ['monthly', { weekly: 200, monthly: -1 }, 'INVALID_MONTHLY_QUOTA'],
  ])(
    'diagnoses an invalid %s window while retaining a valid weekly quota',
    async (_name, quota, code) => {
      const api = makeApiClient();
      usePersonalQuota(api, {
        lite: quota,
        essential: { weekly: 400 },
        standard: { weekly: 600 },
        pro: { weekly: 800 },
      });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'individual',
      });

      expect(result.completeness).toBe('partial');
      expect(result.sections[0]!.rows[0]).toMatchObject({
        weeklyCredits: 200,
        monthlyCredits: null,
      });
      expect(result.sections[0]!.plans![0]!.quotaWindows).toEqual([
        { windowType: 'weekly', totalCredits: '200' },
      ]);
      expect(result.sections[0]!.diagnostics.map((entry) => entry.errorCode)).toEqual([code]);
    },
  );

  it.each([
    [{ weekly: 0, monthly: 500 }, 0, null, 'weekly'],
    [{ weekly: null, monthly: 0 }, undefined, '0', 'monthly'],
    [{ monthly: 500 }, undefined, '500', 'monthly'],
  ] as const)(
    'keeps valid zero and optional missing windows complete for %j',
    async (quota, weekly, monthly, window) => {
      const api = makeApiClient();
      usePersonalQuota(api, { lite: quota, essential: quota, standard: quota, pro: quota });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'individual',
      });

      expect(result.completeness).toBe('complete');
      expect(result.sections[0]!.diagnostics).toEqual([]);
      expect(result.sections[0]!.rows[0]!.weeklyCredits).toBe(weekly);
      expect(result.sections[0]!.rows[0]!.monthlyCredits).toBe(monthly);
      const row = buildTokenPlanListViewModel(result).sections[0]!.rows[0];
      expect(row).toMatchObject({
        quotaWindow: window,
      });
      expect(row).not.toHaveProperty('totalCredits');
    },
  );

  it('defaults to both editions and one monthly cycle with original rows and additive plans', async () => {
    credentialRead.mockClear();
    const api = makeApiClient();

    const result = await new TokenPlanListService(api.client).getTokenPlanList();

    expect(result.authenticated).toBe(false);
    expect(result.edition).toBe('all');
    expect(result.billingCycle).toBe('monthly');
    expect(result.completeness).toBe('complete');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.diagnostics).toEqual([]);
    expect(result.sections[1]?.diagnostics).toEqual([]);
    expect(result.sections[0]?.currentPlan).toBeNull();
    expect(result.sections[0]?.currentPlanDetails).toBeNull();
    expect(result.sections[0]?.subscriptionUrl).toBeNull();
    expect(result.sections[1]?.subscriptionUrl).toBeNull();
    expect(result.sections[0]?.rows).toHaveLength(4);
    expect(result.sections[0]?.plans).toHaveLength(4);
    expect(result.sections[0]?.plans?.[0]).toMatchObject({
      tier: 'lite',
      billingTerm: 'monthly',
      listPrice: '10.01',
      promoPrice: '8.01',
      currency: 'USD',
      quotaWindows: [
        { windowType: 'five_hour', totalCredits: '0' },
        { windowType: 'weekly', totalCredits: '200' },
        { windowType: 'monthly', totalCredits: '500' },
      ],
    });
    expect(result.sections[0]?.plans?.[0]).not.toHaveProperty('supportedModels');
    expect(result.sections[0]?.plans).toMatchObject([
      { tier: 'lite', listPrice: '10.01', promoPrice: '8.01' },
      { tier: 'essential', listPrice: '20.02', promoPrice: '16.02' },
      { tier: 'standard', listPrice: '30.03', promoPrice: '24.03' },
      { tier: 'pro', listPrice: '40.04', promoPrice: '32.04' },
    ]);
    expect(result.sections[1]?.plans).toMatchObject([
      {
        seatType: 'standard',
        listPrice: '120.01',
        promoPrice: null,
        quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
      },
      {
        seatType: 'pro',
        listPrice: '240.01',
        promoPrice: null,
        quotaWindows: [{ windowType: 'monthly', totalCredits: '100000' }],
      },
      {
        seatType: 'max',
        listPrice: '600.01',
        promoPrice: null,
        quotaWindows: [{ windowType: 'monthly', totalCredits: '250000' }],
      },
    ]);
    expect(api.callOrchestrationApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GetCommodity' }),
    );
    expect(
      api.callOrchestrationApi.mock.calls.filter(
        ([options]) => options.action === 'CheckInventory',
      ),
    ).toHaveLength(7);
    expect(
      api.callOrchestrationApi.mock.calls.filter(
        ([options]) => options.action === 'QueryOrderLight',
      ),
    ).toHaveLength(7);
    expect(api.callFlatApi).not.toHaveBeenCalled();
    expect(credentialRead).not.toHaveBeenCalled();
    expect(api.callCsDataApi).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ api: QUOTA, authMode: 'none' }),
    );
  });

  it.each([
    ['monthly', 'Month', '1'],
    ['quarterly', 'Month', '3'],
    ['yearly', 'Year', '1'],
  ] as const)(
    'queries only the selected personal %s purchase cycle',
    async (billingCycle, pricingCycle, duration) => {
      const api = makeApiClient();

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'individual',
        billingCycle,
      });

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]?.edition).toBe('individual');
      expect(result.sections[0]?.plans?.[0]?.billingTerm).toBe(billingCycle);
      expect(api.callOrchestrationApi).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'QueryOrderLight',
          path: '/data/publicCustom.json',
          authMode: 'none',
          params: expect.objectContaining({
            commodityCode: 'sfm_tokenplansolo_public_intl',
            specCode: 'sfm_tokenplansolo_public_intl',
            chargeType: 'PREPAY',
            orderType: 'BUY',
            quantity: 1,
            autoRenew: false,
            pricingCycle,
            duration,
          }),
        }),
      );
      expect(api.callOrchestrationApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GetCommodity' }),
      );
      expect(
        api.callOrchestrationApi.mock.calls.filter(
          ([options]) => options.action === 'QueryOrderLight',
        ),
      ).toHaveLength(4);
    },
  );

  it('marks a quarterly team catalog unsupported and does not query a substitute monthly price', async () => {
    const api = makeApiClient();

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      edition: 'team',
      billingCycle: 'quarterly',
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      edition: 'team',
      billingCycleSupported: false,
      rows: [],
      plans: [],
    });
    expect(api.callOrchestrationApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'QueryOrderLight' }),
    );
    expect(api.callCsDataApi).not.toHaveBeenCalled();
    expect(api.callOrchestrationApi).not.toHaveBeenCalled();
  });

  it.each([
    ['individual', 1, 1],
    ['team', 1, 0],
    ['all', 2, 1],
  ] as const)(
    'keeps %s unknown when every quote is malformed and inventory also fails',
    async (edition, sectionCount, quotaCalls) => {
      const api = makeApiClient();
      api.callOrchestrationApi.mockImplementation(async (options) => {
        if (options.action === 'QueryOrderLight')
          return options.parse({ price: { articleItemResults: [] } });
        if (options.action === 'CheckInventory') throw new Error('Mock inventory failure');
        throw new Error('Unexpected commodity lookup in direct quotations');
      });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({ edition });

      expect(result.completeness).toBe('unknown');
      expect(result.sections).toHaveLength(sectionCount);
      expect(
        api.callCsDataApi.mock.calls.filter(([options]) => options.api === QUOTA),
      ).toHaveLength(quotaCalls);
      for (const section of result.sections) {
        expect(section.rows).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ price: expect.any(String) })]),
        );
        expect(section.plans).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ listPrice: expect.any(String) })]),
        );
        expect(section.plans).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ promoPrice: expect.any(String) })]),
        );
        expect(section.rows).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ inventory: true })]),
        );
        expect(section.diagnostics).toEqual(
          expect.arrayContaining([expect.objectContaining({ errorCode: 'PROTOCOL_ERROR' })]),
        );
      }
      expect(api.callOrchestrationApi).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'QueryOrderLight' }),
      );
      expect(api.callOrchestrationApi).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GetCommodity' }),
      );
    },
  );

  it('preserves successful tier prices while a malformed tier quote remains unknown', async () => {
    const api = makeApiClient();
    const original = api.callOrchestrationApi.getMockImplementation()!;
    api.callOrchestrationApi.mockImplementation(async (options) => {
      if (options.action === 'QueryOrderLight' && requestedTier(options.params) === 'lite')
        return options.parse({ price: { articleItemResults: [] } });
      return original(options);
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      edition: 'individual',
    });

    expect(result.completeness).toBe('partial');
    expect(result.sections[0]?.plans).toMatchObject([
      { tier: 'lite', listPrice: null, promoPrice: null },
      { tier: 'essential', listPrice: '20.02', promoPrice: '16.02' },
      { tier: 'standard', listPrice: '30.03', promoPrice: '24.03' },
      { tier: 'pro', listPrice: '40.04', promoPrice: '32.04' },
    ]);
    expect(result.sections[0]?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ errorCode: 'PROTOCOL_ERROR' })]),
    );
  });

  it('keeps a yearly single-seat team total price without converting it to a monthly average', async () => {
    const api = makeApiClient();

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      edition: 'team',
      billingCycle: 'yearly',
    });

    expect(result.sections[0]?.plans).toMatchObject([
      {
        seatType: 'standard',
        billingTerm: 'yearly',
        listPrice: '120.01',
        promoPrice: null,
        currency: 'USD',
      },
      {
        seatType: 'pro',
        billingTerm: 'yearly',
        listPrice: '240.01',
        promoPrice: null,
        currency: 'USD',
      },
      {
        seatType: 'max',
        billingTerm: 'yearly',
        listPrice: '600.01',
        promoPrice: null,
        currency: 'USD',
      },
    ]);
    expect(
      api.callOrchestrationApi.mock.calls.filter(
        ([options]) => options.action === 'QueryOrderLight',
      ),
    ).toHaveLength(3);
    expect(api.callOrchestrationApi).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'QueryOrderLight',
        params: expect.objectContaining({ pricingCycle: 'Year', duration: '1', quantity: 1 }),
      }),
    );
  });

  it.each([
    [
      'standard',
      '25000',
      { seatType: 'pro', listPrice: '240.01' },
      { seatType: 'max', listPrice: '600.01' },
    ],
    [
      'pro',
      '100000',
      { seatType: 'standard', listPrice: '120.01' },
      { seatType: 'max', listPrice: '600.01' },
    ],
    [
      'max',
      '250000',
      { seatType: 'standard', listPrice: '120.01' },
      { seatType: 'pro', listPrice: '240.01' },
    ],
  ] as const)(
    'closes a %s quotation whose reported Credits conflict with the requested specification',
    async (tier, declaredCredits, otherPlanOne, otherPlanTwo) => {
      const api = makeApiClient();
      const original = api.callOrchestrationApi.getMockImplementation()!;
      api.callOrchestrationApi.mockImplementation(async (options) => {
        if (
          options.action === 'QueryOrderLight' &&
          options.params?.commodityCode === 'sfm_tokenplanteams_dp_intl' &&
          requestedTier(options.params) === tier
        ) {
          return options.parse({
            price: {
              order: { standPrice: 15, currency: 'USD' },
              articleItemResults: [teamArticle(tier, '999', 1500)],
            },
          });
        }
        return original(options);
      });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'team',
      });
      const section = result.sections[0]!;

      expect(result.completeness).toBe('partial');
      expect(section.plans?.find((plan) => plan.seatType === tier)).toMatchObject({
        seatType: tier,
        listPrice: null,
        promoPrice: null,
        quotaWindows: [{ windowType: 'monthly', totalCredits: declaredCredits }],
      });
      expect(section.rows.find((row) => row.specCode === tier)).toMatchObject({
        specCode: tier,
        price: null,
        inventory: true,
        monthlyCredits: declaredCredits,
      });
      expect(section.plans).toEqual(
        expect.arrayContaining([
          expect.objectContaining(otherPlanOne),
          expect.objectContaining(otherPlanTwo),
        ]),
      );
      expect(section.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            api: expect.stringMatching(/\S/),
            errorCode: 'PROTOCOL_ERROR',
          }),
        ]),
      );
      expect(
        api.callOrchestrationApi.mock.calls.filter(
          ([options]) => options.action === 'QueryOrderLight',
        ),
      ).toHaveLength(3);
      expect(
        api.callOrchestrationApi.mock.calls.filter(
          ([options]) => options.action === 'CheckInventory',
        ),
      ).toHaveLength(3);
    },
  );

  it('keeps declared team Credits when a successful quotation omits the response Credits attribute', async () => {
    const api = makeApiClient();
    const original = api.callOrchestrationApi.getMockImplementation()!;
    api.callOrchestrationApi.mockImplementation(async (options) => {
      if (
        options.action === 'QueryOrderLight' &&
        options.params?.commodityCode === 'sfm_tokenplanteams_dp_intl' &&
        requestedTier(options.params) === 'standard'
      ) {
        return options.parse({
          price: {
            order: { standPrice: 15, currency: 'USD' },
            articleItemResults: [
              {
                standPrice: 1500,
                moduleResults: [
                  {
                    moduleCode: 'subscription_spec',
                    moduleAttributeMap: {
                      plan_type: 'standard',
                      quota_cycle: 'byDynamicMonth',
                      seat_num: '1',
                    },
                  },
                ],
              },
            ],
          },
        });
      }
      return original(options);
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({ edition: 'team' });

    expect(result.completeness).toBe('complete');
    expect(result.sections[0]?.diagnostics).toEqual([]);
    expect(result.sections[0]?.plans?.find((plan) => plan.seatType === 'standard')).toMatchObject({
      listPrice: '15',
      promoPrice: null,
      currency: 'USD',
      quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
    });
  });

  it.each(['25000', '25000.00'])(
    'accepts reported team Credits %s that equal the requested decimal amount',
    async (reportedCredits) => {
      const api = makeApiClient();
      const original = api.callOrchestrationApi.getMockImplementation()!;
      api.callOrchestrationApi.mockImplementation(async (options) => {
        if (
          options.action === 'QueryOrderLight' &&
          options.params?.commodityCode === 'sfm_tokenplanteams_dp_intl' &&
          requestedTier(options.params) === 'standard'
        ) {
          return options.parse({
            price: {
              order: { standPrice: 15, currency: 'USD' },
              articleItemResults: [teamArticle('standard', reportedCredits, 1500)],
            },
          });
        }
        return original(options);
      });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'team',
      });

      expect(result.completeness).toBe('complete');
      expect(result.sections[0]?.diagnostics).toEqual([]);
      expect(result.sections[0]?.plans?.find((plan) => plan.seatType === 'standard')).toMatchObject(
        {
          listPrice: '15',
          currency: 'USD',
          quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
        },
      );
    },
  );

  it('rejects conflicting Credits reports inside the same quoted specification', async () => {
    const api = makeApiClient();
    const quotedArticle = teamArticle('standard', '25000', 1500);
    useStandardTeamArticle(api, {
      ...quotedArticle,
      moduleResults: [
        {
          ...quotedArticle.moduleResults[0],
          moduleAttrs: [{ code: 'credit_value', value: '999' }],
        },
      ],
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({ edition: 'team' });

    expect(result.completeness).toBe('partial');
    expect(result.sections[0]?.plans).toMatchObject([
      {
        seatType: 'standard',
        listPrice: null,
        promoPrice: null,
        quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
      },
      { seatType: 'pro', listPrice: '240.01' },
      { seatType: 'max', listPrice: '600.01' },
    ]);
    expect(result.sections[0]?.rows[0]).toMatchObject({
      specCode: 'standard',
      price: null,
      inventory: true,
    });
    expect(result.sections[0]?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ errorCode: 'PROTOCOL_ERROR' })]),
    );
  });

  it.each([null, 'invalid', '', '-1'])(
    'rejects an explicitly reported invalid Credits value %j instead of treating it as missing',
    async (reportedCredits) => {
      const api = makeApiClient();
      const quotedArticle = teamArticle('standard', '25000', 1500);
      useStandardTeamArticle(api, {
        ...quotedArticle,
        moduleResults: [
          {
            ...quotedArticle.moduleResults[0],
            moduleAttributeMap: {
              ...quotedArticle.moduleResults[0]!.moduleAttributeMap,
              credit_value: reportedCredits,
            },
          },
        ],
      });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'team',
      });

      expect(result.completeness).toBe('partial');
      expect(result.sections[0]?.plans).toMatchObject([
        {
          seatType: 'standard',
          listPrice: null,
          promoPrice: null,
          quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
        },
        { seatType: 'pro', listPrice: '240.01' },
        { seatType: 'max', listPrice: '600.01' },
      ]);
      expect(result.sections[0]?.rows[0]).toMatchObject({
        specCode: 'standard',
        price: null,
        inventory: true,
      });
      expect(result.sections[0]?.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ errorCode: 'PROTOCOL_ERROR' })]),
      );
    },
  );

  it('accepts consistent decimal Credits reports from both attributes of the same specification', async () => {
    const api = makeApiClient();
    const quotedArticle = teamArticle('standard', '25000', 1500);
    useStandardTeamArticle(api, {
      ...quotedArticle,
      moduleResults: [
        {
          ...quotedArticle.moduleResults[0],
          moduleAttrs: [{ code: 'credit_value', value: '25000.00' }],
        },
      ],
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({ edition: 'team' });

    expect(result.completeness).toBe('complete');
    expect(result.sections[0]?.diagnostics).toEqual([]);
    expect(result.sections[0]?.plans?.[0]).toMatchObject({
      seatType: 'standard',
      listPrice: '15',
      quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
    });
  });

  it('validates a Credits report supplied only through the attribute list', async () => {
    const api = makeApiClient();
    useStandardTeamArticle(api, {
      standPrice: 1500,
      moduleResults: [
        {
          moduleCode: 'subscription_spec',
          moduleAttributeMap: {
            plan_type: 'standard',
            quota_cycle: 'byDynamicMonth',
            seat_num: '1',
          },
          moduleAttrs: [{ code: 'credit_value', value: '25000.00' }],
        },
      ],
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({ edition: 'team' });

    expect(result.completeness).toBe('complete');
    expect(result.sections[0]?.diagnostics).toEqual([]);
    expect(result.sections[0]?.plans?.[0]).toMatchObject({
      seatType: 'standard',
      listPrice: '15',
      quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
    });
  });

  it.each(['999', null])(
    'rejects an invalid Credits value %j reported only through the attribute list',
    async (reportedCredits) => {
      const api = makeApiClient();
      useStandardTeamArticle(api, {
        standPrice: 1500,
        moduleResults: [
          {
            moduleCode: 'subscription_spec',
            moduleAttributeMap: {
              plan_type: 'standard',
              quota_cycle: 'byDynamicMonth',
              seat_num: '1',
            },
            moduleAttrs: [{ code: 'credit_value', value: reportedCredits }],
          },
        ],
      });

      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        edition: 'team',
      });

      expect(result.completeness).toBe('partial');
      expect(result.sections[0]?.plans).toMatchObject([
        {
          seatType: 'standard',
          listPrice: null,
          promoPrice: null,
          quotaWindows: [{ windowType: 'monthly', totalCredits: '25000' }],
        },
        { seatType: 'pro', listPrice: '240.01' },
        { seatType: 'max', listPrice: '600.01' },
      ]);
      expect(result.sections[0]?.rows[0]).toMatchObject({
        specCode: 'standard',
        price: null,
        inventory: true,
      });
      expect(result.sections[0]?.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ errorCode: 'PROTOCOL_ERROR' })]),
      );
    },
  );

  it('loads models only when requested and reuses providers for both editions', async () => {
    const api = makeApiClient();

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      includeModels: true,
    });

    expect(result.sections[0]?.plans?.[0]?.supportedModels).toEqual([
      {
        modelId: 'mock-supported-model',
        modelBrand: 'Mock Brand',
        modelName: 'Mock Model',
        capabilities: ['tool-call'],
      },
    ]);
    expect(result.sections[1]?.plans?.[0]?.supportedModels).toHaveLength(1);
    expect(api.callCsDataApi.mock.calls.filter(([options]) => options.api === MODELS)).toHaveLength(
      2,
    );
    expect(
      api.callCsDataApi.mock.calls.filter(([options]) => options.api === PROVIDERS),
    ).toHaveLength(1);
  });

  it('preserves the available edition when the other edition quotation and inventory requests fail', async () => {
    const api = makeApiClient();
    const original = api.callOrchestrationApi.getMockImplementation()!;
    api.callOrchestrationApi.mockImplementation(async (options) => {
      if (options.params?.commodityCode === 'sfm_tokenplanteams_dp_intl')
        throw new Error('Mock team quotation and inventory failure');
      return original(options);
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList();

    expect(result.completeness).toBe('partial');
    expect(result.sections[0]?.plans).toHaveLength(4);
    expect(result.sections[1]?.diagnostics.length).toBeGreaterThan(0);
    expect(result.sections[1]?.subscriptionStatus).toBe('unknown');
  });

  it('reloads provider metadata in a later execution while sharing it within each all-edition query', async () => {
    const api = makeApiClient();
    const service = new TokenPlanListService(api.client);

    const first = await service.getTokenPlanList({ includeModels: true });
    expect(first.completeness).toBe('complete');
    expect(
      api.callCsDataApi.mock.calls.filter(([options]) => options.api === PROVIDERS),
    ).toHaveLength(1);
    const second = await service.getTokenPlanList({ includeModels: true });

    expect(second.completeness).toBe('complete');
    expect(
      api.callCsDataApi.mock.calls.filter(([options]) => options.api === PROVIDERS),
    ).toHaveLength(2);
    expect(api.callCsDataApi.mock.calls.filter(([options]) => options.api === MODELS)).toHaveLength(
      4,
    );
  });

  it('preserves catalog prices when requested model expansion fails instead of reporting an empty model list', async () => {
    const api = makeApiClient();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options) => {
      if (options.api === MODELS) throw new Error('Mock model expansion failure');
      return original(options);
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      edition: 'individual',
      includeModels: true,
    });

    expect(result.completeness).toBe('partial');
    expect(result.sections[0]?.plans).toHaveLength(4);
    expect(result.sections[0]?.plans?.[0]?.promoPrice).toBe('8.01');
    expect(result.sections[0]?.plans?.[0]?.supportedModels).toBeNull();
    expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: MODELS }));
    expect(result.sections[0]?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          api: expect.stringMatching(/\S/),
          errorCode: 'SERVICE_UNAVAILABLE',
        }),
      ]),
    );
  });
});

describe('Authenticated team catalog current subscription', () => {
  it.each([undefined, null, '2026-12-01T00:00:00Z'])(
    'uses EndTime before PeriodEnd in the current subscription: %j',
    async (EndTime) => {
      const api = makeApiClient();
      api.callFlatApi.mockImplementation(async (options) => {
        if (options.action === 'GetUserInstanceSummary')
          return { Data: [{ SpecType: 'standard', Quantity: 1 }] };
        if (options.action === 'GetSeatSubscriptionSummary')
          return {
            Data: {
              EndTime,
              PeriodEnd: '2026-11-01T00:00:00Z',
              SubscriptionGroupList: [],
            },
          };
        return {};
      });
      const result = await new TokenPlanListService(api.client).getTokenPlanList({
        authenticated: true,
        edition: 'team',
      });
      const expected = EndTime ? '2026-12-01T00:00:00.000Z' : '2026-11-01T00:00:00.000Z';
      expect(result.sections[0]?.subscriptionStatus).toBe('active');
      expect(result.sections[0]?.currentPlanDetails?.endAt).toBe(expected);
    },
  );
});

describe('Authenticated personal catalog current subscription', () => {
  function authenticatedApi(
    subscription: unknown = {
      commodityCode: 'sfm_tokenplansolo_public_intl',
      status: 'VALID',
      instanceCode: 'mock-personal-instance',
      specCode: 'lite',
      remainingDays: 10,
      startTime: Date.parse('2026-10-01T00:00:00Z'),
      endTime: Date.parse('2026-11-01T00:00:00Z'),
      autoRenewFlag: true,
    },
  ) {
    const api = makeApiClient();
    const originalCs = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options) => {
      if (options.api === SUBSCRIPTION)
        return options.parse(
          subscription === undefined
            ? { code: 'SUCCESS', success: true }
            : { code: 'SUCCESS', success: true, data: subscription },
        );
      if (options.api === USAGE)
        return options.parse({
          code: 'SUCCESS',
          success: true,
          data: { per1WeekPercentage: 0.25, per1WeekResetTime: Date.parse('2026-10-29T12:00:00Z') },
        });
      return originalCs(options);
    });
    const originalOrchestration = api.callOrchestrationApi.getMockImplementation()!;
    api.callOrchestrationApi.mockImplementation(async (options) => {
      if (options.action === 'QueryInstance')
        throw new Error('Mock current billing cycle unavailable');
      return originalOrchestration(options);
    });
    return api;
  }

  it.each([
    { ratio: 0.00005, usedPct: 0.005, remainingPct: 99.995 },
    { ratio: 0.07, usedPct: 7, remainingPct: 93 },
    { ratio: 0.0004, usedPct: 0.04, remainingPct: 99.96 },
  ])('preserves the native used ratio before display rounding: %j', async (fixture) => {
    const api = authenticatedApi();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options) =>
      options.api === USAGE
        ? options.parse({
            code: 'SUCCESS',
            success: true,
            data: { per1WeekPercentage: fixture.ratio },
          })
        : original(options),
    );
    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      authenticated: true,
      edition: 'individual',
    });
    expect(result.sections[0]!.currentPlanDetails?.usedPct).toBe(fixture.usedPct);
    expect(result.sections[0]!.currentPlanDetails?.remainingPct).toBe(fixture.remainingPct);
    expect(api.callCsDataApi.mock.calls.filter(([options]) => options.api === USAGE)).toHaveLength(
      1,
    );
  });

  it.each(['individual', 'team'] as const)(
    'retains prices and models while the %s account query hangs',
    async (edition) => {
      vi.useFakeTimers();
      try {
        const api = authenticatedApi();
        let release: (value: unknown) => void = () => {};
        const stalled = new Promise<unknown>((resolve) => {
          release = resolve;
        });
        const original = api.callCsDataApi.getMockImplementation()!;
        api.callCsDataApi.mockImplementation(async (options) =>
          options.api === SUBSCRIPTION ? stalled : original(options),
        );
        api.callFlatApi.mockImplementation(async () => stalled);
        const pending = new TokenPlanListService(api.client, 50).getTokenPlanList({
          authenticated: true,
          edition,
          includeModels: true,
        });
        await vi.advanceTimersByTimeAsync(0);

        expect(
          api.callOrchestrationApi.mock.calls.filter(
            ([options]) => options.action === 'QueryOrderLight',
          ),
        ).toHaveLength(edition === 'individual' ? 4 : 3);
        expect(api.callCsDataApi).toHaveBeenCalledWith(expect.objectContaining({ api: MODELS }));
        await vi.advanceTimersByTimeAsync(50);
        const result = await pending;
        expect(result.completeness).toBe('partial');
        expect(result.sections[0]?.subscriptionStatus).toBe('unknown');
        expect(result.sections[0]?.subscriptionUrl).toBeNull();
        expect(
          result.sections[0]?.rows.every(
            (row) => row.price !== null && row.inventory === true && row.status === 'unknown',
          ),
        ).toBe(true);
        expect(result.sections[0]?.plans?.[0]?.supportedModels).toHaveLength(1);
        const snapshot = JSON.stringify(result);
        release({ status: 'active' });
        await vi.advanceTimersByTimeAsync(0);
        expect(JSON.stringify(result)).toBe(snapshot);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['individual', 'team'] as const)(
    'preserves confirmed %s state when the billing-cycle query hangs',
    async (edition) => {
      vi.useFakeTimers();
      try {
        const api = authenticatedApi();
        api.callFlatApi.mockImplementation(async () => ({
          Data: [{ SpecType: 'standard', InstanceID: 'mock-team-instance' }],
        }));
        const original = api.callOrchestrationApi.getMockImplementation()!;
        api.callOrchestrationApi.mockImplementation(async (options) =>
          options.action === 'QueryInstance' ? new Promise<never>(() => {}) : original(options),
        );
        const pending = new TokenPlanListService(api.client, 50).getTokenPlanList({
          authenticated: true,
          edition,
          includeModels: true,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(
          api.callOrchestrationApi.mock.calls.filter(
            ([options]) => options.action === 'QueryOrderLight',
          ),
        ).toHaveLength(edition === 'individual' ? 4 : 3);
        await vi.advanceTimersByTimeAsync(50);
        const result = await pending;

        expect(result.sections[0]).toMatchObject({
          subscriptionStatus: 'active',
          currentBillingCycle: null,
        });
        expect(result.sections[0]?.subscriptionUrl).toBe(
          edition === 'individual'
            ? 'https://home.qwencloud.com/analytics/token-plan/individual'
            : 'https://home.qwencloud.com/analytics/token-plan/team',
        );
        if (edition === 'individual') expect(result.sections[0]?.currentPlan).toBe('lite');
        expect(result.sections[0]?.diagnostics).toContainEqual(
          expect.objectContaining({ api: 'QueryInstance', errorCode: 'TIMEOUT' }),
        );
        expect(
          result.sections[0]?.rows.every((row) => row.price !== null && row.inventory === true),
        ).toBe(true);
        expect(result.sections[0]?.plans?.[0]?.supportedModels).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('continues quotations when the public quota configuration hangs', async () => {
    vi.useFakeTimers();
    try {
      const api = makeApiClient();
      const original = api.callCsDataApi.getMockImplementation()!;
      api.callCsDataApi.mockImplementation(async (options) =>
        options.api === QUOTA ? new Promise<never>(() => {}) : original(options),
      );
      const pending = new TokenPlanListService(api.client, 50).getTokenPlanList({
        edition: 'individual',
        includeModels: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(
        api.callOrchestrationApi.mock.calls.filter(
          ([options]) => options.action === 'QueryOrderLight',
        ),
      ).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(50);
      const result = await pending;
      expect(
        result.sections[0]?.rows.every((row) => row.price !== null && row.inventory === true),
      ).toBe(true);
      expect(result.sections[0]?.diagnostics).toContainEqual(
        expect.objectContaining({ api: QUOTA, errorCode: 'TIMEOUT' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates caller cancellation while aborting the independent requests', async () => {
    const api = authenticatedApi();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options) =>
      options.api === SUBSCRIPTION ? new Promise<never>(() => {}) : original(options),
    );
    const controller = new AbortController();
    const pending = new TokenPlanListService(api.client, 1000).getTokenPlanList({
      authenticated: true,
      edition: 'individual',
      signal: controller.signal,
    });
    const error = new Error('Mock caller cancelled');
    const assertion = expect(pending).rejects.toBe(error);
    await vi.waitFor(() => expect(api.callOrchestrationApi).toHaveBeenCalled());
    controller.abort(error);
    await assertion;
    expect(api.callCsDataApi.mock.calls.every(([options]) => options.signal?.aborted)).toBe(true);
    expect(api.callOrchestrationApi.mock.calls.every(([options]) => options.signal?.aborted)).toBe(
      true,
    );
  });

  it('keeps currentPlan a string and preserves subscription identity and unknown remaining Credits after billing-cycle lookup fails', async () => {
    const api = authenticatedApi();

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      authenticated: true,
      edition: 'individual',
    });

    expect(result.authenticated).toBe(true);
    expect(api.callOrchestrationApi).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'QueryOrderLight', authMode: 'optional' }),
    );
    expect(
      api.callOrchestrationApi.mock.calls.filter(
        ([options]) => options.action === 'QueryOrderLight',
      ),
    ).toHaveLength(4);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.subscriptionStatus).toBe('active');
    expect(result.sections[0]?.subscriptionUrl).toBe(
      'https://home.qwencloud.com/analytics/token-plan/individual',
    );
    expect(result.sections[0]?.currentPlan).toEqual(expect.any(String));
    expect(result.sections[0]?.currentBillingCycle).toBeNull();
    expect(result.sections[0]?.currentPlanDetails).toMatchObject({
      subscriptionId: 'mock-personal-instance',
      endAt: '2026-11-01T00:00:00.000Z',
      totalCredits: '200',
      remainingCredits: null,
      usedPct: 25,
      remainingPct: 75,
      quotaWindowType: 'weekly',
    });
    expect(result.sections[0]?.plans?.[0]?.promoPrice).toBe('8.01');
    expect(
      api.callCsDataApi.mock.calls.filter(([options]) => options.api === SUBSCRIPTION),
    ).toHaveLength(1);
    expect(api.callCsDataApi.mock.calls.filter(([options]) => options.api === USAGE)).toHaveLength(
      1,
    );
    expect(
      api.callCsDataApi.mock.calls.filter(
        ([options]) => options.api === QUOTA && options.authMode === 'none',
      ),
    ).toHaveLength(1);
    expect(
      api.callCsDataApi.mock.calls.filter(
        ([options]) => options.api === QUOTA && options.authMode === 'required',
      ),
    ).toHaveLength(1);
    expect(
      api.callOrchestrationApi.mock.calls.filter(([options]) => options.action === 'QueryInstance'),
    ).toHaveLength(1);
    expect(api.callFlatApi).not.toHaveBeenCalled();
  });

  it('keeps a confirmed no-subscription state distinct from a failed current query', async () => {
    const api = authenticatedApi();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options) =>
      options.api === SUBSCRIPTION
        ? options.parse({ code: 'SUCCESS', success: true })
        : original(options),
    );

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      authenticated: true,
      edition: 'individual',
    });

    expect(result.sections[0]).toMatchObject({
      subscriptionStatus: 'not_subscribed',
      currentPlan: null,
      currentPlanDetails: null,
      subscriptionUrl: null,
    });
    expect(result.sections[0]?.plans).toHaveLength(4);
    expect(api.callCsDataApi).not.toHaveBeenCalledWith(expect.objectContaining({ api: USAGE }));
    expect(api.callCsDataApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ api: QUOTA, authMode: 'required' }),
    );
  });

  it('preserves the public catalog and unknown current state on subscription failure', async () => {
    const api = authenticatedApi();
    const original = api.callCsDataApi.getMockImplementation()!;
    api.callCsDataApi.mockImplementation(async (options) => {
      if (options.api === SUBSCRIPTION) throw new Error('Mock current subscription failure');
      return original(options);
    });

    const result = await new TokenPlanListService(api.client).getTokenPlanList({
      authenticated: true,
      edition: 'individual',
    });

    expect(result.sections[0]).toMatchObject({
      subscriptionStatus: 'unknown',
      currentPlan: null,
      currentPlanDetails: null,
      subscriptionUrl: null,
    });
    expect(result.sections[0]?.plans).toHaveLength(4);
    expect(result.sections[0]?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ api: SUBSCRIPTION })]),
    );
    expect(api.callCsDataApi).not.toHaveBeenCalledWith(expect.objectContaining({ api: USAGE }));
  });
});

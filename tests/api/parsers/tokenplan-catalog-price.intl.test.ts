import { describe, expect, it } from 'vitest';
import { parseTokenPlanCatalogPrice } from '../../../src/api/parsers/tokenplan-catalog-price.js';
import { buildTokenPlanCatalogConfiguration } from '../../../src/services/tokenplan-catalog-pricing.js';

const personalCommodity = {
  successResponse: true,
  viewModel: { id: 'sfm_tokenplansolo_public_intl', name: 'Mock Personal Token Plan' },
  componentsMeta: { subscription_type: { name: 'Tier' }, ord_time: { name: 'Term' } },
  components: {
    subscription_type: { subscription_type: [{ value: 'lite', text: 'Lite' }] },
    ord_time: {
      ord_time: [
        { value: '1:Month', text: 'Monthly' },
        { value: '3:Month', text: 'Quarterly' },
        { value: '1:Year', text: 'Yearly' },
      ],
    },
  },
};

const teamCommodity = {
  successResponse: true,
  viewModel: { id: 'sfm_tokenplanteams_dp_intl', name: 'Mock Team Token Plan' },
  componentsMeta: {
    subscription_spec: { name: 'Specs' },
    credit_value: { name: 'Credits' },
    ord_time: { name: 'Term' },
  },
  components: {
    subscription_spec: {
      plan_type: [{ value: 'pro', text: 'Pro' }],
      quota_cycle: [{ value: 'byDynamicMonth', text: 'Monthly' }],
    },
    credit_value: { credit_value: [{ value: '100000', text: '100,000 Credits' }] },
    ord_time: {
      ord_time: [
        { value: '1:Month', text: 'Monthly' },
        { value: '1:Year', text: 'Yearly' },
      ],
    },
  },
  constraint: {
    credit_value: { plan_type: { pro: ['100000'] } },
    seat_num: { plan_type: { pro: [{ min: 0, max: 150, step: 1 }] } },
  },
};

function personalArticle(price: Record<string, unknown>, currency = 'USD', tier = 'lite') {
  return {
    ...price,
    settlement: { pricingCurrency: currency },
    moduleResults: [
      { moduleCode: 'subscription_type', moduleAttributeMap: { subscription_type: tier } },
    ],
  };
}

describe('International catalog price units', () => {
  it('normalizes personal list and explicit promotional cents exactly once', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'individual',
      'lite',
      'monthly',
      personalCommodity,
    );
    const raw = {
      price: {
        articleItemResults: [
          personalArticle({ price: { totalPrice: 2001, discountedTotalPrice: 1501 } }),
        ],
      },
    };

    const result = parseTokenPlanCatalogPrice(raw, configuration, {
      edition: 'individual',
      specCode: 'lite',
      includeListPrice: true,
    });

    expect(result).toMatchObject({
      price: '15.01',
      originalPrice: '20.01',
      listPrice: '20.01',
      promoPrice: '15.01',
      currency: 'USD',
    });
  });

  it('normalizes lightweight article cents and keeps an absent promotional price unknown', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'individual',
      'lite',
      'monthly',
      personalCommodity,
    );
    const raw = { price: { articleItemResults: [personalArticle({ standPrice: 2001 })] } };

    const result = parseTokenPlanCatalogPrice(raw, configuration, {
      edition: 'individual',
      specCode: 'lite',
      includeListPrice: true,
    });

    expect(result.price).toBe('20.01');
    expect(result.listPrice).toBe('20.01');
    expect(result.promoPrice).toBeNull();
    expect(result.currency).toBe('USD');
  });

  it('preserves a major-unit team order price rather than dividing it a second time', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'team',
      'pro',
      'yearly',
      teamCommodity,
    );
    const raw = {
      price: {
        order: { standPrice: 240.01, currency: 'USD' },
      },
    };

    const result = parseTokenPlanCatalogPrice(raw, configuration, {
      edition: 'team',
      specCode: 'pro',
      includeListPrice: true,
    });

    expect(result.price).toBe('240.01');
    expect(result.listPrice).toBe('240.01');
    expect(result.promoPrice).toBeNull();
    expect(result.currency).toBe('USD');
    expect(result.monthlyCredits).toBeNull();
  });

  it('prefers the matching article cents over a different major-unit order price', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'team',
      'pro',
      'yearly',
      teamCommodity,
    );
    const raw = {
      price: {
        order: { standPrice: 990.01, currency: 'USD' },
        articleItemResults: [
          {
            standPrice: 24001,
            moduleResults: [
              {
                moduleCode: 'subscription_spec',
                moduleAttributeMap: {
                  plan_type: 'pro',
                  credit_value: '100000',
                  quota_cycle: 'byDynamicMonth',
                },
              },
            ],
          },
        ],
      },
    };

    const result = parseTokenPlanCatalogPrice(raw, configuration, {
      edition: 'team',
      specCode: 'pro',
      includeListPrice: true,
    });

    expect(result.price).toBe('240.01');
    expect(result.listPrice).toBe('240.01');
    expect(result.promoPrice).toBeNull();
    expect(result.currency).toBe('USD');
    expect(result.monthlyCredits).toBe('100000');
  });

  it('keeps the explicit zero promotion instead of treating it as absent', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'individual',
      'lite',
      'monthly',
      personalCommodity,
    );
    const raw = {
      price: {
        articleItemResults: [
          personalArticle({ price: { totalPrice: 2000, discountedTotalPrice: 0 } }),
        ],
      },
    };

    const result = parseTokenPlanCatalogPrice(raw, configuration, {
      edition: 'individual',
      specCode: 'lite',
      includeListPrice: true,
    });

    expect(result.price).toBe('0');
    expect(result.promoPrice).toBe('0');
    expect(result.listPrice).toBe('20');
  });

  it('retains the reported settlement currency without applying a CNY-only rule', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'individual',
      'lite',
      'monthly',
      personalCommodity,
    );
    const raw = { price: { articleItemResults: [personalArticle({ standPrice: 2001 }, 'EUR')] } };

    const result = parseTokenPlanCatalogPrice(raw, configuration, {
      edition: 'individual',
      specCode: 'lite',
    });

    expect(result.currency).toBe('EUR');
    expect(result.price).toBe('20.01');
    expect(result).not.toHaveProperty('listPrice');
  });

  it('selects the requested tier rather than reusing the first article price', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'individual',
      'lite',
      'monthly',
      personalCommodity,
    );
    const raw = {
      price: {
        articleItemResults: [
          personalArticle({ standPrice: 9901 }, 'USD', 'pro'),
          personalArticle({ standPrice: 2001 }, 'USD', 'lite'),
        ],
      },
    };

    const result = parseTokenPlanCatalogPrice(raw, configuration, {
      edition: 'individual',
      specCode: 'lite',
    });

    expect(result.price).toBe('20.01');
  });

  it('rejects an unconfirmed price instead of inventing zero', () => {
    const configuration = buildTokenPlanCatalogConfiguration(
      'individual',
      'lite',
      'monthly',
      personalCommodity,
    );

    expect(() =>
      parseTokenPlanCatalogPrice({ price: { articleItemResults: [] } }, configuration, {
        edition: 'individual',
        specCode: 'lite',
      }),
    ).toThrow();
  });
});

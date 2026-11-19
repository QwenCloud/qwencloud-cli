import { describe, expect, it } from 'vitest';
import {
  buildTokenPlanPricingPageConfiguration,
  getTokenPlanPricingPageMetadata,
} from '../../src/services/tokenplan-configuration.js';

const personalMetadata = {
  billingCycles: ['monthly', 'quarterly', 'yearly'],
  tiers: [
    { specCode: 'lite', name: 'Lite', monthlyCredits: null },
    { specCode: 'essential', name: 'Essential', monthlyCredits: null },
    { specCode: 'standard', name: 'Standard', monthlyCredits: null },
    { specCode: 'pro', name: 'Pro', monthlyCredits: null },
  ],
};
const teamMetadata = {
  billingCycles: ['monthly', 'yearly'],
  tiers: [
    { specCode: 'standard', name: 'Standard', monthlyCredits: '25000' },
    { specCode: 'pro', name: 'Pro', monthlyCredits: '100000' },
    { specCode: 'max', name: 'Max', monthlyCredits: '250000' },
  ],
};

const root = {
  chargeType: 'PREPAY',
  autoRenew: false,
  orderType: 'BUY',
  quantity: 1,
  orderParams: {},
  config: {},
  isMainDataMode: '',
  couponForSpecItem: false,
  couponNum: '',
};

describe('Pricing page declared Token Plan specifications', () => {
  it('returns the four personal tiers and three purchase cycles without inventing monthly quotas', () => {
    expect(getTokenPlanPricingPageMetadata('individual')).toEqual(personalMetadata);
  });

  it('returns the three team tiers with their declared per-seat monthly Credits', () => {
    expect(getTokenPlanPricingPageMetadata('team')).toEqual(teamMetadata);
  });

  it('isolates returned metadata from mutations in an earlier execution', () => {
    const first = getTokenPlanPricingPageMetadata('team');
    first.tiers[0]!.monthlyCredits = '0';
    first.tiers[0]!.name = 'Mock overwritten tier';
    first.billingCycles!.push('quarterly');

    expect(getTokenPlanPricingPageMetadata('team')).toEqual(teamMetadata);
    expect(getTokenPlanPricingPageMetadata('individual')).toEqual(personalMetadata);
  });
});

describe.each([
  ['lite', '基础套餐'],
  ['essential', 'Essential套餐'],
  ['standard', '标准套餐'],
  ['pro', '高级套餐'],
] as const)('Personal pricing page configuration for %s', (tier, propertyName) => {
  it.each([
    ['monthly', 'Month', '1', '个月'],
    ['quarterly', 'Month', '3', '个月'],
    ['yearly', 'Year', '1', '年'],
  ] as const)(
    'constructs the complete %s quotation configuration',
    (billingCycle, pricingCycle, duration, pricingCycleTitle) => {
      const result = buildTokenPlanPricingPageConfiguration('individual', tier, billingCycle);

      expect(result).toEqual({
        ...root,
        commodityCode: 'sfm_tokenplansolo_public_intl',
        specCode: 'sfm_tokenplansolo_public_intl',
        commodityName: 'Token Plan 个人版',
        chargeTypeTitle: 'Prepaid',
        pricingCycle,
        duration,
        pricingCycleTitle,
        components: [
          {
            componentCode: 'subscription_type',
            componentName: '套餐类型',
            instanceProperty: [{ code: 'subscription_type', name: propertyName, value: tier }],
          },
          {
            componentCode: 'region',
            componentName: '地域',
            instanceProperty: [{ code: 'region', name: '新加坡', value: 'ap-southeast-1' }],
          },
        ],
      });
    },
  );
});

describe.each([
  ['standard', '25000'],
  ['pro', '100000'],
  ['max', '250000'],
] as const)('Team pricing page configuration for %s', (tier, monthlyCredits) => {
  it.each([
    ['monthly', 'Month', '1', '个月'],
    ['yearly', 'Year', '1', '年'],
  ] as const)(
    'constructs the complete single-seat %s quotation configuration',
    (billingCycle, pricingCycle, duration, pricingCycleTitle) => {
      const result = buildTokenPlanPricingPageConfiguration('team', tier, billingCycle);

      expect(result).toEqual({
        ...root,
        commodityCode: 'sfm_tokenplanteams_dp_intl',
        specCode: 'sfm_tokenplanteams_dp_intl',
        pricingCycle,
        duration,
        pricingCycleTitle,
        components: [
          {
            componentCode: 'subscription_spec',
            componentName: '权益规格',
            instanceProperty: [
              { code: 'plan_type', name: '标准坐席', value: tier },
              { code: 'quota_cycle', name: '按动态月', value: 'byDynamicMonth' },
              { code: 'credit_value', name: 'Credits额度', value: monthlyCredits },
              { code: 'seat_num', name: '坐席', value: '1' },
            ],
          },
          {
            componentCode: 'offering_type',
            componentName: '付费类型',
            instanceProperty: [{ code: 'offering_type', name: '全预付', value: 'total' }],
          },
          {
            componentCode: 'showtime',
            componentName: '生效时间选择',
            instanceProperty: [{ code: 'showtime', name: '下单后立即生效', value: 'now' }],
          },
          {
            componentCode: 'aliyun_open_time',
            componentName: '指定时间',
            instanceProperty: [
              { code: 'aliyun_open_time', name: '指定时间', value: 'aliyun_open_time' },
            ],
          },
        ],
      });
    },
  );

  it('rejects an unsupported quarterly team quotation', () => {
    expect(() => buildTokenPlanPricingPageConfiguration('team', tier, 'quarterly')).toThrow();
  });
});

describe('Pricing page configuration validation and isolation', () => {
  it.each([
    ['individual', 'max'],
    ['individual', 'Lite'],
    ['individual', ''],
    ['team', 'lite'],
    ['team', 'future'],
    ['team', ''],
  ] as const)('rejects an undeclared %s tier %j', (edition, tier) => {
    expect(() => buildTokenPlanPricingPageConfiguration(edition, tier, 'monthly')).toThrow();
  });

  it.each([
    ['individual', 'lite'],
    ['team', 'standard'],
  ] as const)(
    'does not reuse mutable %s root parameters or component values from an earlier quotation',
    (edition, tier) => {
      const first = buildTokenPlanPricingPageConfiguration(edition, tier, 'monthly');
      first.quantity = 99;
      (first.orderParams as Record<string, unknown>).mockOverride = true;
      (first.config as Record<string, unknown>).mockOverride = true;
      const components = first.components as Array<{ instanceProperty: Array<{ value: string }> }>;
      components[0]!.instanceProperty[0]!.value = 'mock-overwritten-tier';

      const next = buildTokenPlanPricingPageConfiguration(edition, tier, 'monthly');
      expect(next).not.toBe(first);
      expect(next).toMatchObject({ quantity: 1, orderParams: {}, config: {} });
      expect(next.orderParams).not.toHaveProperty('mockOverride');
      expect(next.config).not.toHaveProperty('mockOverride');
      const nextComponents = next.components as Array<{
        instanceProperty: Array<{ value: string }>;
      }>;
      expect(nextComponents[0]!.instanceProperty[0]!.value).toBe(tier);
    },
  );
});

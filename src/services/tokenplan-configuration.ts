import { GatewayShapeError } from '../api/request-adapter.js';
import {
  parseTokenPlanCatalogCommodity,
  tokenPlanCatalogChoices,
  tokenPlanCatalogRecord,
} from '../api/parsers/tokenplan-catalog.js';
import { site } from '../site.js';
import type {
  TokenPlanBillingCycle,
  TokenPlanCatalogMetadata,
} from '../types/tokenplan-catalog.js';
import type { TokenPlanEdition } from '../types/tokenplan-subscription.js';
import {
  isTokenPlanIndividualTier,
  TOKEN_PLAN_INDIVIDUAL_TIERS,
} from '../types/tokenplan-tiers.js';
import { DecimalAmount } from '../utils/decimal-amount.js';

type Property = { code: string; value: string; name?: string };
type Component = { componentCode: string; componentName?: string; instanceProperty: Property[] };

const TEAM_PRICING_PAGE_TIERS = [
  { specCode: 'standard', name: 'Standard', monthlyCredits: '25000' },
  { specCode: 'pro', name: 'Pro', monthlyCredits: '100000' },
  { specCode: 'max', name: 'Max', monthlyCredits: '250000' },
] as const;

/** Return the declared pricing-page selectors, independently of live prices. */
export function getTokenPlanPricingPageMetadata(
  edition: TokenPlanEdition,
): TokenPlanCatalogMetadata {
  if (edition === 'individual') {
    return {
      billingCycles: ['monthly', 'quarterly', 'yearly'],
      tiers: TOKEN_PLAN_INDIVIDUAL_TIERS.map(({ specCode, name }) => ({
        specCode,
        name,
        monthlyCredits: null,
      })),
    };
  }
  if (edition !== 'team') return invalidConfiguration();
  return {
    billingCycles: ['monthly', 'yearly'],
    tiers: TEAM_PRICING_PAGE_TIERS.map((tier) => ({ ...tier })),
  };
}

/** Build a single pricing-page quote without requiring purchase metadata. */
export function buildTokenPlanPricingPageConfiguration(
  edition: TokenPlanEdition,
  specCode: string,
  billingCycle: TokenPlanBillingCycle,
): Record<string, unknown> {
  const catalog = getTokenPlanPricingPageMetadata(edition);
  const tier = catalog.tiers.find((entry) => entry.specCode === specCode);
  if (!tier || !catalog.billingCycles?.includes(billingCycle)) return invalidConfiguration();
  const individualNames: Record<string, string> = {
    lite: '基础套餐',
    essential: 'Essential套餐',
    standard: '标准套餐',
    pro: '高级套餐',
  };
  const components: Component[] =
    edition === 'individual'
      ? [
          {
            componentCode: 'subscription_type',
            componentName: '套餐类型',
            instanceProperty: [
              { code: 'subscription_type', name: individualNames[specCode], value: specCode },
            ],
          },
          {
            componentCode: 'region',
            componentName: '地域',
            instanceProperty: [{ code: 'region', name: '新加坡', value: site.defaults.region }],
          },
        ]
      : [
          {
            componentCode: 'subscription_spec',
            componentName: '权益规格',
            instanceProperty: [
              { code: 'plan_type', name: '标准坐席', value: specCode },
              { code: 'quota_cycle', name: '按动态月', value: 'byDynamicMonth' },
              { code: 'credit_value', name: 'Credits额度', value: tier.monthlyCredits! },
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
        ];
  const commodityCode = tokenPlanCommodityCode(edition);
  return {
    commodityCode,
    specCode: commodityCode,
    ...(edition === 'individual'
      ? { commodityName: 'Token Plan 个人版', chargeTypeTitle: 'Prepaid' }
      : {}),
    chargeType: 'PREPAY',
    autoRenew: false,
    orderType: 'BUY',
    quantity: 1,
    duration: billingCycle === 'quarterly' ? '3' : '1',
    pricingCycle: billingCycle === 'yearly' ? 'Year' : 'Month',
    pricingCycleTitle: billingCycle === 'yearly' ? '年' : '个月',
    components,
    orderParams: {},
    config: {},
    isMainDataMode: '',
    couponForSpecItem: false,
    couponNum: '',
  };
}

export function tokenPlanCommodityCode(edition: TokenPlanEdition): string {
  return edition === 'individual'
    ? site.features.tokenPlanCommodityCodes.soloBuy
    : site.features.tokenPlanCommodityCodes.teams;
}

function invalidConfiguration(): never {
  throw new GatewayShapeError('Token Plan catalog configuration is invalid');
}

export function buildTokenPlanCatalogConfigurationData(
  edition: TokenPlanEdition,
  specCode: string,
  billingCycle: TokenPlanBillingCycle,
  data: unknown,
): Record<string, unknown> {
  if (
    !['individual', 'team'].includes(edition) ||
    (edition === 'individual' && !isTokenPlanIndividualTier(specCode))
  )
    return invalidConfiguration();
  const cycles = {
    monthly: ['1', 'Month', 'Month(s)'],
    quarterly: ['3', 'Month', 'Month(s)'],
    yearly: ['1', 'Year', 'Year(s)'],
  } as const;
  const cycle = cycles[billingCycle];
  if (!cycle || (edition === 'team' && billingCycle === 'quarterly')) return invalidConfiguration();
  const [duration, pricingCycle, pricingCycleTitle] = cycle;
  const commodityCode = tokenPlanCommodityCode(edition);
  const raw = parseTokenPlanCatalogCommodity(data, commodityCode);
  const meta = tokenPlanCatalogRecord(raw.componentsMeta)!;
  const view = tokenPlanCatalogRecord(raw.viewModel)!;
  const components: Component[] = [];
  const declared = (code: string): boolean => tokenPlanCatalogRecord(meta[code]) !== null;
  const option = (component: string, value: string, property = component): Property => {
    const matches = tokenPlanCatalogChoices(raw, component, property)
      .map(tokenPlanCatalogRecord)
      .filter((entry) => entry?.value === value);
    if (matches.length !== 1 || !value || value.trim() !== value) return invalidConfiguration();
    const name = matches[0]?.text;
    return { code: property, value, ...(typeof name === 'string' && name.trim() ? { name } : {}) };
  };
  const add = (code: string, properties: Property[]): void => {
    if (!declared(code)) return invalidConfiguration();
    const name = tokenPlanCatalogRecord(meta[code])?.name;
    components.push({
      componentCode: code,
      ...(typeof name === 'string' ? { componentName: name } : {}),
      instanceProperty: properties,
    });
  };
  if (edition === 'individual') {
    add('subscription_type', [option('subscription_type', specCode)]);
  } else {
    const plan = option('plan_type', specCode);
    const constraint = tokenPlanCatalogRecord(raw.constraint);
    const creditValues = tokenPlanCatalogRecord(
      tokenPlanCatalogRecord(constraint?.credit_value)?.plan_type,
    )?.[specCode];
    if (
      !Array.isArray(creditValues) ||
      creditValues.length !== 1 ||
      typeof creditValues[0] !== 'string'
    )
      return invalidConfiguration();
    DecimalAmount.parse(creditValues[0]);
    const credit = option('credit_value', creditValues[0]);
    const ranges = tokenPlanCatalogRecord(
      tokenPlanCatalogRecord(constraint?.seat_num)?.plan_type,
    )?.[specCode];
    if (ranges !== undefined) {
      if (!Array.isArray(ranges) || ranges.length !== 1) return invalidConfiguration();
      const range = tokenPlanCatalogRecord(ranges[0]);
      const min = range?.min;
      const max = range?.max;
      const step = range?.step;
      if (
        typeof min !== 'number' ||
        typeof max !== 'number' ||
        typeof step !== 'number' ||
        !Number.isSafeInteger(min) ||
        !Number.isSafeInteger(max) ||
        !Number.isSafeInteger(step) ||
        min < 0 ||
        max < min ||
        step < 1 ||
        1 < min ||
        1 > max ||
        (1 - min) % step !== 0
      )
        return invalidConfiguration();
    }
    if (declared('subscription_spec')) {
      const choices = tokenPlanCatalogChoices(raw, 'subscription_spec', 'quota_cycle');
      if (choices.length !== 1) return invalidConfiguration();
      const quotaCycle = tokenPlanCatalogRecord(choices[0])?.value;
      if (typeof quotaCycle !== 'string') return invalidConfiguration();
      add('subscription_spec', [
        plan,
        option('subscription_spec', quotaCycle, 'quota_cycle'),
        credit,
        { code: 'seat_num', value: '1' },
      ]);
    } else {
      add('plan_type', [plan]);
      add('credit_value', [credit]);
      if (declared('seat_num')) add('seat_num', [{ code: 'seat_num', value: '1' }]);
    }
    for (const code of ['offering_type', 'showtime', 'aliyun_open_time'] as const) {
      if (!declared(code)) continue;
      const value = tokenPlanCatalogRecord(tokenPlanCatalogChoices(raw, code)[0])?.value;
      if (typeof value !== 'string') return invalidConfiguration();
      add(code, [option(code, value)]);
    }
    if (declared('pack')) {
      const packs = tokenPlanCatalogRecord(tokenPlanCatalogRecord(constraint?.pack)?.plan_type)?.[
        specCode
      ];
      if (Array.isArray(packs) && packs.length === 1 && typeof packs[0] === 'string')
        add('pack', [option('pack', packs[0])]);
    }
  }
  const orderTime = `${duration}:${pricingCycle}`;
  if (declared('ord_time')) add('ord_time', [option('ord_time', orderTime)]);
  if (declared('region')) add('region', [option('region', site.defaults.region)]);
  for (const [code, value] of Object.entries(meta)) {
    const required = tokenPlanCatalogRecord(value)?.required;
    if (required !== undefined && typeof required !== 'boolean') return invalidConfiguration();
    if (required === true && !components.some((component) => component.componentCode === code))
      return invalidConfiguration();
  }
  return {
    commodityCode,
    specCode: commodityCode,
    ...(typeof view.name === 'string' ? { commodityName: view.name } : {}),
    chargeType: 'PREPAY',
    autoRenew: false,
    orderType: 'BUY',
    quantity: 1,
    duration,
    pricingCycle,
    pricingCycleTitle,
    components,
    orderParams: {},
    config: {},
    isMainDataMode: '',
    couponForSpecItem: false,
    couponNum: '',
  };
}

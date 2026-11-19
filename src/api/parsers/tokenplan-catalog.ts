import { GatewayShapeError } from '../request-adapter.js';
import type { TokenPlanEdition } from '../../types/tokenplan-subscription.js';
import type {
  TokenPlanBillingCycle,
  TokenPlanCatalogMetadata,
} from '../../types/tokenplan-catalog.js';
import { TOKEN_PLAN_INDIVIDUAL_TIERS } from '../../types/tokenplan-tiers.js';

export interface TokenPlanCatalogQuotaWindow {
  five_hour: number | null;
  weekly: number | null;
  monthly: number | null;
  fiveHourInvalid?: true;
  weeklyInvalid?: true;
  monthlyInvalid?: true;
}

export type TokenPlanCatalogQuota = Partial<Record<string, TokenPlanCatalogQuotaWindow>>;

export function tokenPlanCatalogRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null;
}

function invalidCatalog(): never {
  throw new GatewayShapeError('Token Plan commodity response is invalid');
}

export function parseTokenPlanCatalogCommodity(
  value: unknown,
  commodityCode: string,
): Record<string, unknown> {
  const raw = tokenPlanCatalogRecord(value);
  const view = tokenPlanCatalogRecord(raw?.viewModel);
  if (
    raw?.successResponse !== true ||
    view?.id !== commodityCode ||
    (view?.commodityCode !== undefined && view.commodityCode !== commodityCode) ||
    !tokenPlanCatalogRecord(raw.components) ||
    !tokenPlanCatalogRecord(raw.componentsMeta)
  )
    return invalidCatalog();
  return raw;
}

function label(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function tokenPlanCatalogChoices(
  commodity: Record<string, unknown>,
  component: string,
  property = component,
): unknown[] {
  const components = tokenPlanCatalogRecord(commodity.components);
  const grouped = tokenPlanCatalogRecord(components?.subscription_spec)?.[property];
  const independent = tokenPlanCatalogRecord(components?.[component])?.[property];
  const choices =
    ['plan_type', 'credit_value', 'seat_num'].includes(component) && Array.isArray(grouped)
      ? grouped
      : independent;
  return Array.isArray(choices) ? choices : [];
}

function uniqueChoice(choices: unknown[], value: string): Record<string, unknown> | null {
  const matches = choices.filter((choice) => tokenPlanCatalogRecord(choice)?.value === value);
  return matches.length === 1 ? tokenPlanCatalogRecord(matches[0]) : null;
}

function billingCycles(
  choices: unknown[],
  edition: TokenPlanEdition,
): TokenPlanBillingCycle[] | null {
  if (choices.length === 0) return null;
  const mapping: Record<string, TokenPlanBillingCycle> = {
    '1:Month': 'monthly',
    '3:Month': 'quarterly',
    '1:Year': 'yearly',
  };
  const result = new Set<TokenPlanBillingCycle>();
  for (const choice of choices) {
    const value = tokenPlanCatalogRecord(choice)?.value;
    if (typeof value !== 'string' || !value) return null;
    const cycle = mapping[value];
    if (!cycle) continue;
    if (result.has(cycle)) return null;
    result.add(cycle);
  }
  return [...result].filter((cycle) => edition === 'individual' || cycle !== 'quarterly');
}

export function parseTokenPlanCatalogMetadata(
  data: unknown,
  edition: TokenPlanEdition,
  commodityCode: string,
): TokenPlanCatalogMetadata {
  const raw = parseTokenPlanCatalogCommodity(data, commodityCode);
  const components = tokenPlanCatalogRecord(raw.components)!;
  const grouped = tokenPlanCatalogRecord(components.subscription_spec);
  const tierChoices =
    edition === 'individual'
      ? tokenPlanCatalogRecord(components.subscription_type)?.subscription_type
      : (grouped?.plan_type ?? tokenPlanCatalogRecord(components.plan_type)?.plan_type);
  if (!Array.isArray(tierChoices)) return invalidCatalog();
  const choices = tokenPlanCatalogChoices(
    raw,
    edition === 'individual' ? 'subscription_type' : 'plan_type',
  );
  const creditChoices = tokenPlanCatalogChoices(raw, 'credit_value');
  const creditConstraint = tokenPlanCatalogRecord(
    tokenPlanCatalogRecord(tokenPlanCatalogRecord(raw.constraint)?.credit_value)?.plan_type,
  );
  const quotaChoices = tokenPlanCatalogChoices(raw, 'subscription_spec', 'quota_cycle');
  const monthlyQuota =
    quotaChoices.length === 1 && uniqueChoice(quotaChoices, 'byDynamicMonth') !== null;
  const specs =
    edition === 'individual'
      ? TOKEN_PLAN_INDIVIDUAL_TIERS.map((tier) => tier.specCode)
      : choices.map((choice) => {
          const value = tokenPlanCatalogRecord(choice)?.value;
          if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 100)
            return invalidCatalog();
          return value;
        });
  if (new Set(specs).size !== specs.length) return invalidCatalog();
  return {
    billingCycles: billingCycles(tokenPlanCatalogChoices(raw, 'ord_time'), edition),
    tiers: specs.flatMap((specCode) => {
      const choice = uniqueChoice(choices, specCode);
      if (!choice) return [];
      let monthlyCredits: string | null = null;
      const constraint = creditConstraint?.[specCode];
      if (
        edition === 'team' &&
        monthlyQuota &&
        Array.isArray(constraint) &&
        constraint.length === 1
      ) {
        const value: unknown = constraint[0];
        if (
          typeof value === 'string' &&
          /^(0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value) &&
          uniqueChoice(creditChoices, value)
        ) {
          monthlyCredits = value;
        }
      }
      return [{ specCode, name: label(choice.text), monthlyCredits }];
    }),
  };
}

function credits(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseTokenPlanCatalogQuota(business: unknown): TokenPlanCatalogQuota {
  const data = tokenPlanCatalogRecord(tokenPlanCatalogRecord(business)?.data);
  if (!data) throw new GatewayShapeError('Personal Token Plan quota configuration is invalid');
  const result: TokenPlanCatalogQuota = {};
  for (const { specCode } of TOKEN_PLAN_INDIVIDUAL_TIERS) {
    if (!Object.hasOwn(data, specCode)) continue;
    const quota = tokenPlanCatalogRecord(data[specCode]);
    if (!quota) throw new GatewayShapeError('Personal Token Plan quota configuration is invalid');
    const fiveHour = credits(quota.five_hour);
    const weekly = credits(quota.weekly);
    const monthly = credits(quota.monthly);
    result[specCode] = {
      five_hour: fiveHour,
      weekly,
      monthly,
      ...(quota.five_hour != null && fiveHour === null ? { fiveHourInvalid: true as const } : {}),
      ...(quota.weekly != null && weekly === null ? { weeklyInvalid: true as const } : {}),
      ...(quota.monthly != null && monthly === null ? { monthlyInvalid: true as const } : {}),
    };
  }
  return result;
}

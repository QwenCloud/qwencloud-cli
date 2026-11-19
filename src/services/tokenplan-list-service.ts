import type { ApiClient } from '../api/api-client.js';
import { GatewayShapeError } from '../api/request-adapter.js';
import {
  parseSoloCatalogBillingCycle,
  parseSoloCatalogSubscription,
  parseSoloSubscriptionCore,
  parseSoloStatusUsage,
} from '../api/parsers/solo-subscription.js';
import {
  parseTokenPlanCatalogQuota,
  tokenPlanCatalogRecord as record,
  type TokenPlanCatalogQuota,
} from '../api/parsers/tokenplan-catalog.js';
import { site } from '../site.js';
import type { SubscriptionDiagnostic } from '../types/subscription.js';
import type { TokenPlanEdition } from '../types/tokenplan-subscription.js';
import type {
  TokenPlanBillingCycle,
  TokenPlanListOptions,
  TokenPlanListResult,
  TokenPlanListRow,
  TokenPlanListSection,
  TokenPlanCatalogPlan,
  TokenPlanCurrentPlanDetails,
} from '../types/tokenplan-catalog.js';
import {
  TOKEN_PLAN_INDIVIDUAL_TIERS,
  findTokenPlanIndividualTierBySpecCode,
} from '../types/tokenplan-tiers.js';
import { DecimalAmount } from '../utils/decimal-amount.js';
import { ratioPercentages } from '../utils/percentage.js';
import { CliError } from '../utils/errors.js';
import { safeSubscriptionDiagnostic } from './subscription-diagnostics.js';
import {
  createTokenPlanBenefitsReader,
  type TokenPlanBenefitsReader,
} from './tokenplan-benefits.js';
import { TokenPlanCatalogPricing } from './tokenplan-catalog-pricing.js';
import { parseTeamSeatTypeSummaries, teamResponseData } from './tokenplan-team.js';
import {
  buildTokenPlanPricingPageConfiguration,
  getTokenPlanPricingPageMetadata,
  tokenPlanCommodityCode,
} from './tokenplan-configuration.js';

const SUBSCRIPTION_API = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription';
const QUOTA_API = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config';
const USAGE_API = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage';

interface QueryResult<T> {
  value: T | null;
  diagnostics: SubscriptionDiagnostic[];
}
interface CatalogSubscription {
  status: TokenPlanListSection['subscriptionStatus'];
  currentPlan: string | null;
  currentBillingCycle: TokenPlanBillingCycle | null;
  details: TokenPlanCurrentPlanDetails | null;
  diagnostics: SubscriptionDiagnostic[];
  instanceCode?: string | null;
}

function diagnostic(api: string, errorCode: string, errorMessage: string): SubscriptionDiagnostic {
  return { api, errorCode, errorMessage };
}

function preciseQuota(value: unknown): string | null {
  if (value == null) return null;
  try {
    return DecimalAmount.fromApi(value).toCanonicalString();
  } catch {
    return null;
  }
}

function timestamp(value: unknown): string | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const milliseconds = Number(value);
    return Number.isSafeInteger(milliseconds) &&
      milliseconds > 0 &&
      milliseconds <= 8_640_000_000_000_000
      ? new Date(milliseconds).toISOString()
      : null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString()
    : null;
}

function emptyDetails(): TokenPlanCurrentPlanDetails {
  return { subscriptionId: null, endAt: null, totalCredits: null, remainingCredits: null };
}

function skipped<T>(): Promise<QueryResult<T>> {
  return Promise.resolve({ value: null, diagnostics: [] });
}

async function query<T>(
  api: string,
  signal: AbortSignal,
  request: () => Promise<T>,
): Promise<QueryResult<T>> {
  const stopped = (): QueryResult<T> => ({
    value: null,
    diagnostics: [
      diagnostic(api, 'TIMEOUT', 'The service did not respond in time. Try again later.'),
    ],
  });
  if (signal.aborted) return stopped();
  let onAbort: () => void = () => {};
  const interruption = new Promise<QueryResult<T>>((resolve) => {
    onAbort = () => resolve(stopped());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return request();
        })
        .then(
          (value): QueryResult<T> => ({ value, diagnostics: [] }),
          (error: unknown): QueryResult<T> => ({
            value: null,
            diagnostics: [safeSubscriptionDiagnostic(api, error)],
          }),
        ),
      interruption,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function unavailableSection(edition: TokenPlanEdition, error: unknown): TokenPlanListSection {
  return {
    edition,
    billingCycleSupported: null,
    subscriptionStatus: 'unknown',
    currentPlan: null,
    currentBillingCycle: null,
    subscriptionUrl: null,
    rows: [],
    plans: [],
    currentPlanDetails: null,
    diagnostics: [safeSubscriptionDiagnostic(`TokenPlanList/${edition}`, error)],
  };
}

function baseStatus(
  price: { price: string } | null,
  inventory: boolean | null,
): TokenPlanListRow['status'] {
  if (inventory === false) return 'unavailable';
  return price && inventory === true ? 'purchasable' : 'unknown';
}

function rowStatus(
  edition: TokenPlanEdition,
  subscription: CatalogSubscription | null,
  cycle: TokenPlanBillingCycle,
  specCode: string,
  price: { price: string } | null,
  inventory: boolean | null,
): TokenPlanListRow['status'] {
  if (subscription?.status !== 'active') return baseStatus(price, inventory);
  if (edition === 'team') return 'subscribed';
  if (subscription.currentBillingCycle !== null && subscription.currentBillingCycle !== cycle)
    return 'unavailable';
  if (subscription.currentPlan === specCode) return 'subscribed';
  const current = TOKEN_PLAN_INDIVIDUAL_TIERS.findIndex(
    (tier) => tier.specCode === subscription.currentPlan,
  );
  const candidate = TOKEN_PLAN_INDIVIDUAL_TIERS.findIndex((tier) => tier.specCode === specCode);
  if (current < 0 || candidate < 0) return 'unknown';
  return candidate > current ? 'upgrade' : 'unavailable';
}

function teamInstances(value: unknown): Record<string, unknown>[] {
  const envelope = record(value);
  if (envelope) {
    for (const field of ['Success', 'success', 'successResponse']) {
      if (Object.hasOwn(envelope, field) && envelope[field] !== true) {
        throw new GatewayShapeError('Team Token Plan subscription was rejected');
      }
    }
    for (const field of ['Code', 'code']) {
      if (
        Object.hasOwn(envelope, field) &&
        !['200', 'SUCCESS', 'Success'].includes(String(envelope[field]))
      ) {
        throw new GatewayShapeError('Team Token Plan subscription was rejected');
      }
    }
  }
  const candidates = Array.isArray(value)
    ? [value]
    : envelope
      ? ['Data', 'data'].filter((key) => Object.hasOwn(envelope, key)).map((key) => envelope[key])
      : [];
  const items = candidates[0];
  if (
    !Array.isArray(items) ||
    candidates.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(items))
  )
    throw new GatewayShapeError('Team Token Plan catalog subscription is invalid');
  return items
    .map((value) => {
      const instance = record(value);
      if (!instance) throw new GatewayShapeError('Team Token Plan catalog subscription is invalid');
      if (typeof instance.SpecType !== 'string' || !instance.SpecType.trim()) {
        throw new GatewayShapeError('Team Token Plan subscription tier is missing');
      }
      const quantity = instance.Quantity ?? 1;
      if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 0)
        throw new GatewayShapeError('Team Token Plan subscription quantity is invalid');
      return instance;
    })
    .filter((instance) => (instance.Quantity ?? 1) !== 0);
}

function teamDetails(
  value: unknown,
  diagnostics: SubscriptionDiagnostic[],
): TokenPlanCurrentPlanDetails {
  const details: TokenPlanCurrentPlanDetails = {
    subscriptionId: null,
    endAt: null,
    totalCredits: null,
    remainingCredits: null,
  };
  const data = teamResponseData(value, 'GetSeatSubscriptionSummary', diagnostics);
  if (data === null) return details;
  details.endAt = timestamp(data.EndTime ?? data.PeriodEnd);
  const summaries = parseTeamSeatTypeSummaries(value, diagnostics);
  if (summaries === null) return details;
  // A seat ID cannot stand in for a subscription ID. Aggregate only complete
  // Credits snapshots whose refresh windows agree across seat types.
  const sameWindow =
    summaries.length === 1 ||
    (summaries.length > 1 &&
      summaries[0]!.resetAt !== null &&
      summaries.every((summary) => summary.resetAt === summaries[0]!.resetAt));
  if (
    sameWindow &&
    diagnostics.length === 0 &&
    summaries.every((summary) => summary.totalCredits !== null && summary.remainingCredits !== null)
  ) {
    details.totalCredits = summaries
      .reduce(
        (total, summary) => total.add(DecimalAmount.parse(summary.totalCredits!)),
        DecimalAmount.parse('0'),
      )
      .toCanonicalString();
    details.remainingCredits = summaries
      .reduce(
        (total, summary) => total.add(DecimalAmount.parse(summary.remainingCredits!)),
        DecimalAmount.parse('0'),
      )
      .toCanonicalString();
  } else if (diagnostics.length === 0) {
    diagnostics.push(
      diagnostic(
        'GetSeatSubscriptionSummary',
        'INCOMPLETE_CREDIT_SUMMARY',
        'Team credit totals are unavailable because the quota snapshots are incomplete or use different refresh windows.',
      ),
    );
  }
  return details;
}

export class TokenPlanListService {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly timeoutMs = 30_000,
  ) {}

  async getTokenPlanList(options: TokenPlanListOptions = {}): Promise<TokenPlanListResult> {
    const authenticated = options.authenticated === true;
    const edition = options.edition ?? 'all';
    const billingCycle = options.billingCycle ?? 'monthly';
    if (
      !['all', 'individual', 'team'].includes(edition) ||
      !['monthly', 'quarterly', 'yearly'].includes(billingCycle)
    )
      throw new CliError({
        code: 'TOKENPLAN_CATALOG_OPTIONS_INVALID',
        message: 'Token Plan edition or billing cycle is unsupported.',
        exitCode: 4,
      });
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const benefits = createTokenPlanBenefitsReader(this.apiClient, controller.signal);
    const editions: TokenPlanEdition[] = edition === 'all' ? ['individual', 'team'] : [edition];
    try {
      const results = await Promise.allSettled(
        editions.map((requested) =>
          this.loadEdition(
            requested,
            billingCycle,
            authenticated,
            controller.signal,
            options,
            benefits,
          ),
        ),
      );
      options.signal?.throwIfAborted();
      const sections = results.map((result, index) =>
        result.status === 'fulfilled'
          ? result.value
          : unavailableSection(editions[index], result.reason),
      );
      const hasData = sections.some((section) =>
        section.rows.some((row) => row.price !== null || row.inventory !== null),
      );
      return {
        authenticated,
        edition,
        billingCycle,
        completeness: sections.every((section) => section.diagnostics.length === 0)
          ? 'complete'
          : hasData
            ? 'partial'
            : 'unknown',
        sections,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      controller.abort();
    }
  }

  private async individualSubscription(
    commodityCode: string,
    signal: AbortSignal,
  ): Promise<CatalogSubscription> {
    const response = await this.apiClient.callCsDataApi({
      api: SUBSCRIPTION_API,
      data: { commodityCode },
      signal,
      parse: (business) => ({
        ...parseSoloCatalogSubscription(business),
        core: parseSoloSubscriptionCore(record(business)?.data),
      }),
    });
    const status =
      response.status === 'active'
        ? 'active'
        : response.status === 'none'
          ? 'not_subscribed'
          : 'unknown';
    const details = status === 'active' ? { ...emptyDetails(), ...response.core } : null;
    const diagnostics: SubscriptionDiagnostic[] = [];
    if (status === 'unknown')
      diagnostics.push(
        diagnostic(
          SUBSCRIPTION_API,
          'UNCONFIRMED_SUBSCRIPTION',
          'The service did not confirm the subscription state.',
        ),
      );
    return {
      status,
      currentPlan: status === 'active' ? response.specCode : null,
      currentBillingCycle: null,
      details,
      diagnostics,
      instanceCode: response.instanceCode,
    };
  }

  private async teamSubscription(
    commodityCode: string,
    signal: AbortSignal,
  ): Promise<CatalogSubscription> {
    const response = await this.apiClient.callFlatApi<unknown>({
      product: 'BssOpenAPI-V3',
      action: 'GetUserInstanceSummary',
      version: '2023-09-30',
      params: { ProductCode: commodityCode },
      signal,
    });
    const instances = teamInstances(response);
    const status = instances.length > 0 ? 'active' : 'not_subscribed';
    const details = status === 'active' ? emptyDetails() : null;
    const instanceId =
      instances.length === 1 ? (instances[0].InstanceID ?? instances[0].InstanceId) : null;
    return {
      status,
      currentPlan: null,
      currentBillingCycle: null,
      details,
      diagnostics: [],
      instanceCode: typeof instanceId === 'string' && instanceId.trim() ? instanceId : null,
    };
  }

  private async loadSubscription(
    edition: TokenPlanEdition,
    commodityCode: string,
    signal: AbortSignal,
  ): Promise<QueryResult<CatalogSubscription>> {
    const subscription = await query(
      edition === 'individual' ? SUBSCRIPTION_API : 'GetUserInstanceSummary',
      signal,
      () =>
        edition === 'individual'
          ? this.individualSubscription(commodityCode, signal)
          : this.teamSubscription(commodityCode, signal),
    );
    const confirmed = subscription.value;
    if (confirmed?.status === 'active' && confirmed.instanceCode) {
      // Supplemental details share the deadline without erasing the confirmed subscription.
      const period = await query('QueryInstance', signal, () =>
        this.apiClient.callOrchestrationApi({
          action: 'QueryInstance',
          path: '/data/custom.json',
          authMode: 'required',
          params: { instanceId: confirmed.instanceCode, commodityCode, orderType: 'RENEW' },
          signal,
          parse: parseSoloCatalogBillingCycle,
        }),
      );
      confirmed.currentBillingCycle = period.value;
      confirmed.diagnostics.push(...period.diagnostics);
      if (edition === 'individual' && period.value === null && period.diagnostics.length === 0)
        confirmed.diagnostics.push(
          diagnostic(
            'QueryInstance',
            'UNKNOWN_BILLING_CYCLE',
            'The subscription billing cycle is unavailable.',
          ),
        );
    }
    return subscription;
  }

  private async loadEdition(
    edition: TokenPlanEdition,
    billingCycle: TokenPlanBillingCycle,
    authenticated: boolean,
    signal: AbortSignal,
    options: TokenPlanListOptions,
    benefits: TokenPlanBenefitsReader,
  ): Promise<TokenPlanListSection> {
    if (edition === 'team' && billingCycle === 'quarterly')
      return {
        edition,
        billingCycleSupported: false,
        subscriptionStatus: 'unknown',
        currentPlan: null,
        currentBillingCycle: null,
        subscriptionUrl: null,
        rows: [],
        plans: [],
        currentPlanDetails: null,
        diagnostics: [],
      };
    const commodityCode = tokenPlanCommodityCode(edition);
    const pricing = new TokenPlanCatalogPricing(this.apiClient);
    // Public quotation and model reads progress independently of account queries.
    const subscriptionPromise = authenticated
      ? this.loadSubscription(edition, commodityCode, signal)
      : skipped<CatalogSubscription>();
    const modelsPromise = options.includeModels
      ? query('TokenPlanSupportedModels', signal, () => benefits.loadModels(edition))
      : skipped<Awaited<ReturnType<typeof benefits.loadModels>>>();
    const quotaPromise =
      edition === 'individual'
        ? query(QUOTA_API, signal, () =>
            this.apiClient.callCsDataApi({
              api: QUOTA_API,
              data: {},
              authMode: 'none',
              signal,
              parse: parseTokenPlanCatalogQuota,
            }),
          )
        : skipped<TokenPlanCatalogQuota>();
    const catalog = getTokenPlanPricingPageMetadata(edition);
    const supported = catalog.billingCycles!.includes(billingCycle);
    const rowsAndPlans = await Promise.all(
      catalog.tiers.map(async (tier) => {
        const { specCode } = tier;
        const configuration = await query(`Configuration/${specCode}`, signal, async () =>
          buildTokenPlanPricingPageConfiguration(edition, specCode, billingCycle),
        );
        const [price, inventory] = configuration.value
          ? await Promise.all([
              query(`TokenPlanPrice/${specCode}`, signal, () =>
                pricing.getPrice(configuration.value!, {
                  edition,
                  specCode,
                  authenticated,
                  signal,
                  includeListPrice: true,
                  ...(edition === 'team' && tier.monthlyCredits !== null
                    ? { expectedMonthlyCredits: tier.monthlyCredits }
                    : {}),
                }),
              ),
              query(`CheckInventory/${specCode}`, signal, () =>
                pricing.getInventory(configuration.value!, { authenticated, signal }),
              ),
            ])
          : [
              await skipped<Awaited<ReturnType<typeof pricing.getPrice>>>(),
              await skipped<boolean>(),
            ];
        const quota = await quotaPromise;
        const limits = edition === 'individual' ? quota.value?.[specCode] : undefined;
        const individualTier = findTokenPlanIndividualTierBySpecCode(specCode);
        const monthly = limits && limits.weekly == null ? preciseQuota(limits.monthly) : null;
        const row: TokenPlanListRow = {
          type:
            edition === 'individual'
              ? (individualTier?.type ?? `token_plan_individual_${specCode}`)
              : 'token_plan_team',
          specCode,
          seatType: edition === 'team' ? specCode : null,
          name: tier.name ?? (edition === 'individual' ? (individualTier?.name ?? null) : null),
          price: price.value?.price ?? null,
          currency: price.value?.currency ?? null,
          inventory: inventory.value,
          ...(limits?.weekly == null ? {} : { weeklyCredits: limits.weekly }),
          monthlyCredits:
            edition === 'individual'
              ? monthly
              : (tier.monthlyCredits ?? price.value?.monthlyCredits ?? null),
          status: baseStatus(price.value, inventory.value),
        };
        const quotaWindows: TokenPlanCatalogPlan['quotaWindows'] = [];
        if (edition === 'individual') {
          for (const windowType of ['five_hour', 'weekly', 'monthly'] as const) {
            const totalCredits = preciseQuota(limits?.[windowType]);
            if (totalCredits !== null) quotaWindows.push({ windowType, totalCredits });
          }
        } else if (row.monthlyCredits !== null) {
          const totalCredits = preciseQuota(row.monthlyCredits);
          if (totalCredits !== null) quotaWindows.push({ windowType: 'monthly', totalCredits });
        }
        const plan: TokenPlanCatalogPlan = {
          ...(edition === 'individual' ? { tier: specCode } : { seatType: specCode }),
          billingTerm: billingCycle,
          listPrice: price.value?.listPrice ?? null,
          promoPrice: price.value?.promoPrice ?? null,
          currency: price.value?.currency ?? null,
          quotaWindows,
        };
        const errors = [
          ...configuration.diagnostics,
          ...price.diagnostics,
          ...inventory.diagnostics,
        ];
        for (const [invalid, code, window] of [
          [limits?.fiveHourInvalid, 'INVALID_FIVE_HOUR_QUOTA', 'five-hour'],
          [limits?.weeklyInvalid, 'INVALID_WEEKLY_QUOTA', 'weekly'],
          [limits?.monthlyInvalid, 'INVALID_MONTHLY_QUOTA', 'monthly'],
        ] as const) {
          if (invalid)
            errors.push(diagnostic(QUOTA_API, code, `The ${window} credit limit is invalid.`));
        }
        return { row, plan, diagnostics: errors };
      }),
    );
    const rows = rowsAndPlans.map((entry) => entry.row);
    const plans = rowsAndPlans.map((entry) => entry.plan);
    const [subscription, quota] = await Promise.all([subscriptionPromise, quotaPromise]);
    const diagnostics = [
      ...subscription.diagnostics,
      ...(subscription.value?.diagnostics ?? []),
      ...quota.diagnostics,
    ];
    for (const row of rows) {
      row.status =
        authenticated && (!subscription.value || subscription.value.status === 'unknown')
          ? 'unknown'
          : rowStatus(
              edition,
              subscription.value,
              billingCycle,
              row.specCode,
              row.price === null ? null : { price: row.price },
              row.inventory,
            );
    }
    diagnostics.push(...rowsAndPlans.flatMap((entry) => entry.diagnostics));
    if (
      rows.some(
        (row) =>
          row.name === null ||
          (edition === 'team'
            ? row.monthlyCredits === null
            : row.weeklyCredits === undefined && row.monthlyCredits === null),
      )
    )
      diagnostics.push(
        diagnostic(
          'TokenPlanList',
          'INCOMPLETE_FIELDS',
          'Some names or credit limits are unknown.',
        ),
      );
    const subscriptionStatus = subscription.value?.status ?? 'unknown';
    const teamSummaryDiagnostics: SubscriptionDiagnostic[] = [];
    const [models, usage, accountQuota, teamSummary] = await Promise.all([
      modelsPromise,
      edition === 'individual' && subscriptionStatus === 'active'
        ? query(USAGE_API, signal, () =>
            this.apiClient.callCsDataApi({
              api: USAGE_API,
              data: {},
              authMode: 'required',
              signal,
              parse: parseSoloStatusUsage,
            }),
          )
        : skipped<ReturnType<typeof parseSoloStatusUsage>>(),
      edition === 'individual' && subscriptionStatus === 'active'
        ? query(QUOTA_API, signal, () =>
            this.apiClient.callCsDataApi({
              api: QUOTA_API,
              data: {},
              authMode: 'required',
              signal,
              parse: parseTokenPlanCatalogQuota,
            }),
          )
        : skipped<TokenPlanCatalogQuota>(),
      edition === 'team' && subscriptionStatus === 'active'
        ? query('GetSeatSubscriptionSummary', signal, async () =>
            teamDetails(
              await this.apiClient.callFlatApi<unknown>({
                product: 'BssOpenAPI-V3',
                action: 'GetSeatSubscriptionSummary',
                params: { productCode: commodityCode },
                signal,
              }),
              teamSummaryDiagnostics,
            ),
          )
        : skipped<TokenPlanCurrentPlanDetails>(),
    ]);
    diagnostics.push(
      ...models.diagnostics,
      ...usage.diagnostics,
      ...accountQuota.diagnostics,
      ...teamSummary.diagnostics,
      ...teamSummaryDiagnostics,
    );
    for (const plan of plans) if (options.includeModels) plan.supportedModels = models.value;
    let currentPlanDetails =
      subscriptionStatus === 'active' ? (subscription.value?.details ?? emptyDetails()) : null;
    if (currentPlanDetails && edition === 'individual') {
      const currentQuota = subscription.value?.currentPlan
        ? accountQuota.value?.[subscription.value.currentPlan]
        : undefined;
      Object.assign(currentPlanDetails, ratioPercentages(usage.value?.usedRatio));
      currentPlanDetails.quotaWindowType = usage.value?.cycle ?? null;
      currentPlanDetails.totalCredits = usage.value
        ? preciseQuota(currentQuota?.[usage.value.cycle])
        : null;
      if (
        usage.value &&
        currentPlanDetails.totalCredits === null &&
        accountQuota.diagnostics.length === 0
      ) {
        diagnostics.push(
          diagnostic(
            QUOTA_API,
            'MISSING_ACCOUNT_QUOTA',
            'The account credit limit for this quota window is unavailable.',
          ),
        );
      }
      if (!usage.value && usage.diagnostics.length === 0)
        diagnostics.push(
          diagnostic(
            USAGE_API,
            'MISSING_USAGE_RATIO',
            'Remaining personal quota percentage is unavailable.',
          ),
        );
    }
    if (currentPlanDetails && teamSummary.value) currentPlanDetails = teamSummary.value;
    const consoleBase = new URL(site.apiKeyConsoleUrl).origin;
    return {
      edition,
      billingCycleSupported: supported,
      subscriptionStatus,
      currentPlan: subscription.value?.currentPlan ?? null,
      currentBillingCycle: subscription.value?.currentBillingCycle ?? null,
      subscriptionUrl:
        subscriptionStatus === 'active'
          ? new URL(`/analytics/token-plan/${edition}`, consoleBase).href
          : null,
      rows,
      diagnostics,
      currentPlanDetails,
      plans,
    };
  }
}

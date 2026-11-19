import type { ApiClient } from '../api/api-client.js';
import { site } from '../site.js';
import {
  parseSoloSubscription,
  parseSoloQuotaConfig,
  parseSoloStatusUsage,
  parseSoloSubscriptionCore,
  type SoloSubscription,
} from '../api/parsers/solo-subscription.js';
import type {
  TokenPlanAutoRenew,
  TokenPlanEditionStatus,
} from '../types/tokenplan-subscription.js';
import {
  API_TOKENPLAN_SOLO_SUBSCRIPTION,
  API_TOKENPLAN_SOLO_QUOTA_CONFIG,
  API_TOKENPLAN_SOLO_USAGE,
  API_PRODUCT_BSS_PAYMENT,
} from '../types/api-routes.js';
import { findTokenPlanIndividualTierBySpecCode } from '../types/tokenplan-tiers.js';
import {
  safeSubscriptionDiagnostic,
  subscriptionProtocolDiagnostic,
} from './subscription-diagnostics.js';
import { awaitCsDataOperation, checkCsDataSignal } from '../auth/cs-data-session.js';
import { DecimalAmount } from '../utils/decimal-amount.js';
import { ratioPercentages } from '../utils/percentage.js';

export function subscriptionObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function subscriptionInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function subscriptionDecimal(value: unknown): string | null {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? value : null;
}

export function subscriptionTimestamp(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) return null;
    return new Date(value).toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function matchedIndividualAutoRenewFlag(
  subscription: SoloSubscription,
  value: unknown,
): boolean | null {
  const raw = subscriptionObject(value);
  const data = subscriptionObject(raw?.Data);
  if (
    !raw ||
    raw.Success !== true ||
    raw.Code !== 'Success' ||
    !data ||
    !Array.isArray(data.InstanceList)
  ) {
    return null;
  }

  type RenewalCandidate = {
    instanceId: string | null;
    endTime: number | null;
    renewStatus: boolean | null;
  };
  const relevant = data.InstanceList.reduce<RenewalCandidate[]>((instances, entry) => {
    const instance = subscriptionObject(entry);
    if (!instance || instance.ProductType !== site.features.tokenPlanCommodityCodes.soloBuy) {
      return instances;
    }
    const endTime = subscriptionTimestamp(instance.EndTime);
    const renewStatus =
      instance.RenewStatus === 'AutoRenewal'
        ? true
        : instance.RenewStatus === 'ManualRenewal'
          ? false
          : null;
    if (
      typeof instance.InstanceID !== 'string' ||
      !instance.InstanceID.trim() ||
      instance.Status !== 'Normal' ||
      instance.SubStatus !== 'Normal' ||
      instance.SubscriptionType !== 'Subscription' ||
      endTime === null ||
      Date.parse(endTime) <= Date.now()
    ) {
      instances.push({ instanceId: null, endTime: null, renewStatus: null });
      return instances;
    }
    instances.push({ instanceId: instance.InstanceID, endTime: Date.parse(endTime), renewStatus });
    return instances;
  }, []);
  const active = relevant.filter(
    (instance): instance is { instanceId: string; endTime: number; renewStatus: boolean | null } =>
      instance.instanceId !== null && instance.endTime !== null,
  );

  const byInstanceId = active.filter(
    (instance) => instance.instanceId === subscription.instanceCode,
  );
  if (byInstanceId.length > 0) {
    return byInstanceId.length === 1 ? byInstanceId[0].renewStatus : null;
  }

  const byEndTime = active.filter((instance) => instance.endTime === subscription.endTime);
  if (byEndTime.length > 0) {
    return byEndTime.length === 1 ? byEndTime[0].renewStatus : null;
  }

  const pageNum = subscriptionInteger(data.PageNum);
  const pageSize = subscriptionInteger(data.PageSize);
  const totalCount = subscriptionInteger(data.TotalCount);
  const complete =
    pageNum === 1 &&
    pageSize !== null &&
    pageSize > 0 &&
    totalCount === data.InstanceList.length &&
    data.InstanceList.length <= pageSize;
  return complete && relevant.length === 1 && active.length === 1 ? active[0].renewStatus : null;
}

/** Prefer the billing instance used by the console, then fall back to its subscription flag. */
export function resolveIndividualAutoRenewFlag(
  subscription: SoloSubscription,
  value: unknown,
): boolean {
  return matchedIndividualAutoRenewFlag(subscription, value) ?? subscription.autoRenewFlag;
}

/** Confirm renewal only for the exact subscription identity, without legacy heuristics. */
export function confirmedIndividualAutoRenew(
  subscription: SoloSubscription,
  value: unknown,
): TokenPlanAutoRenew | null {
  const raw = subscriptionObject(value);
  const data = subscriptionObject(raw?.Data);
  if (raw?.Success !== true || raw.Code !== 'Success' || !Array.isArray(data?.InstanceList)) {
    return null;
  }
  const matches = data.InstanceList.map(subscriptionObject).filter(
    (item) =>
      item?.InstanceID === subscription.instanceCode &&
      item.ProductCode === 'sfm' &&
      item.ProductType === site.features.tokenPlanCommodityCodes.soloBuy,
  );
  if (matches.length !== 1) return null;
  const item = matches[0]!;
  const enabled =
    item.RenewStatus === 'AutoRenewal' ? true : item.RenewStatus === 'ManualRenewal' ? false : null;
  return enabled === null
    ? null
    : {
        enabled,
        period: subscriptionInteger(item.RenewalDuration),
        periodUnit:
          typeof item.RenewalDurationUnit === 'string' && item.RenewalDurationUnit.trim()
            ? item.RenewalDurationUnit
            : null,
      };
}

export async function fetchIndividualTokenPlan(
  apiClient: ApiClient,
  signal?: AbortSignal,
): Promise<TokenPlanEditionStatus> {
  const result: TokenPlanEditionStatus = {
    edition: 'individual',
    commodityCode: site.features.tokenPlanCommodityCodes.soloBuy,
    status: 'unknown',
    type: null,
    name: null,
    specCode: null,
    period: null,
    remainingDays: null,
    autoRenew: null,
    confirmedAutoRenew: null,
    subscriptionId: null,
    endAt: null,
    seatSummary: null,
    tiers: [],
    completeness: 'unknown',
    diagnostics: [],
  };
  try {
    const run = <T>(operation: Promise<T>): Promise<T> =>
      signal ? awaitCsDataOperation(operation, signal) : operation;
    const response = await run(
      apiClient.callCsDataApi({
        api: API_TOKENPLAN_SOLO_SUBSCRIPTION,
        authMode: 'required',
        data: { commodityCode: result.commodityCode },
        signal,
        parse: (business) => ({
          subscription: parseSoloSubscription(business),
          core: parseSoloSubscriptionCore(subscriptionObject(business)?.data),
        }),
      }),
    );
    if (response.subscription.status === 'none') {
      result.status = 'not_subscribed';
      result.completeness = 'complete';
      return result;
    }
    const entity = response.subscription.subscription;
    if (response.subscription.status !== 'active' || !entity) {
      result.diagnostics.push(
        subscriptionProtocolDiagnostic(API_TOKENPLAN_SOLO_SUBSCRIPTION, 'UnconfirmedState'),
      );
      return result;
    }
    const tier = findTokenPlanIndividualTierBySpecCode(entity.specCode)!;
    Object.assign(result, response.core, {
      status: 'active',
      type: tier.type,
      name: tier.name,
      specCode: entity.specCode,
      period: {
        start: new Date(entity.startTime).toISOString(),
        end: new Date(entity.endTime).toISOString(),
        remainingDays: entity.remainingDays,
      },
      remainingDays: entity.remainingDays,
      autoRenew: { enabled: entity.autoRenewFlag, period: null, periodUnit: null },
    });
    const [quota, usage, renew] = await Promise.allSettled([
      run(
        apiClient.callCsDataApi({
          api: API_TOKENPLAN_SOLO_QUOTA_CONFIG,
          data: {},
          authMode: 'required',
          signal,
          parse: parseSoloQuotaConfig,
        }),
      ),
      run(
        apiClient.callCsDataApi({
          api: API_TOKENPLAN_SOLO_USAGE,
          data: {},
          authMode: 'required',
          signal,
          parse: parseSoloStatusUsage,
        }),
      ),
      run(
        apiClient.callFlatApi<unknown>({
          product: API_PRODUCT_BSS_PAYMENT,
          action: 'QueryAvailableInstances',
          params: {
            InstanceIDs: entity.instanceCode,
            ProductCode: 'sfm',
            ProductType: result.commodityCode,
            PageNum: 1,
            PageSize: 20,
          },
          signal,
        }),
      ),
    ]);
    if (
      signal?.aborted &&
      !(signal.reason instanceof Error && signal.reason.name === 'RequestTimeoutError')
    )
      checkCsDataSignal(signal);
    for (const [reply, api] of [
      [quota, API_TOKENPLAN_SOLO_QUOTA_CONFIG],
      [usage, API_TOKENPLAN_SOLO_USAGE],
      [renew, 'QueryAvailableInstances'],
    ] as const) {
      if (reply.status === 'rejected')
        result.diagnostics.push(safeSubscriptionDiagnostic(api, reply.reason));
    }
    if (renew.status === 'fulfilled') {
      result.confirmedAutoRenew = confirmedIndividualAutoRenew(entity, renew.value);
      if (result.confirmedAutoRenew === null)
        result.diagnostics.push(
          subscriptionProtocolDiagnostic('QueryAvailableInstances', 'UnconfirmedRenewal'),
        );
      result.autoRenew = {
        enabled: resolveIndividualAutoRenewFlag(entity, renew.value),
        period: null,
        periodUnit: null,
      };
    }
    if (usage.status === 'fulfilled' && usage.value !== null) {
      const selected = usage.value;
      const percentages = ratioPercentages(selected.usedRatio);
      const total =
        quota.status === 'fulfilled'
          ? (quota.value[entity.specCode]?.[selected.cycle] ?? null)
          : null;
      const resetAt =
        selected.resetTime === undefined ? null : new Date(selected.resetTime).toISOString();
      let totalCredits: string | null = null;
      if (total !== null) {
        try {
          totalCredits = DecimalAmount.fromApi(total).toCanonicalString();
        } catch {
          result.diagnostics.push(
            subscriptionProtocolDiagnostic(API_TOKENPLAN_SOLO_QUOTA_CONFIG, 'InvalidQuotaAmount'),
          );
        }
      }
      result.tiers = [
        {
          tier: entity.specCode,
          windowType: selected.cycle,
          totalCredits,
          remainingCredits: null,
          ...percentages,
          resetAt,
        },
      ];
      const credits = {
        total,
        used: null,
        remaining: null,
        usedPct: percentages.usedPct,
        ...(resetAt ? { resetTime: resetAt } : {}),
      };
      if (selected.cycle === 'weekly') result.weeklyCredits = credits;
      else result.monthlyCredits = credits;
      if (total === null)
        result.diagnostics.push(
          subscriptionProtocolDiagnostic(API_TOKENPLAN_SOLO_QUOTA_CONFIG, 'MissingQuotaWindow'),
        );
    } else if (usage.status === 'fulfilled')
      result.diagnostics.push(
        subscriptionProtocolDiagnostic(API_TOKENPLAN_SOLO_USAGE, 'MissingUsageWindow'),
      );
    result.completeness = result.diagnostics.length ? 'partial' : 'complete';
  } catch (error) {
    if (
      signal?.aborted &&
      !(signal.reason instanceof Error && signal.reason.name === 'RequestTimeoutError')
    )
      checkCsDataSignal(signal);
    result.diagnostics.push(safeSubscriptionDiagnostic(API_TOKENPLAN_SOLO_SUBSCRIPTION, error));
  }
  return result;
}

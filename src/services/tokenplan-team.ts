import type { ApiClient } from '../api/api-client.js';
import type { TokenPlan } from '../types/usage.js';
import type { FrInstanceItem } from '../types/api-models.js';
import type { SubscriptionDiagnostic } from '../types/subscription.js';
import type {
  TokenPlanEdition,
  TokenPlanEditionStatus,
  TokenPlanSeatGroup,
  TokenPlanSeatTypeSummary,
  TokenPlanAutoRenew,
  TokenPlanRenewable,
} from '../types/tokenplan-subscription.js';
import { site } from '../site.js';
import { DecimalAmount } from '../utils/decimal-amount.js';
import {
  safeSubscriptionDiagnostic,
  subscriptionProtocolDiagnostic,
} from './subscription-diagnostics.js';
import {
  subscriptionObject,
  subscriptionInteger,
  subscriptionTimestamp,
} from './tokenplan-individual.js';
import { awaitCsDataOperation } from '../auth/cs-data-session.js';
import { hasConsistentCreditUnits } from './tokenplan-credit-units.js';

const API_PRODUCT_BSS = 'BssOpenAPI-V3';

function subscriptionDiagnostic(api: string, errorCode: string): SubscriptionDiagnostic {
  return subscriptionProtocolDiagnostic(api, errorCode);
}

const failedSubscriptionDiagnostic = safeSubscriptionDiagnostic;

function subscriptionDecimal(value: unknown): string | null {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? value : null;
}

function statusCreditDecimal(value: unknown): string | null {
  try {
    return DecimalAmount.fromApi(value).toCanonicalString();
  } catch {
    return null;
  }
}

function isCreditsEquity(item: Record<string, unknown> | null): boolean {
  return (
    item?.EquityType === 'CREDITS' ||
    (item?.EquityType === undefined && item?.EquityCode === 'CREDITS')
  );
}

/** Validate the uniquely identified Credits right for all seat projections. */
export function parseTeamCreditValues(
  group: Record<string, unknown>,
  diagnostics: SubscriptionDiagnostic[],
): Pick<TokenPlanSeatTypeSummary, 'totalCredits' | 'remainingCredits'> {
  const api = 'GetSeatSubscriptionSummary';
  const rights = Array.isArray(group.EquityList)
    ? group.EquityList.map(subscriptionObject).filter(isCreditsEquity)
    : [];
  const right = rights.length === 1 ? rights[0] : null;
  const supportedUnit = hasConsistentCreditUnits(right, group);
  let totalCredits = supportedUnit ? statusCreditDecimal(right?.TotalValue) : null;
  let remainingCredits = supportedUnit ? statusCreditDecimal(right?.SurplusValue) : null;
  if (
    totalCredits !== null &&
    remainingCredits !== null &&
    DecimalAmount.parse(remainingCredits).compare(DecimalAmount.parse(totalCredits)) > 0
  ) {
    remainingCredits = null;
    diagnostics.push(subscriptionDiagnostic(api, 'InvalidCreditBalance'));
  }
  if (totalCredits === null || remainingCredits === null)
    diagnostics.push(subscriptionDiagnostic(api, 'IncompleteCredits'));
  // Preserve valid API string formatting in the legacy seat groups.
  if (totalCredits !== null && typeof right?.TotalValue === 'string')
    totalCredits = right.TotalValue;
  if (remainingCredits !== null && typeof right?.SurplusValue === 'string')
    remainingCredits = right.SurplusValue;
  return { totalCredits, remainingCredits };
}

export function unknownTokenPlanEdition(
  edition: TokenPlanEdition,
  diagnostics: SubscriptionDiagnostic[] = [],
): TokenPlanEditionStatus {
  return {
    edition,
    commodityCode:
      edition === 'individual'
        ? site.features.tokenPlanCommodityCodes.soloBuy
        : site.features.tokenPlanCommodityCodes.teams,
    status: 'unknown',
    type: edition === 'team' ? 'token_plan_team' : null,
    name: null,
    specCode: null,
    period: null,
    remainingDays: null,
    autoRenew: null,
    subscriptionId: null,
    endAt: null,
    seatSummary: null,
    completeness: 'unknown',
    diagnostics,
  };
}

export function hasConfirmedTokenPlanEdition(node?: TokenPlanEditionStatus): boolean {
  if (!node) return false;
  if (node.status === 'active' || node.status === 'not_subscribed') return true;
  if (node.edition !== 'team') return false;
  const summary = node.seatSummary;
  return (
    node.period !== null ||
    (node.seatSummaries?.some((row) => row.assignedCount !== null) ?? false) ||
    (summary !== null &&
      (summary.groups.some(
        (group) => group.seats !== null || group.totalValue !== null || group.surplusValue !== null,
      ) ||
        (summary.total !== null &&
          (summary.total.seats !== null ||
            summary.total.totalValue !== null ||
            summary.total.surplusValue !== null))))
  );
}

export interface TeamTokenPlanResult {
  team: TokenPlanEditionStatus;
  instanceId: string | null;
  legacy: Partial<TokenPlan>;
  legacyInstances: FrInstanceItem[];
}

export interface TokenPlanEditionResult {
  tokenPlan: TokenPlan;
  teamInstanceId: string | null;
  legacyInstances?: FrInstanceItem[];
}

export async function fetchTeamTokenPlan(
  apiClient: ApiClient,
  signal?: AbortSignal,
): Promise<TeamTokenPlanResult> {
  const run = <T>(operation: Promise<T>): Promise<T> =>
    signal ? awaitCsDataOperation(operation, signal) : operation;
  const team = unknownTokenPlanEdition('team');
  const result: TeamTokenPlanResult = { team, instanceId: null, legacy: {}, legacyInstances: [] };
  const api = 'DescribeFrInstances';
  try {
    const raw = subscriptionObject(
      await run(
        apiClient.callFlatApi<unknown>({
          product: API_PRODUCT_BSS,
          action: api,
          params: {
            Group: 'tokenPlan',
            CommodityCode: team.commodityCode,
            PageNum: 1,
            PageSize: 100,
          },
          signal,
        }),
      ),
    );
    if (
      !raw ||
      !Array.isArray(raw.Data) ||
      (raw.Success !== undefined && raw.Success !== true) ||
      (raw.Code !== undefined && raw.Code !== 'Success' && raw.Code !== '200')
    ) {
      team.diagnostics.push(subscriptionDiagnostic(api, 'InvalidResponse'));
      return result;
    }
    result.legacyInstances = raw.Data.slice(0, 10) as FrInstanceItem[];
    const pageSize = raw.PageSize === undefined ? 100 : subscriptionInteger(raw.PageSize);
    if (
      subscriptionInteger(raw.TotalCount) !== raw.Data.length ||
      raw.Data.length > 100 ||
      pageSize === null ||
      pageSize === 0 ||
      raw.Data.length > pageSize ||
      (raw.CurrentPage !== undefined && raw.CurrentPage !== 1) ||
      (raw.PageNum !== undefined && raw.PageNum !== 1)
    ) {
      team.diagnostics.push(subscriptionDiagnostic(api, 'IncompleteInstances'));
    }
    const active = new Map<string, Record<string, unknown>>();
    const instanceIds = new Set<string>();
    const now = Date.now();
    for (const entry of raw.Data) {
      const item = subscriptionObject(entry);
      if (!item || item.CommodityCode !== team.commodityCode) {
        team.diagnostics.push(subscriptionDiagnostic(api, 'CommodityMismatch'));
        continue;
      }
      if (typeof item.InstanceId !== 'string' || !item.InstanceId.trim()) {
        team.diagnostics.push(subscriptionDiagnostic(api, 'InvalidInstance'));
        continue;
      }
      if (instanceIds.has(item.InstanceId)) {
        team.diagnostics.push(subscriptionDiagnostic(api, 'DuplicateInstance'));
      }
      instanceIds.add(item.InstanceId);
      const status =
        typeof item.Status === 'string' ? item.Status : subscriptionObject(item.Status)?.Code;
      if (item.StatusCode !== undefined && item.StatusCode !== status) {
        team.diagnostics.push(subscriptionDiagnostic(api, 'UnconfirmedState'));
        continue;
      }
      const start =
        item.StartTime === undefined ? undefined : subscriptionTimestamp(item.StartTime);
      const end = item.EndTime === undefined ? undefined : subscriptionTimestamp(item.EndTime);
      if (
        start === null ||
        end === null ||
        (start && Date.parse(start) > now) ||
        (status === 'valid' && end && Date.parse(end) <= now) ||
        (start && end && Date.parse(start) >= Date.parse(end))
      ) {
        team.diagnostics.push(subscriptionDiagnostic(api, 'ConflictingPeriod'));
        continue;
      }
      if (status !== 'valid') {
        const expired =
          ((status === 'expire' || status === 'expired') && (!end || Date.parse(end) <= now)) ||
          (status === 'invalid' && end && Date.parse(end) <= now);
        if (!expired) team.diagnostics.push(subscriptionDiagnostic(api, 'UnconfirmedState'));
        continue;
      }
      active.set(item.InstanceId, item);
    }
    if (active.size === 0) {
      // Absence requires a complete, trustworthy page; known active instances
      // remain useful even when the rest of the response is incomplete.
      if (team.diagnostics.length === 0) team.status = 'not_subscribed';
      return result;
    }
    team.status = 'active';
    team.completeness = 'partial';
    if (team.diagnostics.length === 0) team.subscriptionIds = [...active.keys()];
    result.legacy = { subscribed: true, status: 'valid' };
    if (active.size === 1) {
      const [instanceId, item] = [...active.entries()][0];
      result.instanceId = instanceId;
      if (team.diagnostics.length === 0) team.subscriptionId = instanceId;
      const name = item.TemplateName ?? item.CommodityName;
      if (typeof name === 'string' && name.trim()) {
        team.name = name;
        result.legacy.planName = name;
      }
      const total = subscriptionDecimal(item.InitCapacityBaseValue);
      const remaining = subscriptionDecimal(
        item.CapacityTypeCode === 'periodMonthlyShift'
          ? (item.periodCapacityBaseValue ?? item.CurrCapacityBaseValue)
          : item.CurrCapacityBaseValue,
      );
      if (
        total !== null &&
        remaining !== null &&
        Number.isFinite(Number(total)) &&
        Number.isFinite(Number(remaining)) &&
        Number(remaining) <= Number(total)
      ) {
        result.legacy.totalCredits = Number(total);
        result.legacy.remainingCredits = Number(remaining);
        result.legacy.usedPct =
          Number(total) > 0 ? ((Number(total) - Number(remaining)) / Number(total)) * 100 : 0;
      }
      const end = subscriptionTimestamp(item.EndTime);
      if (end) result.legacy.resetDate = end;
    }
    return result;
  } catch (error) {
    team.diagnostics.push(failedSubscriptionDiagnostic(api, error));
    return result;
  }
}

export function teamResponseData(
  value: unknown,
  api: string,
  diagnostics: SubscriptionDiagnostic[],
): Record<string, unknown> | null {
  const raw = subscriptionObject(value);
  if (
    !raw ||
    (raw.Success !== undefined && raw.Success !== true) ||
    (raw.Code !== undefined && raw.Code !== 'Success')
  ) {
    diagnostics.push(subscriptionDiagnostic(api, 'Unavailable'));
    return null;
  }
  const inner = Object.hasOwn(raw, 'Data') ? subscriptionObject(raw.Data) : raw;
  if (
    !inner ||
    (inner.ProductCode !== undefined &&
      inner.ProductCode !== site.features.tokenPlanCommodityCodes.teams)
  ) {
    diagnostics.push(subscriptionDiagnostic(api, 'InvalidResponse'));
    return null;
  }
  return inner;
}

type TeamCreditCache = Map<Record<string, unknown>, ReturnType<typeof parseTeamCreditValues>>;

function buildTeamSeatGroups(
  seat: Record<string, unknown>,
  diagnostics: SubscriptionDiagnostic[],
  autoRenewEnabled: boolean | null,
  creditCache?: TeamCreditCache,
): TokenPlanSeatGroup[] {
  if (!Array.isArray(seat.SubscriptionGroupList)) return [];
  return seat.SubscriptionGroupList.flatMap((entry) => {
    const group = subscriptionObject(entry);
    if (!group) {
      diagnostics.push(subscriptionDiagnostic('GetSeatSubscriptionSummary', 'InvalidGroup'));
      return [];
    }
    const credits = creditCache?.get(group) ?? parseTeamCreditValues(group, diagnostics);
    creditCache?.set(group, credits);
    return [
      {
        specType:
          typeof group.SpecType === 'string' && group.SpecType.trim() ? group.SpecType : 'unknown',
        seats: subscriptionInteger(group.SubscriptionTotalNumber),
        assigned: subscriptionInteger(group.SubscriptionAssignedNumber),
        totalValue: credits.totalCredits,
        surplusValue: credits.remainingCredits,
        unit: 'Credits',
        nextCycleFlushTime:
          autoRenewEnabled === false ? null : subscriptionTimestamp(group.NextCycleFlushTime),
      },
    ];
  });
}

export function parseTeamSeatGroups(
  value: unknown,
  diagnostics: SubscriptionDiagnostic[],
): TokenPlanSeatGroup[] | null {
  const seat = teamResponseData(value, 'GetSeatSubscriptionSummary', diagnostics);
  return seat && Array.isArray(seat.SubscriptionGroupList)
    ? buildTeamSeatGroups(seat, diagnostics, null)
    : null;
}

/** Combine complete Credits snapshots only within the same seat type and refresh window. */
export function parseTeamSeatTypeSummaries(
  value: unknown,
  diagnostics: SubscriptionDiagnostic[],
): TokenPlanSeatTypeSummary[] | null {
  const seat = teamResponseData(value, 'GetSeatSubscriptionSummary', diagnostics);
  return seat ? buildTeamSeatTypeSummaries(seat, diagnostics) : null;
}

function buildTeamSeatTypeSummaries(
  seat: Record<string, unknown>,
  diagnostics: SubscriptionDiagnostic[],
  creditCache?: TeamCreditCache,
): TokenPlanSeatTypeSummary[] | null {
  const api = 'GetSeatSubscriptionSummary';
  if (!Array.isArray(seat.SubscriptionGroupList)) {
    if (Object.keys(seat).length === 0) return [];
    diagnostics.push(subscriptionDiagnostic(api, 'MissingGroups'));
    return null;
  }
  const groups = new Map<string, { summary: TokenPlanSeatTypeSummary; mergeable: boolean }>();
  for (const entry of seat.SubscriptionGroupList) {
    const group = subscriptionObject(entry);
    if (!group || typeof group.SpecType !== 'string' || !group.SpecType.trim()) {
      diagnostics.push(subscriptionDiagnostic(api, 'InvalidGroup'));
      continue;
    }
    const credits = creditCache?.get(group) ?? parseTeamCreditValues(group, diagnostics);
    creditCache?.set(group, credits);
    let totalCredits = statusCreditDecimal(credits.totalCredits);
    let remainingCredits = statusCreditDecimal(credits.remainingCredits);
    const seatCount = subscriptionInteger(group.SubscriptionTotalNumber);
    let assignedCount = subscriptionInteger(group.SubscriptionAssignedNumber);
    const resetAt = subscriptionTimestamp(group.NextCycleFlushTime);
    if (seatCount !== null && assignedCount !== null && assignedCount > seatCount) {
      assignedCount = null;
      diagnostics.push(subscriptionDiagnostic(api, 'InvalidAssignmentCount'));
    }
    const mergeable = totalCredits !== null && remainingCredits !== null;
    const summary: TokenPlanSeatTypeSummary = {
      seatType: group.SpecType,
      seatCount,
      assignedCount,
      totalCredits,
      remainingCredits,
      remainingPct: null,
      resetAt,
    };
    const previous = groups.get(summary.seatType);
    if (previous) {
      const sameWindow = resetAt !== null && previous.summary.resetAt === resetAt;
      const canMerge = previous.mergeable && mergeable && sameWindow;
      totalCredits = canMerge
        ? DecimalAmount.parse(previous.summary.totalCredits!)
            .add(DecimalAmount.parse(totalCredits!))
            .toCanonicalString()
        : null;
      remainingCredits = canMerge
        ? DecimalAmount.parse(previous.summary.remainingCredits!)
            .add(DecimalAmount.parse(remainingCredits!))
            .toCanonicalString()
        : null;
      previous.summary = {
        ...summary,
        seatCount:
          previous.summary.seatCount !== null && seatCount !== null
            ? subscriptionInteger(previous.summary.seatCount + seatCount)
            : null,
        assignedCount:
          previous.summary.assignedCount !== null && assignedCount !== null
            ? subscriptionInteger(previous.summary.assignedCount + assignedCount)
            : null,
        totalCredits,
        remainingCredits,
        resetAt: sameWindow ? resetAt : null,
      };
      previous.mergeable = canMerge;
      if (!canMerge) diagnostics.push(subscriptionDiagnostic(api, 'ConflictingCreditGroups'));
    } else groups.set(summary.seatType, { summary, mergeable });
  }
  if (seat.SubscriptionGroupList.length > 0 && groups.size === 0) return null;
  return [...groups.values()].map(({ summary }) => {
    const total = summary.totalCredits === null ? null : Number(summary.totalCredits);
    const remaining = summary.remainingCredits === null ? null : Number(summary.remainingCredits);
    return {
      ...summary,
      remainingPct:
        total !== null &&
        remaining !== null &&
        Number.isFinite(total) &&
        Number.isFinite(remaining) &&
        total > 0
          ? (remaining / total) * 100
          : null,
    };
  });
}

/** Only the documented numeric 0/1 values confirm team auto-renewal. */
export function confirmedTeamAutoRenew(value: unknown): TokenPlanAutoRenew | null {
  const raw = subscriptionObject(value);
  if (
    !raw ||
    (raw.Success !== undefined && raw.Success !== true) ||
    (raw.Code !== undefined && raw.Code !== 'Success')
  )
    return null;
  const data = Object.hasOwn(raw, 'Data') ? subscriptionObject(raw.Data) : raw;
  if (!data) return null;
  if (data.AutoRenewal !== 0 && data.AutoRenewal !== 1) return null;
  return {
    enabled: data.AutoRenewal === 1,
    period: subscriptionInteger(data.RenewalPeriod),
    periodUnit:
      typeof data.RenewalPeriodUnit === 'string' && data.RenewalPeriodUnit.trim()
        ? data.RenewalPeriodUnit
        : null,
  };
}

export function enrichTeamTokenPlan(
  source: TokenPlanEditionStatus,
  seatRaw: unknown,
  summaryRaw: unknown,
  autoRenewRaw: unknown,
): TokenPlanEditionStatus {
  const result = { ...source, diagnostics: [...source.diagnostics] };
  const seat = teamResponseData(seatRaw, 'GetSeatSubscriptionSummary', result.diagnostics);
  const summary = teamResponseData(summaryRaw, 'GetSubscriptionSummary', result.diagnostics);
  const autoRenew =
    result.status === 'not_subscribed'
      ? null
      : teamResponseData(autoRenewRaw, 'CheckTokenPlanAutoRenewal', result.diagnostics);
  if (autoRenew) {
    const value = autoRenew.AutoRenewal;
    const enabled =
      typeof value === 'boolean' ? value : value === 0 ? false : value === 1 ? true : null;
    if (enabled !== null) {
      result.autoRenew = {
        enabled,
        period: subscriptionInteger(autoRenew.RenewalPeriod),
        periodUnit:
          typeof autoRenew.RenewalPeriodUnit === 'string' && autoRenew.RenewalPeriodUnit.trim()
            ? autoRenew.RenewalPeriodUnit
            : null,
      };
    } else
      result.diagnostics.push(subscriptionDiagnostic('CheckTokenPlanAutoRenewal', 'InvalidFields'));
  }
  if (seat) {
    const start = subscriptionTimestamp(seat.StartTime ?? seat.PeriodStart);
    const end = subscriptionTimestamp(seat.EndTime ?? seat.PeriodEnd);
    const remainingDays =
      typeof seat.RemainingDays === 'string' && /^\d+$/.test(seat.RemainingDays)
        ? subscriptionInteger(Number(seat.RemainingDays))
        : subscriptionInteger(seat.RemainingDays);
    result.remainingDays = remainingDays;
    if (start && end && Date.parse(start) < Date.parse(end))
      result.period = { start, end, remainingDays };
    if (typeof seat.PlanName === 'string' && seat.PlanName.trim()) result.name = seat.PlanName;
  }
  const creditCache: TeamCreditCache = new Map();
  const groups = seat
    ? buildTeamSeatGroups(seat, result.diagnostics, result.autoRenew?.enabled ?? null, creditCache)
    : [];
  const total = summary
    ? {
        seats: subscriptionInteger(summary.TotalCount),
        totalValue: subscriptionDecimal(summary.TotalValue),
        surplusValue: subscriptionDecimal(summary.TotalSurplusValue),
        unit: 'Credits',
      }
    : null;
  if (
    summary &&
    [summary.TotalValue, summary.TotalSurplusValue].some(
      (value) => value !== undefined && value !== null && subscriptionDecimal(value) === null,
    )
  )
    result.diagnostics.push(subscriptionDiagnostic('GetSubscriptionSummary', 'InvalidFields'));
  const knownTotal =
    total && (total.seats !== null || total.totalValue !== null || total.surplusValue !== null)
      ? total
      : null;
  result.seatSummary =
    (seat && Array.isArray(seat.SubscriptionGroupList)) || knownTotal
      ? { groups, total: knownTotal }
      : null;
  result.subscriptionId = result.status === 'active' ? (source.subscriptionId ?? null) : null;
  if (result.status !== 'active') delete result.subscriptionIds;
  result.confirmedAutoRenew =
    result.status === 'not_subscribed' ? null : confirmedTeamAutoRenew(autoRenewRaw);
  const summaries = seat ? buildTeamSeatTypeSummaries(seat, result.diagnostics, creditCache) : null;
  result.endAt =
    summaries === null ? null : subscriptionTimestamp(seat?.EndTime ?? seat?.PeriodEnd);
  if (summaries !== null) result.seatSummaries = summaries;
  result.completeness =
    result.status === 'unknown' ? 'unknown' : result.diagnostics.length ? 'partial' : 'complete';
  return result;
}

export function buildTeamRenewable(
  value: unknown,
  instanceId: string | null,
): TokenPlanRenewable | null {
  const raw = subscriptionObject(value);
  if (
    !raw ||
    (raw.Success !== undefined && raw.Success !== true) ||
    (raw.Code !== undefined && raw.Code !== 'Success')
  )
    return null;
  if (Array.isArray(raw.Data)) {
    const matches = raw.Data.map(subscriptionObject).filter(
      (item) =>
        item?.InstanceId === instanceId &&
        item?.CommodityCode === site.features.tokenPlanCommodityCodes.teams,
    );
    if (matches.length !== 1) return null;
    const item = matches[0];
    const canRenew = item?.CanRenew ?? item?.canRenew;
    return typeof canRenew === 'boolean'
      ? {
          canRenew,
          interceptCode: typeof item?.InterceptCode === 'string' ? item.InterceptCode : null,
        }
      : null;
  }
  return typeof raw.Renewable === 'boolean'
    ? { canRenew: raw.Renewable, interceptCode: null }
    : null;
}

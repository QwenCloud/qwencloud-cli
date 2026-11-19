import type {
  CodingSubscriptionRead,
  IndividualSubscriptionRead,
  TeamSubscriptionRead,
} from './subscription-readers.js';
import type { SubscriptionAdapter } from './subscription-service.js';
import type {
  CheckInstancesRenewableResponse,
  CheckTokenPlanAutoRenewalResponse,
  FrInstanceItem,
  FrInstanceResponse,
  GetSeatSubscriptionSummaryResponse,
  GetSubscriptionSummaryResponse,
  QuerySubscriptionGrayResponse,
} from '../types/api-models.js';
import type {
  SubscriptionCreditPack,
  SubscriptionDiagnostic,
  SubscriptionQuota,
  SubscriptionRecentOrder,
  SubscriptionSeatTier,
  SubscriptionStatus,
} from '../types/subscription.js';
import type { TokenPlan } from '../types/usage.js';
import type { TokenPlanEditionStatus } from '../types/tokenplan-subscription.js';
import { subscriptionProtocolDiagnostic } from './subscription-diagnostics.js';
import { DecimalAmount } from '../utils/decimal-amount.js';
import { tokenPlanFromFrInstances, tokenPlanFromSeatSummary } from './tokenplan-service.js';
import { isSentinelDate } from '../utils/timestamp.js';
import { parseTeamCreditValues } from './tokenplan-team.js';
import { subscriptionObject } from './tokenplan-individual.js';

import type {
  GetSeatSubscriptionSummaryDataInner,
  GetSubscriptionSummaryDataInner,
  SeatSubscriptionGroupItem,
} from '../types/api-models.js';
import type {
  TokenPlanStatusResult,
  TokenPlanPeriod,
  TokenPlanSeatGroup,
  TokenPlanSeatTotal,
  TokenPlanAutoRenew,
  TokenPlanRenewable,
} from '../types/tokenplan-subscription.js';
function quotaFromValues(
  total: number | null | undefined,
  remaining: number | null | undefined,
): SubscriptionQuota | null {
  if (
    typeof total !== 'number' ||
    typeof remaining !== 'number' ||
    !Number.isFinite(total) ||
    !Number.isFinite(remaining) ||
    total < 0 ||
    remaining < 0 ||
    remaining > total
  )
    return null;
  const usedPct = total === 0 ? 0 : Math.round(((total - remaining) / total) * 100);
  return { remaining, total, usedPct };
}

function sumAmountStrings(values: string[]): string {
  return values
    .reduce((sum, value) => sum.add(DecimalAmount.parse(value)), DecimalAmount.parse('0'))
    .toCanonicalString();
}

function quotaFromSeatValues(
  groups: Array<{ totalValue: string | null; surplusValue: string | null }>,
): SubscriptionQuota | null {
  if (groups.length === 0) return null;
  const totals: string[] = [];
  const remainingValues: string[] = [];
  for (const group of groups) {
    if (group.totalValue === null || group.surplusValue === null) return null;
    const quota = quotaFromValues(Number(group.totalValue), Number(group.surplusValue));
    if (!quota) return null;
    totals.push(group.totalValue);
    remainingValues.push(group.surplusValue);
  }
  return quotaFromValues(
    Number(sumAmountStrings(totals)),
    Number(sumAmountStrings(remainingValues)),
  );
}

function quotaFromTokenPlan(
  dto: TokenPlan | null | undefined,
  team?: TokenPlanEditionStatus,
): SubscriptionQuota | null {
  if (!dto || dto.subscribed !== true) return null;
  if (team && team.status !== 'active') return null;
  if (
    team?.diagnostics.some(
      (entry) => entry.api === 'GetSubscriptionSummary' && entry.errorCode === 'InvalidFields',
    )
  )
    return null;
  const legacyQuota = quotaFromValues(dto.totalCredits, dto.remainingCredits);
  const summary = team?.seatSummary;
  if (!summary) return legacyQuota;
  const total = summary.total;
  const completeTotal = total !== null && total.totalValue !== null && total.surplusValue !== null;
  const totalQuota = completeTotal ? quotaFromSeatValues([total]) : null;
  if (completeTotal && !totalQuota) return null;
  const invalidGroup = team.diagnostics.some(
    (entry) => entry.api === 'GetSeatSubscriptionSummary' && entry.errorCode === 'InvalidGroup',
  );
  const groupQuota = invalidGroup ? null : quotaFromSeatValues(summary.groups);
  if (
    totalQuota &&
    groupQuota &&
    (totalQuota.total !== groupQuota.total || totalQuota.remaining !== groupQuota.remaining)
  )
    return null;
  if (totalQuota || groupQuota) return totalQuota ?? groupQuota;
  if (invalidGroup || summary.groups.length > 0 || !legacyQuota) return null;
  if (
    total &&
    ((total.totalValue !== null && Number(total.totalValue) !== legacyQuota.total) ||
      (total.surplusValue !== null && Number(total.surplusValue) !== legacyQuota.remaining))
  )
    return null;
  return legacyQuota;
}

function syntheticSeatTierFromTokenPlan(dto: TokenPlan | null | undefined): SubscriptionSeatTier[] {
  if (!dto || dto.subscribed !== true) return [];
  const total = Number(dto.totalCredits ?? 0);
  const remaining = Number(dto.remainingCredits ?? 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  const used = Math.max(0, total - safeRemaining);
  const usedPct = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
  return [
    {
      specType: '',
      seats: 1,
      totalCredits: total,
      remainingCredits: safeRemaining,
      usedPct,
      nextCycleFlushTime: dto.resetDate ?? null,
    },
  ];
}

export function projectTeamEditionOutput(source: TokenPlanEditionStatus): {
  team: TokenPlanEditionStatus;
  seatTiers: SubscriptionSeatTier[];
} {
  const team = structuredClone(source);
  return { team, seatTiers: legacyTeamSeatTiers(team) };
}

function legacyTeamSeatTiers(team: TokenPlanEditionStatus): SubscriptionSeatTier[] {
  let omitted = false;
  const tiers = (team.seatSummaries ?? []).flatMap((row): SubscriptionSeatTier[] => {
    if (row.seatCount === null || row.totalCredits === null || row.remainingCredits === null) {
      omitted = true;
      return [];
    }
    const total = Number(row.totalCredits);
    const remaining = Number(row.remainingCredits);
    if (
      !Number.isSafeInteger(row.seatCount) ||
      row.seatCount < 0 ||
      !Number.isFinite(total) ||
      !Number.isFinite(remaining) ||
      total < 0 ||
      remaining < 0 ||
      remaining > total
    ) {
      omitted = true;
      return [];
    }
    // The legacy percentage is rounded; zero quota remains a real numeric zero.
    const usedPct =
      total > 0 ? Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100))) : 0;
    return [
      {
        specType: row.seatType,
        seats: row.seatCount,
        totalCredits: total,
        remainingCredits: remaining,
        usedPct,
        nextCycleFlushTime: row.resetAt,
      },
    ];
  });
  if (omitted) {
    team.diagnostics.push(
      subscriptionProtocolDiagnostic(
        'GetSeatSubscriptionSummary',
        'IncompleteLegacySeatTier',
        'Some seat quotas could not be confirmed. Available team quota details are preserved.',
      ),
    );
    if (team.status !== 'unknown') team.completeness = 'partial';
  }
  return tiers;
}

export function projectSubscriptionStatus(
  input: {
    coding?: CodingSubscriptionRead;
    individual?: IndividualSubscriptionRead;
    team?: TeamSubscriptionRead;
    gray?: QuerySubscriptionGrayResponse;
    personalInstances?: FrInstanceItem[];
    addon?: FrInstanceResponse;
    recentOrders: SubscriptionRecentOrder[];
    includeCoding: boolean;
    includeToken: boolean;
  },
  adapter: SubscriptionAdapter,
): SubscriptionStatus {
  const { includeCoding, includeToken, recentOrders } = input;
  const lookup = new Map<string, unknown>([
    ['QuerySubscriptionGray', input.gray],
    ['GetSeatSubscriptionSummary', input.team?.compatibility.seat],
    ['CheckTokenPlanAutoRenewal', input.team?.compatibility.autoRenew],
    ['DescribeFrInstances-addon', input.addon],
    ['DescribeFrInstances-personal', input.personalInstances],
  ]);
  const grayDto = adapter.transformSubscriptionGray(
    lookup.get('QuerySubscriptionGray') as QuerySubscriptionGrayResponse | undefined,
  );
  const seatRaw = lookup.get('GetSeatSubscriptionSummary') as
    | GetSeatSubscriptionSummaryResponse
    | undefined;
  const seatDto = adapter.transformSeatSubscriptionSummary(seatRaw);
  const detailDto = input.coding?.data.detail ?? { instances: [], activeInstance: null };
  const autoRenewDto = adapter.transformAutoRenewal(
    lookup.get('CheckTokenPlanAutoRenewal') as CheckTokenPlanAutoRenewalResponse | undefined,
  );
  const frAddonRaw = lookup.get('DescribeFrInstances-addon') as FrInstanceResponse | undefined;
  const individual = input.individual?.data;
  const teamOutput = input.team ? projectTeamEditionOutput(input.team.data) : undefined;
  const team = teamOutput?.team;
  const tokenPlanDto: TokenPlan | undefined =
    input.team || individual
      ? {
          ...input.team?.compatibility.instanceSummary,
          subscribed: individual?.status === 'active' || team?.status === 'active' ? true : null,
        }
      : undefined;
  const teamRenewable = team?.renewable ?? null;
  const codingRenewable = input.coding?.data.renewable ?? { renewable: null };
  const legacyTokenPlanDto =
    includeCoding && grayDto.isGray === true
      ? tokenPlanFromSeatSummary(seatRaw)
      : input.team !== undefined
        ? tokenPlanFromFrInstances([
            ...input.team.compatibility.frInstances,
            ...((lookup.get('DescribeFrInstances-personal') as FrInstanceItem[] | undefined) ?? []),
          ])
        : tokenPlanDto;
  const quota = includeCoding
    ? legacyTokenPlanDto?.subscribed === true
      ? quotaFromValues(legacyTokenPlanDto.totalCredits, legacyTokenPlanDto.remainingCredits)
      : null
    : quotaFromTokenPlan(tokenPlanDto, team);

  const detailActive = detailDto.activeInstance;
  const legacyPlanName =
    includeToken && (grayDto.isGray !== true || seatRaw !== undefined)
      ? legacyTokenPlanDto?.planName
      : undefined;
  const plan =
    detailActive?.plan ??
    seatDto.plan ??
    (includeCoding ? legacyPlanName : tokenPlanDto?.planName) ??
    null;
  const period = detailActive?.period ?? seatDto.period ?? null;

  const seatInner = seatRaw?.Data ?? seatRaw;
  const seatTiersRaw = team ? [] : extractSeatTiers(seatInner);
  const seatTiers = team
    ? teamOutput!.seatTiers
    : seatTiersRaw.some((tier) => tier.totalCredits > 0)
      ? seatTiersRaw
      : syntheticSeatTierFromTokenPlan(tokenPlanDto);
  const remainingDays = extractRemainingDays(seatInner);
  const creditPacks = extractCreditPacks(frAddonRaw);
  const codingPlanStatus = detailActive?.status ?? null;

  return {
    ...(individual ? { individual } : {}),
    ...(team ? { team } : {}),
    isGray: grayDto.isGray,
    plan: includeCoding || !team ? plan : team.name,
    period: includeCoding || !team ? period : team.period,
    quota,
    autoRenew: includeCoding || !team ? autoRenewDto.autoRenew : (team.autoRenew?.enabled ?? null),
    renewable: includeCoding ? codingRenewable.renewable : (teamRenewable?.canRenew ?? null),
    remainingDays: includeCoding || !team ? remainingDays : team.remainingDays,
    seatTiers,
    creditPacks,
    codingPlanStatus,
    recentOrders,
  };
}
function extractRemainingDays(
  inner: { RemainingDays?: number | string } | null | undefined,
): number | null {
  if (!inner) return null;
  const raw = inner.RemainingDays;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSeatTiers(
  inner:
    | { SubscriptionGroupList?: GetSeatSubscriptionSummaryResponse['SubscriptionGroupList'] }
    | null
    | undefined,
): SubscriptionSeatTier[] {
  const groups = inner?.SubscriptionGroupList;
  if (!Array.isArray(groups) || groups.length === 0) return [];
  const tiers: SubscriptionSeatTier[] = [];
  for (const group of groups) {
    if (!group) continue;
    const equity = group.EquityList?.[0];
    const total = parseFloat(equity?.TotalValue ?? group.TotalValue ?? '0');
    const remaining = parseFloat(equity?.SurplusValue ?? group.SurplusValue ?? '0');
    const safeTotal = Number.isFinite(total) ? total : 0;
    const safeRemaining = Number.isFinite(remaining) ? remaining : 0;
    const used = Math.max(0, safeTotal - safeRemaining);
    const usedPct =
      safeTotal > 0 ? Math.min(100, Math.max(0, Math.round((used / safeTotal) * 100))) : 0;
    let flush: string | null = null;
    const rawFlush = group.NextCycleFlushTime;
    if (typeof rawFlush === 'number' && Number.isFinite(rawFlush)) {
      flush = new Date(rawFlush).toISOString();
    } else if (typeof rawFlush === 'string' && rawFlush.length > 0) {
      flush = rawFlush;
    }
    tiers.push({
      specType: group.SpecType ?? '',
      seats: typeof group.SubscriptionTotalNumber === 'number' ? group.SubscriptionTotalNumber : 0,
      totalCredits: safeTotal,
      remainingCredits: safeRemaining,
      usedPct,
      nextCycleFlushTime: flush,
    });
  }
  return tiers;
}

function extractCreditPacks(raw: FrInstanceResponse | null | undefined): SubscriptionCreditPack[] {
  if (!raw || !Array.isArray(raw.Data) || raw.Data.length === 0) return [];
  const packs: SubscriptionCreditPack[] = [];
  for (const item of raw.Data) {
    if (!item) continue;
    const statusCode =
      item.StatusCode ?? (typeof item.Status === 'string' ? item.Status : item.Status?.Code);
    if (statusCode !== 'valid') continue;
    const total = parseFloat(item.InitCapacityBaseValue ?? '0');
    const remaining = parseFloat(item.CurrCapacityBaseValue ?? '0');
    let expiresAt: string | null = null;
    if (typeof item.EndTime === 'number' && Number.isFinite(item.EndTime)) {
      const isoStr = new Date(item.EndTime).toISOString();
      expiresAt = isSentinelDate(isoStr) ? null : isoStr;
    }
    packs.push({
      instanceId: item.InstanceId ?? '',
      totalCredits: Number.isFinite(total) ? total : 0,
      remainingCredits: Number.isFinite(remaining) ? remaining : 0,
      expiresAt,
    });
  }
  return packs;
}

/** Convert timestamp or string to ISO 8601 string; returns null if not coercible. */
function toIsoString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

/** Unwrap a single nested .Data envelope when present. */
function unwrapDataEnvelope<T extends { Data?: unknown }, I>(raw: T | undefined): I | undefined {
  if (!raw) return undefined;
  const inner = (raw as { Data?: unknown }).Data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as I;
  }
  return raw as unknown as I;
}

export function projectTokenPlanStatus(
  lookup: Map<string, unknown>,
  diagnostics: SubscriptionDiagnostic[],
): TokenPlanStatusResult {
  const outputDiagnostics = [...diagnostics];
  const seatSummaryRaw = lookup.get('GetSeatSubscriptionSummary') as
    | GetSeatSubscriptionSummaryResponse
    | undefined;
  const subscriptionSummaryRaw = lookup.get('GetSubscriptionSummary') as
    | GetSubscriptionSummaryResponse
    | undefined;
  const autoRenewalRaw = lookup.get('CheckTokenPlanAutoRenewal') as
    | CheckTokenPlanAutoRenewalResponse
    | undefined;
  const renewableRaw = lookup.get('CheckInstancesRenewable') as
    | CheckInstancesRenewableResponse
    | undefined;

  const seatInner = unwrapDataEnvelope<
    GetSeatSubscriptionSummaryResponse,
    GetSeatSubscriptionSummaryDataInner
  >(seatSummaryRaw);
  const subscriptionInner = unwrapDataEnvelope<
    GetSubscriptionSummaryResponse,
    GetSubscriptionSummaryDataInner
  >(subscriptionSummaryRaw);

  const period = buildPeriod(seatInner);
  const groups = buildSeatGroups(seatInner, outputDiagnostics);
  const total = buildSeatTotal(subscriptionInner);
  const autoRenew = buildAutoRenew(autoRenewalRaw);
  const renewable = buildRenewable(renewableRaw);

  // seatSummary is null when GetSeatSubscriptionSummary failed.
  const seatSummary = seatSummaryRaw === undefined ? null : { groups, total };

  return {
    product: 'Token Plan Team Edition',
    period,
    autoRenew,
    renewable,
    seatSummary,
    diagnostics: outputDiagnostics,
  };
}

function buildPeriod(
  inner: GetSeatSubscriptionSummaryDataInner | undefined,
): TokenPlanPeriod | null {
  if (!inner) return null;
  const start = toIsoString(inner.StartTime ?? inner.PeriodStart);
  const end = toIsoString(inner.EndTime ?? inner.PeriodEnd);
  if (!start || !end) return null;
  const remainingDays =
    typeof inner.RemainingDays === 'number'
      ? inner.RemainingDays
      : typeof inner.RemainingDays === 'string'
        ? parseInt(inner.RemainingDays, 10) || 0
        : 0;
  return { start, end, remainingDays };
}

function buildSeatGroups(
  inner: GetSeatSubscriptionSummaryDataInner | undefined,
  diagnostics: SubscriptionDiagnostic[],
): TokenPlanSeatGroup[] {
  if (!inner || !Array.isArray(inner.SubscriptionGroupList)) return [];
  return inner.SubscriptionGroupList.flatMap((group: SeatSubscriptionGroupItem) => {
    const record = subscriptionObject(group);
    if (!record) return [];
    const credits = parseTeamCreditValues(record, diagnostics);
    return [
      {
        specType: group.SpecType ?? 'unknown',
        seats: group.SubscriptionTotalNumber ?? 0,
        assigned: group.SubscriptionAssignedNumber ?? 0,
        totalValue: credits.totalCredits,
        surplusValue: credits.remainingCredits,
        unit: 'Credits',
        nextCycleFlushTime: toIsoString(group.NextCycleFlushTime),
      },
    ];
  });
}

function buildSeatTotal(
  inner: GetSubscriptionSummaryDataInner | undefined,
): TokenPlanSeatTotal | null {
  if (!inner) return null;
  return {
    seats: inner.TotalCount ?? 0,
    totalValue: inner.TotalValue ?? '0',
    surplusValue: inner.TotalSurplusValue ?? '0',
    unit: 'Credits',
  };
}

function buildAutoRenew(
  raw: CheckTokenPlanAutoRenewalResponse | undefined,
): TokenPlanAutoRenew | null {
  if (!raw) return null;
  const autoRenewalValue = raw.Data?.AutoRenewal ?? raw.AutoRenewal;
  const enabled =
    typeof autoRenewalValue === 'number'
      ? autoRenewalValue === 1
      : typeof autoRenewalValue === 'boolean'
        ? autoRenewalValue
        : false;
  const period = raw.Data?.RenewalPeriod ?? 0;
  const periodUnit = raw.Data?.RenewalPeriodUnit ?? '';
  return { enabled, period, periodUnit };
}

function buildRenewable(
  raw: CheckInstancesRenewableResponse | undefined,
): TokenPlanRenewable | null {
  if (!raw) return null;
  const item = Array.isArray(raw.Data) && raw.Data.length > 0 ? raw.Data[0] : null;
  if (item) {
    const canRenew = item.CanRenew ?? item.canRenew ?? false;
    const interceptCode = item.InterceptCode ?? null;
    return { canRenew, interceptCode };
  }
  const canRenew = raw.Renewable ?? false;
  return { canRenew, interceptCode: null };
}

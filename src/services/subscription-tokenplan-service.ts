/** Token Plan team edition subscription status orchestration. */
import type { ApiClient } from '../api/api-client.js';
import type {
  GetSubscriptionDetailDataInner,
  GetSubscriptionDetailResponse,
  SubscriptionDetailEquityItem,
  SubscriptionDetailItem,
} from '../types/api-models.js';
import type { SubscriptionDiagnostic } from '../types/subscription.js';
import type {
  ListTokenPlanSeatsParams,
  TokenPlanSeatConfig,
  TokenPlanSeatCycle,
  TokenPlanSeatItem,
  TokenPlanSeatsResult,
  TokenPlanStatusResult,
  TokenPlanStatusOptions,
} from '../types/tokenplan-subscription.js';
import { site } from '../site.js';
import { createCsDataBudget, checkCsDataSignal } from '../auth/cs-data-session.js';
import { invalidArgError } from '../utils/errors.js';

const API_PRODUCT_BSS = 'BssOpenAPI-V3';
const STATUS_SOFT_TIMEOUT_MS = 35_000;
const PRODUCT_LABEL = 'Token Plan Team Edition';
const SEATS_DEFAULT_PAGE = 1;
const SEATS_DEFAULT_PAGE_SIZE = 20;
const SEATS_MAX_PAGE_SIZE = 100;

import { readIndividualSubscription, readTeamSubscription } from './subscription-readers.js';
import { projectTokenPlanStatus, projectTeamEditionOutput } from './subscription-status-compat.js';
import {
  fetchTokenPlanSeatDetails,
  resolveTokenPlanSeatAssignments,
} from './tokenplan-seat-details.js';

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

export class SubscriptionTokenPlanService {
  constructor(private readonly apiClient: ApiClient) {}

  async getTokenPlanStatus(options: TokenPlanStatusOptions = {}): Promise<TokenPlanStatusResult> {
    const edition = options.edition ?? 'all';
    if (!['individual', 'team', 'all'].includes(edition))
      throw invalidArgError('Invalid Token Plan edition. Use individual, team, or all.');
    const budget = createCsDataBudget(options.signal, STATUS_SOFT_TIMEOUT_MS);
    const empty: TokenPlanStatusResult = {
      product: PRODUCT_LABEL,
      period: null,
      autoRenew: null,
      renewable: null,
      seatSummary: null,
      diagnostics: [],
    };
    try {
      checkCsDataSignal(budget.signal);
      const [individualRead, teamRead, seatDetails] = await Promise.all([
        edition === 'team' ? undefined : readIndividualSubscription(this.apiClient, budget.signal),
        edition === 'individual' ? undefined : readTeamSubscription(this.apiClient, budget.signal),
        edition === 'individual'
          ? undefined
          : fetchTokenPlanSeatDetails(this.apiClient, budget.signal),
      ]);
      const individual = individualRead?.data;
      const team = teamRead
        ? {
            ...projectTokenPlanStatus(
              new Map<string, unknown>([
                ['GetSeatSubscriptionSummary', teamRead.compatibility.seat],
                ['GetSubscriptionSummary', teamRead.compatibility.summary],
                ['CheckTokenPlanAutoRenewal', teamRead.compatibility.autoRenew],
                ['CheckInstancesRenewable', teamRead.compatibility.renewable],
              ]),
              teamRead.requestDiagnostics,
            ),
            renewable: teamRead.data.renewable ?? null,
            team: projectTeamEditionOutput(teamRead.data).team,
          }
        : undefined;
      if (team?.team && seatDetails) {
        team.team.seatDetails = resolveTokenPlanSeatAssignments(seatDetails, team.team);
      }
      if (options.signal) checkCsDataSignal(options.signal);
      return {
        ...(team ?? empty),
        ...(individual ? { individual } : {}),
        diagnostics: [
          ...(team?.diagnostics ?? []),
          ...(individual?.diagnostics ?? []),
          ...(team?.team.seatDetails?.diagnostics ?? []),
        ],
      };
    } finally {
      budget.dispose();
    }
  }

  // Seats listing

  async listTokenPlanSeats(params: ListTokenPlanSeatsParams = {}): Promise<TokenPlanSeatsResult> {
    const productCode = site.features.tokenPlanCommodityCodes.teams;
    const diagnostics: SubscriptionDiagnostic[] = [];

    const requestedPage = Number.isFinite(params.page) ? Number(params.page) : SEATS_DEFAULT_PAGE;
    const pageNo = Math.max(1, Math.trunc(requestedPage));
    const requestedPageSize = Number.isFinite(params.pageSize)
      ? Number(params.pageSize)
      : SEATS_DEFAULT_PAGE_SIZE;
    const pageSize = Math.max(1, Math.min(SEATS_MAX_PAGE_SIZE, Math.trunc(requestedPageSize)));
    const specType =
      typeof params.specType === 'string' && params.specType.length > 0 ? params.specType : null;

    const apiParams: Record<string, unknown> = { productCode, pageNo, pageSize };
    if (specType) apiParams.specType = specType;

    // Network errors propagate to the caller.
    const raw = await this.apiClient.callFlatApi<GetSubscriptionDetailResponse>({
      product: API_PRODUCT_BSS,
      action: 'GetSubscriptionDetail',
      params: apiParams,
    });

    if (raw && (raw as GetSubscriptionDetailResponse).Success === false) {
      const code = (raw as GetSubscriptionDetailResponse).Code;
      const suffix = code ? ` (${code})` : '';
      throw new Error(`InternalError: Backend unavailable${suffix}`);
    }

    const inner = this.unwrapDetailEnvelope(raw);
    const list = inner?.SubscriptionList ?? [];
    const items = list.map((entry) => this.buildSeatItem(entry, diagnostics));

    // Client-side fallback filter.
    const filteredItems = specType
      ? items.filter((it) => it.specType.toLowerCase() === specType.toLowerCase())
      : items;

    const total = typeof inner?.TotalCount === 'number' ? inner.TotalCount : filteredItems.length;

    return {
      page: { current: pageNo, size: pageSize, total },
      filter: { specType },
      items: filteredItems,
      diagnostics,
    };
  }

  private unwrapDetailEnvelope(
    raw: GetSubscriptionDetailResponse | undefined,
  ): GetSubscriptionDetailDataInner | undefined {
    if (!raw) return undefined;
    const data = raw.Data;
    if (data && !Array.isArray(data) && typeof data === 'object') {
      return data as GetSubscriptionDetailDataInner;
    }
    if (Array.isArray(data)) {
      return {
        SubscriptionList: data,
        TotalCount: raw.TotalCount,
        PageSize: raw.PageSize,
        CurrentPage: raw.CurrentPage,
      };
    }
    return undefined;
  }

  private buildSeatItem(
    entry: SubscriptionDetailItem,
    diagnostics: SubscriptionDiagnostic[],
  ): TokenPlanSeatItem {
    const instanceCode = entry.InstanceCode ?? entry.InstanceId ?? '';
    const cycle = this.buildSeatCycle(entry, instanceCode, diagnostics);
    const config = this.buildSeatConfig(entry, instanceCode, diagnostics);
    return {
      instanceCode,
      specType: entry.SpecType ?? '',
      status: entry.Status ?? '',
      memberId: entry.MemberId ?? '',
      assignable: entry.Assignable === true,
      assignment: entry.MemberId ? 'Assigned' : 'Unassigned',
      payMode: entry.PayMode ?? '',
      productType: entry.ProductType ?? '',
      cycle,
      config,
    };
  }

  private buildSeatCycle(
    entry: SubscriptionDetailItem,
    instanceCode: string,
    diagnostics: SubscriptionDiagnostic[],
  ): TokenPlanSeatCycle | null {
    const list: SubscriptionDetailEquityItem[] = Array.isArray(entry.EquityList)
      ? entry.EquityList
      : [];
    const equity = list.find((item) => item.EquityType === 'CREDITS');
    if (!equity) {
      const empty = list.length === 0;
      diagnostics.push({
        api: 'GetSubscriptionDetail',
        errorCode: empty ? 'EquityListEmpty' : 'CreditsEquityMissing',
        errorMessage: empty
          ? `EquityList empty for instance ${instanceCode}`
          : `Credits equity missing for instance ${instanceCode}`,
      });
      return null;
    }
    return {
      startTime: toIsoString(equity.CycleStartTime),
      endTime: toIsoString(equity.CycleEndTime),
      totalValue: equity.CycleTotalValue ?? '0',
      surplusValue: equity.CycleSurplusValue ?? '0',
      unit: equity.Unit ?? 'Credits',
    };
  }

  private buildSeatConfig(
    entry: SubscriptionDetailItem,
    instanceCode: string,
    diagnostics: SubscriptionDiagnostic[],
  ): TokenPlanSeatConfig | null {
    const rawConfig = entry.Config;
    if (typeof rawConfig !== 'string' || rawConfig.length === 0) {
      if (typeof rawConfig === 'string') {
        diagnostics.push({
          api: 'GetSubscriptionDetail',
          errorCode: 'ConfigEmpty',
          errorMessage: `Config empty for instance ${instanceCode}`,
        });
      }
      return null;
    }
    try {
      let parsed: unknown = JSON.parse(rawConfig);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Config payload is not an object');
      }
      const obj = parsed as Record<string, unknown>;
      return {
        planType: typeof obj.plan_type === 'string' ? obj.plan_type : null,
        creditValue: typeof obj.credit_value === 'number' ? obj.credit_value : null,
        seatNum: typeof obj.seat_num === 'number' ? obj.seat_num : null,
        quotaCycle: typeof obj.quota_cycle === 'string' ? obj.quota_cycle : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        api: 'GetSubscriptionDetail',
        errorCode: 'ConfigParseFailed',
        errorMessage: `Config parse failed for instance ${instanceCode}: ${message}`,
      });
      return null;
    }
  }
}

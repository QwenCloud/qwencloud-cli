/** Subscription status assembly and order listing. */
import type { ApiClient } from '../api/api-client.js';
import type { CachedFetcher } from '../types/cache.js';
import type {
  CheckInstancesRenewableResponse,
  CheckTokenPlanAutoRenewalResponse,
  FrInstanceItem,
  FrInstanceResponse,
  GetSeatSubscriptionSummaryResponse,
  GetSubscriptionDetailResponse,
  QueryOrderDetailResponse,
  QueryOrderListResponse,
  QuerySubscriptionGrayResponse,
} from '../types/api-models.js';
import type {
  AutoRenewalDto,
  InstancesRenewableDto,
  ListOrdersOptions,
  OrderDetail,
  OrderListDto,
  SeatSubscriptionSummaryDto,
  SubscriptionDetailDto,
  SubscriptionDiagnostic,
  SubscriptionGrayDto,
  SubscriptionOrder,
  SubscriptionOrders,
  SubscriptionOrdersResult,
  SubscriptionRecentOrder,
  SubscriptionStatusResult,
} from '../types/subscription.js';
import {
  safeSubscriptionDiagnostic,
  subscriptionFailureExitCode,
} from './subscription-diagnostics.js';
import { type TokenplanService } from './tokenplan-service.js';
import { site } from '../site.js';
import { API_PRODUCT_ACCOUNT_CENTER } from '../types/api-routes.js';
import { CliError } from '../utils/errors.js';
import { EXIT_CODES } from '../utils/exit-codes.js';

const API_PRODUCT_BSS = 'BssOpenAPI-V3';
const STATUS_SOFT_TIMEOUT_MS = 35_000;
const ORDERS_CACHE_TTL_MS = 5 * 60 * 1000;
const DETAIL_CONCURRENCY = 5;
const NBID_CACHE_TTL_MS = 30 * 60 * 1000;

export interface SubscriptionAdapter {
  transformSubscriptionGray(
    raw: QuerySubscriptionGrayResponse | null | undefined,
  ): SubscriptionGrayDto;
  transformSeatSubscriptionSummary(
    raw: GetSeatSubscriptionSummaryResponse | null | undefined,
  ): SeatSubscriptionSummaryDto;
  transformSubscriptionDetail(
    raw: GetSubscriptionDetailResponse | null | undefined,
  ): SubscriptionDetailDto;
  transformAutoRenewal(raw: CheckTokenPlanAutoRenewalResponse | null | undefined): AutoRenewalDto;
  transformInstancesRenewable(
    raw: CheckInstancesRenewableResponse | null | undefined,
  ): InstancesRenewableDto;
  transformOrderList(raw: QueryOrderListResponse | null | undefined): OrderListDto;
  transformOrderDetail(raw: QueryOrderDetailResponse | null | undefined): OrderDetail;
}

import {
  readCodingSubscription,
  readIndividualSubscription,
  readTeamSubscription,
} from './subscription-readers.js';
import { projectSubscriptionStatus } from './subscription-status-compat.js';
import { runSubscriptionCalls } from './subscription-query.js';
import { createCsDataBudget, awaitCsDataOperation } from '../auth/cs-data-session.js';

function detectOrderApiUnavailable(
  raw: { Code?: string; Message?: string; Data?: unknown } | null | undefined,
): CliError | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.Data !== undefined) return null;
  const code = typeof raw.Code === 'string' ? raw.Code : '';
  if (!code) return null;
  return new CliError({
    code: 'FEATURE_UNAVAILABLE',
    message: 'Subscription orders is not available yet.',
    exitCode: EXIT_CODES.GENERAL_ERROR,
  });
}

export class SubscriptionService {
  private cachedNbId: string | null = null;
  private nbIdTimestamp = 0;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly subscriptionAdapter: SubscriptionAdapter,
    private readonly cache: CachedFetcher,
    private readonly tokenplanService: TokenplanService,
  ) {}

  async getStatus(
    opts: { plan?: 'token' | 'coding'; signal?: AbortSignal } = {},
  ): Promise<SubscriptionStatusResult> {
    const budget = createCsDataBudget(opts.signal, STATUS_SOFT_TIMEOUT_MS);
    try {
      return await this.getStatusWithinBudget({ ...opts, signal: budget.signal });
    } finally {
      budget.dispose();
    }
  }

  private async getStatusWithinBudget(opts: {
    plan?: 'token' | 'coding';
    signal: AbortSignal;
  }): Promise<SubscriptionStatusResult> {
    if (opts.plan !== undefined && opts.plan !== 'token' && opts.plan !== 'coding')
      throw new CliError({
        code: 'INVALID_ARGUMENT',
        message: '--plan must be token or coding.',
        exitCode: EXIT_CODES.INVALID_ARGUMENT,
      });
    if (opts.signal?.aborted) throw opts.signal.reason;
    const wantCoding = opts.plan === undefined || opts.plan === 'coding';
    const wantToken = opts.plan === undefined || opts.plan === 'token';
    let grayPromise: Promise<QuerySubscriptionGrayResponse> | undefined;
    const getGray = (signal: AbortSignal) =>
      (grayPromise ??= this.apiClient.callFlatApi<QuerySubscriptionGrayResponse>({
        product: API_PRODUCT_BSS,
        action: 'QuerySubscriptionGray',
        signal,
      }));
    const getPersonalInstances = async (signal: AbortSignal) => {
      if (!wantCoding) return [];
      try {
        const gray = await awaitCsDataOperation(
          getGray(signal).catch(() => undefined),
          signal,
        );
        signal.throwIfAborted();
        if (this.subscriptionAdapter.transformSubscriptionGray(gray).isGray === true) return [];
        const raw = await awaitCsDataOperation(
          this.apiClient.callFlatApi<FrInstanceResponse & { Success?: boolean; Code?: string }>({
            product: API_PRODUCT_BSS,
            action: 'DescribeFrInstances',
            signal,
            params: {
              Group: 'tokenPlan',
              CommodityCode: site.features.tokenPlanCommodityCodes.personal,
              PageNum: 1,
              PageSize: 10,
            },
          }),
          signal,
        );
        return raw &&
          Array.isArray(raw.Data) &&
          (raw.Success === undefined || raw.Success === true) &&
          (raw.Code === undefined || raw.Code === 'Success' || raw.Code === '200')
          ? raw.Data
          : [];
      } catch {
        return [];
      }
    };
    const codingPromise = wantCoding
      ? readCodingSubscription(this.apiClient, this.subscriptionAdapter, opts.signal)
      : undefined;
    const individualPromise = wantToken
      ? readIndividualSubscription(this.apiClient, opts.signal, (signal) =>
          this.tokenplanService.fetchIndividualTokenPlan(signal),
        )
      : undefined;
    const teamPromise = wantToken
      ? readTeamSubscription(this.apiClient, opts.signal, (signal) =>
          this.tokenplanService.fetchTeamTokenPlan(signal),
        )
      : undefined;
    const calls: Array<{ api: string; invoke: (signal: AbortSignal) => Promise<unknown> }> = [
      { api: 'QuerySubscriptionGray', invoke: getGray },
    ];
    if (wantToken && wantCoding)
      calls.push({ api: 'DescribeFrInstances-personal', invoke: getPersonalInstances });
    if (wantToken)
      calls.push({
        api: 'DescribeFrInstances-addon',
        invoke: (signal) =>
          this.apiClient.callFlatApi<FrInstanceResponse>({
            product: API_PRODUCT_BSS,
            action: 'DescribeFrInstances',
            signal,
            params: {
              Group: 'tokenPlan',
              CommodityCode: site.features.tokenPlanCommodityCodes.addon,
              PageNum: 1,
              PageSize: 10,
            },
          }),
      });
    const [coding, individual, team, supplementary] = await Promise.all([
      codingPromise,
      individualPromise,
      teamPromise,
      runSubscriptionCalls(calls, STATUS_SOFT_TIMEOUT_MS, opts.signal),
    ]);
    const lookup = new Map(supplementary.map((reply) => [reply.api, reply.data]));
    const diagnostics: SubscriptionDiagnostic[] = [
      ...supplementary.flatMap((reply) => (reply.diagnostic ? [reply.diagnostic] : [])),
      ...(coding?.diagnostics ?? []),
      ...(individual?.diagnostics ?? []),
      ...(team?.diagnostics ?? []),
    ];
    if (individual?.outcome === 'failed' && team?.outcome === 'failed')
      diagnostics.push(
        safeSubscriptionDiagnostic('TokenPlan', {
          exitCode: subscriptionFailureExitCode([...individual.diagnostics, ...team.diagnostics]),
        }),
      );

    // Recent orders do not determine subscription validity.
    let recentOrders: SubscriptionRecentOrder[] = [];
    try {
      const tokenPlanCommodityCodes = [
        site.features.tokenPlanCommodityCodes.teams,
        site.features.tokenPlanCommodityCodes.addon,
        site.features.tokenPlanCommodityCodes.soloBuy,
      ]
        .filter(Boolean)
        .join(',');
      const ordersResult = await awaitCsDataOperation(
        this.listOrders({
          signal: opts.signal,
          page: 1,
          pageSize: 3,
          expandDetail: false,
          commodityCodeList:
            wantToken && tokenPlanCommodityCodes ? tokenPlanCommodityCodes : undefined,
        }),
        opts.signal,
      );
      recentOrders = ordersResult.orders.map((o) => ({
        orderId: o.orderId,
        orderType: o.orderType,
        orderTime: o.orderTime,
        amount: o.amount,
        status: o.status,
      }));
    } catch {
      // Non-fatal: recent orders are supplementary.
    }

    if (
      opts.signal.aborted &&
      !(opts.signal.reason instanceof Error && opts.signal.reason.name === 'RequestTimeoutError')
    )
      throw opts.signal.reason;
    if (![coding, individual, team].some((read) => read && read.outcome !== 'failed'))
      return { data: null, diagnostics, failureExitCode: subscriptionFailureExitCode(diagnostics) };
    const data = projectSubscriptionStatus(
      {
        coding,
        individual,
        team,
        gray: lookup.get('QuerySubscriptionGray') as QuerySubscriptionGrayResponse | undefined,
        personalInstances: lookup.get('DescribeFrInstances-personal') as
          | FrInstanceItem[]
          | undefined,
        addon: lookup.get('DescribeFrInstances-addon') as FrInstanceResponse | undefined,
        recentOrders,
        includeCoding: wantCoding,
        includeToken: wantToken,
      },
      this.subscriptionAdapter,
    );
    diagnostics.push(...(data.team?.diagnostics ?? []));
    return {
      data,
      diagnostics: [
        ...new Map(diagnostics.map((entry) => [JSON.stringify(entry), entry])).values(),
      ],
    };
  }

  async listOrders(opts: ListOrdersOptions): Promise<SubscriptionOrdersResult> {
    opts.signal?.throwIfAborted();
    const cacheKey = `orders:${opts.from ?? ''}:${opts.to ?? ''}:${opts.type ?? ''}:${opts.page}:${opts.pageSize}:${opts.commodityCodeList ?? ''}`;

    const nbId = await this.resolveNbId(opts.signal);

    const params: Record<string, unknown> = {
      CurrentPage: opts.page,
      PageSize: opts.pageSize,
    };
    if (nbId) params.Nbid = nbId;
    if (opts.from) {
      const start = new Date(`${opts.from}T00:00:00`).getTime();
      if (Number.isFinite(start)) params.startDate = start;
    }
    if (opts.to) {
      const end = new Date(`${opts.to}T23:59:59.999`).getTime();
      if (Number.isFinite(end)) params.endDate = end;
    }
    if (opts.type) {
      const TYPE_TO_API: Record<string, string> = {
        purchase: 'BUY',
        renew: 'RENEW',
        upgrade: 'UPGRADE',
      };
      params.OrderType = TYPE_TO_API[opts.type] ?? opts.type.toUpperCase();
    }
    if (opts.commodityCodeList) params.CommodityCodeList = opts.commodityCodeList;

    const listRaw = await this.cache.getOrFetch(cacheKey, ORDERS_CACHE_TTL_MS, async () =>
      this.apiClient.callFlatApi<QueryOrderListResponse>({
        product: API_PRODUCT_BSS,
        action: 'QueryOrderList',
        params,
        signal: opts.signal,
      }),
    );

    // Surface upstream authentication failure (or any other inner business
    // error) as a CliError instead of silently returning an empty list.
    const unavailable = detectOrderApiUnavailable(listRaw);
    if (unavailable) throw unavailable;

    const dto = this.subscriptionAdapter.transformOrderList(listRaw);

    const orders =
      opts.expandDetail && dto.orders.length > 0
        ? await this.expandOrderDetails(dto.orders)
        : dto.orders;

    const result: SubscriptionOrders = {
      orders,
      pagination: {
        page: dto.pagination.currentPage || opts.page,
        pageSize: dto.pagination.pageSize || opts.pageSize,
        total: dto.pagination.totalCount,
      },
    };
    return result;
  }

  /** Fetch a single order detail. */
  async getOrderDetail(orderId: string): Promise<OrderDetail> {
    const raw = await this.apiClient.callFlatApi<QueryOrderDetailResponse>({
      product: API_PRODUCT_BSS,
      action: 'QueryOrderDetail',
      params: { OrderId: orderId },
    });
    const unavailable = detectOrderApiUnavailable(
      raw as unknown as { Code?: string; Message?: string; Data?: unknown },
    );
    if (unavailable) throw unavailable;
    return this.subscriptionAdapter.transformOrderDetail(raw);
  }

  /** Concurrency-bounded eager detail expansion. */
  private async expandOrderDetails(items: SubscriptionOrder[]): Promise<SubscriptionOrder[]> {
    const result: SubscriptionOrder[] = items.slice();
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const idx = cursor++;
        const order = items[idx]!;
        if (!order.orderId) continue;
        try {
          const raw = await this.apiClient.callFlatApi<QueryOrderDetailResponse>({
            product: API_PRODUCT_BSS,
            action: 'QueryOrderDetail',
            params: { OrderId: order.orderId },
          });
          const unavailable = detectOrderApiUnavailable(
            raw as unknown as { Code?: string; Message?: string; Data?: unknown },
          );
          if (unavailable) throw unavailable;
          const enriched = this.subscriptionAdapter.transformOrderDetail(raw);
          result[idx] = { ...order, detail: enriched, detailError: null };
        } catch (error) {
          if (error instanceof CliError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          result[idx] = { ...order, detailError: message };
        }
      }
    };

    const pool = Math.min(DETAIL_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: pool }, () => worker()));
    return result;
  }

  private async resolveNbId(signal?: AbortSignal): Promise<string | null> {
    if (this.cachedNbId && Date.now() - this.nbIdTimestamp < NBID_CACHE_TTL_MS) {
      return this.cachedNbId;
    }
    try {
      const raw = await this.apiClient.callFlatApi<Record<string, unknown>>({
        product: API_PRODUCT_ACCOUNT_CENTER,
        action: 'QueryAccountBaseInfoApi',
        params: {},
        signal,
      });
      const inner =
        raw?.Data && typeof raw.Data === 'object' ? (raw.Data as Record<string, unknown>) : raw;
      const nbId = inner?.NbId;
      if (typeof nbId === 'string' || typeof nbId === 'number') {
        this.cachedNbId = String(nbId);
        this.nbIdTimestamp = Date.now();
        return this.cachedNbId;
      }
    } catch {
      // non-fatal; order query may still succeed
    }
    return null;
  }
}

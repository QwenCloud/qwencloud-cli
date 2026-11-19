/**
 * CodingplanService — Coding Plan subscription orchestration.
 *
 * Uses flat gateway parameters and validates the gateway and business statuses.
 * Failures emit a diagnostic while allowing UsageService to render its summary.
 */

import type { ApiClient } from '../api/api-client.js';
import type { CachedFetcher } from '../types/cache.js';
import type { CodingPlanInstance } from '../types/api-models.js';
import type { CodingPlan } from '../types/usage.js';
import { getEffectiveConfig } from '../config/manager.js';
import { addDiagnostic } from '../api/debug-buffer.js';
import { site } from '../site.js';
import { API_ACTION_GATEWAY, API_PRODUCT_GATEWAY } from '../types/api-routes.js';
import { parseRetError } from '../api/adapters/gateway-adapter.js';
import { GatewayBusinessError, GatewayShapeError } from '../api/request-adapter.js';

// ────────────────────────────────────────────────────────────────────
// Wire format constants
// ────────────────────────────────────────────────────────────────────

const ENVELOPE_API = 'zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2';

// ────────────────────────────────────────────────────────────────────
// Coding Plan response validation
// ────────────────────────────────────────────────────────────────────

export interface GatewayAdapter {
  /** Extract the codingPlanInstanceInfos array from a raw envelope response. */
  extractCodingPlanInstances(raw: unknown): CodingPlanInstance[];
}

function responseObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayShapeError('Invalid Coding Plan response');
  }
  return value as Record<string, unknown>;
}

function diagnosticCode(value: unknown): string {
  const code = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^(?:\d{1,8}|[A-Z][A-Z_]{1,63})$/.test(code) ? code : 'QUERY_FAILED';
}

/** Validate both success layers before extracting Coding Plan instances. */
export function extractCodingPlanInstances(raw: unknown): CodingPlanInstance[] {
  const envelope = responseObject(raw);
  if (envelope.Success === false) {
    throw new GatewayBusinessError('QUERY_FAILED', 'Coding Plan query failed');
  }
  const payload = responseObject(envelope.DataV2);
  const ret = payload.ret;
  if (!Array.isArray(ret) || typeof ret[0] !== 'string') {
    throw new GatewayShapeError('Coding Plan response missing gateway status');
  }
  const { code } = parseRetError(ret[0]);
  if (code !== 'SUCCESS') {
    throw new GatewayBusinessError(diagnosticCode(code), 'Coding Plan gateway rejected the query');
  }
  const business = responseObject(payload.data);
  if (business.success === false || business.failed === true) {
    throw new GatewayBusinessError(diagnosticCode(business.errorCode), 'Coding Plan query failed');
  }
  if (business.success !== true) {
    throw new GatewayShapeError('Coding Plan response missing business success');
  }
  const data = responseObject(business.data);
  if (!Array.isArray(data.codingPlanInstanceInfos)) {
    throw new GatewayShapeError('Coding Plan response missing instances');
  }
  return data.codingPlanInstanceInfos.map((value: unknown) => {
    const instance = responseObject(value);
    if (typeof instance.status !== 'string' || instance.status.length === 0) {
      throw new GatewayShapeError('Coding Plan instance missing status');
    }
    if (instance.instanceType !== undefined && typeof instance.instanceType !== 'string') {
      throw new GatewayShapeError('Invalid Coding Plan instance type');
    }
    if (instance.codingPlanQuotaInfo !== undefined) {
      const quota = responseObject(instance.codingPlanQuotaInfo);
      for (const key of [
        'per5HourTotalQuota',
        'per5HourUsedQuota',
        'per5HourQuotaNextRefreshTime',
        'perWeekTotalQuota',
        'perWeekUsedQuota',
        'perWeekQuotaNextRefreshTime',
        'perBillMonthTotalQuota',
        'perBillMonthUsedQuota',
        'perBillMonthQuotaNextRefreshTime',
      ]) {
        if (
          quota[key] !== undefined &&
          (typeof quota[key] !== 'number' || !Number.isFinite(quota[key]))
        ) {
          throw new GatewayShapeError('Invalid Coding Plan quota value');
        }
      }
    }
    return instance as CodingPlanInstance;
  });
}

/** Production GatewayAdapter — pass-through to the standalone extractor. */
export function createGatewayAdapter(): GatewayAdapter {
  return {
    extractCodingPlanInstances,
  };
}

// ────────────────────────────────────────────────────────────────────
// CodingplanService
// ────────────────────────────────────────────────────────────────────

export class CodingplanService {
  constructor(
    private readonly apiClient: Pick<ApiClient, 'callFlatApi'>,
    private readonly gatewayAdapter: GatewayAdapter,
    private readonly cache: CachedFetcher,
  ) {}

  /** Hostname for request metadata. */
  private getCodingPlanHost(): string {
    return getEffectiveConfig()
      ['api.endpoint'].replace(/\/+$/, '')
      .replace(/^https?:\/\//, '');
  }

  /** Fetch the user's current Coding Plan. Returns subscribed=false (rather
   *  than throwing) on any upstream failure or non-VALID instance, so the
   *  surrounding summary can still render. */
  async fetchCodingPlan(): Promise<CodingPlan> {
    try {
      const requestPayload = {
        queryCodingPlanInstanceInfoRequest: {
          commodityCode: site.features.codingPlanCommodityCode,
          onlyLatestOne: true,
        },
      };

      const data = await this.apiClient.callFlatApi<unknown>({
        product: API_PRODUCT_GATEWAY,
        action: API_ACTION_GATEWAY,
        params: {
          Api: ENVELOPE_API,
          V: '1.0',
          Data: JSON.stringify({
            ...requestPayload,
            cornerstoneParam: {
              domain: this.getCodingPlanHost(),
              consoleSite: 'QWENCLOUD',
              console: 'ONE_CONSOLE',
              xsp_lang: site.defaults.language,
              protocol: 'V2',
              productCode: 'p_efm',
            },
          }),
        },
      });

      const instances = this.gatewayAdapter.extractCodingPlanInstances(data);
      if (!instances || instances.length === 0) return { subscribed: false };

      const instance = instances[0]!;
      if (instance.status !== 'VALID') return { subscribed: false };

      return this.buildCodingPlanDto(instance);
    } catch (error) {
      const code =
        error instanceof GatewayBusinessError
          ? diagnosticCode(error.code)
          : error instanceof GatewayShapeError
            ? 'PROTOCOL_ERROR'
            : 'QUERY_FAILED';
      addDiagnostic(
        'CodingPlan',
        `Quota query failed (${code}); Coding Plan availability could not be verified.`,
        'warn',
      );
      return { subscribed: false };
    } finally {
      void this.cache; // caching delegated upstream to UsageService
    }
  }

  /** Build a CodingPlan DTO from a single VALID instance. */
  private buildCodingPlanDto(instance: CodingPlanInstance): CodingPlan {
    const q = instance.codingPlanQuotaInfo ?? {};

    const per5hTotal = q.per5HourTotalQuota ?? 0;
    const per5hUsed = q.per5HourUsedQuota ?? 0;
    const weeklyTotal = q.perWeekTotalQuota ?? 0;
    const weeklyUsed = q.perWeekUsedQuota ?? 0;
    const monthlyTotal = q.perBillMonthTotalQuota ?? 0;
    const monthlyUsed = q.perBillMonthUsedQuota ?? 0;

    const msToIso = (ms: number | undefined): string => (ms ? new Date(ms).toISOString() : '');

    const windows: CodingPlan['windows'] = {
      per_5h: {
        remaining: per5hTotal - per5hUsed,
        total: per5hTotal,
        used_pct: per5hTotal > 0 ? (per5hUsed / per5hTotal) * 100 : 0,
        next_reset_at: msToIso(q.per5HourQuotaNextRefreshTime),
      },
      weekly: {
        remaining: weeklyTotal - weeklyUsed,
        total: weeklyTotal,
        used_pct: weeklyTotal > 0 ? (weeklyUsed / weeklyTotal) * 100 : 0,
        next_reset_at: msToIso(q.perWeekQuotaNextRefreshTime),
      },
      monthly: {
        remaining: monthlyTotal - monthlyUsed,
        total: monthlyTotal,
        used_pct: monthlyTotal > 0 ? (monthlyUsed / monthlyTotal) * 100 : 0,
        next_reset_at: msToIso(q.perBillMonthQuotaNextRefreshTime),
      },
    };

    const planName = instance.instanceType ?? 'unknown';
    const codingPlan: CodingPlan = {
      subscribed: true,
      plan: planName,
      included_models: [],
      windows,
    };
    if (planName === 'pro') {
      codingPlan.price = { amount: 50, currency: site.features.currency, cycle: 'monthly' };
    } else if (planName === 'starter') {
      codingPlan.price = { amount: 10, currency: site.features.currency, cycle: 'monthly' };
    }
    return codingPlan;
  }
}

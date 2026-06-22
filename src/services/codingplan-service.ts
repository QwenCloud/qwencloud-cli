/**
 * CodingplanService — Coding Plan subscription orchestration.
 *
 * Wire format: envelope protocol via the injected ApiClient. Failures are
 * downgraded to "not subscribed" so the surrounding UsageService can still
 * render a usable summary even when this dimension is unavailable.
 */

import type { ApiClient } from '../api/api-client.js';
import type { CachedFetcher } from '../types/cache.js';
import type { CodingPlanInstance, CodingPlanApiResponse } from '../types/api-models.js';
import type { CodingPlan } from '../types/usage.js';
import { getEffectiveConfig } from '../config/manager.js';
import { addDiagnostic } from '../api/debug-buffer.js';
import { site } from '../site.js';

// ────────────────────────────────────────────────────────────────────
// Wire format constants
// ────────────────────────────────────────────────────────────────────

const ENVELOPE_API = 'zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2';

// ────────────────────────────────────────────────────────────────────
// GatewayAdapter contract — surfaces gateway-level extraction so tests can
// inject a stub. Production wires extractCodingPlanInstances from the
// envelope protocol response shape.
// ────────────────────────────────────────────────────────────────────

export interface GatewayAdapter {
  /** Extract the codingPlanInstanceInfos array from a raw envelope response. */
  extractCodingPlanInstances(raw: CodingPlanApiResponse | null | undefined): CodingPlanInstance[];
}

/** Extract coding plan instances from the standard envelope response shape. */
export function extractCodingPlanInstances(
  raw: CodingPlanApiResponse | null | undefined,
): CodingPlanInstance[] {
  return raw?.DataV2?.data?.data?.codingPlanInstanceInfos ?? [];
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
    private readonly apiClient: ApiClient,
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

      const data = await this.apiClient.callEnvelopeApi<CodingPlanApiResponse | null>({
        api: ENVELOPE_API,
        data: requestPayload,
        cornerstoneParam: {
          domain: this.getCodingPlanHost(),
          consoleSite: 'QWENCLOUD',
          console: 'ONE_CONSOLE',
          xsp_lang: site.defaults.language,
          protocol: 'V2',
          productCode: 'p_efm',
        },
      });

      const instances = this.gatewayAdapter.extractCodingPlanInstances(data);
      if (!instances || instances.length === 0) return { subscribed: false };

      const instance = instances[0]!;
      if (instance.status !== 'VALID') return { subscribed: false };

      return this.buildCodingPlanDto(instance);
    } catch (error) {
      addDiagnostic(
        'CodingPlan',
        `fetch failed, treating as not subscribed: ${error instanceof Error ? error.message : String(error)}`,
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

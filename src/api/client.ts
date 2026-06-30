/** Flat-surface CLI-facing client that stitches services into the command contract. */
import type { ModelsListResponse, ModelDetail, Model } from '../types/model.js';
import type {
  UsageSummaryResponse,
  UsageBreakdownResponse,
  UsageLogsResponse,
} from '../types/usage.js';
import type { AuthStatus, DeviceFlowPollResponse } from '../types/auth.js';
import type {
  DocsSearchResponse,
  DocContentResult,
  DocsIndexEntry,
  ResolveResult,
} from '../types/docs.js';
import type { WorkspaceListResult, WorkspaceLimitResult } from '../types/workspace.js';

import { getEffectiveConfig } from '../config/manager.js';
import { createServices, type ServiceContainer } from '../services/index.js';
import type { LoginInitResult } from '../services/auth-service.js';
import type { AuthModeContext } from '../auth/pkce.js';
import type { WorkspaceService } from '../services/workspace-service.js';
import type { BillingService } from '../services/billing-service.js';
import type { SubscriptionService } from '../services/subscription-service.js';
import type { SubscriptionTokenPlanService } from '../services/subscription-tokenplan-service.js';
import type { SupportService } from '../services/support-service.js';
import type { DocsService, DocsSearchOptions } from '../services/docs-service.js';
import type { UsageLogsOptions } from '../services/usage-service.js';
import type {
  UsageLimit,
  ConsumeBreakdown,
  ConsumeBreakdownByPeriods,
  ConsumeBreakdownOptions,
  SettleBillSummary,
  SettleBillSummaryOptions,
} from '../types/billing-extra.js';
import type {
  SubscriptionStatusResult,
  SubscriptionOrdersResult,
  ListOrdersOptions,
} from '../types/subscription.js';
import type { PaymentMethodsResult } from '../types/payment-method.js';

export type ClientFactory = () => Promise<CliFacade>;

export interface ListModelsOptions {
  input?: string;
  output?: string;
}

export interface UsageSummaryOptions {
  from?: string;
  to?: string;
  period?: string;
}

export interface UsageBreakdownOptions {
  model: string;
  granularity?: 'day' | 'month' | 'quarter';
  from?: string;
  to?: string;
  period?: string;
  days?: number;
}

/**
 * CliFacade — broad-surface client used by the command layer. Retained as a
 * single point of indirection so commands stay decoupled from the service
 * graph's internal shape.
 */
export interface CliFacade {
  // Models
  listModels(options?: ListModelsOptions): Promise<ModelsListResponse>;
  getModel(id: string): Promise<ModelDetail>;
  getModels(ids: string[]): Promise<(ModelDetail | null)[]>;
  searchModels(keyword: string): Promise<ModelsListResponse>;
  fetchQuotasForModels(models: Model[]): Promise<Model[]>;

  // Usage
  getUsageSummary(options?: UsageSummaryOptions): Promise<UsageSummaryResponse>;
  getUsageBreakdown(options: UsageBreakdownOptions): Promise<UsageBreakdownResponse>;
  getUsageLogs(options: UsageLogsOptions): Promise<UsageLogsResponse>;

  // Docs
  searchDocs(options: DocsSearchOptions): Promise<DocsSearchResponse>;
  fetchDocContent(url: string): Promise<DocContentResult>;
  loadDocsIndex(): Promise<DocsIndexEntry[]>;
  resolveDocPath(input: string, index: DocsIndexEntry[]): ResolveResult;

  // Auth
  getAuthStatus(): Promise<AuthStatus>;
  loginInit(ctx?: AuthModeContext): Promise<LoginInitResult>;
  loginPoll(
    token: string,
    intervalSec?: number,
    verifier?: string,
  ): Promise<DeviceFlowPollResponse>;
  revokeSession(): Promise<boolean>;

  // Extended command groups
  workspaceService: WorkspaceService;
  billingService: BillingService;
  subscriptionService: SubscriptionService;
  subscriptionTokenPlanService: SubscriptionTokenPlanService;
  docsService: DocsService;
  supportService: SupportService;

  // Flat command-facing methods (delegated to services)
  listWorkspaces(): Promise<WorkspaceListResult>;
  getWorkspaceLimit(): Promise<WorkspaceLimitResult>;

  // Billing (extended)
  getUsageLimit(): Promise<UsageLimit>;
  getConsumeBreakdown(opts: ConsumeBreakdownOptions): Promise<ConsumeBreakdown>;
  getConsumeBreakdownByPeriods(opts: ConsumeBreakdownOptions): Promise<ConsumeBreakdownByPeriods>;
  getSettleBillSummary(opts: SettleBillSummaryOptions): Promise<SettleBillSummary>;
  getPaymentMethods(): Promise<PaymentMethodsResult>;

  // Subscription
  getSubscriptionStatus(opts?: { plan?: 'token' | 'coding' }): Promise<SubscriptionStatusResult>;
  listSubscriptionOrders(opts: ListOrdersOptions): Promise<SubscriptionOrdersResult>;

  // Health
  ping(): Promise<{ latency: number; reachable: boolean; hostname: string }>;
  checkVersion(): Promise<{
    current: string;
    latest: string;
    update_available: boolean;
  }>;
}

/**
 * Backwards-compatible alias. Existing code still imports `ApiClient` from
 * this module; new code should prefer `CliFacade`.
 */
export type ApiClient = CliFacade;

declare const __VERSION__: string;

/** Lightweight HEAD probe of the configured api endpoint. */
async function pingEndpoint(): Promise<{
  latency: number;
  reachable: boolean;
  hostname: string;
}> {
  const endpoint = (getEffectiveConfig()['api.endpoint'] as string).replace(/\/+$/, '');
  const hostname = (() => {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return endpoint;
    }
  })();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const start = Date.now();
    await fetch(endpoint, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(timer);
    return { latency: Date.now() - start, reachable: true, hostname };
  } catch {
    clearTimeout(timer);
    return { latency: 0, reachable: false, hostname };
  }
}

/** CLI version probe via the upgrade-check module (no service dependency). */
async function probeLatestVersion(): Promise<{
  current: string;
  latest: string;
  update_available: boolean;
}> {
  const current = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '1.0.0';
  const { fetchLatestVersion, compareVersions } = await import('../upgrade/check.js');
  const latest = await fetchLatestVersion();
  if (!latest) return { current, latest: current, update_available: false };
  return { current, latest, update_available: compareVersions(current, latest) < 0 };
}

/** Build a CliFacade by composing the Service layer through `createServices`. */
export async function createClient(_options?: { endpoint?: string }): Promise<CliFacade> {
  const services: ServiceContainer = createServices();
  const {
    modelsService,
    usageService,
    authService,
    workspaceService,
    billingService,
    subscriptionService,
    docsService,
    supportService,
  } = services;
  const { subscriptionTokenPlanService } = services;

  return {
    // Models
    listModels: (opts) => modelsService.listModels(opts),
    searchModels: (keyword) => modelsService.searchModels(keyword),
    fetchQuotasForModels: (models) => modelsService.fetchQuotasForModels(models),
    getModel: (id) => modelsService.getModel(id),
    getModels: (ids) => modelsService.getModels(ids),

    // Usage
    getUsageSummary: (opts) => usageService.getUsageSummary(opts),
    getUsageBreakdown: (opts) => usageService.getUsageBreakdown(opts),
    getUsageLogs: (opts) => usageService.getUsageLogs(opts),

    // Docs
    searchDocs: (opts) => docsService.searchDocs(opts),
    fetchDocContent: (url) => docsService.fetchDocContent(url),
    loadDocsIndex: () => docsService.loadDocsIndex(),
    resolveDocPath: (input, index) => docsService.resolveDocPath(input, index),

    // Auth
    getAuthStatus: () => authService.getAuthStatus(),
    loginInit: (ctx) => authService.loginInit(ctx),
    loginPoll: (token, intervalSec, verifier) =>
      authService.loginPoll(token, intervalSec, verifier),
    revokeSession: async () => {
      try {
        await authService.logout();
        return true;
      } catch {
        return false;
      }
    },

    // Extended command groups
    workspaceService,
    billingService,
    subscriptionService,
    subscriptionTokenPlanService,
    docsService,
    supportService,

    // Flat command-facing methods
    listWorkspaces: () => workspaceService.list(),
    getWorkspaceLimit: () => workspaceService.limit(),

    // Billing (extended)
    getUsageLimit: () => billingService.getUsageLimit(),
    getConsumeBreakdown: (opts) => billingService.getConsumeBreakdown(opts),
    getConsumeBreakdownByPeriods: (opts) => billingService.getConsumeBreakdownByPeriods(opts),
    getSettleBillSummary: (opts) => billingService.getSettleBillSummary(opts),
    getPaymentMethods: () => billingService.getOuterPaymentMethods(),

    // Subscription
    getSubscriptionStatus: (opts) => subscriptionService.getStatus(opts ?? {}),
    listSubscriptionOrders: (opts) => subscriptionService.listOrders(opts),

    // Health
    ping: () => pingEndpoint(),
    checkVersion: () => probeLatestVersion(),
  };
}

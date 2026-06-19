/**
 * Mock ApiClient factory for command-layer tests.
 *
 * All methods default to an "everything is fine, but empty" response so each
 * test only has to override the bits it cares about. Callers typically do:
 *
 *   const client = makeMockApiClient({
 *     listModels: async () => ({ models: [{ id: 'qwen3.6-plus', ... }], total: 1 }),
 *   });
 */
import type { ApiClient } from '../../src/api/client.js';
import type { Model } from '../../src/types/model.js';
import type { WorkspaceService } from '../../src/services/workspace-service.js';
import type { BillingService } from '../../src/services/billing-service.js';
import type { SubscriptionService } from '../../src/services/subscription-service.js';
import type { SubscriptionTokenPlanService } from '../../src/services/subscription-tokenplan-service.js';
import type { DocsService, DocsSearchOptions } from '../../src/services/docs-service.js';
import type { DocContentResult } from '../../src/types/docs.js';

export function makeMockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const emptyWorkspaces = { items: [], total: 0, limit: 0 };
  const emptyWorkspaceLimit = { current: 0, max: 0 };
  const workspaceServiceStub = {
    list: async () => emptyWorkspaces,
    limit: async () => emptyWorkspaceLimit,
  } as unknown as WorkspaceService;
  const billingServiceStub = {} as unknown as BillingService;
  const subscriptionServiceStub = {} as unknown as SubscriptionService;
  const subscriptionTokenPlanServiceStub = {} as unknown as SubscriptionTokenPlanService;
  const docsServiceStub = {} as unknown as DocsService;

  const emptyUsageLimit = {
    threshold: '0',
    receivers: [] as string[],
    notify: false,
    currency: 'USD',
  };
  const emptyConsumeBreakdown = { rows: [], truncated: 0, currency: 'USD' };
  const emptySettleBillSummary = {
    cycles: [],
    total: {
      pretaxAmount: '0',
      paymentAmount: '0',
      cashAmount: '0',
      voucherAmount: '0',
      couponAmount: '0',
      promotionAmount: '0',
    },
    currency: 'USD',
  };
  const emptySubscriptionStatus = { sections: [], diagnostics: [] };
  const emptySubscriptionOrders = {
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: 10,
    diagnostics: [],
    currency: 'USD',
  };

  const defaults: ApiClient = {
    listModels: async () => ({ models: [], total: 0 }),
    getModel: async (id: string) => {
      throw new Error(`Model '${id}' not found`);
    },
    getModels: async () => [],
    searchModels: async () => ({ models: [], total: 0 }),
    fetchQuotasForModels: async (models) => models,

    getUsageSummary: async () => ({
      period: { from: '2026-04-01', to: '2026-04-20' },
      free_tier: [],
      coding_plan: { subscribed: false },
      token_plan: { subscribed: false },
      pay_as_you_go: { models: [], total: { cost: 0, currency: 'USD' } },
    }),
    getUsageBreakdown: async (opts) => ({
      model_id: opts.model,
      period: { from: '2026-04-01', to: '2026-04-20' },
      granularity: opts.granularity ?? 'day',
      rows: [],
      total: { cost: 0, currency: 'USD' },
    }),
    getUsageLogs: async (opts) => ({
      totalCount: 0,
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 20,
      period: { from: opts.from ?? '', to: opts.to ?? '' },
      items: [],
    }),

    searchDocs: async (opts) => ({
      totalCount: 0,
      page: opts.page ?? 1,
      pageSize: opts.limit ?? 20,
      items: [],
      rawItems: [],
    }),

    fetchDocContent: async (url: string): Promise<DocContentResult> => ({
      url,
      resolvedMarkdownUrl: url.endsWith('.md') ? url : url + '.md',
      content: null,
      error: 'Not mocked',
      anchor: null,
    }),

    loadDocsIndex: async () => [],
    resolveDocPath: () => ({ type: 'notfound' as const, suggestions: [] }),

    getAuthStatus: async () => ({ authenticated: true, server_verified: true }),
    loginInit: async () => ({
      token: 't', verification_url: '', expires_in: 600, interval: 5, auth_mode: 'pkce',
    }),
    loginPoll: async () => ({ status: 'authorization_pending' }),
    revokeSession: async () => true,

    workspaceService: workspaceServiceStub,
    billingService: billingServiceStub,
    subscriptionService: subscriptionServiceStub,
    subscriptionTokenPlanService: subscriptionTokenPlanServiceStub,
    docsService: docsServiceStub,

    listWorkspaces: async () => emptyWorkspaces,
    getWorkspaceLimit: async () => emptyWorkspaceLimit,

    getUsageLimit: async () => emptyUsageLimit as never,
    getConsumeBreakdown: async () => emptyConsumeBreakdown as never,
    getSettleBillSummary: async () => emptySettleBillSummary as never,
    getSubscriptionStatus: async () => emptySubscriptionStatus as never,
    listSubscriptionOrders: async () => emptySubscriptionOrders as never,

    ping: async () => ({ latency: 1, reachable: true, hostname: 'test' }),
    checkVersion: async () => ({ current: '1.0.0', latest: '1.0.0', update_available: false }),
  };
  return { ...defaults, ...overrides };
}

/** Convenience: minimal Model with sensible defaults. */
export function makeModel(overrides: Partial<Model> & { id: string }): Model {
  return {
    modality: { input: ['text'], output: ['text'] },
    can_try: true,
    free_tier: { mode: null, quota: null },
    ...overrides,
  } as Model;
}

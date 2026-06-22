// View Models — Layer 2: Transform API data into render-friendly structures
// This layer is pure data — no React, no console.log, no side effects.

export {
  // Models
  buildModelListViewModel,
  buildModelListViewModelFromModels,
  buildModelDetailViewModel,
  // Shared format utilities (transit-through for command layer)
  formatFreeTierSplit,
  formatFreeTier,
  formatPriceFromPricing,
} from './models/index.js';
export type {
  ModelRowViewModel,
  ModelsListViewModel,
  ModelDetailViewModel,
  PricingLineViewModel,
  BuiltInToolViewModel,
  ContextViewModel,
  FreeTierSummaryViewModel,
} from './models/index.js';

export {
  // Usage Summary
  buildUsageSummaryViewModel,
  // Usage Breakdown
  buildUsageBreakdownViewModel,
  // Usage Logs
  buildUsageLogsViewModel,
} from './usage/index.js';
export type {
  UsageSummaryViewModel,
  FreeTierSectionViewModel,
  FreeTierRowViewModel,
  CodingPlanSectionViewModel,
  CodingPlanWindowViewModel,
  PayAsYouGoSectionViewModel,
  PayAsYouGoRowViewModel,
  UsageBreakdownViewModel,
  BreakdownColumn,
  BreakdownRowViewModel,
  BreakdownTotalViewModel,
  UsageLogsViewModel,
  UsageLogRowViewModel,
  UsageLogStatusColor,
} from './usage/index.js';

export {
  // Doctor
  buildDoctorViewModel,
} from './doctor/index.js';
export type { DoctorViewModel, DoctorCheckViewModel, DoctorCheck } from './doctor/index.js';

export { buildWorkspaceListViewModel, buildWorkspaceLimitViewModel } from './workspace/index.js';
export type {
  WorkspaceListViewModel,
  WorkspaceRowViewModel,
  WorkspaceLimitViewModel,
} from './workspace/index.js';

export {
  buildBillingLimitViewModel,
  buildBillingBreakdownViewModel,
  buildBillingSummaryViewModel,
} from './billing/index.js';
export type {
  BillingLimitViewModel,
  BillingBreakdownViewModel,
  BillingBreakdownRowViewModel,
  BillingSummaryViewModel,
  BillingSummaryFieldViewModel,
} from './billing/index.js';

export {
  buildSubscriptionStatusViewModel,
  buildSubscriptionOrdersViewModel,
} from './subscription/index.js';
export type {
  SubscriptionStatusViewModel,
  SubscriptionStatusFieldViewModel,
  SubscriptionQuotaViewModel,
  SubscriptionOrdersViewModel,
  SubscriptionOrderRowViewModel,
} from './subscription/index.js';

export { buildDocsSearchViewModel, stripEmTags } from './docs/index.js';
export type {
  DocsSearchViewModel,
  DocsSearchItemViewModel,
  BuildDocsSearchOptions,
} from './docs/index.js';

// Text mode renderers — Layer 3: Pure text output (no ANSI, no borders)
// Receives ViewModels as input, outputs via console.log

export {
  // Usage
  renderTextUsageSummary,
  renderTextUsageBreakdown,
  renderTextUsageLogs,
} from './usage.js';

export { renderTextDocsSearch } from './docs.js';

export {
  // Models
  renderTextModelsList,
  renderTextModelDetail,
} from './models.js';

export {
  // Doctor
  renderTextDoctor,
} from './doctor.js';

export { renderTextWorkspaceList, renderTextWorkspaceLimit } from './workspace.js';
export {
  renderTextBillingLimit,
  renderTextBillingBreakdown,
  renderTextBillingSummary,
} from './billing.js';

export { renderTextSubscriptionStatus, renderTextSubscriptionOrders } from './subscription.js';

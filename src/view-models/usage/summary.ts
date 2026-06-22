import type {
  UsageSummaryResponse,
  FreeTierUsage,
  CodingPlan,
  TokenPlan,
  PayAsYouGo,
} from '../../types/usage.js';
import {
  humanizeNumber,
  humanizeWithUnit,
  formatNextReset,
  formatAmount,
} from '../../output/humanize.js';
import { CUR } from './shared.js';

// ── Usage Summary ViewModel ───────────────────────────────────────────

export interface UsageSummaryViewModel {
  period: string; // "2026-04-07"
  freeTier?: FreeTierSectionViewModel;
  codingPlan?: CodingPlanSectionViewModel;
  tokenPlan?: TokenPlanSectionViewModel;
  payAsYouGo?: PayAsYouGoSectionViewModel;
}

export interface FreeTierSectionViewModel {
  items: FreeTierRowViewModel[]; // already sorted, possibly truncated
  totalCount: number; // total number of free tier models
  hiddenCount: number; // number hidden due to truncation (0 = no truncation)
  footer: string;
}

export interface FreeTierRowViewModel {
  modelId: string;
  remaining: string; // "850K tok"
  total: string; // "1M tok"
  progressBar: {
    percentage: number; // 0-100
    mode: 'remaining';
    label: string; // "85% left"
  };
  isFreeOnly: boolean; // for "Only" models
}

export interface CodingPlanSectionViewModel {
  planName: string; // "Pro"
  price: string; // "$50/mo"
  includedModels: string; // space-separated model list
  windows: CodingPlanWindowViewModel[];
}

export interface CodingPlanWindowViewModel {
  label: string; // "Per 5 hours" / "This week" / "This month"
  remaining: string; // "4,820 req"
  total: string; // "6,000"
  usedPct: number; // 20
  progressBar: {
    percentage: number;
    mode: 'remaining' | 'used';
    label: string; // "20%"
  };
  nextReset: string; // "in 3h 24m"
}

export interface TokenPlanSectionViewModel {
  planName: string; // "Token Plan Team (Monthly)"
  status: string; // "valid" | "exhaust" | "invalid"
  usageDisplay: string; // "0 / 25,000 Credits"
  progressBar: {
    percentage: number; // remaining percentage 0-100
    mode: 'remaining';
    label: string; // "100%"
  };
  resetDate: string; // "2026-06-01" or "—"
  addonRemaining?: string; // "1,000 Credits"
}

export interface PayAsYouGoSectionViewModel {
  period: string; // "2026-04-01 → 2026-04-07"
  items: PayAsYouGoRowViewModel[]; // sorted by cost desc, possibly truncated
  totalCount: number; // total number of PAYG models
  hiddenCount: number; // hidden due to truncation
  total: {
    cost: string;
  };
  isEmpty: boolean;
}

export interface PayAsYouGoRowViewModel {
  modelId: string;
  usage: string; // "480K in · 120K out tok" or "45 img"
  cost: string; // "$0.38"
}

export function buildUsageSummaryViewModel(response: UsageSummaryResponse): UsageSummaryViewModel {
  const vm: UsageSummaryViewModel = {
    period: response.period.to,
  };

  // Free Tier section
  if (response.free_tier.length > 0) {
    const allItems = sortFreeTierRows(response.free_tier.map(buildFreeTierRow));
    const totalCount = allItems.length;
    vm.freeTier = {
      items: allItems,
      totalCount,
      hiddenCount: 0,
      footer: `${totalCount} models with free tier`,
    };
  }

  // Coding Plan section
  if (response.coding_plan.subscribed && response.coding_plan.windows) {
    vm.codingPlan = buildCodingPlanSection(response.coding_plan);
  }

  // Token Plan section
  if (response.token_plan?.subscribed) {
    vm.tokenPlan = buildTokenPlanSection(response.token_plan);
  }

  // Pay-as-you-go section
  vm.payAsYouGo = buildPayAsYouGoSection(response.pay_as_you_go, response.period);

  return vm;
}

/**
 * Sort free tier rows by urgency: quota models first (ascending remaining%),
 * then quota=null models at the end.
 */
function sortFreeTierRows(rows: FreeTierRowViewModel[]): FreeTierRowViewModel[] {
  return [...rows].sort((a, b) => {
    const aHasQuota = !a.isFreeOnly;
    const bHasQuota = !b.isFreeOnly;
    if (aHasQuota && bHasQuota) {
      return a.progressBar.percentage - b.progressBar.percentage; // lower remaining% first
    }
    if (aHasQuota) return -1;
    if (bHasQuota) return 1;
    return a.modelId.localeCompare(b.modelId);
  });
}

function buildFreeTierRow(usage: FreeTierUsage): FreeTierRowViewModel {
  if (usage.quota == null) {
    // "Only" mode or no quota
    return {
      modelId: usage.model_id,
      remaining: '—',
      total: '—',
      progressBar: { percentage: 100, mode: 'remaining', label: '' },
      isFreeOnly: true,
    };
  }

  const q = usage.quota;
  // Direct compute from remaining/total to avoid the precision loss
  // introduced by `100 - used_pct` (used_pct is already truncated upstream).
  const remainingPct = q.total > 0 ? parseFloat(((q.remaining / q.total) * 100).toFixed(2)) : 0;

  // Expired quota: show total with (expired) suffix, not misleading remaining amount
  const remainingStr =
    q.status === 'expire'
      ? `${humanizeWithUnit(q.total, q.unit)} (expired)`
      : humanizeWithUnit(q.remaining, q.unit);

  return {
    modelId: usage.model_id,
    remaining: remainingStr,
    total: humanizeWithUnit(q.total, q.unit),
    progressBar: {
      percentage: q.status === 'expire' ? 0 : remainingPct,
      mode: 'remaining',
      label: q.status === 'expire' ? 'expired' : `${remainingPct}%`,
    },
    isFreeOnly: false,
  };
}

function buildCodingPlanSection(codingPlan: CodingPlan): CodingPlanSectionViewModel {
  const windows: CodingPlanWindowViewModel[] = [];

  if (codingPlan.windows) {
    const w = codingPlan.windows;
    windows.push(buildCodingWindow('Per 5 hours', w.per_5h));
    windows.push(buildCodingWindow('This week', w.weekly));
    windows.push(buildCodingWindow('This month', w.monthly));
  }

  return {
    planName: codingPlan.plan?.toUpperCase() ?? 'Pro',
    price: codingPlan.price
      ? `${CUR}${codingPlan.price.amount}/${codingPlan.price.cycle === 'monthly' ? 'mo' : 'cycle'}`
      : `${CUR}50/mo`,
    includedModels: (codingPlan.included_models ?? []).join('  '),
    windows,
  };
}

function buildCodingWindow(
  label: string,
  window: { remaining: number; total: number; used_pct: number; next_reset_at: string },
): CodingPlanWindowViewModel {
  const remainingPct =
    window.total > 0 ? parseFloat(((window.remaining / window.total) * 100).toFixed(2)) : 0;
  return {
    label,
    remaining: `${window.remaining.toLocaleString(undefined, { maximumFractionDigits: 20 })} req`,
    total: `${window.total.toLocaleString(undefined, { maximumFractionDigits: 20 })}`,
    usedPct: window.used_pct,
    progressBar: {
      percentage: remainingPct,
      mode: 'remaining',
      label: `${remainingPct}%`,
    },
    nextReset: formatNextReset(window.next_reset_at),
  };
}

function buildTokenPlanSection(tokenPlan: TokenPlan): TokenPlanSectionViewModel {
  const total = tokenPlan.totalCredits ?? 0;
  const remaining = tokenPlan.remainingCredits ?? 0;
  const remainingPct = total > 0 ? parseFloat(((remaining / total) * 100).toFixed(2)) : 0;

  const resetDate = tokenPlan.resetDate
    ? tokenPlan.resetDate.split('T')[0] // ISO → YYYY-MM-DD
    : '\u2014';

  const displayStatus = tokenPlan.status ?? '\u2014';

  return {
    planName: tokenPlan.planName ?? 'Token Plan',
    status: displayStatus,
    usageDisplay: `${remaining.toLocaleString(undefined, { maximumFractionDigits: 20 })} / ${total.toLocaleString(undefined, { maximumFractionDigits: 20 })} Credits`,
    progressBar: {
      percentage: tokenPlan.status === 'exhaust' ? 0 : remainingPct,
      mode: 'remaining',
      label: tokenPlan.status === 'exhaust' ? '0%' : `${remainingPct}%`,
    },
    resetDate,
    addonRemaining: tokenPlan.addonRemaining
      ? `${tokenPlan.addonRemaining.toLocaleString(undefined, { maximumFractionDigits: 20 })} Credits`
      : undefined,
  };
}

function buildPayAsYouGoSection(
  payg: PayAsYouGo,
  period: { from: string; to: string },
): PayAsYouGoSectionViewModel {
  const isEmpty = payg.models.length === 0;

  // Sort by cost descending (highest spend first)
  const sorted = [...payg.models].sort((a, b) => b.cost - a.cost);
  const totalCount = sorted.length;

  const items = sorted.map((model) => ({
    modelId: model.model_id,
    usage: formatPaygUsage(model),
    cost: `${CUR}${formatAmount(model.cost)}`,
  }));

  return {
    period: `${period.from} → ${period.to}`,
    items,
    totalCount,
    hiddenCount: 0,
    total: {
      cost: `${CUR}${formatAmount(payg.total.cost)}`,
    },
    isEmpty,
  };
}

function formatPaygUsage(model: { model_id: string; usage: Record<string, number> }): string {
  const u = model.usage;
  // Tokens: the upstream API returns an undifferentiated count with no in/out
  // split; stored under the neutral 'tokens' key by the aggregator.
  if (u.tokens != null) {
    return `${humanizeNumber(u.tokens)} tok`;
  }
  if (u.images != null) {
    return `${humanizeNumber(u.images)} img`;
  }
  if (u.characters != null) {
    return `${humanizeNumber(u.characters)} char`;
  }
  if (u.seconds != null) {
    return `${humanizeNumber(u.seconds)} sec`;
  }
  if (u.voices != null) {
    return `${humanizeNumber(u.voices)} voice`;
  }
  // Dynamic unit fallback (e.g. "calls", "request") — first non-zero key wins.
  for (const [k, v] of Object.entries(u)) {
    if (typeof v === 'number' && v > 0) {
      return `${humanizeNumber(v)} ${k}`;
    }
  }
  return '—';
}

// formatNextReset is imported from '../../output/humanize.js' — single source of truth

import { stripVTControlCharacters } from 'node:util';
import { formatCmd } from '../../utils/runtime-mode.js';
import type {
  TokenPlanListResult,
  TokenPlanListRow,
  TokenPlanListSection,
  TokenPlanCatalogPlan,
  TokenPlanCurrentPlanDetails,
} from '../../types/tokenplan-catalog.js';
import { findTokenPlanIndividualTierBySpecCode } from '../../types/tokenplan-tiers.js';
import { percentagePair } from '../../utils/percentage.js';
import {
  buildTokenPlanCatalogDetails,
  tokenPlanDisplayDate,
  type TokenPlanDisplayTable,
} from './tokenplan-details.js';

export type TokenPlanListJsonRow = Omit<
  TokenPlanListRow,
  'status' | 'weeklyCredits' | 'monthlyCredits'
> & {
  status?: TokenPlanListRow['status'];
};

type TokenPlanListJsonCurrentPlanDetails = Pick<
  TokenPlanCurrentPlanDetails,
  'subscriptionId' | 'endAt'
> & {
  usedPct?: number | null;
  remainingPct?: number | null;
  quotaWindowType?: TokenPlanCurrentPlanDetails['quotaWindowType'];
};

type TokenPlanListJsonPlan = Omit<TokenPlanCatalogPlan, 'quotaWindows'> & {
  quotaWindows: Array<Pick<TokenPlanCatalogPlan['quotaWindows'][number], 'windowType'>>;
};

export type TokenPlanListJsonResult = Omit<TokenPlanListResult, 'sections'> & {
  sections: Array<
    Omit<TokenPlanListSection, 'rows' | 'currentPlanDetails' | 'plans'> & {
      rows: TokenPlanListJsonRow[];
      currentPlanDetails?: TokenPlanListJsonCurrentPlanDetails | null;
      plans?: TokenPlanListJsonPlan[];
    }
  >;
};

export interface TokenPlanListViewModel {
  data: TokenPlanListJsonResult;
  billingCycleLabel: string;
  sections: Array<{
    edition: string;
    title: string;
    subscription: string | null;
    subscriptionDetails: string[];
    type: string | null;
    cycleNote: string | null;
    columns: Array<{ key: string; header: string }>;
    rows: Record<string, string>[];
    diagnostics: string[];
    details: TokenPlanDisplayTable[];
  }>;
  note: string;
}

function text(value: string): string {
  return Array.from(stripVTControlCharacters(value))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && (code < 127 || code > 159);
    })
    .join('')
    .trim();
}

function nullableText(value: string | null): string | null {
  return value === null ? null : text(value);
}

function normalizePlan(plan: TokenPlanCatalogPlan): TokenPlanCatalogPlan {
  return {
    ...(plan.tier === undefined ? {} : { tier: text(plan.tier) }),
    ...(plan.seatType === undefined ? {} : { seatType: text(plan.seatType) }),
    billingTerm: plan.billingTerm,
    listPrice: nullableText(plan.listPrice),
    promoPrice: nullableText(plan.promoPrice),
    currency: plan.currency,
    quotaWindows: plan.quotaWindows
      .filter((window) => window.windowType !== 'five_hour')
      .map((window) => ({
        windowType: window.windowType,
        totalCredits: text(window.totalCredits),
      })),
    ...(plan.supportedModels === undefined
      ? {}
      : {
          supportedModels:
            plan.supportedModels === null
              ? null
              : plan.supportedModels.map((model) => ({
                  modelId: text(model.modelId),
                  modelBrand: text(model.modelBrand),
                  modelName: text(model.modelName),
                  capabilities: model.capabilities.map(text),
                  ...(model.badgeLabel === undefined ? {} : { badgeLabel: text(model.badgeLabel) }),
                  ...(model.badgeDescription === undefined
                    ? {}
                    : { badgeDescription: text(model.badgeDescription) }),
                  ...(model.isNew === undefined ? {} : { isNew: model.isNew }),
                })),
        }),
  };
}

const individualStatusLabels: Record<TokenPlanListRow['status'], string> = {
  purchasable: 'purchasable',
  unavailable: 'not_subscribable',
  subscribed: 'current_plan',
  upgrade: 'upgrade_on_web',
  unknown: 'unknown',
};

const seatNames: Record<string, string> = {
  standard: 'Standard Seat',
  pro: 'Pro Seat',
  max: 'Max Seat',
};

function rowName(row: TokenPlanListRow, individual: boolean): string {
  return (
    (individual
      ? findTokenPlanIndividualTierBySpecCode(row.specCode)?.name
      : seatNames[row.specCode]) ??
    row.name ??
    row.seatType ??
    row.type
  );
}

function catalogDegradationMessages(section: TokenPlanListSection): string[] {
  if (section.billingCycleSupported === false) return [];
  const individual = section.edition === 'individual';
  if (section.rows.length === 0) {
    return section.diagnostics.length === 0
      ? ['No Token Plan tiers are available for the selected edition and billing cycle.']
      : [
          `${individual ? 'Individual' : 'Team'} Token Plan catalog is temporarily unavailable. Try again later.`,
        ];
  }

  const messages = section.rows.flatMap((row) => {
    const missing: string[] = [];
    if (row.price === null || row.currency === null) missing.push('price');
    if (row.inventory === null) missing.push('availability');
    if (individual) {
      // A personal tier needs at least one quota-config limit (weekly or its monthly fallback).
      if (row.weeklyCredits === undefined && row.monthlyCredits === null) {
        missing.push('credit limit');
      }
    } else if (row.monthlyCredits === null) {
      missing.push('monthly credit limit');
    }
    if (missing.length === 0) return [];
    const fields =
      missing.length === 1
        ? missing[0]!
        : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
    return [
      `${rowName(row, individual)} ${fields} ${missing.length === 1 ? 'is' : 'are'} temporarily unavailable. Try again later.`,
    ];
  });

  return [
    ...new Set([
      ...messages,
      ...section.diagnostics
        .filter(
          (entry) =>
            entry.api === 'TokenPlanSupportedModels' ||
            (entry.api.endsWith('/quota-config') &&
              ['INVALID_FIVE_HOUR_QUOTA', 'INVALID_WEEKLY_QUOTA', 'INVALID_MONTHLY_QUOTA'].includes(
                entry.errorCode,
              )),
        )
        .map((entry) => entry.errorMessage),
    ]),
  ];
}

function displayPrice(value: string | null): string {
  if (value === null) return '—';
  const [integer, fraction = ''] = value.split('.');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

function currentPlanUsage(
  current: TokenPlanCurrentPlanDetails,
  edition: TokenPlanListSection['edition'],
): TokenPlanListJsonCurrentPlanDetails {
  const identity = { subscriptionId: current.subscriptionId, endAt: current.endAt };
  if (current.quotaWindowType === 'five_hour') return identity;
  const quotaWindow =
    current.quotaWindowType === undefined ? {} : { quotaWindowType: current.quotaWindowType };
  if (edition === 'team') return { ...identity, ...quotaWindow };
  if (Object.hasOwn(current, 'usedPct')) {
    return {
      ...identity,
      ...percentagePair(current.usedPct),
      ...quotaWindow,
    };
  }
  const percentages = percentagePair(current.remainingPct);
  return {
    ...identity,
    usedPct: percentages.remainingPct,
    remainingPct: percentages.usedPct,
    ...quotaWindow,
  };
}

function displayPct(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100) / 100}%`;
}

function subscriptionFailureMessage(section: TokenPlanListSection): string {
  const code = section.diagnostics.find(
    (entry) => entry.api.endsWith('/subscription') || entry.api === 'GetUserInstanceSummary',
  )?.errorCode;
  if (code === undefined) return 'The subscription state could not be confirmed.';
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'TOKEN_EXPIRED':
    case 'CS_DATA_AUTH_REQUIRED':
      return `Authentication failed. Run: ${formatCmd('auth login')}`;
    case 'NETWORK_ERROR':
      return 'The subscription service could not be reached. Check your network connection.';
    case 'TIMEOUT':
      return 'The subscription service did not respond in time. Try again later.';
    case 'PROTOCOL_ERROR':
      return 'The subscription response could not be verified. Try again later.';
    case 'SERVICE_UNAVAILABLE':
      return 'The subscription service is temporarily unavailable. Try again later.';
    default:
      return 'The service did not confirm the subscription state. Try again later.';
  }
}

export function buildTokenPlanListViewModel(
  result: TokenPlanListResult,
  options: { billingCycleDefaulted?: boolean } = {},
): TokenPlanListViewModel {
  const normalizedSections: TokenPlanListSection[] = result.sections.map((section) => ({
    edition: section.edition,
    billingCycleSupported: section.billingCycleSupported,
    subscriptionStatus: section.subscriptionStatus,
    currentPlan: section.currentPlan === null ? null : text(section.currentPlan),
    currentBillingCycle:
      section.currentBillingCycle === null ? null : text(section.currentBillingCycle),
    subscriptionUrl: section.subscriptionUrl === null ? null : text(section.subscriptionUrl),
    diagnostics: section.diagnostics.map((entry) => ({
      api: text(entry.api),
      errorCode: text(entry.errorCode),
      errorMessage: text(entry.errorMessage),
    })),
    rows: section.rows.map((row) => ({
      type: row.type,
      specCode: row.specCode,
      seatType: row.seatType,
      name: row.name === null ? null : text(row.name) || null,
      price: row.price,
      currency: row.currency,
      inventory: row.inventory,
      ...(row.weeklyCredits === undefined ? {} : { weeklyCredits: row.weeklyCredits }),
      monthlyCredits: row.monthlyCredits,
      status: row.status,
    })),
    ...(section.currentPlanDetails === undefined
      ? {}
      : {
          currentPlanDetails:
            section.currentPlanDetails === null
              ? null
              : {
                  subscriptionId: nullableText(section.currentPlanDetails.subscriptionId),
                  endAt: nullableText(section.currentPlanDetails.endAt),
                  totalCredits: nullableText(section.currentPlanDetails.totalCredits),
                  remainingCredits: nullableText(section.currentPlanDetails.remainingCredits),
                  ...(Object.hasOwn(section.currentPlanDetails, 'usedPct')
                    ? { usedPct: section.currentPlanDetails.usedPct }
                    : {}),
                  ...(section.currentPlanDetails.remainingPct === undefined
                    ? {}
                    : {
                        remainingPct:
                          section.currentPlanDetails.remainingPct !== null &&
                          Number.isFinite(section.currentPlanDetails.remainingPct) &&
                          section.currentPlanDetails.remainingPct >= 0 &&
                          section.currentPlanDetails.remainingPct <= 100
                            ? section.currentPlanDetails.remainingPct
                            : null,
                      }),
                  ...(section.currentPlanDetails.quotaWindowType === undefined
                    ? {}
                    : { quotaWindowType: section.currentPlanDetails.quotaWindowType }),
                },
        }),
    ...(section.plans === undefined ? {} : { plans: section.plans.map(normalizePlan) }),
  }));
  const data: TokenPlanListJsonResult = {
    authenticated: result.authenticated,
    edition: result.edition,
    billingCycle: result.billingCycle,
    completeness: result.completeness,
    sections: normalizedSections.map((section) => ({
      edition: section.edition,
      billingCycleSupported: section.billingCycleSupported,
      subscriptionStatus: section.subscriptionStatus,
      currentPlan: section.currentPlan,
      currentBillingCycle: section.currentBillingCycle,
      subscriptionUrl: section.subscriptionUrl,
      ...(section.currentPlanDetails === undefined
        ? {}
        : {
            currentPlanDetails:
              section.currentPlanDetails === null
                ? null
                : currentPlanUsage(section.currentPlanDetails!, section.edition),
          }),
      ...(section.plans === undefined
        ? {}
        : {
            plans: section.plans.map((plan) => ({
              ...plan,
              quotaWindows: plan.quotaWindows.map(({ windowType }) => ({ windowType })),
            })),
          }),
      diagnostics: section.diagnostics,
      rows: section.rows.map(
        ({ status, weeklyCredits: _weekly, monthlyCredits: _monthly, ...row }) =>
          section.edition === 'team' && section.subscriptionStatus === 'active'
            ? row
            : { ...row, status },
      ),
    })),
  };
  return {
    data,
    billingCycleLabel: `${data.billingCycle}${options.billingCycleDefaulted ? ' (default)' : ''}`,
    sections: normalizedSections.map((section) => {
      const individual = section.edition === 'individual';
      const active = section.subscriptionStatus === 'active';
      const currentPlan =
        section.currentPlan === null
          ? null
          : (findTokenPlanIndividualTierBySpecCode(section.currentPlan)?.name ??
            section.currentPlan);
      const currentSubscription = individual
        ? currentPlan
          ? ` Current plan: ${currentPlan}${section.currentBillingCycle ? ` (${section.currentBillingCycle})` : ''}`
          : ''
        : '';
      const subscriptionDetails = active
        ? [
            ...(!individual && section.currentBillingCycle
              ? [`Billing cycle: ${section.currentBillingCycle}`]
              : []),
          ]
        : [];
      if (
        data.authenticated &&
        section.subscriptionStatus === 'unknown' &&
        section.billingCycleSupported !== false
      ) {
        subscriptionDetails.push(subscriptionFailureMessage(section));
      }
      if (section.currentPlanDetails) {
        const current = section.currentPlanDetails;
        const usage = currentPlanUsage(current, section.edition);
        subscriptionDetails.push(
          ...(individual || current.subscriptionId
            ? [`Subscription ID: ${current.subscriptionId ? text(current.subscriptionId) : '—'}`]
            : []),
          `End At: ${tokenPlanDisplayDate(current.endAt)}`,
          ...(!individual || current.quotaWindowType === 'five_hour'
            ? []
            : [
                `Used (%): ${displayPct(usage.usedPct)}; Remaining (%): ${displayPct(usage.remainingPct)}${current.quotaWindowType ? ` (${current.quotaWindowType})` : ''}`,
              ]),
        );
      }
      if (active && section.subscriptionUrl)
        subscriptionDetails.push(`View subscription: ${section.subscriptionUrl}`);
      return {
        edition: section.edition,
        title: individual ? 'INDIVIDUAL TOKEN PLANS' : 'TEAM TOKEN PLANS',
        type: null,
        subscription: active
          ? `You're already subscribed to ${individual ? 'an Individual' : 'a Team'} Token Plan.${currentSubscription}`
          : section.subscriptionStatus === 'not_subscribed' && data.authenticated
            ? `No active ${individual ? 'Individual' : 'Team'} Token Plan subscription.`
            : data.authenticated &&
                section.subscriptionStatus === 'unknown' &&
                section.billingCycleSupported !== false
              ? 'Subscription status: unknown'
              : null,
        subscriptionDetails,
        cycleNote:
          section.billingCycleSupported === false
            ? individual
              ? `Error: billing cycle '${data.billingCycle}' is not available for Individual Token Plans.\nAvailable billing cycles:\n  monthly\n  quarterly\n  yearly`
              : `Error: billing cycle '${data.billingCycle}' is not available for Team Token Plans.\nAvailable billing cycles:\n  monthly\n  yearly`
            : section.billingCycleSupported === null
              ? 'Billing cycle support: unknown'
              : null,
        columns: [
          individual ? { key: 'tier', header: 'Tier' } : { key: 'seatType', header: 'Seat Type' },
          { key: 'billingCycle', header: 'Billing Cycle' },
          { key: 'listPrice', header: 'List Price' },
          { key: 'promoPrice', header: 'Promo Price' },
          { key: 'currency', header: 'Currency' },
          { key: 'quotaWindow', header: 'Quota Window' },
          ...(individual || !active ? [{ key: 'status', header: 'Status' }] : []),
        ],
        rows: section.rows.map((row, index) => {
          const plan = section.plans?.[index];
          const windows = section.plans
            ? (plan?.quotaWindows ?? [])
            : [
                ...(individual && row.weeklyCredits !== undefined
                  ? [{ windowType: 'weekly', totalCredits: String(row.weeklyCredits) }]
                  : []),
                ...(row.monthlyCredits !== null
                  ? [{ windowType: 'monthly', totalCredits: String(row.monthlyCredits) }]
                  : []),
              ];
          const primaryWindowType =
            individual && row.weeklyCredits !== undefined
              ? 'weekly'
              : row.monthlyCredits !== null
                ? 'monthly'
                : undefined;
          const window = windows.find((entry) => entry.windowType === primaryWindowType);
          return {
            ...(individual ? { tier: row.specCode } : { seatType: row.seatType ?? row.specCode }),
            billingCycle: plan?.billingTerm ?? data.billingCycle,
            listPrice: displayPrice(plan?.listPrice ?? null),
            promoPrice: displayPrice(plan?.promoPrice ?? null),
            currency: (section.plans ? plan?.currency : row.currency) ?? '—',
            quotaWindow: window?.windowType ?? '—',
            ...(individual || !active
              ? { status: individual ? individualStatusLabels[row.status] : row.status }
              : {}),
          };
        }),
        diagnostics: catalogDegradationMessages(section),
        details: buildTokenPlanCatalogDetails(section),
      };
    }),
    note: (() => {
      const supportedCycles =
        data.edition === 'team'
          ? (['monthly', 'yearly'] as const)
          : (['monthly', 'quarterly', 'yearly'] as const);
      const editionOption = data.edition === 'all' ? '' : ` --edition ${data.edition}`;
      return [
        ...(!data.authenticated
          ? [
              'You can view Token Plan prices without logging in.',
              'To view your subscription status and account-specific availability, run:',
              `  ${formatCmd('auth login')}`,
              '',
            ]
          : []),
        'Your purchase status shown here is for reference only. Your eligibility will be verified again before purchase.',
        '',
        'To view another billing cycle, run:',
        ...supportedCycles
          .filter((c) => c !== data.billingCycle)
          .map(
            (c) =>
              `  ${formatCmd(`subscription tokenplan list${editionOption} --billing-cycle ${c}`)}`,
          ),
        '',
        'Billing cycles and credit quota reset windows are independent.',
      ].join('\n');
    })(),
  };
}

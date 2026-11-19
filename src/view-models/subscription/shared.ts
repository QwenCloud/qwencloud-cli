import { site } from '../../site.js';
import type { SubscriptionDiagnostic } from '../../types/subscription.js';
import type {
  TokenPlanEditionSection,
  TokenPlanEditionStatus,
} from '../../types/tokenplan-subscription.js';
import type { ViewContext } from '../billing/shared.js';
import {
  buildTokenPlanEditionSections,
  individualCreditPercentages,
} from './tokenplan-editions.js';
import { tokenPlanDisplayDate, tokenPlanDisplayText } from './tokenplan-details.js';

export const NA = '—';
export const CURRENCY_CODE = site.features.currency;
export const CURRENCY_SYMBOL =
  site.features.currency === 'USD'
    ? '$'
    : site.features.currency === 'CNY' || site.features.currency === 'JPY'
      ? '¥'
      : site.features.currency === 'EUR'
        ? '€'
        : site.features.currency === 'GBP'
          ? '£'
          : '';

export const STATUS_UNAVAILABLE_NOTE =
  'Subscription data unavailable — see --format json for diagnostics';

export const PARTIAL_FAILURE_NOTE_TEMPLATE = (count: number): string =>
  `Note: ${count} diagnostic(s), see --format json for details`;

export function formatDiagnosticMessage(diagnostic: SubscriptionDiagnostic): string {
  const prefix = `${diagnostic.api}:`;
  let message = diagnostic.errorMessage.trimStart();
  while (message.startsWith(prefix)) {
    message = message.slice(prefix.length).trimStart();
  }
  return message;
}

export function buildSubscriptionEditionSections(
  source: { individual?: TokenPlanEditionStatus; team?: TokenPlanEditionStatus },
  renewable: string | null,
): TokenPlanEditionSection[] {
  const sections = buildTokenPlanEditionSections(source);
  if (sections.length === 0 || renewable === null) return sections;
  const team = sections.find((section) => section.edition === 'team');
  if (team) team.fields.push({ label: 'Renewable', value: renewable });
  return sections;
}

export function buildSubscriptionStatusEditionSections(
  source: { individual?: TokenPlanEditionStatus; team?: TokenPlanEditionStatus },
  renewable: string | null,
  options: { includePeriod?: boolean } = {},
): TokenPlanEditionSection[] {
  return buildSubscriptionEditionSections(source, renewable).map((section) => {
    const edition = section.edition === 'individual' ? source.individual : source.team;
    if (!edition) return section;
    // An unsubscribed edition needs only its status and the explicit empty-state note.
    if (edition.status === 'not_subscribed') {
      return {
        ...section,
        fields: [
          ...section.fields
            .filter((field) => field.label !== 'Name')
            .map((field) => ({
              ...field,
              value: tokenPlanDisplayText(field.value),
            })),
          {
            label: 'Subscription',
            value: tokenPlanDisplayText(`No active ${section.title} Token Plan subscription.`),
          },
        ],
      };
    }
    const fields = section.fields.filter(
      (field) =>
        field.label !== 'Name' &&
        (options.includePeriod || field.label !== 'Period') &&
        !(
          Object.hasOwn(edition, 'tiers') &&
          ['Monthly Credits', 'Weekly Credits'].includes(field.label)
        ),
    );
    fields.splice(
      1,
      0,
      // Team instance identifiers identify seats rather than the overall plan.
      ...(edition.edition === 'individual' && edition.subscriptionId
        ? [
            {
              label: 'Subscription ID',
              value: tokenPlanDisplayText(edition.subscriptionId),
            },
          ]
        : []),
      { label: 'Commodity', value: tokenPlanDisplayText(edition.commodityCode) },
      { label: 'Edition', value: edition.edition },
    );
    fields.push({
      label: 'End At',
      value: tokenPlanDisplayDate(edition.endAt ?? edition.period?.end),
    });
    fields.push({ label: 'Remaining Days', value: tokenPlanDisplayText(edition.remainingDays) });
    return {
      ...section,
      fields: fields.map((field) => ({ ...field, value: tokenPlanDisplayText(field.value) })),
    };
  });
}

const STATUS_TIME_FIELDS = new Set([
  'start',
  'end',
  'resetTime',
  'nextCycleFlushTime',
  'expiresAt',
  'orderTime',
]);

/** Format edition status JSON while preserving legacy timestamp strings and service data. */
export function formatSubscriptionStatusJson(value: unknown): unknown {
  return formatStatusJson(value, false);
}

function formatStatusJson(value: unknown, normalizeTimes: boolean): unknown {
  if (Array.isArray(value)) return value.map((entry) => formatStatusJson(entry, normalizeTimes));
  if (value === null || typeof value !== 'object') return value;
  const isIndividual = 'edition' in value && value.edition === 'individual';
  const isTeam = 'edition' in value && value.edition === 'team';
  const format = (entry: unknown) =>
    formatStatusJson(entry, normalizeTimes || isIndividual || isTeam);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]): Array<[string, unknown]> => {
      if ((isIndividual || isTeam) && key === 'fiveHourCredits') return [];
      if ((isIndividual || isTeam) && key === 'tiers' && Array.isArray(entry)) {
        return [
          [
            key,
            format(
              entry
                .filter(
                  (tier) =>
                    tier === null ||
                    typeof tier !== 'object' ||
                    !('windowType' in tier) ||
                    tier.windowType !== 'five_hour',
                )
                .map((tier) =>
                  isIndividual && tier !== null && typeof tier === 'object' && !Array.isArray(tier)
                    ? Object.fromEntries(
                        Object.entries(tier).filter(
                          ([field]) => !['totalCredits', 'remainingCredits'].includes(field),
                        ),
                      )
                    : tier,
                ),
            ),
          ],
        ];
      }
      const isIndividualCredits =
        isIndividual && (key === 'monthlyCredits' || key === 'weeklyCredits');
      if (isIndividualCredits && entry === null) return [];
      if (
        isIndividualCredits &&
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry)
      ) {
        const credits = Object.fromEntries(
          Object.entries(entry).filter(
            ([field]) => !['total', 'used', 'remaining'].includes(field),
          ),
        );
        return [
          [
            key,
            format({
              ...credits,
              ...individualCreditPercentages(credits.usedPct),
            }),
          ],
        ];
      }
      if (
        (normalizeTimes || isIndividual || isTeam) &&
        STATUS_TIME_FIELDS.has(key) &&
        typeof entry === 'string' &&
        /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(entry) &&
        Number.isFinite(Date.parse(entry))
      ) {
        return [[key, new Date(entry).toISOString()]];
      }
      return [[key, format(entry)]];
    }),
  );
}

export const NARROW_TERMINAL_THRESHOLD = 80;

export function renderQuotaBar(used: number, total: number): { bar: string; percent: number } {
  if (total <= 0) return { bar: '·'.repeat(24), percent: 0 };
  const ratio = Math.min(1, Math.max(0, used / total));
  const percent = Math.round(ratio * 100);
  const filled = Math.round(ratio * 24);
  return { bar: '█'.repeat(filled).padEnd(24, '·'), percent };
}

export function renderQuotaBarFor(
  used: number,
  total: number,
  ctx: ViewContext | undefined,
): { bar: string; percent: number } {
  const cols = typeof ctx?.columns === 'number' ? ctx.columns : 100;
  if (cols < NARROW_TERMINAL_THRESHOLD) {
    if (total <= 0) return { bar: '[0.00%]', percent: 0 };
    const ratio = Math.min(1, Math.max(0, used / total));
    const pct = (ratio * 100).toFixed(2);
    return { bar: `[${pct}%]`, percent: Math.round(ratio * 100) };
  }
  return renderQuotaBar(used, total);
}

/** Boolean → "Yes" / "No" / em-dash. */
export function formatBool(value: boolean | null): string {
  if (value === null) return NA;
  return value ? 'Yes' : 'No';
}

/** Period → "start → end" / em-dash. */
export function formatPeriod(start: string, end: string): string {
  if (!start && !end) return NA;
  return `${start || NA} → ${end || NA}`;
}

export type { ViewContext } from '../billing/shared.js';

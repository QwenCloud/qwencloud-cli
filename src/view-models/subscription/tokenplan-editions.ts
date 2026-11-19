import type {
  TokenPlanCreditWindow,
  TokenPlanEditionSection,
  TokenPlanEditionStatus,
  TokenPlanSeatSummary,
} from '../../types/tokenplan-subscription.js';
import { tokenPlanDisplayDate, tokenPlanDisplayText } from './tokenplan-details.js';
import { percentagePair } from '../../utils/percentage.js';

const TEAM_PLAN_NAME = 'Token Plan Team Edition';
const INDIVIDUAL_PLAN_NAME = 'Token Plan Individual Edition';

export function individualCreditPercentages(value: unknown): {
  usedPct: number | null;
  remainingPct: number | null;
} {
  return percentagePair(value);
}

function credits(window: TokenPlanCreditWindow): string {
  const { usedPct, remainingPct } = individualCreditPercentages(window.usedPct);
  const formatPercent = (percentage: number | null) =>
    percentage === null ? 'unknown' : `${Math.round((percentage + Number.EPSILON) * 100) / 100}%`;
  const reset = window.resetTime ? `; resets ${tokenPlanDisplayDate(window.resetTime)}` : '';
  return `${formatPercent(usedPct)} used (${formatPercent(remainingPct)} remaining)${reset}`;
}

function period(start: string, end: string, remainingDays: number | null): string {
  const range = `${tokenPlanDisplayDate(start)} → ${tokenPlanDisplayDate(end)}`;
  if (remainingDays === null) return range;
  const unit = remainingDays === 1 ? 'day' : 'days';
  return `${range} (${remainingDays} ${unit} remaining)`;
}

function name(edition: TokenPlanEditionStatus): string {
  return edition.name ?? (edition.edition === 'individual' ? INDIVIDUAL_PLAN_NAME : TEAM_PLAN_NAME);
}

function seatCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function formatTeamSeatAllocation(summary: TokenPlanSeatSummary | null): string {
  const total = seatCount(summary?.total?.seats);
  const groups = summary?.groups ?? [];
  const specs = new Set(groups.map((group) => group.specType.toLowerCase()));
  const valid =
    total !== null &&
    specs.size === groups.length &&
    [...specs].every((spec) => ['standard', 'pro', 'max'].includes(spec)) &&
    groups.every(
      (group) =>
        seatCount(group.seats) !== null &&
        seatCount(group.assigned) !== null &&
        group.assigned! <= group.seats!,
    ) &&
    groups.reduce((sum, group) => sum + group.seats!, 0) === total;
  const assigned = valid ? groups.reduce((sum, group) => sum + group.assigned!, 0) : null;
  return `${total ?? 'unknown'} total · ${assigned ?? 'unknown'} assigned · ${assigned === null ? 'unknown' : total! - assigned} unassigned`;
}

export function buildTokenPlanEditionSections(source: {
  individual?: TokenPlanEditionStatus;
  team?: TokenPlanEditionStatus;
}): TokenPlanEditionSection[] {
  return [source.individual, source.team].flatMap((edition) => {
    if (!edition) return [];
    const fields: Array<{ label: string; value: string }> = [
      { label: 'Status', value: edition.status },
    ];
    if (edition.status === 'not_subscribed') fields.push({ label: 'Name', value: name(edition) });
    if (edition.status !== 'not_subscribed') {
      const renewal = Object.hasOwn(edition, 'confirmedAutoRenew')
        ? edition.confirmedAutoRenew
        : edition.autoRenew;
      fields.push(
        { label: 'Type', value: edition.type ?? 'unknown' },
        { label: 'Name', value: name(edition) },
        {
          label: 'Period',
          value: edition.period
            ? period(edition.period.start, edition.period.end, edition.remainingDays)
            : 'unknown',
        },
        { label: 'Auto-Renew', value: renewal ? (renewal.enabled ? 'On' : 'Off') : 'unknown' },
      );
      if (edition.billingCycle)
        fields.splice(3, 0, { label: 'Billing Cycle', value: edition.billingCycle });
      if (edition.edition === 'individual' && edition.monthlyCredits)
        fields.push({ label: 'Monthly Credits', value: credits(edition.monthlyCredits) });
      if (edition.edition === 'individual' && edition.weeklyCredits)
        fields.push({ label: 'Weekly Credits', value: credits(edition.weeklyCredits) });
      if (edition.edition === 'team')
        fields.push({ label: 'Seats', value: formatTeamSeatAllocation(edition.seatSummary) });
    }
    return [
      {
        edition: edition.edition,
        title: edition.edition === 'individual' ? 'Individual' : 'Team',
        fields: fields.map((field) => ({ ...field, value: tokenPlanDisplayText(field.value) })),
      },
    ];
  });
}

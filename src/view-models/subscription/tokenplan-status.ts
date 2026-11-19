import { collectTokenPlanDiagnostics } from '../../services/subscription-diagnostics.js';
import type {
  TokenPlanStatusResult,
  TokenPlanStatusViewModel as BaseTokenPlanStatusViewModel,
  TokenPlanStatusViewModelHeader,
  TokenPlanStatusSeatLine,
  TokenPlanStatusTable,
  TokenPlanStatusFooter,
  TokenPlanEditionSection,
  TokenPlanSeatDetailsViewModel,
} from '../../types/tokenplan-subscription.js';
import {
  NA,
  PARTIAL_FAILURE_NOTE_TEMPLATE,
  buildSubscriptionStatusEditionSections,
  formatDiagnosticMessage,
} from './shared.js';
import {
  buildTokenPlanStatusDetails,
  tokenPlanDisplayDate,
  tokenPlanDisplayText,
  type TokenPlanDisplayTable,
} from './tokenplan-details.js';
import {
  buildTokenPlanSeatDetailsViewModel,
  sortTokenPlanSeats,
} from './tokenplan-seat-details.js';

export interface TokenPlanStatusViewModel extends BaseTokenPlanStatusViewModel {
  detailTables?: TokenPlanDisplayTable[];
  editionSections: Array<
    TokenPlanEditionSection & {
      detailTables?: TokenPlanDisplayTable[];
      seatLines?: TokenPlanStatusSeatLine[];
      seatDetails?: TokenPlanSeatDetailsViewModel;
    }
  >;
}

/** Build display labels while preserving the service DTO for JSON output. */
export function buildTokenPlanStatusViewModel(
  result: TokenPlanStatusResult,
  format: 'tui' | 'text' | 'json',
): TokenPlanStatusViewModel {
  const diagnostics = collectTokenPlanDiagnostics(result);
  const detailTables = buildTokenPlanStatusDetails(result);
  const seatLines = buildSeatLines(result);
  const seatDetails = buildTokenPlanSeatDetailsViewModel(result.team?.seatDetails, 'tokenplan');
  const editionSections = buildSubscriptionStatusEditionSections(
    result,
    result.renewable ? formatRenewable(result.renewable) : null,
  ).map((section) => ({
    ...section,
    detailTables: detailTables.filter((table) => table.edition === section.edition),
    ...(section.edition === 'team' ? { seatLines, seatDetails } : {}),
  }));
  const totalLine = buildTotalLine(result);
  return {
    format,
    individual: result.individual,
    team: result.team,
    editionSections,
    product: result.product,
    period: result.period,
    autoRenew: result.autoRenew,
    renewable: result.renewable,
    seatSummary: result.seatSummary,
    header: format !== 'json' && editionSections.length === 0 ? buildHeader(result) : undefined,
    table: buildTable(result),
    footer: format !== 'json' ? buildFooter(result) : undefined,
    seatLines,
    totalLine,
    seatDetails,
    warnings:
      diagnostics.length > 0
        ? diagnostics.map(
            (diagnostic) => `⚠ ${tokenPlanDisplayText(formatDiagnosticMessage(diagnostic))}`,
          )
        : undefined,
    diagnostics: result.diagnostics,
    footnote: diagnostics.length > 0 ? PARTIAL_FAILURE_NOTE_TEMPLATE(diagnostics.length) : null,
    detailTables,
  };
}

function buildHeader(result: TokenPlanStatusResult): TokenPlanStatusViewModelHeader {
  return {
    product: tokenPlanDisplayText(result.product),
    period: result.period
      ? `${tokenPlanDisplayDate(result.period.end)} (${tokenPlanDisplayText(result.period.remainingDays)} days remaining)`
      : NA,
    autoRenew: result.autoRenew
      ? result.autoRenew.enabled
        ? `ON (${formatRenewalPeriod(result.autoRenew.period, result.autoRenew.periodUnit)})`
        : 'OFF'
      : NA,
    renewable: formatRenewable(result.renewable),
  };
}

function formatRenewable(renewable: TokenPlanStatusResult['renewable']): string {
  if (!renewable) return NA;
  return renewable.canRenew
    ? 'Yes'
    : renewable.interceptCode
      ? `No (${tokenPlanDisplayText(renewable.interceptCode)})`
      : 'No';
}

function seatLine(
  group: NonNullable<TokenPlanStatusResult['seatSummary']>['groups'][number],
): TokenPlanStatusSeatLine {
  return {
    specType: ['standard', 'pro', 'max'].includes(group.specType.toLowerCase())
      ? capitalizeFirst(group.specType.toLowerCase())
      : 'unknown',
    seats: tokenPlanDisplayText(group.seats),
    totalValue: formatAmount(group.totalValue),
    surplusValue: formatAmount(group.surplusValue),
    nextCycleFlushTime: tokenPlanDisplayDate(group.nextCycleFlushTime),
  };
}

function buildSeatLines(result: TokenPlanStatusResult): TokenPlanStatusSeatLine[] | undefined {
  return result.seatSummary
    ? sortTokenPlanSeats(result.seatSummary.groups, (group) => group.specType).map(seatLine)
    : undefined;
}

function buildTotalLine(result: TokenPlanStatusResult): TokenPlanStatusSeatLine | undefined {
  const total = result.seatSummary?.total;
  return total
    ? {
        specType: 'Total',
        seats: tokenPlanDisplayText(total.seats),
        totalValue: formatAmount(total.totalValue),
        surplusValue: formatAmount(total.surplusValue),
        nextCycleFlushTime: '',
      }
    : undefined;
}

function buildTable(result: TokenPlanStatusResult): TokenPlanStatusTable | null {
  return result.seatSummary
    ? { rows: buildSeatLines(result) ?? [], totalRow: buildTotalLine(result) ?? null }
    : null;
}

function buildFooter(result: TokenPlanStatusResult): TokenPlanStatusFooter {
  return { total: buildTotalLine(result) ?? null, diagnostics: result.diagnostics };
}

function formatAmount(value: string | null): string {
  if (value === null) return NA;
  const [integer = '', fraction] = tokenPlanDisplayText(value).split('.');
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${formatted}.${fraction}` : formatted;
}

function formatRenewalPeriod(period: number | null, unit: string | null): string {
  if (period === null || unit === null) return NA;
  if (unit === 'M' || unit === 'Month') return period === 1 ? 'Monthly' : `${period} Months`;
  if (unit === 'Y' || unit === 'Year') return period === 1 ? 'Yearly' : `${period} Years`;
  return `${period} ${tokenPlanDisplayText(unit)}`;
}

function capitalizeFirst(value: string): string {
  const safe = tokenPlanDisplayText(value);
  return safe.charAt(0).toUpperCase() + safe.slice(1);
}

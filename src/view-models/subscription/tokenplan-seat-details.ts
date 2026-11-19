import { stripVTControlCharacters } from 'node:util';
import type {
  TokenPlanSeatDetails,
  TokenPlanSeatDetailsViewModel,
} from '../../types/tokenplan-subscription.js';

function safe(value: string): string {
  // Keep remote IDs on one line; JSON retains their original, escaped representation.
  return stripVTControlCharacters(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ');
}

function amount(value: string | null): string {
  if (value === null) return 'unknown';
  const [integer = '0', fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (trimmed ? `.${trimmed}` : '');
}

const STATUS = new Map(
  Object.entries({
    CREATING: 'Active',
    NORMAL: 'Active',
    LIMIT: 'Active',
    RELEASE: 'Expired',
    STOP: 'Expired',
    REFUNDED: 'Refunded',
  }),
);
const TYPES = new Map(Object.entries({ standard: 'Standard', pro: 'Pro', max: 'Max' }));

export function sortTokenPlanSeats<T>(
  seats: readonly T[],
  type: (seat: T) => string | null | undefined,
): T[] {
  const order = ['standard', 'pro', 'max'];
  const rank = (value: string | null | undefined) => {
    const index = order.indexOf(value?.toLowerCase() ?? '');
    return index < 0 ? order.length : index;
  };
  return [...seats].sort((a, b) => rank(type(a)) - rank(type(b)));
}

export function formatTokenPlanSeatName(specType: string | null): string {
  return TYPES.get(specType?.toLowerCase() ?? '') ?? 'unknown';
}

function remainingPercent(totalValue: string | null, surplusValue: string | null): string {
  if (totalValue === null || surplusValue === null) return '—';
  const total = Number(totalValue);
  const remaining = Number(surplusValue);
  // A zero or unknown total cannot establish a remaining percentage.
  if (
    !Number.isFinite(total) ||
    !Number.isFinite(remaining) ||
    total <= 0 ||
    remaining < 0 ||
    remaining > total
  )
    return '—';
  return `${Math.round((remaining / total) * 10_000) / 100}%`;
}

export function buildTokenPlanSeatDetailsViewModel(
  details: TokenPlanSeatDetails | undefined,
  variant: 'subscription' | 'tokenplan' = 'subscription',
): TokenPlanSeatDetailsViewModel | undefined {
  if (!details) return undefined;
  const dedicated = variant === 'tokenplan';
  const hasUnknownStatus = details.items.some((seat) => seat.status === null);
  const label = hasUnknownStatus ? 'seat record' : 'current seat';
  const count = `${details.items.length} ${label}${details.items.length === 1 ? '' : 's'}`;
  const notes: string[] = [];
  const summaryMismatch = details.diagnostics.find((d) => d.errorCode === 'SeatSummaryMismatch');
  if (summaryMismatch) {
    notes.push(summaryMismatch.errorMessage);
    if (details.items.length) notes.push(`Showing ${count}. Credits: remaining / total.`);
  } else if (details.collectionCompleteness !== 'complete') {
    const state = details.collectionCompleteness === 'partial' ? 'incomplete' : 'unavailable';
    notes.push(
      `Seat query ${state}: ${details.fetchedCount} / ${details.totalCount ?? 'unknown'} records retrieved.`,
    );
    if (details.items.length) notes.push(`Showing ${count}. Credits: remaining / total.`);
  } else if (!dedicated || details.items.length === 0) {
    notes.push(
      details.items.length ? `${count}. Credits: remaining / total.` : 'No current seats.',
    );
  }
  return {
    title: dedicated ? 'SEAT DETAILS' : 'Seat Details',
    headers: [
      'SEAT ID',
      dedicated ? 'SEAT TYPE' : 'TYPE',
      'STATUS',
      'ASSIGNMENT',
      dedicated ? 'CREDITS (REMAINING / TOTAL)' : 'CREDITS',
      ...(dedicated ? ['REMAINING (%)'] : []),
    ],
    note: notes.join('\n'),
    noteAfterRows: dedicated,
    rows: sortTokenPlanSeats(details.items, (seat) => seat.specType).map((seat) => [
      safe(seat.instanceCode),
      dedicated
        ? formatTokenPlanSeatName(seat.specType)
        : (TYPES.get(seat.specType ?? '') ?? 'unknown'),
      dedicated
        ? (STATUS.get(seat.status ?? '') ?? 'unknown').toLowerCase()
        : (STATUS.get(seat.status ?? '') ?? 'unknown'),
      dedicated
        ? seat.assignment
        : seat.assignment === 'assigned'
          ? 'Assigned'
          : seat.assignment === 'unassigned'
            ? 'Unassigned'
            : 'unknown',
      `${amount(seat.surplusValue)} / ${amount(seat.totalValue)}`,
      ...(dedicated ? [remainingPercent(seat.totalValue, seat.surplusValue)] : []),
    ]),
  };
}

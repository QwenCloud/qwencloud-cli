import { site } from '../../site.js';
import { formatAmount } from '../../output/humanize.js';

export const NA = '—';

export const CURRENCY_CODE = site.features.currency;

export interface ViewContext {
  currency: string;
  locale?: string;
  /** Terminal columns; builders may degrade on narrow widths. */
  columns?: number;
}

export const NARROW_TERMINAL_THRESHOLD = 60;

function currencySymbolFor(code: string): string {
  switch (code) {
    case 'USD':
      return '$';
    case 'CNY':
    case 'JPY':
      return '¥';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    default:
      return '';
  }
}

/** Format an amount string for display. */
export function formatMoney(amount: string | null | undefined, ctx: ViewContext): string {
  if (amount == null) return NA;
  const trimmed = amount.trim();
  if (trimmed.length === 0) return NA;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return NA;
  const sym = currencySymbolFor(ctx.currency);
  const formatted = formatAmount(n);
  return sym.length > 0 ? `${sym}${formatted}` : `${formatted} ${ctx.currency}`;
}

/** Format an integer count. */
export function formatCount(value: number | null | undefined): string {
  if (value == null) return NA;
  if (!Number.isFinite(value)) return NA;
  return value.toLocaleString('en-US');
}

export function defaultViewContext(): ViewContext {
  return {
    currency: CURRENCY_CODE,
    locale: 'en-US',
    columns: typeof process.stdout?.columns === 'number' ? process.stdout.columns : 100,
  };
}

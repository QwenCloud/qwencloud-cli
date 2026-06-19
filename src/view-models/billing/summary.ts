import type {
  ChargeType,
  SettleBillCycle,
  SettleBillSummary,
  SettleBillTotals,
} from '../../types/billing-extra.js';
import { sumAmountStrings } from '../../services/billing-service.js';
import { CURRENCY_CODE, formatMoney, type ViewContext } from './shared.js';

export interface BillingSummaryFieldViewModel {
  label: string;
  value: string;
  raw: string;
}

export interface BillingSummaryCycleViewModel {
  billingCycle: string;
  pretaxAmount: string;
  tax: string;
  aftertaxAmount: string;
  display: BillingSummaryFieldViewModel[];
}

export interface BillingSummaryTotalsViewModel {
  pretaxAmount: string;
  tax: string;
  aftertaxAmount: string;
}

export interface BillingSummaryViewModel {
  cycle: string;
  chargeType: ChargeType | undefined;
  currency: string;
  cycles: BillingSummaryCycleViewModel[];
  totals: BillingSummaryTotalsViewModel;
  fields: BillingSummaryFieldViewModel[];
}

function sumField(
  cycles: SettleBillCycle[],
  pick: (c: SettleBillCycle) => string,
  fallback: string,
): string {
  if (cycles.length === 0) return fallback;
  const values = cycles.map(pick).filter((v) => v != null && v !== '');
  if (values.length === 0) return fallback;
  return sumAmountStrings(values);
}

function deriveTotals(data: SettleBillSummary): SettleBillTotals {
  if (data.totals) return data.totals;
  return {
    pretaxAmount: sumField(data.cycles, (c) => c.pretaxAmount, '0'),
    tax: sumField(data.cycles, (c) => c.tax, '0'),
    aftertaxAmount: sumField(data.cycles, (c) => c.aftertaxAmount, '0'),
  };
}

export function buildBillingSummaryViewModel(
  data: SettleBillSummary,
  ctx: ViewContext,
): BillingSummaryViewModel {
  const cycleLabel =
    data.period.from === data.period.to
      ? data.period.from
      : `${data.period.from} → ${data.period.to}`;
  const totals = deriveTotals(data);

  const fields: BillingSummaryFieldViewModel[] = [
    {
      label: 'Spend before tax',
      value: formatMoney(totals.pretaxAmount, ctx),
      raw: totals.pretaxAmount,
    },
    { label: 'Tax', value: formatMoney(totals.tax, ctx), raw: totals.tax },
    {
      label: 'Total',
      value: formatMoney(totals.aftertaxAmount, ctx),
      raw: totals.aftertaxAmount,
    },
  ];

  const cycles: BillingSummaryCycleViewModel[] = data.cycles.map((c) => ({
    billingCycle: c.billingCycle,
    pretaxAmount: c.pretaxAmount,
    tax: c.tax,
    aftertaxAmount: c.aftertaxAmount,
    display: [
      { label: 'Spend before tax', value: formatMoney(c.pretaxAmount, ctx), raw: c.pretaxAmount },
      { label: 'Tax', value: formatMoney(c.tax, ctx), raw: c.tax },
      {
        label: 'Total',
        value: formatMoney(c.aftertaxAmount, ctx),
        raw: c.aftertaxAmount,
      },
    ],
  }));

  return {
    cycle: cycleLabel,
    chargeType: data.chargeType,
    currency: ctx.currency || CURRENCY_CODE,
    cycles,
    totals: {
      pretaxAmount: totals.pretaxAmount,
      tax: totals.tax,
      aftertaxAmount: totals.aftertaxAmount,
    },
    fields,
  };
}

/** Pay-as-you-go orchestration and billing-rule utilities. */

import type { ApiClient } from '../api/api-client.js';
import type { CachedFetcher } from '../types/cache.js';
import type {
  ConsumeSummaryLineItem,
  DescribeUsageLimitResponse,
  MaasDescribeCostAnalysisResponse,
  ListSettleBillTotalSummaryResponse,
} from '../types/api-models.js';
import type {
  PayAsYouGo,
  UsageBreakdownResponse,
  UsageBreakdownRow,
  UsageBreakdownTotal,
} from '../types/usage.js';
import type {
  UsageLimit,
  ConsumeBreakdown,
  ConsumeBreakdownByPeriods,
  ConsumeBreakdownDto,
  ConsumeBreakdownOptions,
  ConsumeBreakdownPeriodSlice,
  ConsumeBreakdownRow,
  SettleBillSummary,
  SettleBillSummaryDto,
  SettleBillSummaryOptions,
  SettleBillTotals,
} from '../types/billing-extra.js';
import {
  transformUsageLimit,
  transformConsumeBreakdown,
  transformSettleBillSummary,
} from '../api/adapters/billing-adapter.js';
import {
  aggregatePaygByModel,
  aggregatePaygByDate,
  aggregateMonthly,
  aggregateQuarterly,
  fillDailyGaps,
  type PaygItem,
  type PaygDailyRow,
  type AggregatedRow,
} from '../api/payg-aggregator.js';
import { site } from '../site.js';
import { normalizeToFullDate } from '../utils/date.js';

const API_PRODUCT_BSS = 'BssOpenAPI-V3';
const API_ACTION_CONSUME_SUMMARY = 'MaasListConsumeSummary';
const BREAKDOWN_CACHE_TTL_MS = 10 * 60 * 1000;

function toCompactCycle(cycle: string): string {
  return cycle.replace(/-/g, '');
}

function toCompactDate(date: string): string {
  return date.replace(/-/g, '');
}

const DIM_FIELD_MAP: Record<string, string> = {
  model: 'BASE_MODEL',
  'api-key': 'API_KEY_ID',
};

function toNumber(value: string | number | undefined | null): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : 0;
}

export const SKIP_LINE_ITEM_CATEGORIES: ReadonlySet<string> = new Set([
  'Rounding Adjustment',
  'Refund',
  'Credit Adjustment',
]);

/** Infer billing unit from step unit and billing item code. */
export function inferBillingUnit(stepUnit: string, billingItemCode?: string): string {
  if (billingItemCode) {
    const codeLower = billingItemCode.toLowerCase();
    if (codeLower.includes('image')) return 'images';
    if (codeLower.includes('video') || codeLower.includes('duration')) return 'seconds';
    if (codeLower.includes('char')) return 'characters';
    if (codeLower.includes('voice')) return 'voices';
    if (codeLower.includes('token')) return 'tokens';
  }

  if (stepUnit) {
    const unitLower = stepUnit.toLowerCase();
    if (unitLower.includes('token')) return 'tokens';
    if (unitLower.includes('image') || unitLower.includes('page')) return 'images';
    if (unitLower.includes('second') || unitLower.includes('sec')) return 'seconds';
    if (unitLower.includes('char') || unitLower.includes('word')) return 'characters';
    if (unitLower.includes('voice')) return 'voices';
  }

  const perMatch = stepUnit.match(/^Per\s+\S+\s+(.+)$/i);
  if (perMatch) return perMatch[1]!.toLowerCase();

  return 'tokens';
}

/** Convert BillQuantity to raw usage units based on step size. */
export function computeUsageValue(billQuantity: number, stepUnit: string): number {
  if (billQuantity === 0) return 0;
  const unitLower = stepUnit.toLowerCase();

  if (unitLower.includes('tenthousand') || stepUnit.includes('万字')) {
    return billQuantity * 10_000;
  }

  const numMatch = stepUnit.match(/(?:^|Per\s+)([\d,]+)\s*([KMkm])?/);
  if (numMatch) {
    const rawNum = numMatch[1]!.replace(/,/g, '');
    const num = parseInt(rawNum, 10);
    const suffix = (numMatch[2] ?? '').toUpperCase();

    let multiplier = num;
    if (suffix === 'K') multiplier = num * 1_000;
    else if (suffix === 'M') multiplier = num * 1_000_000;

    if (multiplier === 1) return billQuantity;
    return billQuantity * multiplier;
  }

  return billQuantity;
}

export interface ParsedBillingItem {
  lineItemCat: string;
  billingDate: string;
  billingMonth: string;
  modelId: string;
  usageValue: number;
  cost: number;
  billingUnit: string;
  isFree: boolean;
}

/** Parse a raw line item into normalized fields; returns null for skipped categories. */
export function parseBillingItem(
  item: ConsumeSummaryLineItem,
  costMode?: 'full' | 'minimal',
): ParsedBillingItem | null {
  const category = item.LineItemCategory ?? '';
  if (SKIP_LINE_ITEM_CATEGORIES.has(category)) return null;

  const mode = costMode ?? 'full';
  const billingDate = item.BillingDate ?? '';
  const billingMonth = item.BillingMonth ?? '';
  const modelId = item.ModelName ?? item.Model ?? item.JobId ?? item.MaasTypeName ?? 'Other';
  const billQuantity = toNumber(item.BillQuantity);
  const stepUnit = item.StepQuantityUnit ?? '';
  const billingItemCode = item.BillingItemCode ?? '';

  const usageValue = computeUsageValue(billQuantity, stepUnit);
  const billingUnit = inferBillingUnit(stepUnit, billingItemCode);

  const cost =
    mode === 'full'
      ? toNumber(item.RequireAmount ?? item.Amount ?? item.Cost ?? item.ListPrice)
      : toNumber(item.RequireAmount ?? item.ListPrice);

  const isFree = category.toLowerCase().includes('free');

  return {
    lineItemCat: category,
    billingDate,
    billingMonth,
    modelId,
    usageValue,
    cost,
    billingUnit,
    isFree,
  };
}

/** Split a date range into per-calendar-month sub-ranges. */
export function splitIntoMonths(fromDate: string, toDate: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  let current = fromDate;

  while (current <= toDate) {
    const [yearStr, monthStr] = current.split('-') as [string, string];
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const monthEnd = `${yearStr}-${monthStr}-${String(lastDayOfMonth).padStart(2, '0')}`;

    if (monthEnd >= toDate) {
      result.push([current, toDate]);
      break;
    } else {
      result.push([current, monthEnd]);
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      current = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
    }
  }

  return result;
}

const PRECISION = 12;
const FACTOR_BIGINT = 10n ** BigInt(PRECISION);

/** Sum decimal-string amounts using BigInt fixed-point arithmetic. */
export function sumAmountStrings(values: string[]): string {
  if (values.length === 0) return '0';

  let sum = 0n;
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed || trimmed === '0') continue;

    const check = parseFloat(trimmed);
    if (!Number.isFinite(check)) continue;

    const isNegative = trimmed.startsWith('-');
    const absStr = isNegative ? trimmed.substring(1) : trimmed;
    const dotIdx = absStr.indexOf('.');

    let intPart: string;
    let fracPart: string;

    if (dotIdx !== -1) {
      intPart = absStr.substring(0, dotIdx) || '0';
      fracPart = absStr.substring(dotIdx + 1);
    } else {
      intPart = absStr;
      fracPart = '';
    }

    fracPart = fracPart.padEnd(PRECISION, '0').substring(0, PRECISION);

    const bigintVal = BigInt(intPart) * FACTOR_BIGINT + BigInt(fracPart);
    sum += isNegative ? -bigintVal : bigintVal;
  }

  if (sum === 0n) return '0';

  const isNeg = sum < 0n;
  const absSum = isNeg ? (-sum).toString() : sum.toString();

  const padded = absSum.padStart(PRECISION + 1, '0');
  const splitIdx = padded.length - PRECISION;
  const intResult = padded.substring(0, splitIdx).replace(/^0+/, '') || '0';
  const fracResult = padded.substring(splitIdx).replace(/0+$/, '');

  let result = intResult;
  if (fracResult) result += '.' + fracResult;
  if (isNeg && result !== '0') result = '-' + result;

  return result;
}

export interface BillingAdapter {
  toNormalizedItem(item: ConsumeSummaryLineItem): ParsedBillingItem | null;
}

export interface PaygSummaryOptions {
  from: string;
  to: string;
}

export interface PaygBreakdownOptions {
  from: string;
  to: string;
  granularity: 'day' | 'month' | 'quarter';
  modelFilter?: string;
}

interface RawConsumeData {
  Data?: ConsumeSummaryLineItem[];
}

export class BillingService {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly billingAdapter: BillingAdapter,
    private readonly cache: CachedFetcher,
  ) {}

  async getUsageLimit(): Promise<UsageLimit> {
    const raw = await this.apiClient.callFlatApi<DescribeUsageLimitResponse>({
      product: API_PRODUCT_BSS,
      action: 'DescribeUsageLimit',
    });
    return transformUsageLimit(raw);
  }

  async getConsumeBreakdown(opts: ConsumeBreakdownOptions): Promise<ConsumeBreakdown> {
    const dimCode = DIM_FIELD_MAP[opts.groupBy] ?? 'BASE_MODEL';
    const chargeTypes = opts.chargeType && opts.chargeType !== 'all' ? [opts.chargeType] : [];
    const topNum = opts.top > 0 ? opts.top : 10;
    const granularity = opts.granularity ?? 'month';

    const pretaxFilter = {
      Dimensions: [{ Code: 'LINE_ITEM_CATEGORY', Values: ['TaxFee'], SelectType: 'NOT' }],
    };
    const taxFilter = {
      Dimensions: [{ Code: 'LINE_ITEM_CATEGORY', Values: ['TaxFee'], SelectType: 'IN' }],
    };

    const mergedMap = new Map<string, ConsumeBreakdownRow>();

    if (granularity === 'month') {
      const startDate = toCompactCycle(opts.from.substring(0, 7));
      const endDate = toCompactCycle(opts.to.substring(0, 7));
      const cacheKeyPretax = `breakdown:${opts.groupBy}:${startDate}:${endDate}:${opts.chargeType}:month:pretax`;
      const cacheKeyTax = `breakdown:${opts.groupBy}:${startDate}:${endDate}:${opts.chargeType}:month:tax`;

      const baseParams = {
        BizType: 'MAAS_CONSUME_ANALYSIS',
        ChargeTypes: chargeTypes,
        Granularity: 'MONTH',
        TimePeriod: { Start: startDate, End: endDate },
        TopNum: topNum,
        GroupBy: [{ Code: dimCode, Type: 'Dimensions' }],
      };

      const [rawPretax, rawTax] = await Promise.all([
        this.cache.getOrFetch(cacheKeyPretax, BREAKDOWN_CACHE_TTL_MS, async () =>
          this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
            product: API_PRODUCT_BSS,
            action: 'MaasDescribeCostAnalysis',
            params: { ...baseParams, Filter: pretaxFilter },
          }),
        ),
        this.cache.getOrFetch(cacheKeyTax, BREAKDOWN_CACHE_TTL_MS, async () =>
          this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
            product: API_PRODUCT_BSS,
            action: 'MaasDescribeCostAnalysis',
            params: { ...baseParams, Filter: taxFilter },
          }),
        ),
      ]);

      const pretaxDto: ConsumeBreakdownDto = transformConsumeBreakdown(rawPretax);
      const taxDto: ConsumeBreakdownDto = transformConsumeBreakdown(rawTax);

      for (const row of pretaxDto.rows) {
        mergedMap.set(row.groupKey, { ...row });
      }

      const totalTaxAmount = sumAmountStrings(taxDto.rows.map((r) => r.amount));
      if (parseFloat(totalTaxAmount) !== 0) {
        mergedMap.set('__tax__', {
          groupKey: '__tax__',
          groupLabel: 'Tax',
          amount: totalTaxAmount,
        });
      }
    } else {
      const fromDate = normalizeToFullDate(opts.from, 'start');
      const toDate = normalizeToFullDate(opts.to, 'end');
      const months = splitIntoMonths(fromDate, toDate);

      for (const [monthStart, monthEnd] of months) {
        const cacheKeyPretax = `breakdown:${opts.groupBy}:${monthStart}:${monthEnd}:${opts.chargeType}:pretax`;
        const cacheKeyTax = `breakdown:${opts.groupBy}:${monthStart}:${monthEnd}:${opts.chargeType}:tax`;

        const baseParams = {
          BizType: 'MAAS_CONSUME_ANALYSIS',
          ChargeTypes: chargeTypes,
          Granularity: 'DAY',
          TimePeriod: {
            Start: toCompactDate(monthStart),
            End: toCompactDate(monthEnd),
          },
          TopNum: topNum,
          GroupBy: [{ Code: dimCode, Type: 'Dimensions' }],
        };

        const [rawPretax, rawTax] = await Promise.all([
          this.cache.getOrFetch(cacheKeyPretax, BREAKDOWN_CACHE_TTL_MS, async () =>
            this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
              product: API_PRODUCT_BSS,
              action: 'MaasDescribeCostAnalysis',
              params: { ...baseParams, Filter: pretaxFilter },
            }),
          ),
          this.cache.getOrFetch(cacheKeyTax, BREAKDOWN_CACHE_TTL_MS, async () =>
            this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
              product: API_PRODUCT_BSS,
              action: 'MaasDescribeCostAnalysis',
              params: { ...baseParams, Filter: taxFilter },
            }),
          ),
        ]);

        const pretaxDto: ConsumeBreakdownDto = transformConsumeBreakdown(rawPretax);
        const taxDto: ConsumeBreakdownDto = transformConsumeBreakdown(rawTax);

        for (const row of pretaxDto.rows) {
          const existing = mergedMap.get(row.groupKey);
          if (existing) {
            existing.amount = sumAmountStrings([existing.amount, row.amount]);
          } else {
            mergedMap.set(row.groupKey, { ...row });
          }
        }

        const monthTax = sumAmountStrings(taxDto.rows.map((r) => r.amount));
        const existingTax = mergedMap.get('__tax__');
        if (existingTax) {
          existingTax.amount = sumAmountStrings([existingTax.amount, monthTax]);
        } else if (parseFloat(monthTax) !== 0) {
          mergedMap.set('__tax__', { groupKey: '__tax__', groupLabel: 'Tax', amount: monthTax });
        }
      }
    }

    const allRows = [...mergedMap.values()];
    const taxRow = allRows.find((r) => r.groupKey === '__tax__');
    const nonTaxRows = allRows.filter((r) => r.groupKey !== '__tax__');
    const totalRows = nonTaxRows.length;
    const sortedRows = nonTaxRows.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
    const truncated = opts.top > 0 ? sortedRows.slice(0, opts.top) : sortedRows;

    const finalRows = taxRow ? [...truncated, taxRow] : truncated;
    const totalAmount = sumAmountStrings(finalRows.map((r) => r.amount));

    return {
      groupBy: opts.groupBy,
      period: { from: opts.from, to: opts.to },
      chargeType: opts.chargeType,
      rows: finalRows,
      totalRows,
      totalAmount,
      currency: site.features.currency,
    };
  }

  async getConsumeBreakdownByPeriods(
    opts: ConsumeBreakdownOptions,
  ): Promise<ConsumeBreakdownByPeriods> {
    const dimCode = DIM_FIELD_MAP[opts.groupBy] ?? 'BASE_MODEL';
    const chargeTypes = opts.chargeType && opts.chargeType !== 'all' ? [opts.chargeType] : [];
    const topNum = opts.top > 0 ? opts.top : 10;
    const granularity = opts.granularity ?? 'month';

    const pretaxFilter = {
      Dimensions: [{ Code: 'LINE_ITEM_CATEGORY', Values: ['TaxFee'], SelectType: 'NOT' }],
    };
    const taxFilter = {
      Dimensions: [{ Code: 'LINE_ITEM_CATEGORY', Values: ['TaxFee'], SelectType: 'IN' }],
    };

    const slices: ConsumeBreakdownPeriodSlice[] = [];

    if (granularity === 'month') {
      const fromMonth = opts.from.substring(0, 7);
      const toMonth = opts.to.substring(0, 7);
      const months = this.enumerateMonths(fromMonth, toMonth);

      for (const month of months) {
        const compactMonth = toCompactCycle(month);
        const cacheKeyPretax = `breakdown-periods:${opts.groupBy}:${compactMonth}:${opts.chargeType}:month:pretax`;
        const cacheKeyTax = `breakdown-periods:${opts.groupBy}:${compactMonth}:${opts.chargeType}:month:tax`;

        const baseParams = {
          BizType: 'MAAS_CONSUME_ANALYSIS',
          ChargeTypes: chargeTypes,
          Granularity: 'MONTH',
          TimePeriod: { Start: compactMonth, End: compactMonth },
          TopNum: topNum,
          GroupBy: [{ Code: dimCode, Type: 'Dimensions' }],
        };

        const [rawPretax, rawTax] = await Promise.all([
          this.cache.getOrFetch(cacheKeyPretax, BREAKDOWN_CACHE_TTL_MS, async () =>
            this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
              product: API_PRODUCT_BSS,
              action: 'MaasDescribeCostAnalysis',
              params: { ...baseParams, Filter: pretaxFilter },
            }),
          ),
          this.cache.getOrFetch(cacheKeyTax, BREAKDOWN_CACHE_TTL_MS, async () =>
            this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
              product: API_PRODUCT_BSS,
              action: 'MaasDescribeCostAnalysis',
              params: { ...baseParams, Filter: taxFilter },
            }),
          ),
        ]);

        const slice = this.buildPeriodSlice(month, rawPretax, rawTax, topNum);
        slices.push(slice);
      }
    } else {
      const fromDate = normalizeToFullDate(opts.from, 'start');
      const toDate = normalizeToFullDate(opts.to, 'end');
      const months = splitIntoMonths(fromDate, toDate);

      for (const [monthStart, monthEnd] of months) {
        const cacheKeyPretax = `breakdown-periods:${opts.groupBy}:${monthStart}:${monthEnd}:${opts.chargeType}:day:pretax`;
        const cacheKeyTax = `breakdown-periods:${opts.groupBy}:${monthStart}:${monthEnd}:${opts.chargeType}:day:tax`;

        const baseParams = {
          BizType: 'MAAS_CONSUME_ANALYSIS',
          ChargeTypes: chargeTypes,
          Granularity: 'DAY',
          TimePeriod: {
            Start: toCompactDate(monthStart),
            End: toCompactDate(monthEnd),
          },
          TopNum: topNum,
          GroupBy: [{ Code: dimCode, Type: 'Dimensions' }],
        };

        const [rawPretax, rawTax] = await Promise.all([
          this.cache.getOrFetch(cacheKeyPretax, BREAKDOWN_CACHE_TTL_MS, async () =>
            this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
              product: API_PRODUCT_BSS,
              action: 'MaasDescribeCostAnalysis',
              params: { ...baseParams, Filter: pretaxFilter },
            }),
          ),
          this.cache.getOrFetch(cacheKeyTax, BREAKDOWN_CACHE_TTL_MS, async () =>
            this.apiClient.callFlatApi<MaasDescribeCostAnalysisResponse>({
              product: API_PRODUCT_BSS,
              action: 'MaasDescribeCostAnalysis',
              params: { ...baseParams, Filter: taxFilter },
            }),
          ),
        ]);

        // Attempt to extract ResultByTime for day-level slicing
        const resultByTime = rawPretax?.ResultByTime;
        const taxResultByTime = rawTax?.ResultByTime;

        if (resultByTime && resultByTime.length > 0) {
          for (const entry of resultByTime) {
            const period = entry.Period ?? monthStart;
            const taxEntry = taxResultByTime?.find((t) => t.Period === period);
            const pretaxRows = (entry.PeriodDetails ?? []).map((item) => ({
              groupKey: item.Key ?? '',
              groupLabel: item.Name ?? item.Key ?? '',
              amount: this.toAmountStr(item.Amount),
            }));
            const taxRows = (taxEntry?.PeriodDetails ?? []).map((item) => ({
              groupKey: item.Key ?? '',
              groupLabel: item.Name ?? item.Key ?? '',
              amount: this.toAmountStr(item.Amount),
            }));
            const slice = this.buildPeriodSliceFromRows(period, pretaxRows, taxRows, topNum);
            slices.push(slice);
          }
        } else {
          // Fallback: treat entire month chunk as a single period
          const periodLabel =
            monthStart === monthEnd ? monthStart : `${monthStart} \u2192 ${monthEnd}`;
          const slice = this.buildPeriodSlice(periodLabel, rawPretax, rawTax, topNum);
          slices.push(slice);
        }
      }
    }

    slices.sort((a, b) => a.period.localeCompare(b.period));

    return {
      groupBy: opts.groupBy,
      dateRange: { from: opts.from, to: opts.to },
      granularity,
      chargeType: opts.chargeType,
      slices,
      currency: site.features.currency,
    };
  }

  private enumerateMonths(fromYM: string, toYM: string): string[] {
    const result: string[] = [];
    let [year, month] = fromYM.split('-').map(Number) as [number, number];
    const [endYear, endMonth] = toYM.split('-').map(Number) as [number, number];
    while (year < endYear || (year === endYear && month <= endMonth)) {
      result.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    return result;
  }

  private buildPeriodSlice(
    period: string,
    rawPretax: MaasDescribeCostAnalysisResponse | null | undefined,
    rawTax: MaasDescribeCostAnalysisResponse | null | undefined,
    topNum: number,
  ): ConsumeBreakdownPeriodSlice {
    const pretaxDto: ConsumeBreakdownDto = transformConsumeBreakdown(rawPretax);
    const taxDto: ConsumeBreakdownDto = transformConsumeBreakdown(rawTax);
    return this.buildPeriodSliceFromRows(period, pretaxDto.rows, taxDto.rows, topNum);
  }

  private buildPeriodSliceFromRows(
    period: string,
    pretaxRows: ConsumeBreakdownRow[],
    taxRows: ConsumeBreakdownRow[],
    topNum: number,
  ): ConsumeBreakdownPeriodSlice {
    const sorted = pretaxRows.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
    const truncated = topNum > 0 ? sorted.slice(0, topNum) : sorted;

    const totalTaxAmount = sumAmountStrings(taxRows.map((r) => r.amount));
    const finalRows: ConsumeBreakdownRow[] = [...truncated];
    if (parseFloat(totalTaxAmount) !== 0) {
      finalRows.push({ groupKey: '__tax__', groupLabel: 'Tax', amount: totalTaxAmount });
    }

    const totalAmount = sumAmountStrings(finalRows.map((r) => r.amount));
    return { period, rows: finalRows, totalAmount };
  }

  private toAmountStr(value: string | number | undefined | null): string {
    if (value == null) return '0';
    const s = String(value).trim();
    return s.length === 0 ? '0' : s;
  }

  async getSettleBillSummary(opts: SettleBillSummaryOptions): Promise<SettleBillSummary> {
    const raw = await this.apiClient.callFlatApi<ListSettleBillTotalSummaryResponse>({
      product: API_PRODUCT_BSS,
      action: 'ListSettleBillTotalSummary',
      params: {
        StartBillingCycle: toCompactCycle(opts.from),
        EndBillingCycle: toCompactCycle(opts.to),
        ChargeType: opts.chargeType && opts.chargeType !== 'all' ? opts.chargeType : '',
      },
    });
    const dto: SettleBillSummaryDto = transformSettleBillSummary(raw);
    const totals: SettleBillTotals = {
      pretaxAmount: sumAmountStrings(dto.cycles.map((c) => c.pretaxAmount)),
      tax: sumAmountStrings(dto.cycles.map((c) => c.tax)),
      aftertaxAmount: sumAmountStrings(dto.cycles.map((c) => c.aftertaxAmount)),
    };
    return {
      cycles: dto.cycles,
      totals,
      currency: dto.currency,
      period: { from: opts.from, to: opts.to },
      chargeType: opts.chargeType,
    };
  }

  async getPaygSummary(options: PaygSummaryOptions): Promise<PayAsYouGo> {
    const fromDate = normalizeToFullDate(options.from, 'start');
    const toDate = normalizeToFullDate(options.to, 'end');
    const items = await this.fetchPaygItems(fromDate, toDate);
    return aggregatePaygByModel(items);
  }

  async getPaygBreakdown(options: PaygBreakdownOptions): Promise<UsageBreakdownResponse> {
    const fromDate = normalizeToFullDate(options.from, 'start');
    const toDate = normalizeToFullDate(options.to, 'end');
    const items = await this.fetchPaygItems(fromDate, toDate, options.modelFilter);
    const rawDailyRows = aggregatePaygByDate(items);
    const dailyRows = fillDailyGaps(rawDailyRows, fromDate, toDate);

    let rows: AggregatedRow[] | PaygDailyRow[];
    if (options.granularity === 'quarter') {
      rows = aggregateQuarterly(aggregateMonthly(dailyRows));
    } else if (options.granularity === 'month') {
      rows = aggregateMonthly(dailyRows);
    } else {
      rows = dailyRows;
    }

    return this.shapeBreakdown(rows, { ...options, from: fromDate, to: toDate });
  }

  private async fetchPaygItems(
    fromDate: string,
    toDate: string,
    modelFilter?: string,
  ): Promise<PaygItem[]> {
    const collected: PaygItem[] = [];

    for (const [monthStart, monthEnd] of splitIntoMonths(fromDate, toDate)) {
      const params: Record<string, unknown> = {
        Console: true,
        Granularity: 'DAILY',
        ChargeTypes: ['postpaid'],
        StartBillingDate: monthStart,
        EndBillingDate: monthEnd,
        MaxResults: 100,
        CurrentPage: 1,
        SortName: 'BillingDate',
        SortOrder: 'DESC',
      };
      if (modelFilter) params['ModelNames'] = [modelFilter];

      const response = await this.apiClient.callFlatApi<RawConsumeData>({
        product: API_PRODUCT_BSS,
        action: API_ACTION_CONSUME_SUMMARY,
        params,
      });

      for (const item of response.Data ?? []) {
        const parsed = this.billingAdapter.toNormalizedItem(item);
        if (!parsed || parsed.isFree) continue;
        collected.push({
          billingDate: parsed.billingDate,
          billingMonth: parsed.billingMonth,
          modelId: parsed.modelId,
          usageValue: parsed.usageValue,
          cost: parsed.cost,
          billingUnit: parsed.billingUnit,
        });
      }
    }

    return collected;
  }

  private shapeBreakdown(
    rows: Array<AggregatedRow | PaygDailyRow>,
    options: PaygBreakdownOptions,
  ): UsageBreakdownResponse {
    const costStrings = rows.map((r) => String(r.cost ?? 0));
    const totalCost = parseFloat(sumAmountStrings(costStrings));
    const sumKey = (key: string): number =>
      rows.reduce((s, r) => s + ((r as Record<string, number>)[key] ?? 0), 0);
    const totalTokensIn = sumKey('tokens_in');
    const totalTokensOut = sumKey('tokens_out');
    const totalImages = sumKey('images');
    const totalSeconds = sumKey('seconds');
    const totalCharacters = sumKey('characters');

    const breakdownRows: UsageBreakdownRow[] = rows.map((r) => {
      const out: UsageBreakdownRow = {
        period: r.period,
        cost: r.cost,
        currency: r.currency,
      };
      const flat = r as Record<string, unknown>;
      if (flat.tokens_in != null) out.tokens_in = flat.tokens_in as number;
      if (flat.tokens_out != null) out.tokens_out = flat.tokens_out as number;
      const usage: Record<string, number> = {};
      if (flat.images != null) usage.images = flat.images as number;
      if (flat.seconds != null) usage.seconds = flat.seconds as number;
      if (flat.characters != null) usage.characters = flat.characters as number;
      if (Object.keys(usage).length > 0) out.usage = usage;
      return out;
    });

    const total: UsageBreakdownTotal = {
      cost: Math.round(totalCost * 10000) / 10000,
      currency: site.features.currency,
    };
    if (totalTokensIn > 0) total.tokens_in = Math.round(totalTokensIn);
    if (totalTokensOut > 0) total.tokens_out = Math.round(totalTokensOut);
    const totalUsage: Record<string, number> = {};
    if (totalImages > 0) totalUsage.images = Math.round(totalImages);
    if (totalSeconds > 0) totalUsage.seconds = Math.round(totalSeconds);
    if (totalCharacters > 0) totalUsage.characters = Math.round(totalCharacters);
    if (Object.keys(totalUsage).length > 0) total.usage = totalUsage;

    void this.cache;
    return {
      model_id: options.modelFilter ?? 'all',
      period: { from: options.from, to: options.to },
      granularity: options.granularity,
      rows: breakdownRows,
      total,
    };
  }
}

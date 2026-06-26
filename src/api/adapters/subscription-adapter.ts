/**
 * Subscription adapter — pure transformations from raw flat-parameter
 * responses into Service-layer DTOs. Each transform is a single-arg pure
 * function; missing fields fall back to null/empty defaults so the Service
 * layer can compose partial results without per-field guards.
 */
import type {
  QuerySubscriptionGrayResponse,
  GetSeatSubscriptionSummaryResponse,
  GetSubscriptionDetailResponse,
  CheckTokenPlanAutoRenewalResponse,
  CheckInstancesRenewableResponse,
  QueryOrderListResponse,
  QueryOrderDetailResponse,
} from '../../types/api-models.js';
import type {
  SubscriptionGrayDto,
  SeatSubscriptionSummaryDto,
  SubscriptionDetailDto,
  SubscriptionDetailInstance,
  AutoRenewalDto,
  InstancesRenewableDto,
  OrderListDto,
  SubscriptionOrder,
  OrderDetail,
  OrderDetailLine,
} from '../../types/subscription.js';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function toAmountString(value: unknown, fallback = '0'): string {
  if (value == null) return fallback;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? fallback : trimmed;
  }
  return fallback;
}

function toQuantity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ────────────────────────────────────────────────────────────────────
// QuerySubscriptionGray
// ────────────────────────────────────────────────────────────────────

export function transformSubscriptionGray(
  raw: QuerySubscriptionGrayResponse | null | undefined,
): SubscriptionGrayDto {
  const safe = raw ?? {};
  return { isGray: typeof safe.IsGray === 'boolean' ? safe.IsGray : null };
}

// ────────────────────────────────────────────────────────────────────
// GetSeatSubscriptionSummary
// ────────────────────────────────────────────────────────────────────

/** Coerce a raw period boundary into a stable ISO 8601 string, or null if missing. */
function toPeriodIso(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

export function transformSeatSubscriptionSummary(
  raw: GetSeatSubscriptionSummaryResponse | null | undefined,
): SeatSubscriptionSummaryDto {
  const outer = raw ?? {};
  // Unwrap BSS response envelope.
  const inner = (outer.Data ?? {}) as Partial<typeof outer>;
  const pick = <K extends keyof typeof outer>(key: K): (typeof outer)[K] | undefined =>
    inner[key] ?? outer[key];

  const start = toPeriodIso(pick('PeriodStart') ?? pick('StartTime'));
  const end = toPeriodIso(pick('PeriodEnd') ?? pick('EndTime'));
  const period = start && end ? { start, end } : null;

  const planName = pick('PlanName');
  const planCode = pick('PlanCode');
  const seats = pick('Seats');

  return {
    plan: typeof planName === 'string' && planName.length > 0 ? planName : null,
    planCode: typeof planCode === 'string' && planCode.length > 0 ? planCode : null,
    period,
    seats: typeof seats === 'number' ? seats : null,
  };
}

// ────────────────────────────────────────────────────────────────────
// GetSubscriptionDetail
// ────────────────────────────────────────────────────────────────────

export function transformSubscriptionDetail(
  raw: GetSubscriptionDetailResponse | null | undefined,
): SubscriptionDetailDto {
  const safe = raw ?? {};
  const list = Array.isArray(safe.Data) ? safe.Data : [];
  const instances: SubscriptionDetailInstance[] = list.map((i) => {
    const period =
      typeof i.StartTime === 'string' &&
      i.StartTime.length > 0 &&
      typeof i.EndTime === 'string' &&
      i.EndTime.length > 0
        ? { start: i.StartTime, end: i.EndTime }
        : null;
    return {
      instanceId: i.InstanceId ?? '',
      status: i.Status ?? '',
      plan: typeof i.PlanName === 'string' && i.PlanName.length > 0 ? i.PlanName : null,
      period,
    };
  });
  const activeInstance = instances.find((i) => i.status === 'VALID') ?? null;
  return { instances, activeInstance };
}

// ────────────────────────────────────────────────────────────────────
// CheckTokenPlanAutoRenewal
// ────────────────────────────────────────────────────────────────────

export function transformAutoRenewal(
  raw: CheckTokenPlanAutoRenewalResponse | null | undefined,
): AutoRenewalDto {
  const safe = raw ?? {};
  if (safe.Data != null) {
    const ar = safe.Data.AutoRenewal;
    if (typeof ar === 'boolean') return { autoRenew: ar };
    if (typeof ar === 'number') return { autoRenew: ar !== 0 };
  }
  if (typeof safe.EnableRenew === 'boolean') return { autoRenew: safe.EnableRenew };
  if (typeof safe.AutoRenewal === 'boolean') return { autoRenew: safe.AutoRenewal };
  if (typeof safe.Enable === 'boolean') return { autoRenew: safe.Enable };
  return { autoRenew: null };
}

// ────────────────────────────────────────────────────────────────────
// CheckInstancesRenewable
// ────────────────────────────────────────────────────────────────────

export function transformInstancesRenewable(
  raw: CheckInstancesRenewableResponse | null | undefined,
): InstancesRenewableDto {
  const safe = raw ?? {};
  if (Array.isArray(safe.Data) && safe.Data.length > 0) {
    const first = safe.Data[0];
    if (first) {
      const canRenew = first.CanRenew ?? first.canRenew;
      if (typeof canRenew === 'boolean') return { renewable: canRenew };
    }
  }
  return { renewable: typeof safe.Renewable === 'boolean' ? safe.Renewable : null };
}

// ────────────────────────────────────────────────────────────────────
// QueryOrderList
// ────────────────────────────────────────────────────────────────────

export function transformOrderList(raw: QueryOrderListResponse | null | undefined): OrderListDto {
  const safe = raw ?? {};
  const list = Array.isArray(safe.Data) ? safe.Data : [];
  const orders: SubscriptionOrder[] = list.map((o) => ({
    orderId: o.OrderId ?? '',
    orderType: o.OrderType ?? '',
    // Compatible with multiple API response versions.
    orderTime: o.GmtCreate ?? o.GmtPay ?? o.OrderTime ?? '',
    amount: toAmountString(
      o.PayAmount ??
        o.TradeAmount ??
        o.CashAmount ??
        o.OriginalAmount ??
        o.PostTaxAmount ??
        o.PretaxAmount ??
        o.Amount,
      '0',
    ),
    currency: o.Currency ?? o.SettCurrency,
    status: o.OrderStatus ?? o.Status ?? '',
  }));
  return {
    orders,
    pagination: {
      totalCount: typeof safe.TotalCount === 'number' ? safe.TotalCount : orders.length,
      pageSize: typeof safe.PageSize === 'number' ? safe.PageSize : 20,
      currentPage: typeof safe.CurrentPage === 'number' ? safe.CurrentPage : 1,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// QueryOrderDetail
// ────────────────────────────────────────────────────────────────────

export function transformOrderDetail(
  raw: QueryOrderDetailResponse | null | undefined,
): OrderDetail {
  const safe = raw ?? {};
  const items: OrderDetailLine[] = Array.isArray(safe.Items)
    ? safe.Items.map((it) => ({
        name: it.Name ?? '',
        quantity: toQuantity(it.Quantity),
        amount: toAmountString(it.Amount, '0'),
      }))
    : [];
  return {
    orderId: safe.OrderId ?? '',
    orderType: safe.OrderType ?? '',
    orderTime: safe.OrderTime ?? '',
    amount: toAmountString(safe.Amount, '0'),
    status: safe.Status ?? '',
    items,
    invoiceUrl:
      typeof safe.InvoiceUrl === 'string' && safe.InvoiceUrl.length > 0 ? safe.InvoiceUrl : null,
  };
}

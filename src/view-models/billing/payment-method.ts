import type { PaymentMethodsResult } from '../../types/payment-method.js';

export interface PaymentMethodViewModel {
  type: string;
  number: string;
  status: string;
  statusColor: 'green' | 'red' | 'yellow';
}

export interface PaymentMethodListViewModel {
  rows: PaymentMethodViewModel[];
}

function resolveStatusColor(status: string): 'green' | 'red' | 'yellow' {
  const upper = status.toUpperCase();
  if (upper === 'VALID') return 'green';
  if (upper === 'INVALID') return 'red';
  return 'yellow';
}

export function buildPaymentMethodListViewModel(
  data: PaymentMethodsResult,
): PaymentMethodListViewModel {
  const rows: PaymentMethodViewModel[] = data.items
    .filter((item) => item.status.toUpperCase() === 'VALID')
    .map((item) => ({
      type: item.cardBrand ? `${item.paymentTypeName} (${item.cardBrand})` : item.paymentTypeName,
      number: item.paymentMethodName,
      status: item.status,
      statusColor: resolveStatusColor(item.status),
    }));
  return { rows };
}

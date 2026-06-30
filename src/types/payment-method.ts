export interface PaymentMethodDto {
  PaymentMethodId: string;
  PaymentTypeName: string;
  CardBrand?: string;
  PaymentMethodName: string;
  Status: string;
  IsDefault?: boolean;
  Currency?: string;
  GmtCreate?: string;
  PaymentType?: string;
  UserId?: number;
  PId?: number;
  Bid?: string;
}

export interface GetOuterPaymentMethodResponse {
  TotalCount: number;
  CurrentPage: number;
  PageSize: number;
  Data?: PaymentMethodDto[];
}

export interface PaymentMethod {
  paymentTypeName: string;
  cardBrand?: string;
  paymentMethodName: string;
  status: string;
}

export interface PaymentMethodsResult {
  items: PaymentMethod[];
}

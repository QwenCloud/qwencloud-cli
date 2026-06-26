// ============================================================
// API raw response type definitions
// These types directly map the JSON structure returned by the backend API.
// ============================================================

// Price item (element of Prices array / BuiltInToolMultiPrices array)
export interface ApiPriceItem {
  Type: string; // e.g. "text_input_token", "vision_input_token_cache"
  PriceUnit: string; // e.g. "Per 1M tokens"
  Price: string; // Note: string type, e.g. "0.07"
  PriceName: string; // e.g. "Input: Text"
  Discount?: string; // Discount multiplier (e.g. "0.8" = 20% off, pay 80%)
}

// QPM rate-limit info
export interface ApiQpmLimit {
  UsageLimitField: string; // e.g. "total_tokens"
  CountLimit: number; // Request count limit
  Type: string; // e.g. "model-default"
  UsageLimit: number; // Token count limit
  CountLimitPeriod: number; // Request count limit period (seconds)
  UsageLimitPeriod: number; // Token count limit period (seconds)
}

export interface ApiQpmInfo {
  ModelDefault: ApiQpmLimit;
  ModelDefaultActual?: ApiQpmLimit;
}

// Inference metadata (multimodal info)
export interface ApiInferenceMetadata {
  RequestModality: string[]; // e.g. ["Text", "Image", "Video", "Audio"]
  ResponseModality: string[]; // e.g. ["Text", "Audio"]
}

// Model specification info
export interface ApiModelInfo {
  ContextWindow: number;
  MaxInputTokens: number;
  MaxOutputTokens: number;
}

// Model capability support
export interface ApiModelSupports {
  Sft: boolean;
  App: boolean;
  Dpo: boolean;
  WorkflowText: boolean;
  CheckpointImport: boolean;
  WorkflowMultimodal: boolean;
  Cpt: boolean;
  Inference: boolean;
  Workflow: boolean;
  Deploy: boolean;
  SelfServiceLimitIncrease: boolean;
  Experience: boolean; // -> can_try
  SellingByQpm: boolean;
  AppV1: boolean;
  ExperienceUpcoming: boolean;
  AppV2: boolean;
  DisplayQpmLimit: boolean;
  Tokenizer: boolean;
  Eval: boolean;
  FineTune: boolean;
}

// Model permissions
export interface ApiModelPermissions {
  Inference: boolean;
}

// Sample code (currently an empty object)
export interface ApiSampleCodeV2 {
  Openai?: Record<string, unknown>;
}

// Built-in tool price item
export interface ApiBuiltInToolPrice {
  Type: string; // Tool type, e.g. "web_search"
  Name: string; // Tool name
  Prices: Array<{
    PriceUnit: string; // e.g. "Per 1K calls"
    Price: string; // Price string
    Currency?: string; // e.g. "USD"
  }>;
  DocUrl?: string; // Documentation URL
  SupportedApi?: string; // Supported API, e.g. "Responses API"
}

// Multi-price range (element of MultiPrices array)
export interface ApiMultiPriceRange {
  RangeName: string;
  Prices: ApiPriceItem[];
}

// Concrete model version (element of Items array) — this is the data actually consumed by the CLI
export interface ApiModelItem {
  // Basic info
  Model: string; // Model ID, e.g. "qwen-omni-turbo" (globally unique)
  Name: string; // Display name, e.g. "Qwen-Omni-Turbo"
  Description: string; // Full description
  ShortDescription: string; // Short description
  Category: string; // Category, e.g. "Older"
  Language: string; // e.g. "en-US"

  // Identifiers
  DataId: string;
  GroupModel: string; // Owning series name
  EquivalentSnapshot?: string; // Equivalent snapshot version
  VersionTag: string; // e.g. "MAJOR"

  // Status flags
  ActivationStatus: number; // Activation status (meaning to be confirmed)
  Scope: string; // e.g. "PUBLIC"
  OpenSource: boolean;
  FreeTierOnly: boolean; // Free-only flag
  NeedApply: boolean; // Whether application is required
  AliyunRecommend: boolean;

  // Timestamps
  UpdateAt: string; // ISO 8601 format
  LatestOnlineAt: string; // ISO 8601 format

  // Multimodal
  InferenceMetadata: ApiInferenceMetadata;
  Capabilities: string[]; // e.g. ["Multimodal-Omni"]

  // Pricing
  Prices?: ApiPriceItem[];
  MultiPrices?: ApiMultiPriceRange[]; // Tiered pricing by input length
  BuiltInToolMultiPrices?: ApiBuiltInToolPrice[]; // Built-in tool pricing

  // Specifications
  ModelInfo: ApiModelInfo;
  ContextWindow: number; // Redundant field, same as ModelInfo
  MaxInputTokens: number; // Redundant field, same as ModelInfo
  MaxOutputTokens: number; // Redundant field, same as ModelInfo

  // Rate limiting
  QpmInfo: ApiQpmInfo;

  // Capability support
  Supports: ApiModelSupports;
  Permissions: ApiModelPermissions;
  Features: string[]; // e.g. ["cache", "model-experience"]
  Tags: string[];
  InferenceProvider: string; // e.g. "bailian"
  Provider: string; // e.g. "qwen"

  // Misc
  SampleCodeV2: ApiSampleCodeV2;
  ApplyType: number;
}

// Model series / group (outer wrapper)
export interface ApiModelGroup {
  Group: boolean;
  Name: string; // Series name, e.g. "Qwen-Omni-Turbo"
  DataId: string;
  Providers: string[]; // e.g. ["qwen"]
  LatestOnlineAt: string;
  InstanceLatestOnlineAt: string;
  ActivationStatus: number;
  UpdateAt: string;
  Supports: ApiModelSupports;
  Language: string;
  Permissions: ApiModelPermissions;
  Features: string[];
  Items: ApiModelItem[]; // Actual list of model versions
  ApplyType: number;
}

// API list response structure
export interface ApiModelsListResponse {
  requestId: string;
  code: string;
  message: string | null;
  action: string | null;
  apiName: string | null;
  data: {
    Data: ApiModelGroup[];
  };
}

// ============================================================
// Free-tier quota query API types
// ============================================================

export interface FqCapacity {
  BaseValue: number;
  ShowUnit: string;
  ShowValue: string;
}

export interface FqInstanceItem {
  InstanceName: string;
  Status: string;
  Uid: number;
  InitCapacity: FqCapacity;
  CurrCapacity: FqCapacity;
  Template: { Code: string; Name: string };
  StartTime: string;
  EndTime: string;
  CurrentCycleStartTime: string;
  CurrentCycleEndTime: string;
}

export interface FqInstanceResponse {
  TotalCount: number;
  PageSize: number;
  RequestId: string;
  CurrentPage: number;
  Data: FqInstanceItem[];
}

// ============================================================
// DescribeFrInstances API types (Token Plan subscription query)
// ============================================================

export interface FrInstanceItem {
  InstanceId: string;
  CommodityCode: string;
  CommodityName?: string;
  TemplateName?: string;
  Status: { Code: string; Name?: string } | string;
  StatusCode?: string;
  StatusName?: string;
  InitCapacityBaseValue: string;
  CurrCapacityBaseValue: string;
  periodCapacityBaseValue?: string;
  CapacityTypeCode?: string;
  EndTime?: number;
  EnableRenew?: boolean;
}

export interface FrInstanceResponse {
  TotalCount?: number;
  PageSize?: number;
  RequestId?: string;
  CurrentPage?: number;
  Data: FrInstanceItem[];
}

// ============================================================
// MaasListConsumeSummary API types (Pay-as-you-go billing)
// ============================================================

export interface ConsumeSummaryLineItem {
  LineItemCategory?: string; // e.g. "LLM Token Consumption", "Free Tier Image Generation"
  BillingItemCode?: string; // e.g. "image_number", "token_number", "char_number", "video_duration"
  BillingDate?: string; // YYYY-MM-DD
  BillingMonth?: string; // YYYY-MM
  ModelName?: string; // model ID like "qwen-plus"
  Model?: string; // alternative model ID field
  JobId?: string; // job identifier (e.g. fine-tuning job)
  MaasType?: string; // e.g. "training", "inference"
  MaasTypeName?: string; // e.g. "Training", "Inference"
  BillQuantity?: string | number; // quantity in step units
  StepQuantityUnit?: string; // e.g. "1K tokens", "seconds", "Page"
  RequireAmount?: string | number; // actual charged amount
  Amount?: string | number; // alternative amount field
  Cost?: string | number; // alternative cost field
  ListPrice?: string | number; // list price (fallback)
  [key: string]: unknown;
}

export interface ConsumeSummaryResponse {
  Data: ConsumeSummaryLineItem[];
  TotalCount?: number;
  RequestId?: string;
}

// ============================================================
// Coding Plan API types (queryCodingPlanInstanceInfoV2)
// ============================================================

export interface CodingPlanQuotaInfo {
  per5HourTotalQuota?: number;
  per5HourUsedQuota?: number;
  per5HourQuotaNextRefreshTime?: number; // ms timestamp
  perWeekTotalQuota?: number;
  perWeekUsedQuota?: number;
  perWeekQuotaNextRefreshTime?: number; // ms timestamp
  perBillMonthTotalQuota?: number;
  perBillMonthUsedQuota?: number;
  perBillMonthQuotaNextRefreshTime?: number; // ms timestamp
}

export interface CodingPlanInstance {
  instanceType?: string; // e.g. "pro", "starter"
  status?: string; // "VALID" or other
  codingPlanQuotaInfo?: CodingPlanQuotaInfo;
  nextResetTime?: string; // ISO 8601
}

export interface CodingPlanApiResponse {
  code?: string;
  message?: string;
  data?: unknown;
  DataV2?: {
    data?: {
      data?: {
        codingPlanInstanceInfos?: CodingPlanInstance[];
      };
    };
  };
}

// API single-model detail response (same structure as an Items element)
export interface ApiModelDetailResponse {
  requestId: string;
  code: string;
  message: string | null;
  action: string | null;
  apiName: string | null;
  data: ApiModelItem;
}

// ============================================================
// DescribeUsageLimit (billing limit)
// ============================================================

export interface DescribeUsageLimitResponse {
  Status?: string;
  LimitAmount?: string | number;
  Currency?: string;
  AlertThreshold?: string | number;
  Receivers?: string[];
  RequestId?: string;
}

// ============================================================
// MaasListConsumeSummary (grouped) — breakdown rows
// ============================================================

export interface ConsumeSummaryGroupedItem {
  GroupKey?: string;
  GroupLabel?: string;
  Amount?: string | number;
  Quantity?: number;
}

export interface MaasListConsumeSummaryGroupedResponse {
  Data?: ConsumeSummaryGroupedItem[];
  TotalCount?: number;
  RequestId?: string;
}

// ============================================================
// MaasConsumeSummaryDimensionValues (legacy dimension dictionary)
// ============================================================

export interface DimensionValueItem {
  Value?: string;
  DisplayName?: string;
  Quantity?: number;
  TaxFee?: string | number;
  RequireAmount?: string | number;
  Amount?: string | number;
}

export interface MaasConsumeSummaryDimensionValuesResponse {
  Data?: DimensionValueItem[];
  TotalCount?: number;
  RequestId?: string;
}

// ============================================================
// MaasDescribeCostAnalysis (cost trend)
// ============================================================

export interface CostAnalysisDataPoint {
  Period?: string;
  Amount?: string | number;
}

export interface CostAnalysisGroupByItem {
  Key?: string;
  Name?: string;
  Amount?: string | number;
  Percentage?: string;
}

export interface MaasDescribeCostAnalysisResponse {
  Items?: CostAnalysisDataPoint[];
  GroupByTotal?: CostAnalysisGroupByItem[];
  CostTotals?: { Amount?: string | number; Currency?: string };
  ResultByTime?: Array<{
    Period?: string;
    Total?: { Amount?: string | number; Currency?: string };
    PeriodDetails?: CostAnalysisGroupByItem[];
  }>;
  Granularity?: string;
  Currency?: string;
  TotalAmount?: string | number;
  RequestId?: string;
}

// ============================================================
// ListSettleBillTotalSummary (account-cycle settle summary)
// ============================================================

export interface SettleBillTotalItem {
  BillingCycle?: string;
  // Actual API fields
  TotalPriceSettleFee?: string | number;
  TotalPriceTaxFee?: string | number;
  TotalPricePostTaxFee?: string | number;
  Currency?: string;
  // Legacy fields (retained for backward compatibility)
  PretaxAmount?: string | number;
  Tax?: string | number;
  AftertaxAmount?: string | number;
  Discount?: string | number;
  PaidAmount?: string | number;
  OutstandingAmount?: string | number;
}

export interface ListSettleBillTotalSummaryResponse {
  Data?: SettleBillTotalItem[];
  Currency?: string;
  RequestId?: string;
}

// ============================================================
// Subscription — raw response types
// ============================================================

export interface QuerySubscriptionGrayResponse {
  IsGray?: boolean;
  RequestId?: string;
}

export interface SeatSubscriptionEquityItem {
  EquityCode?: string;
  EquityType?: string;
  TotalValue?: string;
  SurplusValue?: string;
}

export interface SeatSubscriptionGroupItem {
  SpecType?: string;
  SubscriptionTotalNumber?: number;
  SubscriptionAssignedNumber?: number;
  TotalValue?: string;
  SurplusValue?: string;
  NextCycleFlushTime?: string | number;
  EquityList?: SeatSubscriptionEquityItem[];
  SubscriptionList?: Array<{ InstanceCode?: string; InstanceId?: string }>;
}

export interface GetSeatSubscriptionSummaryDataInner {
  Uid?: number | string;
  ProductCode?: string;
  PlanName?: string;
  PlanCode?: string;
  PeriodStart?: string;
  PeriodEnd?: string;
  Seats?: number;
  StartTime?: string | number;
  EndTime?: string | number;
  RemainingDays?: number | string;
  SubscriptionGroupList?: SeatSubscriptionGroupItem[];
}

export interface GetSeatSubscriptionSummaryResponse extends GetSeatSubscriptionSummaryDataInner {
  RequestId?: string;
  Message?: string;
  Code?: string;
  Success?: boolean;
  Data?: GetSeatSubscriptionSummaryDataInner;
}

export interface GetSubscriptionSummaryDataInner {
  Uid?: number | string;
  ProductCode?: string;
  TotalValue?: string;
  TotalSurplusValue?: string;
  TotalCount?: number;
  NearestExpireDate?: string | number;
}

export interface GetSubscriptionSummaryResponse extends GetSubscriptionSummaryDataInner {
  RequestId?: string;
  Message?: string;
  Code?: string;
  Success?: boolean;
  Data?: GetSubscriptionSummaryDataInner;
}

export interface SubscriptionDetailEquityItem {
  EquityCode?: string;
  EquityType?: string;
  CycleTotalValue?: string;
  CycleSurplusValue?: string;
  CycleStartTime?: string | number;
  CycleEndTime?: string | number;
  Unit?: string;
  TotalValue?: string;
  SurplusValue?: string;
}

export interface SubscriptionDetailItem {
  InstanceId?: string;
  InstanceCode?: string;
  Status?: string;
  PlanName?: string;
  PlanCode?: string;
  ProductCode?: string;
  StartTime?: string | number;
  EndTime?: string | number;
  MemberId?: string;
  SpecType?: string;
  ProductType?: string;
  PayMode?: string;
  Assignable?: boolean;
  Config?: string;
  EquityList?: SubscriptionDetailEquityItem[];
}

export interface GetSubscriptionDetailDataInner {
  SubscriptionList?: SubscriptionDetailItem[];
  TotalCount?: number;
  PageSize?: number;
  CurrentPage?: number;
  PageNo?: number;
}

export interface GetSubscriptionDetailResponse {
  Data?: SubscriptionDetailItem[] | GetSubscriptionDetailDataInner;
  TotalCount?: number;
  PageSize?: number;
  CurrentPage?: number;
  Code?: string;
  Success?: boolean;
  RequestId?: string;
}

export interface CheckTokenPlanAutoRenewalResponse {
  EnableRenew?: boolean;
  AutoRenewal?: boolean;
  Enable?: boolean;
  RequestId?: string;
  Data?: {
    AutoRenewal?: number | boolean;
    RenewalPeriod?: number;
    RenewalPeriodUnit?: string;
  };
}

export interface CheckInstancesRenewableResponse {
  Renewable?: boolean;
  RequestId?: string;
  Data?: Array<{
    InstanceId?: string;
    CommodityCode?: string;
    CommodityName?: string;
    CanRenew?: boolean;
    canRenew?: boolean;
    InterceptCode?: string;
  }>;
}

// ============================================================
// QueryOrderList + QueryOrderDetail
// ============================================================

export interface OrderListItem {
  OrderId?: string;
  OrderType?: string;
  OrderStatus?: string;
  DisplayStatus?: string;
  GmtCreate?: string;
  GmtPay?: string;
  OrderTime?: string;
  PayAmount?: string | number;
  TradeAmount?: string | number;
  CashAmount?: string | number;
  OriginalAmount?: string | number;
  PostTaxAmount?: string;
  PretaxAmount?: string;
  Amount?: string | number;
  Currency?: string;
  SettCurrency?: string;
  Status?: string;
  CommodityCode?: string;
  CommodityName?: string;
}

export interface QueryOrderListResponse {
  Data?: OrderListItem[];
  TotalCount?: number;
  PageSize?: number;
  CurrentPage?: number;
  RequestId?: string;
  /** Business code surfaced when the upstream BSS service rejects the call. */
  Code?: string;
  Message?: string;
  Success?: boolean;
}

export interface OrderDetailLineItem {
  Name?: string;
  Quantity?: number;
  Amount?: string | number;
}

export interface OrderDetailItem {
  OrderId?: string;
  OrderType?: string;
  OrderTime?: string;
  Amount?: string | number;
  Currency?: string;
  Status?: string;
  Items?: OrderDetailLineItem[];
  InvoiceUrl?: string;
}

export type QueryOrderDetailResponse = OrderDetailItem;

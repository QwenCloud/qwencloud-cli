export type RouteType = 'A' | 'B';

// Product constants (used across API routing layers)
export const API_PRODUCT_ACCOUNT_CENTER = 'AccountCenter';
export const API_PRODUCT_MODEL_STUDIO_REGIONAL = 'ModelStudioRegional';
/** Product identifier for model delivery service. */
export const API_PRODUCT_DELIVERY = 'AliyunDeliveryService';
/** Product identifier for billing service. */
export const API_PRODUCT_BSS = 'BssOpenAPI-V3';
/** Product identifier for gateway service. */
export const API_PRODUCT_GATEWAY = 'sfm_bailian';
export const API_PRODUCT_SEARCH = 'aliyun-search-maas';
/** Product identifier for support ticket service. */
export const API_PRODUCT_WORKORDER = 'Workorder';

// Action constants
export const API_ACTION_LIST_MODELS = 'ListModelSeries';
export const API_ACTION_DESCRIBE_FQ = 'DescribeFqInstance';
export const API_ACTION_DESCRIBE_FR = 'DescribeFrInstances';
export const API_ACTION_GATEWAY = 'IntlBroadScopeAspnGateway';
export const API_ACTION_CONSUME_SUMMARY = 'MaasListConsumeSummary';
export const API_ACTION_SEARCH_ALL = 'SearchAll';
export const API_ACTION_GENERATE_CLI_ACCESS_TOKEN = 'GenerateCLIAccessToken';
export const API_VERSION_GENERATE_CLI_ACCESS_TOKEN = '2026-02-10';

// Products with optional authentication (public search API, etc.)
export const AUTH_OPTIONAL_PRODUCTS: ReadonlySet<string> = new Set([API_PRODUCT_SEARCH]);

export const API_VERSION_GATEWAY = '1.0';
export const API_PRODUCT_ORCHESTRATION = 'occa-payment';
export const API_PRODUCT_BSS_PAYMENT = 'BssOpenApi';
export const API_ORCHESTRATION_PATH = '/data/custom.json';
export const API_PUBLIC_ORCHESTRATION_PATH = '/data/publicCustom.json';
export type OrchestrationPath =
  | typeof API_ORCHESTRATION_PATH
  | typeof API_PUBLIC_ORCHESTRATION_PATH;
export const API_TOKENPLAN_SOLO_SUBSCRIPTION =
  'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription';
export const API_TOKENPLAN_SOLO_QUOTA_CONFIG =
  'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config';
export const API_TOKENPLAN_SOLO_USAGE = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage';
export const API_TOKENPLAN_SUPPORTED_MODELS =
  'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listTokenPlanModels';
export const API_TOKENPLAN_MODEL_PROVIDERS =
  'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listModelProviders';

export const PUBLIC_ANONYMOUS_CAPABILITIES: ReadonlyMap<string, ReadonlySet<string>> = new Map();

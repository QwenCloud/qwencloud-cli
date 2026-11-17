export { VERSION } from './version.js';

// UI Components
export * from './ui/index.js';

// Types
export type {
  Modality,
  ModalityType,
  FreeTier,
  FreeTierQuota,
  PricingTier,
  BuiltInTool,
  LLMPricing,
  VideoPerSecondPricing,
  ImagePricing,
  TTSPricing,
  ASRPricing,
  EmbeddingPricing,
  Pricing,
  Context,
  RateLimits,
  ModelMetadata,
  Model,
  ModelDetail,
  ModelsListResponse,
  UsageSummaryResponse,
  FreeTierUsage,
  CodingPlan,
  CodingPlanWindow,
  PayAsYouGo,
  PayAsYouGoModel,
  UsageBreakdownResponse,
  UsageBreakdownRow,
  UsageBreakdownTotal,
  Credentials,
  UserInfo,
  AuthStatus,
  DeviceFlowInitResponse,
  DeviceFlowPollResponse,
  ConfigSchema,
  ConfigKey,
  OutputFormat,
  ResolvedFormat,
  ConfigEntry,
} from './types/index.js';

// API
export type {
  ApiClient,
  CliFacade,
  ListModelsOptions,
  UsageSummaryOptions,
  UsageBreakdownOptions,
} from './api/client.js';
export { createClient } from './api/client.js';

// Service composition root
export { createServices, type ServiceContainer } from './services/index.js';

// Cache utilities
export {
  MemoryCache,
  getGlobalCache,
  resetGlobalCache,
  CacheKeys,
  CacheTTL,
} from './utils/cache.js';

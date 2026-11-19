import type { ApiClient } from '../api/api-client.js';
import { parseTokenPlanCatalogCommodity } from '../api/parsers/tokenplan-catalog.js';
import {
  parseTokenPlanCatalogInventory,
  parseTokenPlanCatalogPrice,
  type TokenPlanCatalogPrice,
} from '../api/parsers/tokenplan-catalog-price.js';
import type { TokenPlanBillingCycle } from '../types/tokenplan-catalog.js';
import type { TokenPlanEdition } from '../types/tokenplan-subscription.js';
import {
  buildTokenPlanCatalogConfigurationData,
  tokenPlanCommodityCode,
} from './tokenplan-configuration.js';

export type { TokenPlanCatalogPrice } from '../api/parsers/tokenplan-catalog-price.js';

export function buildTokenPlanCatalogConfiguration(
  edition: TokenPlanEdition,
  specCode: string,
  billingCycle: TokenPlanBillingCycle,
  commodity: Record<string, unknown>,
): Record<string, unknown> {
  return buildTokenPlanCatalogConfigurationData(edition, specCode, billingCycle, commodity);
}

export class TokenPlanCatalogPricing {
  constructor(private readonly apiClient: ApiClient) {}

  async getCommodity(
    edition: TokenPlanEdition,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const commodityCode = tokenPlanCommodityCode(edition);
    return this.apiClient.callOrchestrationApi({
      action: 'GetCommodity',
      path: '/data/publicCustom.json',
      authMode: 'none',
      params: { commodityCode, orderType: 'BUY' },
      signal,
      parse: (data) => parseTokenPlanCatalogCommodity(data, commodityCode),
    });
  }

  async getPrice(
    configuration: Record<string, unknown>,
    options: {
      edition: TokenPlanEdition;
      specCode: string;
      authenticated: boolean;
      includeListPrice?: boolean;
      expectedMonthlyCredits?: string;
      signal?: AbortSignal;
    },
  ): Promise<TokenPlanCatalogPrice> {
    return this.apiClient.callOrchestrationApi({
      action: 'QueryOrderLight',
      path: '/data/publicCustom.json',
      authMode: options.authenticated ? 'optional' : 'none',
      params: configuration,
      signal: options.signal,
      parse: (data) => parseTokenPlanCatalogPrice(data, configuration, options),
    });
  }

  async getInventory(
    configuration: Record<string, unknown>,
    options: { authenticated: boolean; signal?: AbortSignal },
  ): Promise<boolean> {
    return this.apiClient.callOrchestrationApi({
      action: 'CheckInventory',
      path: '/data/publicCustom.json',
      authMode: options.authenticated ? 'optional' : 'none',
      params: configuration,
      signal: options.signal,
      parse: parseTokenPlanCatalogInventory,
    });
  }
}

import type { ApiClient } from '../api/api-client.js';
import { GatewayShapeError } from '../api/request-adapter.js';
import type { TokenPlanSupportedModel } from '../types/tokenplan-benefits.js';

type Edition = 'individual' | 'team';
interface Provider {
  name: string;
  order: number;
}

export interface TokenPlanBenefitsReader {
  loadModels(edition: Edition): Promise<TokenPlanSupportedModel[]>;
}

const MODELS_API = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listTokenPlanModels';
const PROVIDERS_API = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listModelProviders';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GatewayShapeError('Invalid Token Plan model metadata');
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function requiredText(value: unknown): string {
  const result = text(value);
  if (result === null) throw new GatewayShapeError('Invalid Token Plan model identifier');
  return result;
}

function localizedName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  try {
    return text(record(JSON.parse(value) as unknown)['en-US']) ?? fallback;
  } catch {
    return fallback;
  }
}

function capabilities(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((capability) => text(capability) === null))
    throw new GatewayShapeError('Invalid Token Plan model capabilities');
  const priority = ['TG', 'Reasoning', 'VU'];
  return [...new Set(value as string[])].sort((left, right) => {
    const leftRank = priority.indexOf(left);
    const rightRank = priority.indexOf(right);
    return (
      (leftRank < 0 ? priority.length : leftRank) - (rightRank < 0 ? priority.length : rightRank)
    );
  });
}

function providerLookup(business: unknown): Map<string, Provider> {
  const data = record(business).data;
  if (!Array.isArray(data)) throw new GatewayShapeError('Token Plan provider tree is missing');
  const lookup = new Map<string, Provider>();
  const visit = (nodes: unknown[], depth: number): void => {
    if (depth > 32) throw new GatewayShapeError('Token Plan provider tree is too deep');
    for (const value of nodes) {
      const node = record(value);
      if (node.items !== undefined && !Array.isArray(node.items))
        throw new GatewayShapeError('Invalid Token Plan provider items');
      if (Array.isArray(node.items) && node.items.length > 0) {
        visit(node.items, depth + 1);
        continue;
      }
      const id = requiredText(node.providerId);
      if (lookup.has(id)) throw new GatewayShapeError('Duplicate Token Plan provider identifier');
      lookup.set(id, { name: text(node.displayName) ?? id, order: lookup.size });
    }
  };
  visit(data, 0);
  return lookup;
}

async function supportedModels(
  apiClient: ApiClient,
  edition: Edition,
  providers: Promise<Map<string, Provider>>,
  signal?: AbortSignal,
): Promise<TokenPlanSupportedModel[]> {
  if (edition !== 'individual' && edition !== 'team')
    throw new GatewayShapeError('Invalid Token Plan model edition');
  const lookup = await providers;
  const result: Array<TokenPlanSupportedModel & { providerId: string }> = [];
  const seen = new Set<string>();
  const unknownBrands = new Map<string, number>();
  let expectedTotal: number | null = null;
  for (let pageNo = 1; pageNo <= 100; pageNo++) {
    signal?.throwIfAborted();
    const page = await apiClient.callCsDataApi({
      api: MODELS_API,
      data: {
        input: { pageNo, pageSize: 100, edition: edition === 'individual' ? 'PERSONAL' : 'TEAM' },
      },
      authMode: 'none',
      signal,
      parse: (business) => record(record(business).data),
    });
    if (!Array.isArray(page.list) || page.list.length > 100)
      throw new GatewayShapeError('Invalid Token Plan model page');
    if (page.pageNo !== pageNo || page.pageSize !== 100)
      throw new GatewayShapeError('Token Plan model page mismatch');
    if (
      !Number.isSafeInteger(page.total) ||
      Number(page.total) < 0 ||
      (expectedTotal !== null && expectedTotal !== page.total)
    )
      throw new GatewayShapeError('Invalid Token Plan model total');
    expectedTotal = Number(page.total);
    for (const value of page.list) {
      const model = record(value);
      const modelId = requiredText(model.modelId);
      if (seen.has(modelId)) throw new GatewayShapeError('Duplicate Token Plan model while paging');
      seen.add(modelId);
      const providerId = requiredText(model.provider);
      if (!lookup.has(providerId) && !unknownBrands.has(providerId))
        unknownBrands.set(providerId, lookup.size + unknownBrands.size);
      result.push({
        modelId,
        providerId,
        modelBrand: lookup.get(providerId)?.name ?? providerId,
        modelName: localizedName(model.name, modelId),
        capabilities: capabilities(model.capabilities),
        ...(typeof model.badgeLabel === 'string' ? { badgeLabel: model.badgeLabel } : {}),
        ...(typeof model.badgeDescription === 'string'
          ? { badgeDescription: model.badgeDescription }
          : {}),
        ...(typeof model.isNew === 'boolean' ? { isNew: model.isNew } : {}),
      });
    }
    if (result.length > expectedTotal)
      throw new GatewayShapeError('Token Plan model total is inconsistent');
    if (result.length === expectedTotal) {
      result.sort(
        (left, right) =>
          (lookup.get(left.providerId)?.order ?? unknownBrands.get(left.providerId)!) -
          (lookup.get(right.providerId)?.order ?? unknownBrands.get(right.providerId)!),
      );
      return result.map(({ providerId: _providerId, ...model }) => model);
    }
    if (page.list.length === 0)
      throw new GatewayShapeError('Token Plan model paging made no progress');
  }
  throw new GatewayShapeError('Token Plan model page budget exceeded');
}

export function createTokenPlanBenefitsReader(
  apiClient: ApiClient,
  signal?: AbortSignal,
): TokenPlanBenefitsReader {
  let providers: Promise<Map<string, Provider>> | undefined;
  const models = new Map<Edition, Promise<TokenPlanSupportedModel[]>>();
  return {
    loadModels(edition) {
      if (edition !== 'individual' && edition !== 'team')
        return Promise.reject(new GatewayShapeError('Invalid Token Plan model edition'));
      if (!models.has(edition)) {
        providers ??= apiClient.callCsDataApi({
          api: PROVIDERS_API,
          data: {},
          authMode: 'none',
          signal,
          parse: providerLookup,
        });
        models.set(edition, supportedModels(apiClient, edition, providers, signal));
      }
      return models.get(edition)!;
    },
  };
}

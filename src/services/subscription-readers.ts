import type { ApiClient } from '../api/api-client.js';
import type {
  CheckInstancesRenewableResponse,
  CheckTokenPlanAutoRenewalResponse,
  FrInstanceItem,
  GetSeatSubscriptionSummaryResponse,
  GetSubscriptionDetailResponse,
  GetSubscriptionSummaryResponse,
  SubscriptionDetailItem,
} from '../types/api-models.js';
import type {
  InstancesRenewableDto,
  SubscriptionDetailDto,
  SubscriptionDiagnostic,
} from '../types/subscription.js';
import type { TokenPlanEditionStatus } from '../types/tokenplan-subscription.js';
import type { TokenPlan } from '../types/usage.js';
import type { SubscriptionAdapter } from './subscription-service.js';
import { awaitCsDataOperation } from '../auth/cs-data-session.js';
import { site } from '../site.js';
import { runSubscriptionCalls } from './subscription-query.js';
import { fetchIndividualTokenPlan } from './tokenplan-individual.js';
import {
  buildTeamRenewable,
  enrichTeamTokenPlan,
  fetchTeamTokenPlan,
  hasConfirmedTokenPlanEdition,
  unknownTokenPlanEdition,
  type TeamTokenPlanResult,
} from './tokenplan-team.js';
import {
  safeSubscriptionDiagnostic,
  subscriptionProtocolDiagnostic,
} from './subscription-diagnostics.js';

const API_PRODUCT_BSS = 'BssOpenAPI-V3';
const STATUS_TIMEOUT_MS = 35_000;

export type SubscriptionReadOutcome = 'confirmed' | 'partial' | 'failed';

interface SubscriptionRead<T> {
  data: T;
  outcome: SubscriptionReadOutcome;
  diagnostics: SubscriptionDiagnostic[];
}

export type CodingSubscriptionRead = SubscriptionRead<{
  detail: SubscriptionDetailDto;
  renewable: InstancesRenewableDto;
}>;
export type IndividualSubscriptionRead = SubscriptionRead<TokenPlanEditionStatus>;
export interface TeamSubscriptionRead extends SubscriptionRead<TokenPlanEditionStatus> {
  requestDiagnostics: SubscriptionDiagnostic[];
  compatibility: {
    frInstances: FrInstanceItem[];
    instanceSummary: Partial<TokenPlan>;
    seat?: GetSeatSubscriptionSummaryResponse;
    summary?: GetSubscriptionSummaryResponse;
    autoRenew?: CheckTokenPlanAutoRenewalResponse;
    renewable?: CheckInstancesRenewableResponse;
  };
}

export function editionReadOutcome(node: TokenPlanEditionStatus): SubscriptionReadOutcome {
  if (!hasConfirmedTokenPlanEdition(node)) return 'failed';
  return node.status === 'unknown' || node.completeness !== 'complete' ? 'partial' : 'confirmed';
}

function uniqueDiagnostics(records: SubscriptionDiagnostic[]): SubscriptionDiagnostic[] {
  return [...new Map(records.map((record) => [JSON.stringify(record), record])).values()];
}

export async function readIndividualSubscription(
  apiClient: ApiClient,
  signal: AbortSignal,
  fetch: (signal: AbortSignal) => Promise<TokenPlanEditionStatus> = (signal) =>
    fetchIndividualTokenPlan(apiClient, signal),
): Promise<IndividualSubscriptionRead> {
  const [reply] = await runSubscriptionCalls(
    [{ api: 'TokenPlanIndividual', invoke: fetch }],
    STATUS_TIMEOUT_MS,
    signal,
    { abortCompleted: false },
  );
  const data =
    (reply?.data as TokenPlanEditionStatus | null) ??
    unknownTokenPlanEdition('individual', reply?.diagnostic ? [reply.diagnostic] : []);
  return { data, outcome: editionReadOutcome(data), diagnostics: data.diagnostics };
}

export async function readTeamSubscription(
  apiClient: ApiClient,
  signal: AbortSignal,
  fetchInstances: (signal: AbortSignal) => Promise<TeamTokenPlanResult> = (signal) =>
    fetchTeamTokenPlan(apiClient, signal),
): Promise<TeamSubscriptionRead> {
  const productCode = site.features.tokenPlanCommodityCodes.teams;
  let instancesPromise: Promise<TeamTokenPlanResult> | undefined;
  const getInstances = (signal: AbortSignal) => (instancesPromise ??= fetchInstances(signal));
  let renewalStarted = false;
  const replies = await runSubscriptionCalls(
    [
      { api: 'DescribeFrInstances', invoke: getInstances },
      {
        api: 'GetSeatSubscriptionSummary',
        invoke: (signal) =>
          apiClient.callFlatApi<GetSeatSubscriptionSummaryResponse>({
            product: API_PRODUCT_BSS,
            action: 'GetSeatSubscriptionSummary',
            params: { productCode },
            signal,
          }),
      },
      {
        api: 'GetSubscriptionSummary',
        invoke: (signal) =>
          apiClient.callFlatApi<GetSubscriptionSummaryResponse>({
            product: API_PRODUCT_BSS,
            action: 'GetSubscriptionSummary',
            params: { productCode },
            signal,
          }),
      },
      {
        api: 'CheckTokenPlanAutoRenewal',
        invoke: (signal) =>
          apiClient.callFlatApi<CheckTokenPlanAutoRenewalResponse>({
            product: 'BssOpenApi',
            action: 'CheckTokenPlanAutoRenewal',
            params: { CommodityCode: productCode },
            signal,
          }),
      },
      {
        api: 'CheckInstancesRenewable',
        invoke: async (signal) => {
          const instances = await awaitCsDataOperation(getInstances(signal), signal).catch(
            () => null,
          );
          if (!instances?.instanceId || signal.aborted) return null;
          renewalStarted = true;
          return apiClient.callFlatApi<CheckInstancesRenewableResponse>({
            product: API_PRODUCT_BSS,
            action: 'CheckInstancesRenewable',
            signal,
            params: {
              'instanceIdentities.1.InstanceId': instances.instanceId,
              'instanceIdentities.1.CommodityCode': productCode,
              'instanceIdentities.1.ResourceType': 'subscription',
            },
          });
        },
      },
    ],
    STATUS_TIMEOUT_MS,
    signal,
    { abortCompleted: false },
  );
  const lookup = new Map(replies.map((reply) => [reply.api, reply.data]));
  const instances = lookup.get('DescribeFrInstances') as TeamTokenPlanResult | null;
  const compatibility: TeamSubscriptionRead['compatibility'] = {
    frInstances: instances?.legacyInstances ?? [],
    instanceSummary: instances?.legacy ?? {},
    seat:
      (lookup.get('GetSeatSubscriptionSummary') as GetSeatSubscriptionSummaryResponse | null) ??
      undefined,
    summary:
      (lookup.get('GetSubscriptionSummary') as GetSubscriptionSummaryResponse | null) ?? undefined,
    autoRenew:
      (lookup.get('CheckTokenPlanAutoRenewal') as CheckTokenPlanAutoRenewalResponse | null) ??
      undefined,
    renewable:
      (lookup.get('CheckInstancesRenewable') as CheckInstancesRenewableResponse | null) ??
      undefined,
  };
  const data = enrichTeamTokenPlan(
    instances?.team ?? unknownTokenPlanEdition('team'),
    compatibility.seat,
    compatibility.summary,
    compatibility.autoRenew,
  );
  data.renewable = buildTeamRenewable(compatibility.renewable, instances?.instanceId ?? null);
  const requestDiagnostics = replies.flatMap((reply) =>
    reply.diagnostic && (reply.api !== 'CheckInstancesRenewable' || renewalStarted)
      ? [reply.diagnostic]
      : [],
  );
  data.diagnostics = data.diagnostics.filter(
    (entry) =>
      entry.errorCode !== 'Unavailable' ||
      !requestDiagnostics.some((failed) => failed.api === entry.api),
  );
  return {
    data,
    outcome: editionReadOutcome(data),
    diagnostics: uniqueDiagnostics([...requestDiagnostics, ...data.diagnostics]),
    requestDiagnostics,
    compatibility,
  };
}

export async function readCodingSubscription(
  apiClient: ApiClient,
  adapter: Pick<SubscriptionAdapter, 'transformSubscriptionDetail' | 'transformInstancesRenewable'>,
  signal: AbortSignal,
): Promise<CodingSubscriptionRead> {
  let detailPromise: Promise<GetSubscriptionDetailResponse> | undefined;
  const getDetail = (signal: AbortSignal) =>
    (detailPromise ??= apiClient.callFlatApi<GetSubscriptionDetailResponse>({
      product: API_PRODUCT_BSS,
      action: 'GetSubscriptionDetail',
      signal,
      params: { productCode: site.features.codingPlanCommodityCode, pageNo: 1, pageSize: 100 },
    }));
  let renewalStarted = false;
  const replies = await runSubscriptionCalls(
    [
      { api: 'GetSubscriptionDetail', invoke: getDetail },
      {
        api: 'CheckInstancesRenewable',
        invoke: async (signal) => {
          const raw = await awaitCsDataOperation(getDetail(signal), signal).catch(() => null);
          if (!raw || !inspectCodingPlanResponse(raw).usable) return null;
          const items: SubscriptionDetailItem[] = Array.isArray(raw.Data)
            ? raw.Data
            : (raw.Data?.SubscriptionList ?? []);
          const normal = items.filter((item) => item.Status === 'NORMAL');
          if (normal.length === 0 || signal.aborted) return null;
          const params: Record<string, string> = {};
          normal.forEach((item, index) => {
            params[`instanceIdentities.${index + 1}.InstanceId`] =
              item.InstanceCode ?? item.InstanceId ?? '';
            params[`instanceIdentities.${index + 1}.CommodityCode`] = item.ProductCode ?? '';
            params[`instanceIdentities.${index + 1}.ResourceType`] = 'subscription';
          });
          renewalStarted = true;
          return awaitCsDataOperation(
            apiClient.callFlatApi<CheckInstancesRenewableResponse>({
              product: API_PRODUCT_BSS,
              action: 'CheckInstancesRenewable',
              params,
              signal,
            }),
            signal,
          );
        },
      },
    ],
    STATUS_TIMEOUT_MS,
    signal,
    { abortCompleted: false },
  );
  const raw = replies[0]?.data;
  const inspected = raw == null ? undefined : inspectCodingPlanResponse(raw);
  const diagnostics = replies.flatMap((reply) =>
    reply.diagnostic && (reply.api !== 'CheckInstancesRenewable' || renewalStarted)
      ? [reply.diagnostic]
      : [],
  );
  if (inspected?.diagnostic) diagnostics.push(inspected.diagnostic);
  const detail = adapter.transformSubscriptionDetail(
    inspected?.usable ? (raw as GetSubscriptionDetailResponse) : undefined,
  );
  const renewable = adapter.transformInstancesRenewable(
    replies[1]?.data as CheckInstancesRenewableResponse | undefined,
  );
  const confirmed = inspected?.confirmed || detail.activeInstance !== null;
  return {
    data: { detail, renewable },
    outcome: !confirmed ? 'failed' : diagnostics.length ? 'partial' : 'confirmed',
    diagnostics,
  };
}
function inspectCodingPlanResponse(value: unknown): {
  usable: boolean;
  confirmed: boolean;
  diagnostic: SubscriptionDiagnostic | null;
} {
  const invalid = (errorCode: string) => ({
    usable: false,
    confirmed: false,
    diagnostic: subscriptionProtocolDiagnostic('GetSubscriptionDetail', errorCode),
  });
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid('InvalidResponse');
  const raw = value as Record<string, unknown>;
  const code = raw.Code === undefined ? undefined : String(raw.Code);
  const businessFailure = code !== undefined && !['Success', 'SUCCESS', '200'].includes(code);
  if ((raw.Success !== undefined && raw.Success !== true) || businessFailure)
    return businessFailure
      ? {
          usable: false,
          confirmed: false,
          diagnostic: safeSubscriptionDiagnostic('GetSubscriptionDetail', { code }),
        }
      : invalid('InvalidResponse');
  const data = raw.Data;
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as Record<string, unknown>).SubscriptionList
      : undefined;
  const total =
    data && typeof data === 'object' && !Array.isArray(data)
      ? ((data as Record<string, unknown>).TotalCount ?? raw.TotalCount)
      : raw.TotalCount;
  if (
    !Array.isArray(list) ||
    list.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))
  )
    return invalid('InvalidInstances');
  const complete = total === undefined || total === list.length;
  const known = list.every((item) => ['VALID', 'NORMAL', 'EXPIRED'].includes(item.Status));
  return {
    usable: true,
    confirmed: complete && known,
    diagnostic: !complete
      ? subscriptionProtocolDiagnostic('GetSubscriptionDetail', 'IncompleteInstances')
      : !known
        ? subscriptionProtocolDiagnostic('GetSubscriptionDetail', 'UnconfirmedState')
        : null,
  };
}

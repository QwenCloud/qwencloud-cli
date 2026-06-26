/** Token Plan subscription orchestration. */

import type { ApiClient } from '../api/api-client.js';
import type { CachedFetcher } from '../types/cache.js';
import type {
  FrInstanceItem,
  FrInstanceResponse,
  GetSeatSubscriptionSummaryDataInner,
  GetSeatSubscriptionSummaryResponse,
  QuerySubscriptionGrayResponse,
  SeatSubscriptionGroupItem,
} from '../types/api-models.js';
import type { TokenPlan } from '../types/usage.js';
import { addDiagnostic } from '../api/debug-buffer.js';
import { preciseAdd } from '../utils/precise-math.js';
import { site } from '../site.js';

const API_PRODUCT_BSS = 'BssOpenAPI-V3';
const API_ACTION_DESCRIBE_FR = 'DescribeFrInstances';

export class TokenplanService {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly cache: CachedFetcher,
  ) {}

  /** Fetch Token Plan; degrades to subscribed=false on failure. */
  async fetchTokenPlan(): Promise<TokenPlan> {
    try {
      const isGray = await this.checkIsGray();

      if (isGray) {
        return this.fetchTokenPlanFromSeatSummary();
      }

      return this.fetchTokenPlanLegacy();
    } catch (error) {
      addDiagnostic(
        'TokenPlan',
        `fetch failed, treating as not subscribed: ${error instanceof Error ? error.message : String(error)}`,
        'warn',
      );
      return { subscribed: false };
    } finally {
      void this.cache;
    }
  }

  /** Legacy path: concurrent DescribeFrInstances for all commodity codes. */
  private async fetchTokenPlanLegacy(): Promise<TokenPlan> {
    const codes = site.features.tokenPlanCommodityCodes;
    const [teamsRes, personalRes, addonRes] = await Promise.all([
      this.fetchFrInstances(codes.teams, 10),
      this.fetchFrInstances(codes.personal, 10),
      this.fetchFrInstances(codes.addon, 100),
    ]);

    const allPlanInstances = [...(teamsRes?.Data ?? []), ...(personalRes?.Data ?? [])];
    const validInstance =
      allPlanInstances.find((inst) => {
        const statusCode = typeof inst.Status === 'object' ? inst.Status?.Code : inst.Status;
        return statusCode === 'valid';
      }) ?? allPlanInstances[0];

    const addonRemaining = (addonRes?.Data ?? [])
      .filter((inst) => {
        const statusCode = typeof inst.Status === 'object' ? inst.Status?.Code : inst.Status;
        return statusCode === 'valid';
      })
      .reduce(
        (sum: number, inst: FrInstanceItem) => preciseAdd(sum, Number(inst.CurrCapacityBaseValue || 0)),
        0,
      );

    if (!validInstance) {
      if (addonRemaining > 0) return { subscribed: false, addonRemaining };
      return { subscribed: false };
    }

    return this.buildTokenPlanDto(validInstance, addonRemaining);
  }

  private async checkIsGray(): Promise<boolean> {
    try {
      const res = await this.apiClient.callFlatApi<QuerySubscriptionGrayResponse>({
        product: API_PRODUCT_BSS,
        action: 'QuerySubscriptionGray',
      });
      return res?.IsGray === true;
    } catch {
      return false;
    }
  }

  private async fetchTokenPlanFromSeatSummary(): Promise<TokenPlan> {
    const codes = site.features.tokenPlanCommodityCodes;

    const [seatRes, addonRemaining] = await Promise.all([
      this.apiClient.callFlatApi<GetSeatSubscriptionSummaryResponse>({
        product: API_PRODUCT_BSS,
        action: 'GetSeatSubscriptionSummary',
        params: { productCode: codes.teams },
      }),
      this.fetchAddonRemaining(),
    ]);

    const data: GetSeatSubscriptionSummaryDataInner | undefined = seatRes?.Data ?? seatRes;
    const groups: SeatSubscriptionGroupItem[] = data?.SubscriptionGroupList ?? [];

    let totalCredits = 0;
    let remainingCredits = 0;

    for (const group of groups) {
      const equity = Array.isArray(group.EquityList) ? group.EquityList[0] : undefined;
      const total = parseFloat(equity?.TotalValue ?? group.TotalValue ?? '0');
      const remaining = parseFloat(equity?.SurplusValue ?? group.SurplusValue ?? '0');
      if (Number.isFinite(total)) totalCredits = preciseAdd(totalCredits, total);
      if (Number.isFinite(remaining)) remainingCredits = preciseAdd(remainingCredits, remaining);
    }

    const subscribed = groups.length > 0 && totalCredits > 0;
    const usedPct =
      totalCredits > 0 ? Math.round(((totalCredits - remainingCredits) / totalCredits) * 100) : 0;

    const endTime = data?.EndTime;
    const resetDate =
      typeof endTime === 'number' && endTime > 0
        ? new Date(endTime).toISOString()
        : typeof endTime === 'string' && endTime.length > 0
          ? endTime
          : undefined;

    const planName = data?.PlanName ?? 'Token Plan';

    const dto: TokenPlan = {
      subscribed,
      planName,
      status: subscribed ? 'valid' : undefined,
      totalCredits,
      remainingCredits,
      usedPct,
    };
    if (resetDate) dto.resetDate = resetDate;
    if (addonRemaining > 0) dto.addonRemaining = addonRemaining;
    return dto;
  }

  private async fetchAddonRemaining(): Promise<number> {
    const codes = site.features.tokenPlanCommodityCodes;
    const addonRes = await this.fetchFrInstances(codes.addon, 100);
    return (addonRes?.Data ?? [])
      .filter((inst) => {
        const statusCode = typeof inst.Status === 'object' ? inst.Status?.Code : inst.Status;
        return statusCode === 'valid';
      })
      .reduce(
        (sum: number, inst: FrInstanceItem) => preciseAdd(sum, Number(inst.CurrCapacityBaseValue || 0)),
        0,
      );
  }

  private async fetchFrInstances(
    commodityCode: string,
    pageSize: number,
  ): Promise<FrInstanceResponse | null> {
    try {
      const result = await this.apiClient.callFlatApi<FrInstanceResponse>({
        product: API_PRODUCT_BSS,
        action: API_ACTION_DESCRIBE_FR,
        params: {
          Group: 'tokenPlan',
          CommodityCode: commodityCode,
          PageNum: 1,
          PageSize: pageSize,
        },
      });
      return result ?? null;
    } catch (error) {
      addDiagnostic(
        'TokenPlan',
        `DescribeFrInstances failed for ${commodityCode}: ${error instanceof Error ? error.message : String(error)}`,
        'warn',
      );
      return null;
    }
  }

  /** Reduce a subscription instance to a TokenPlan DTO. */
  private buildTokenPlanDto(instance: FrInstanceItem, addonRemaining: number): TokenPlan {
    const statusCode =
      typeof instance.Status === 'object' ? instance.Status?.Code : instance.Status;
    const totalCredits = Number(instance.InitCapacityBaseValue || 0);
    const capacityType = instance.CapacityTypeCode ?? '';
    const remainingCredits =
      capacityType === 'periodMonthlyShift'
        ? Number(instance.periodCapacityBaseValue || instance.CurrCapacityBaseValue || 0)
        : Number(instance.CurrCapacityBaseValue || 0);
    const usedPct = totalCredits > 0 ? ((totalCredits - remainingCredits) / totalCredits) * 100 : 0;
    const resetDate = instance.EndTime ? new Date(instance.EndTime).toISOString() : undefined;

    const dto: TokenPlan = {
      subscribed: statusCode === 'valid',
      planName: instance.TemplateName ?? instance.CommodityName,
      status: statusCode as TokenPlan['status'],
      totalCredits,
      remainingCredits,
      usedPct,
    };
    if (resetDate) dto.resetDate = resetDate;
    if (addonRemaining > 0) dto.addonRemaining = addonRemaining;
    return dto;
  }
}

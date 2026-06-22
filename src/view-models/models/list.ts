import type { Model, ModelsListResponse, ModelDetail } from '../../types/model.js';
import { abbreviateModality } from '../../utils/modality.js';
import { splitPrice } from '../../utils/formatting.js';
import { formatFreeTierSplit, formatPriceFromPricing } from './shared.js';

// ── Model List ViewModel ──────────────────────────────────────────────

export interface ModelRowViewModel {
  id: string;
  modalityInput: string; // "Text+Img+Video"
  modalityOutput: string; // "Text"
  canTry: string; // "Yes" / "No"
  freeTierAmt: string; // "1M" / "500K" / "Only" / "—"
  freeTierUnit: string; // "tok" | "img" | "sec" | ""
  freeTierRemainingPct?: number; // 0–100, undefined if no quota data
  freeTierExpired?: boolean; // true when quota status is 'expire'
  price: string; // "$0.50-2.00" (amount only)
  priceUnit: string; // "/1M tok" | "/img" | "/sec" | ""
}

export interface ModelsListViewModel {
  rows: ModelRowViewModel[];
  total: number;
}

/**
 * Build list view model from API response.
 */
export function buildModelListViewModel(response: ModelsListResponse): ModelsListViewModel {
  return buildModelListViewModelFromModels(response.models);
}

/**
 * Build list view model from raw Model[] with optional detail overrides.
 * Used by list/search commands where details come from getModels() cache.
 */
export function buildModelListViewModelFromModels(
  models: Model[],
  details?: (ModelDetail | null)[],
): ModelsListViewModel {
  const rows = models.map((model, i) => {
    const detail = details?.[i] ?? null;
    const pricing = detail?.pricing ?? model.pricing;
    const priceStr = pricing
      ? formatPriceFromPricing(pricing, model.free_tier.mode === 'only')
      : '—';

    const { amount: priceAmt, unit: priceUnit } = splitPrice(priceStr);
    const { amount: ftAmt, unit: ftUnit, expired: ftExpired } = formatFreeTierSplit(model);
    const quota = model.free_tier.quota;
    const freeTierRemainingPct = quota
      ? quota.status === 'expire'
        ? 0
        : quota.total > 0
          ? parseFloat(((quota.remaining / quota.total) * 100).toFixed(2))
          : undefined
      : undefined;
    return {
      id: model.id,
      modalityInput: model.modality.input.map(abbreviateModality).join('+'),
      modalityOutput: model.modality.output.map(abbreviateModality).join('+'),
      canTry: model.can_try ? 'Yes' : 'No',
      freeTierAmt: ftAmt,
      freeTierUnit: ftUnit,
      freeTierRemainingPct,
      freeTierExpired: ftExpired,
      price: priceAmt,
      priceUnit,
    };
  });

  return { rows, total: models.length };
}

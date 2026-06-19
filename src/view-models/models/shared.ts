import type { Model, Pricing } from '../../types/model.js';
import { humanizeNumber, humanizeWithUnit, formatAmount } from '../../output/humanize.js';
import { site } from '../../site.js';

/** Currency symbol resolved from site config. */
export const CUR = site.features.currency === 'USD' ? '$' : ' ';

// Unit abbreviation map (mirrors humanize.ts unitAbbrev)
const UNIT_SHORT: Record<string, string> = {
  tokens: 'tok',
  images: 'img',
  characters: 'char',
  seconds: 'sec',
  token: 'tok',
  image: 'img',
  piece: 'img',
  pieces: 'img',
  character: 'char',
  second: 'sec',
};

/**
 * Format the Free Tier column as split amount + unit for aligned table display.
 */
export function formatFreeTierSplit(model: Model): {
  amount: string;
  unit: string;
  expired?: boolean;
} {
  if (model.free_tier.mode === 'only') return { amount: 'Only', unit: '' };
  if (model.free_tier.mode === 'standard' && model.free_tier.quota) {
    const quota = model.free_tier.quota;
    // Expired quotas show numbers with (expired) suffix, rendered muted by display layer
    if (quota.status === 'expire') {
      return {
        amount: humanizeNumber(quota.total),
        unit: `${UNIT_SHORT[quota.unit] ?? quota.unit} (expired)`,
        expired: true,
      };
    }
    return {
      amount: humanizeNumber(quota.total),
      unit: UNIT_SHORT[quota.unit] ?? quota.unit,
    };
  }
  if (model.free_tier.mode === 'standard') return { amount: '—', unit: '' };
  return { amount: '—', unit: '' };
}

/**
 * Format the Free Tier column value for a model.
 */
export function formatFreeTier(model: Model): string {
  if (model.free_tier.mode === 'only') return 'Only';
  if (model.free_tier.mode === 'standard' && model.free_tier.quota) {
    const quota = model.free_tier.quota;
    const base = humanizeWithUnit(quota.remaining, quota.unit);
    if (quota.status === 'exhaust') {
      return `${base} (exhaust)`;
    }
    if (quota.status === 'expire') {
      return `${base} (expired)`;
    }
    return base;
  }
  if (model.free_tier.mode === 'standard') return 'Yes';
  return '\u2014';
}

/**
 * Format price column from a Pricing object.
 */
export function formatPriceFromPricing(pricing: Pricing, isFreeOnly: boolean): string {
  const DASH = '\u2014';
  const isValidNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  if (isFreeOnly) return 'Free';

  if ('tiers' in pricing) {
    const tiers = pricing.tiers;
    if (!Array.isArray(tiers) || tiers.length === 0) return DASH;

    // Only tiers with numeric, finite input/output are considered understandable.
    const valid = tiers.filter((t) => isValidNum(t?.input) && isValidNum(t?.output));
    if (valid.length === 0) return DASH;

    const paid = valid.filter((t) => t.input > 0 || t.output > 0);
    // All-zero or no paid tier → treat as "no price data" rather than "Free",
    // since only `free_tier.mode === 'only'` carries reliable free-only semantics.
    if (paid.length === 0) return DASH;

    const cheapest = paid.reduce((min, t) => (t.input < min.input ? t : min), paid[0]);
    const suffix = paid.length > 1 ? ' +' : '';
    return `${CUR}${formatAmount(cheapest.input)} / ${CUR}${formatAmount(cheapest.output)}${suffix} /1M tok`;
  }

  if ('per_second' in pricing) {
    const rows = Array.isArray(pricing.per_second) ? pricing.per_second : [];
    const prices = rows.map((r) => r?.price).filter(isValidNum);
    if (prices.length === 0) return DASH;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return `${CUR}${formatAmount(min)} /sec`;
    return `${CUR}${formatAmount(min)}-${formatAmount(max)} /sec`;
  }

  if ('per_image' in pricing) {
    const p = pricing.per_image?.price;
    if (!isValidNum(p)) return DASH;
    return `${CUR}${formatAmount(p)} /img`;
  }

  if ('per_character' in pricing) {
    const p = pricing.per_character?.price;
    if (!isValidNum(p)) return DASH;
    return `${CUR}${formatAmount(p)} /10K char`;
  }

  if ('per_second_audio' in pricing) {
    const p = pricing.per_second_audio?.price;
    if (!isValidNum(p)) return DASH;
    return `${CUR}${formatAmount(p)} /sec`;
  }

  if ('per_token' in pricing) {
    const p = pricing.per_token?.price;
    if (!isValidNum(p)) return DASH;
    return `${CUR}${formatAmount(p)} /1M tok`;
  }

  if ('items' in pricing) {
    const items = pricing.items;
    if (!Array.isArray(items) || items.length === 0) return DASH;
    const prices = items.map((i) => i?.price).filter(isValidNum);
    if (prices.length === 0) return DASH;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const unit = items[0].unit ?? '';
    if (min === max) return `${CUR}${formatAmount(min)} /${unit}`;
    return `${CUR}${formatAmount(min)}-${formatAmount(max)} /${unit}`;
  }

  return DASH;
}

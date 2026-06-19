import type {
  Pricing,
  PricingSummary,
  LLMPricing,
  VideoPerSecondPricing,
  ImagePricing,
  TTSPricing,
  ASRPricing,
  EmbeddingPricing,
  ItemizedPricing,
} from '../../types/model.js';
import { site } from '../../site.js';

/** Currency label used in pricing unit strings (e.g. "USD/1M tokens"). */
const CUR_LABEL = site.features.currency;

/** Parse a price string to a finite number; returns 0 for NaN / non-numeric input. */
export function safePrice(raw: string | undefined | null): number {
  if (raw == null) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Apply discount multiplier to base price. Returns base price if discount is invalid/absent. */
export function applyDiscount(basePrice: number, discount: string | undefined | null): number {
  if (discount == null) return basePrice;
  const multiplier = parseFloat(discount);
  // Valid discount: must be a finite number in range (0, 1]
  // If multiplier > 1 or <= 0 or NaN, ignore it (return base price)
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1) return basePrice;
  // Clean floating-point artifacts: round to 10 significant decimal places
  // This eliminates artifacts like 0.14*0.8=0.11200000000000001 → 0.112
  return parseFloat((basePrice * multiplier).toPrecision(10));
}

export type RawPricing =
  | Omit<LLMPricing, 'summary'>
  | Omit<VideoPerSecondPricing, 'summary'>
  | Omit<ImagePricing, 'summary'>
  | Omit<TTSPricing, 'summary'>
  | Omit<ASRPricing, 'summary'>
  | Omit<EmbeddingPricing, 'summary'>
  | Omit<ItemizedPricing, 'summary'>;

export function minPositive(values: Array<number | null | undefined>): number {
  let best = Infinity;
  for (const v of values) {
    if (v != null && v > 0 && v < best) best = v;
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * Compute the normalized PricingSummary for a raw pricing variant. Lets Agents
 * sort/compare across token-billed and unit-billed models without branching on
 * the underlying shape.
 */
export function computePricingSummary(p: RawPricing): PricingSummary {
  if ('tiers' in p) {
    if (p.tiers.length === 0) {
      return { cheapest_input: 0, cheapest_output: 0, unit: '—', billing_type: 'no_pricing' };
    }
    if (p.tiers.length > 0 && p.tiers.every((t) => t.input === 0 && t.output === 0)) {
      return { cheapest_input: 0, cheapest_output: 0, unit: p.tiers[0].unit, billing_type: 'free' };
    }
    return {
      cheapest_input: minPositive(p.tiers.map((t) => t.input)),
      cheapest_output: minPositive(p.tiers.map((t) => t.output)),
      unit: p.tiers[0].unit,
      billing_type: 'token',
    };
  }
  if ('per_token' in p) {
    return {
      cheapest_input: p.per_token.price,
      cheapest_output: 0,
      unit: p.per_token.unit,
      billing_type: 'token',
    };
  }
  if ('per_image_tiers' in p && p.per_image_tiers && p.per_image_tiers.length > 0) {
    return {
      cheapest_input: 0,
      cheapest_output: minPositive(p.per_image_tiers.map((t) => t.price)),
      unit: p.per_image_tiers[0].unit,
      billing_type: 'image',
    };
  }
  if ('per_image' in p) {
    return {
      cheapest_input: 0,
      cheapest_output: p.per_image.price,
      unit: p.per_image.unit,
      billing_type: 'image',
    };
  }
  if ('per_character' in p) {
    return {
      cheapest_input: 0,
      cheapest_output: p.per_character.price,
      unit: p.per_character.unit,
      billing_type: 'character',
    };
  }
  if ('per_second_audio' in p) {
    return {
      cheapest_input: p.per_second_audio.price,
      cheapest_output: 0,
      unit: p.per_second_audio.unit,
      billing_type: 'second',
    };
  }
  if ('per_second' in p) {
    return {
      cheapest_input: 0,
      cheapest_output: minPositive(p.per_second.map((s) => s.price)),
      unit: p.per_second[0]?.unit ?? `${CUR_LABEL}/second`,
      billing_type: 'second',
    };
  }
  if ('items' in p && p.items.length > 0) {
    return {
      cheapest_input: 0,
      cheapest_output: minPositive(p.items.map((i) => i.price)),
      unit: p.items[0].unit,
      billing_type: 'itemized',
    };
  }
  return { cheapest_input: 0, cheapest_output: 0, unit: '', billing_type: 'unknown' };
}

export function attachPricingSummary(raw: RawPricing): Pricing {
  return { ...raw, summary: computePricingSummary(raw) } as Pricing;
}

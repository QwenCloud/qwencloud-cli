import type { ModelDetail, Pricing } from '../../types/model.js';
import { humanizeNumber, humanizeWithUnit, formatAmount } from '../../output/humanize.js';
import { abbreviateModality } from '../../utils/modality.js';
import { CUR } from './shared.js';

// ── Model Detail ViewModel ────────────────────────────────────────────

export interface ModelDetailViewModel {
  // Header
  id: string;
  description: string;
  tags: string; // comma-separated for display

  // Modality
  modalityInput: string; // "Image  Text  Video"
  modalityOutput: string; // "Text"

  // Features
  features: string; // comma-separated or "—"

  // Pricing (rendered lines)
  pricingType: 'llm' | 'video' | 'image' | 'tts' | 'asr' | 'embedding' | 'itemized' | 'no_pricing';
  pricingLines: PricingLineViewModel[];
  builtInTools: BuiltInToolViewModel[];

  // Context (LLM only)
  context?: ContextViewModel;

  // Rate Limits
  rateLimits: string; // "RPM   15K          TPM   5M"

  // Free Tier
  freeTier?: FreeTierSummaryViewModel;

  // Metadata
  metadata: {
    category?: string;
    version: string;
    snapshot?: string;
    openSource: string;
    updated: string;
  };
}

export interface PricingLineViewModel {
  cells: Record<string, string>;
}

export interface BuiltInToolViewModel {
  name: string;
  price: string;
  api: string;
}

export interface ContextViewModel {
  window: string;
  maxInput: string;
  maxOutput: string;
}

export interface FreeTierSummaryViewModel {
  mode: 'standard' | 'only';
  total?: string; // "1M tok" — standard mode with quota
  remaining?: string; // "997.1K tok" — standard mode with quota
  remainingPct?: number; // 99.7
  resetDate?: string; // "2025-06-01" — current cycle end date
  statusLabel?: string; // "(exhaust)" | "(expired)" — non-valid quota status
}

export function buildModelDetailViewModel(detail: ModelDetail): ModelDetailViewModel {
  const pricingType = inferPricingType(detail);
  const pricingLines = buildPricingLines(detail.pricing);

  const vm: ModelDetailViewModel = {
    id: detail.id,
    description: detail.description,
    tags: detail.tags.length > 0 ? detail.tags.join(' · ') : '—',
    modalityInput: detail.modality.input.map(abbreviateModality).join(' · '),
    modalityOutput: detail.modality.output.map(abbreviateModality).join(' · '),
    features: detail.features.length > 0 ? detail.features.join(' · ') : '—',
    pricingType,
    pricingLines,
    builtInTools: buildBuiltInTools(detail.pricing),
    rateLimits: formatRateLimits(detail.rate_limits),
    metadata: {
      category: detail.metadata.category,
      version: detail.metadata.version_tag,
      snapshot: detail.metadata.snapshot,
      openSource: detail.metadata.open_source ? 'Yes' : 'No',
      updated: detail.metadata.updated,
    },
  };

  // Context (LLM only)
  if (detail.context) {
    vm.context = {
      window: humanizeWithUnit(detail.context.context_window, 'tokens'),
      maxInput:
        detail.context.max_input != null
          ? humanizeWithUnit(detail.context.max_input, 'tokens')
          : '—',
      maxOutput:
        detail.context.max_output != null
          ? humanizeWithUnit(detail.context.max_output, 'tokens')
          : '—',
    };
  }

  // Free Tier summary
  if (detail.free_tier.mode === 'standard' && detail.free_tier.quota) {
    const q = detail.free_tier.quota;
    const pct = q.total > 0 ? parseFloat(((q.remaining / q.total) * 100).toFixed(2)) : undefined;
    const statusLabel =
      q.status === 'exhaust' ? '(exhaust)' : q.status === 'expire' ? '(expired)' : undefined;
    vm.freeTier = {
      mode: 'standard',
      total: humanizeWithUnit(q.total, q.unit),
      remaining: humanizeWithUnit(q.remaining, q.unit),
      remainingPct: q.status === 'expire' ? 0 : pct,
      // Display layer wants a compact YYYY-MM-DD; the JSON layer keeps the
      // full ISO timestamp from FreeTierQuota.
      resetDate: q.resetDate ? q.resetDate.slice(0, 10) : undefined,
      statusLabel,
    };
  } else if (detail.free_tier.mode === 'standard') {
    vm.freeTier = { mode: 'standard' };
  } else if (detail.free_tier.mode === 'only') {
    vm.freeTier = { mode: 'only' };
  }

  return vm;
}

// ── Helper Functions ──────────────────────────────────────────────────

function inferPricingType(
  detail: ModelDetail,
): 'llm' | 'video' | 'image' | 'tts' | 'asr' | 'embedding' | 'itemized' | 'no_pricing' {
  const pricing = detail.pricing;
  if (!pricing) return 'llm';

  // Prefer billing_type from pricing summary — 100% accurate for most types
  const billingType = pricing.summary?.billing_type;
  if (billingType) {
    switch (billingType) {
      case 'token':
        // per_token structure = embedding/rerank; tiers structure = LLM
        return 'per_token' in pricing ? 'embedding' : 'llm';
      case 'image':
        return 'image';
      case 'character':
        return 'tts';
      case 'itemized':
        return 'itemized';
      case 'second':
        // Distinguish ASR (per_second_audio) from video (per_second)
        if ('per_second_audio' in pricing) return 'asr';
        return 'video';
      case 'no_pricing':
        // No pricing data available — render as uniform placeholder
        return 'no_pricing';
      // 'free', 'unknown' — fall through to structural inference
    }
  }

  // Fallback: pricing structure detection
  if ('items' in pricing) return 'itemized';
  if ('per_token' in pricing) return 'embedding';
  if ('per_character' in pricing) return 'tts';
  if ('per_second' in pricing) return 'video';
  if ('per_second_audio' in pricing) return 'asr';
  if ('per_image' in pricing) return 'image';
  if ('per_image_tiers' in pricing) return 'image';

  // Fallback: modality-based inference for tiers-based pricing
  // (LLM models all use { tiers: [...] })
  const { input, output } = detail.modality;
  const hasContext = !!detail.context;

  if (output.includes('text') && hasContext) return 'llm';
  if (output.includes('video')) return 'video';
  if (output.includes('image')) return 'image';
  if (input.length === 1 && input[0] === 'text' && output.includes('audio')) return 'tts';
  if (input.includes('audio') && output.length === 1 && output[0] === 'text') return 'asr';
  if (output.includes('vector')) return 'embedding';

  // Default to LLM if output includes text
  if (output.includes('text')) return 'llm';
  return 'llm';
}

function buildPricingLines(pricing: Pricing): PricingLineViewModel[] {
  if ('tiers' in pricing) {
    // Empty tiers means the mapper could not interpret the upstream pricing
    // shape (e.g. non-token MultiPrices). Surface a single em-dash row so the
    // Pricing card retains its tabular structure without falsely advertising
    // a free or zero price.
    if (pricing.tiers.length === 0) {
      return [{ cells: { label: '\u2014', input: '\u2014', output: '\u2014' } }];
    }

    // LLM pricing table
    const hasCache = pricing.tiers.some((t) => t.cache_creation != null);
    return pricing.tiers.map((tier) => {
      const cells: Record<string, string> = {
        label: tier.label,
        input: `${CUR}${formatAmount(tier.input)}/1M`,
        output: `${CUR}${formatAmount(tier.output)}/1M`,
      };
      if (hasCache) {
        cells.cacheCreation =
          tier.cache_creation != null ? `${CUR}${formatAmount(tier.cache_creation)}/1M` : '—';
        cells.cacheRead =
          tier.cache_read != null ? `${CUR}${formatAmount(tier.cache_read)}/1M` : '—';
      }
      return { cells };
    });
  }

  if ('per_second' in pricing) {
    return pricing.per_second.map((p) => ({
      cells: {
        resolution: p.resolution,
        price: `${CUR}${formatAmount(p.price)} / second`,
      },
    }));
  }

  if ('per_image' in pricing) {
    return [
      {
        cells: {
          label: 'Image Generation',
          price: `${CUR}${formatAmount(pricing.per_image.price)} / image`,
        },
      },
    ];
  }

  if ('per_character' in pricing) {
    return [
      {
        cells: {
          label: 'TTS',
          price: `${CUR}${formatAmount(pricing.per_character.price)} / 10,000 characters`,
        },
      },
    ];
  }

  if ('per_second_audio' in pricing) {
    return [
      {
        cells: {
          label: 'ASR',
          price: `${CUR}${formatAmount(pricing.per_second_audio.price)} / second`,
        },
      },
    ];
  }

  if ('per_token' in pricing) {
    return [
      {
        cells: {
          label: 'Embedding',
          price: `${CUR}${formatAmount(pricing.per_token.price)} / 1M tokens`,
        },
      },
    ];
  }

  if ('items' in pricing && pricing.items.length > 0) {
    return pricing.items.map((item) => ({
      cells: {
        label: item.name ?? '\u2014',
        price: item.unit
          ? `${CUR}${formatAmount(typeof item.price === 'number' ? item.price : 0)} / ${item.unit}`
          : `${CUR}${formatAmount(typeof item.price === 'number' ? item.price : 0)}`,
      },
    }));
  }

  return [];
}

function buildBuiltInTools(pricing: Pricing): BuiltInToolViewModel[] {
  if (!('built_in_tools' in pricing) || !pricing.built_in_tools) return [];

  // Deduplicate by tool name — API may return duplicate entries
  const unique = [...new Map(pricing.built_in_tools.map((t) => [t.name, t])).values()];

  return unique.map((tool) => {
    const unitRaw = tool.unit
      .replace(/^[A-Z]{3}\//, '')
      .replace(/^per\s+/i, '')
      .trim();
    const price = tool.price === 0 ? 'Free' : `${CUR}${formatAmount(tool.price)} / ${unitRaw}`;
    return { name: tool.name, price, api: tool.api };
  });
}

function formatRateLimits(rl: {
  rpm: number;
  tpm?: number;
  concurrency?: number;
  async_queue?: number;
}): string {
  const parts = [`RPM   ${humanizeNumber(rl.rpm)}`];
  if (rl.tpm != null) parts.push(`TPM   ${humanizeNumber(rl.tpm)}`);
  if (rl.concurrency != null) parts.push(`Concurrency   ${rl.concurrency}`);
  if (rl.async_queue != null) parts.push(`Async Queue   ${humanizeNumber(rl.async_queue)} tasks`);
  return parts.join('          ');
}

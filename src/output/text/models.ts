/**
 * Text mode renderers for models commands.
 * Pure text output (no ANSI colors, no borders) for --format text.
 * Receives ViewModel as input.
 */

import type { ModelsListViewModel, ModelDetailViewModel } from '../../view-models/models/index.js';
import { formatTextTable } from '../text.js';
import { MODEL_LIST_COLUMNS } from '../../commands/models/shared.js';

// ── Models List Text Renderer ────────────────────────────────────────

export function renderTextModelsList(vm: ModelsListViewModel): void {
  const headers = MODEL_LIST_COLUMNS.map((c) => c.header);
  const rows = vm.rows.map((row) => {
    const r = row as unknown as Record<string, string>;
    return MODEL_LIST_COLUMNS.map((c) => r[c.key] ?? '');
  });

  console.log(formatTextTable(headers, rows));
  console.log(`  ${vm.total} models`);
}

// ── Models Info Text Renderer ────────────────────────────────────────

export function renderTextModelDetail(vm: ModelDetailViewModel): void {
  const lines: string[] = [];

  // Header
  lines.push(`  ${vm.id}`);
  lines.push('');
  lines.push(`  ${vm.description}`);
  if (vm.tags !== '—') {
    lines.push(`  Tags: ${vm.tags}`);
  }
  lines.push('');

  // Modality
  lines.push('  ── Modality ──');
  lines.push(`  Input    ${vm.modalityInput}`);
  lines.push(`  Output   ${vm.modalityOutput}`);
  lines.push('');

  // Features
  lines.push('  ── Features ──');
  lines.push(`  ${vm.features}`);
  lines.push('');

  // Pricing
  lines.push('  ── Pricing ──');
  if (vm.pricingType === 'llm') {
    // LLM pricing table
    const hasCache = vm.pricingLines.some((l) => l.cells.cacheCreation != null);
    const headers = hasCache
      ? ['Context Length', 'Input', 'Output', 'Cache Creation', 'Cache Read']
      : ['Context Length', 'Input', 'Output'];

    const rows = vm.pricingLines.map((l) => {
      const row = [l.cells.label, l.cells.input, l.cells.output];
      if (hasCache) {
        row.push(l.cells.cacheCreation ?? '—', l.cells.cacheRead ?? '—');
      }
      return row;
    });

    lines.push('  ' + formatTextTable(headers, rows, 0).replace(/^ {2}/gm, ''));

    // Built-in tools
    if (vm.builtInTools.length > 0) {
      lines.push('');
      lines.push('  Built-in Tools');
      for (const tool of vm.builtInTools) {
        lines.push(`    ${tool.name.padEnd(20)}${tool.price.padStart(12)}  (${tool.api})`);
      }
    }
  } else if (vm.pricingType === 'video') {
    if (vm.pricingLines.length === 0) {
      lines.push('  \u2014');
    } else if (vm.pricingLines[0].cells.resolution != null) {
      const toolRows = vm.pricingLines.map((l) => [l.cells.resolution, l.cells.price]);
      lines.push(
        '  ' + formatTextTable(['Resolution', 'Price'], toolRows, 0).replace(/^ {2}/gm, ''),
      );
    } else {
      // Fallback: pricing structure doesn't match video format (e.g. free-only model mapped to tiers)
      const firstLine = vm.pricingLines[0];
      lines.push(`  ${firstLine.cells.label ?? '\u2014'}`);
    }
  } else if (vm.pricingType === 'itemized') {
    // Itemized pricing table (generic fallback)
    if (vm.pricingLines.length === 0) {
      lines.push('  \u2014');
    } else {
      const toolRows = vm.pricingLines.map((l) => [l.cells.label, l.cells.price]);
      lines.push('  ' + formatTextTable(['Item', 'Price'], toolRows, 0).replace(/^ {2}/gm, ''));
    }
  } else {
    // Single-line pricing (image, tts, asr, embedding)
    const firstLine = vm.pricingLines[0];
    if (firstLine) {
      const label = firstLine.cells.label ?? '';
      const price = firstLine.cells.price ?? '';
      if (label && price) {
        lines.push(`  ${label}  ${price}`);
      } else {
        lines.push(`  ${label || price || '\u2014'}`);
      }
    }
  }
  lines.push('');

  // Context (LLM only)
  if (vm.context) {
    lines.push('  ── Context ──');
    lines.push(`  Context Window  ${vm.context.window}`);
    lines.push(`  Max Input       ${vm.context.maxInput}`);
    lines.push(`  Max Output      ${vm.context.maxOutput}`);
    lines.push('');
  }

  // Rate Limits
  lines.push('  ── Rate Limits ──');
  lines.push(`  ${vm.rateLimits}`);
  lines.push('');

  // Free Tier
  if (vm.freeTier) {
    lines.push('  ── Free Tier ──');
    if (vm.freeTier.mode === 'only') {
      lines.push('  FreeTier Only');
    } else if (vm.freeTier.remaining !== undefined && vm.freeTier.remainingPct !== undefined) {
      lines.push(
        `  ${vm.freeTier.total ?? '—'}  ·  ${vm.freeTier.remaining} remaining (${vm.freeTier.remainingPct}%)`,
      );
      if (vm.freeTier.resetDate) {
        lines.push(`  Resets: ${vm.freeTier.resetDate}`);
      }
    } else {
      lines.push('  Quota data unavailable');
    }
    lines.push('');
  }

  // Metadata
  lines.push('  ── Metadata ──');
  lines.push(
    `  Version    ${vm.metadata.version}    Open Source  ${vm.metadata.openSource}    Updated  ${vm.metadata.updated}`,
  );
  lines.push('');

  console.log(lines.join('\n'));
}

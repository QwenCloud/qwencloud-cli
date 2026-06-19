import React from 'react';
import { Text } from 'ink';
import { Card, CardLine, Section as CardSection } from './Card.js';
import { theme, colors, buildProgressBar } from './theme.js';
import { wrapTextWithIndent, visibleWidth } from './textWrap.js';
import { renderWithInk } from './render.js';
import { useTerminalSize } from './useTerminalSize.js';
import type {
  ModelDetailViewModel,
  PricingLineViewModel,
  BuiltInToolViewModel,
} from '../view-models/models/index.js';

export interface ModelInfoInkProps {
  vm: ModelDetailViewModel;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Column divider for inline tables — dark purple ` │ ` (matches Table.tsx) */
const COL_DIV = theme.border(' │ ');

/** Pad a chalk-colored string to a visual width. */
function padColored(s: string, w: number): string {
  const visual = visibleWidth(s);
  return s + ' '.repeat(Math.max(0, w - visual));
}

/** Build a separator row: col widths joined with ─┼─, padded with ─ to innerWidth. */
function buildSep(colWidths: number[], innerWidth: number): string {
  const raw = colWidths
    .map((w) => '─'.repeat(w))
    .join('─┼─')
    .padEnd(innerWidth, '─');
  return theme.border(raw);
}

/** Build a mini progress bar string (detail card uses wider bar). */
const progressBar = (pct: number) => buildProgressBar(pct, 22);

/** Build a key-value label string: muted label padded + plain value. */
function kv(label: string, value: string, labelWidth: number): string {
  return theme.label(label.padEnd(labelWidth)) + value;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * Ink React component for model detail display.
 * Consumes ModelDetailViewModel — pure presentation, no API/data logic.
 */
export function ModelInfoInk({ vm }: ModelInfoInkProps) {
  const paddingLeft = 2;
  const { columns } = useTerminalSize();
  const terminalWidth = Math.max(20, columns);
  const w = Math.max(20, Math.min(terminalWidth - paddingLeft, 80));
  const innerWidth = Math.max(0, w - 6);

  return (
    <Card title={vm.id} width={w}>
      {/* Metadata — first section, its ├──┤ serves as card title separator */}
      <CardSection title="Metadata" width={w}>
        {vm.metadata.category && (
          <CardLine width={w}>
            <Text>{kv('Category', vm.metadata.category, 13)}</Text>
          </CardLine>
        )}
        <CardLine width={w}>
          <Text>{kv('Version', vm.metadata.version, 13)}</Text>
        </CardLine>
        {vm.metadata.snapshot && (
          <CardLine width={w}>
            <Text>{kv('Snapshot', vm.metadata.snapshot, 13)}</Text>
          </CardLine>
        )}
        <CardLine width={w}>
          <Text>{kv('Open Source', vm.metadata.openSource, 13)}</Text>
        </CardLine>
        <CardLine width={w}>
          <Text>{kv('Updated', vm.metadata.updated, 13)}</Text>
        </CardLine>
      </CardSection>

      {/* Description */}
      <CardSection title="Description" width={w}>
        <CardLine width={w} lines={wrapTextWithIndent(vm.description, innerWidth)} />
      </CardSection>

      {/* Tags */}
      {vm.tags !== '—' && (
        <CardSection title="Tags" width={w}>
          <CardLine width={w}>
            <Text>{vm.tags}</Text>
          </CardLine>
        </CardSection>
      )}

      {/* Modality */}
      <CardSection title="Modality" width={w}>
        <CardLine width={w}>
          <Text>{kv('Input', vm.modalityInput, 8)}</Text>
        </CardLine>
        <CardLine width={w}>
          <Text>{kv('Output', vm.modalityOutput, 8)}</Text>
        </CardLine>
      </CardSection>

      {/* Features */}
      <CardSection title="Features" width={w}>
        <CardLine width={w} lines={wrapTextWithIndent(vm.features, innerWidth)} />
      </CardSection>

      {/* Pricing */}
      <CardSection title="Pricing" width={w}>
        <PricingContent
          pricingType={vm.pricingType}
          pricingLines={vm.pricingLines}
          builtInTools={vm.builtInTools}
          width={w}
        />
      </CardSection>

      {/* Context (LLM only) */}
      {vm.context && (
        <CardSection title="Context" width={w}>
          <CardLine width={w}>
            <Text>{kv('Window', vm.context.window, 12)}</Text>
          </CardLine>
          <CardLine width={w}>
            <Text>{kv('Max Input', vm.context.maxInput, 12)}</Text>
          </CardLine>
          <CardLine width={w}>
            <Text>{kv('Max Output', vm.context.maxOutput, 12)}</Text>
          </CardLine>
        </CardSection>
      )}

      {/* Rate Limits */}
      <CardSection title="Rate Limits" width={w}>
        <CardLine width={w}>
          <Text>{vm.rateLimits}</Text>
        </CardLine>
      </CardSection>

      {/* Free Tier */}
      {vm.freeTier && (
        <CardSection title="Free Tier" width={w}>
          <FreeTierContent vm={vm} width={w} />
        </CardSection>
      )}
    </Card>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FreeTierContent({ vm, width }: { vm: ModelDetailViewModel; width: number }) {
  const ft = vm.freeTier!;

  if (ft.mode === 'only') {
    return (
      <CardLine width={width}>
        <Text>{theme.success('FreeTier Only')}</Text>
      </CardLine>
    );
  }

  if (
    ft.mode === 'standard' &&
    ft.total &&
    ft.remaining !== undefined &&
    ft.remainingPct !== undefined
  ) {
    const bar = progressBar(ft.remainingPct);
    const pctStr = ft.statusLabel ?? `${parseFloat(ft.remainingPct.toFixed(2))}%`;
    return (
      <>
        <CardLine width={width}>
          <Text>{kv('Total', ft.total, 12)}</Text>
        </CardLine>
        <CardLine width={width}>
          <Text>{kv('Remaining', ft.remaining, 12) + '  ' + bar + '  ' + pctStr}</Text>
        </CardLine>
        {ft.resetDate && (
          <CardLine width={width}>
            <Text>{kv('Resets', ft.resetDate, 12)}</Text>
          </CardLine>
        )}
      </>
    );
  }

  // mode=standard but no quota data yet
  return (
    <CardLine width={width}>
      <Text>{theme.muted('Quota data unavailable')}</Text>
    </CardLine>
  );
}

function PricingContent({
  pricingType,
  pricingLines,
  builtInTools,
  width,
}: {
  pricingType: ModelDetailViewModel['pricingType'];
  pricingLines: PricingLineViewModel[];
  builtInTools: BuiltInToolViewModel[];
  width: number;
}) {
  // no_pricing: uniform single-line placeholder regardless of modality
  if (pricingType === 'no_pricing' || pricingLines.length === 0) {
    return (
      <CardLine width={width}>
        <Text>{theme.muted('\u2014')}</Text>
      </CardLine>
    );
  }
  if (pricingType === 'llm') {
    return <LlmPricing pricingLines={pricingLines} builtInTools={builtInTools} width={width} />;
  }
  if (pricingType === 'video') {
    return <VideoPricing pricingLines={pricingLines} width={width} />;
  }
  if (pricingType === 'itemized') {
    return <ItemizedPricing pricingLines={pricingLines} width={width} />;
  }
  // image, tts, asr, embedding — render all pricing lines
  return (
    <>
      {pricingLines.map((line, i) => {
        const label = line.cells.label ? line.cells.label + '  ' : '';
        const price = line.cells.price ?? '';
        return (
          <CardLine key={i} width={width}>
            <Text>
              {theme.muted(label)}
              {theme.accent(price)}
            </Text>
          </CardLine>
        );
      })}
    </>
  );
}

function LlmPricing({
  pricingLines,
  builtInTools,
  width,
}: {
  pricingLines: PricingLineViewModel[];
  builtInTools: BuiltInToolViewModel[];
  width: number;
}) {
  if (pricingLines.length === 0) {
    return (
      <CardLine width={width}>
        <Text>{theme.muted('\u2014')}</Text>
      </CardLine>
    );
  }

  const innerWidth = Math.max(0, width - 6);
  const hasCache = pricingLines.some((l) => l.cells.cacheCreation != null);

  // Column widths (content only — separators ` │ ` are added between)
  const COL_TIER = Math.max(4, ...pricingLines.map((l) => (l.cells.label ?? '').length));
  const COL_IN = Math.max(5, ...pricingLines.map((l) => (l.cells.input ?? '').length));
  const COL_OUT = Math.max(6, ...pricingLines.map((l) => (l.cells.output ?? '').length));
  const COL_CC = hasCache
    ? Math.max(11, ...pricingLines.map((l) => (l.cells.cacheCreation ?? '—').length))
    : 0;
  const COL_CR = hasCache
    ? Math.max(10, ...pricingLines.map((l) => (l.cells.cacheRead ?? '—').length))
    : 0;
  const priceCols = hasCache
    ? [COL_TIER, COL_IN, COL_OUT, COL_CC, COL_CR]
    : [COL_TIER, COL_IN, COL_OUT];

  // Header: plain ` │ ` separators (bg color covers them all)
  const hParts = hasCache
    ? [
        'Tier'.padEnd(COL_TIER),
        'Input'.padEnd(COL_IN),
        'Output'.padEnd(COL_OUT),
        'Cache Write'.padEnd(COL_CC),
        'Cache Read'.padEnd(COL_CR),
      ]
    : ['Tier'.padEnd(COL_TIER), 'Input'.padEnd(COL_IN), 'Output'.padEnd(COL_OUT)];
  const headerStr = hParts.join(' │ ').padEnd(innerWidth);

  // Row builder: COL_DIV (dark purple ` │ `) between cells
  function buildRow(line: PricingLineViewModel): string {
    const parts = hasCache
      ? [
          (line.cells.label ?? '—').padEnd(COL_TIER),
          padColored(theme.accent(line.cells.input ?? '—'), COL_IN),
          padColored(theme.accent(line.cells.output ?? '—'), COL_OUT),
          padColored(theme.accent(line.cells.cacheCreation ?? '—'), COL_CC),
          theme.accent(line.cells.cacheRead ?? '—'),
        ]
      : [
          (line.cells.label ?? '—').padEnd(COL_TIER),
          padColored(theme.accent(line.cells.input ?? '—'), COL_IN),
          theme.accent(line.cells.output ?? '—'),
        ];
    return parts.join(COL_DIV);
  }

  const nodes: React.ReactNode[] = [
    <CardLine key="price-hdr" width={width}>
      <Text bold color={theme.tableHeader.fg} backgroundColor={theme.tableHeader.bg}>
        {headerStr}
      </Text>
    </CardLine>,
    <CardLine key="price-sep" width={width}>
      <Text>{buildSep(priceCols, innerWidth)}</Text>
    </CardLine>,
    ...pricingLines.map((line, i) => (
      <CardLine key={`price-${i}`} width={width}>
        <Text>{buildRow(line)}</Text>
      </CardLine>
    )),
  ];

  // Built-in Tools
  if (builtInTools.length > 0) {
    const COL_TNAME = Math.max(4, ...builtInTools.map((t) => t.name.length));
    const COL_TPRICE = Math.max(5, ...builtInTools.map((t) => t.price.length));
    const COL_TAPI = Math.max(3, ...builtInTools.map((t) => t.api.length));

    const toolHeaderStr = [
      'Name'.padEnd(COL_TNAME),
      'Price'.padEnd(COL_TPRICE),
      'API'.padEnd(COL_TAPI),
    ]
      .join(' │ ')
      .padEnd(innerWidth);

    nodes.push(
      <CardLine key="tools-spacer" width={width}>
        <Text>{''}</Text>
      </CardLine>,
      <CardLine key="tools-label" width={width}>
        <Text bold color={colors.brand}>
          {'Built-in Tools'.padEnd(innerWidth)}
        </Text>
      </CardLine>,
      <CardLine key="tools-hdr" width={width}>
        <Text bold color={theme.tableHeader.fg} backgroundColor={theme.tableHeader.bg}>
          {toolHeaderStr}
        </Text>
      </CardLine>,
      <CardLine key="tools-sep" width={width}>
        <Text>{buildSep([COL_TNAME, COL_TPRICE, COL_TAPI], innerWidth)}</Text>
      </CardLine>,
    );

    builtInTools.forEach((tool) => {
      const priceStr = tool.price === 'Free' ? theme.success(tool.price) : theme.accent(tool.price);
      const parts = [
        tool.name.padEnd(COL_TNAME),
        padColored(priceStr, COL_TPRICE),
        theme.muted(tool.api),
      ];
      nodes.push(
        <CardLine key={`tool-${tool.name}`} width={width}>
          <Text>{parts.join(COL_DIV)}</Text>
        </CardLine>,
      );
    });
  }

  return <>{nodes}</>;
}

function VideoPricing({
  pricingLines,
  width,
}: {
  pricingLines: PricingLineViewModel[];
  width: number;
}) {
  const innerWidth = Math.max(0, width - 6);

  // Defensive: when tiers are empty the mapper returns LLM-style em-dash rows
  // that lack `resolution`/`price`.  Fall back to a plain dash.
  if (pricingLines.length === 0 || pricingLines[0].cells.resolution == null) {
    const fallback = pricingLines[0]?.cells.label ?? '\u2014';
    return (
      <CardLine width={width}>
        <Text>{theme.muted(fallback)}</Text>
      </CardLine>
    );
  }

  const COL_RES = Math.max(10, ...pricingLines.map((l) => l.cells.resolution.length));
  const COL_PRICE = Math.max(5, ...pricingLines.map((l) => l.cells.price.length));

  const headerStr = ['Resolution'.padEnd(COL_RES), 'Price'.padEnd(COL_PRICE)]
    .join(' │ ')
    .padEnd(innerWidth);

  return (
    <>
      <CardLine width={width}>
        <Text bold color={theme.tableHeader.fg} backgroundColor={theme.tableHeader.bg}>
          {headerStr}
        </Text>
      </CardLine>
      <CardLine width={width}>
        <Text>{buildSep([COL_RES, COL_PRICE], innerWidth)}</Text>
      </CardLine>
      {pricingLines.map((line, i) => (
        <CardLine key={`price-${i}`} width={width}>
          <Text>
            {[line.cells.resolution.padEnd(COL_RES), theme.accent(line.cells.price)].join(COL_DIV)}
          </Text>
        </CardLine>
      ))}
    </>
  );
}

function ItemizedPricing({
  pricingLines,
  width,
}: {
  pricingLines: PricingLineViewModel[];
  width: number;
}) {
  const innerWidth = Math.max(0, width - 6);

  if (pricingLines.length === 0) {
    return (
      <CardLine width={width}>
        <Text>{theme.muted('\u2014')}</Text>
      </CardLine>
    );
  }

  const COL_ITEM = Math.max(4, ...pricingLines.map((l) => visibleWidth(l.cells.label ?? '')));
  const COL_PRICE = Math.max(5, ...pricingLines.map((l) => visibleWidth(l.cells.price ?? '')));

  const headerStr = ['Item'.padEnd(COL_ITEM), 'Price'.padEnd(COL_PRICE)]
    .join(' │ ')
    .padEnd(innerWidth);

  return (
    <>
      <CardLine width={width}>
        <Text bold color={theme.tableHeader.fg} backgroundColor={theme.tableHeader.bg}>
          {headerStr}
        </Text>
      </CardLine>
      <CardLine width={width}>
        <Text>{buildSep([COL_ITEM, COL_PRICE], innerWidth)}</Text>
      </CardLine>
      {pricingLines.map((line, i) => (
        <CardLine key={`price-${i}`} width={width}>
          <Text>
            {[
              padColored(line.cells.label ?? '\u2014', COL_ITEM),
              theme.accent(line.cells.price ?? '\u2014'),
            ].join(COL_DIV)}
          </Text>
        </CardLine>
      ))}
    </>
  );
}

/**
 * Render model info via Ink.
 * Used by non-interactive mode as a drop-in replacement.
 */
export async function renderModelInfoInk(vm: ModelDetailViewModel): Promise<void> {
  await renderWithInk(<ModelInfoInk vm={vm} />);
}

import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { theme } from './theme.js';
import { visibleWidth, truncateByDisplayWidth } from './textWrap.js';

export interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right';
  color?: (value: string) => string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
}

export interface TableProps {
  columns: Column[];
  data: Record<string, string>[];
  footer?: Record<string, string>;
  rowColor?: (row: Record<string, string>, index: number) => ((text: string) => string) | undefined;
  paddingLeft?: number;
  /**
   * Truncate each row to the terminal width instead of letting the terminal
   * wrap it. Keeps physical line count equal to logical line count, which is
   * required for correct frame erasure during interactive (redrawn) rendering.
   */
  truncate?: boolean;
  /** Limit cells and dividers to the available display width. */
  maxTotalWidth?: number;
}

/** Pad a pre-colored string to a fixed visual width. */
function padCell(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const visualLen = visibleWidth(value);
  const padding = Math.max(0, width - visualLen);
  return align === 'right' ? ' '.repeat(padding) + value : value + ' '.repeat(padding);
}

// ─── Column divider style ─────────────────────────────────────────────────────
// Divider between cells: a dim purple │ with 1-space padding on each side.
// Using chalk directly (not Ink color prop) so it can be embedded in Text strings
// alongside per-cell colors without requiring nested Text elements.
const DIV = theme.border(' │ '); // data rows
const DIV_SEP = '─┼─'; // separator row (drawn in border color)
const MIN_SHRINK_WIDTH = 5;

export function Table({
  columns,
  data,
  footer,
  rowColor,
  paddingLeft = 2,
  truncate = false,
  maxTotalWidth,
}: TableProps) {
  const wrap = truncate || maxTotalWidth != null ? 'truncate-end' : undefined;
  // ── 1. Calculate fixed column widths ────────────────────────────────────────
  const colWidths = columns.map((col) => {
    const headerLen = visibleWidth(col.header);
    const dataMax = data.reduce((max, row) => Math.max(max, visibleWidth(row[col.key] ?? '')), 0);
    const footerLen = footer ? visibleWidth(footer[col.key] ?? '') : 0;
    let w = Math.max(headerLen, dataMax, footerLen);
    if (col.minWidth != null) w = Math.max(w, col.minWidth);
    if (col.maxWidth != null) w = Math.min(w, col.maxWidth);
    if (col.width != null) w = col.width;
    return w;
  });

  if (maxTotalWidth != null) {
    const overhead = paddingLeft + (columns.length - 1) * 3 + 1; // dividers + header trailing space
    let excess = colWidths.reduce((sum, w) => sum + w, 0) + overhead - maxTotalWidth;
    while (excess > 0) {
      let widest = -1;
      for (let i = 0; i < colWidths.length; i++) {
        if (
          colWidths[i] > MIN_SHRINK_WIDTH &&
          (widest === -1 || colWidths[i] > colWidths[widest])
        ) {
          widest = i;
        }
      }
      if (widest === -1) break; // all columns at floor — the truncate wrap is the backstop
      colWidths[widest] -= 1;
      excess -= 1;
    }
  }

  // ── 2. Build reusable separator string ──────────────────────────────────────
  // Format: ─────────┼─────── (aligns with cell content + ` │ ` dividers)
  const separatorRaw = colWidths
    .map((w, i) => '─'.repeat(w) + (i < colWidths.length - 1 ? DIV_SEP : ''))
    .join('');
  const separator = theme.border(separatorRaw);

  // ── 3. Build header string (single string so bg color is continuous) ────────
  const headerContent = colWidths
    .map((w, i) => {
      const padded = padCell(truncateByDisplayWidth(columns[i].header, w), w, columns[i].align);
      return i < colWidths.length - 1 ? padded + ' │ ' : padded;
    })
    .join('');
  // Wrap with 1-space trailing padding so bg color extends past the last cell
  const headerStr = headerContent + ' ';

  // ── 4. Render a data / footer row as a single concatenated string ──────────
  // Rationale: Ink's Yoga flexbox measures each <Text> child independently by
  // character count, which diverges from the terminal's actual CJK column
  // width — causing `│` dividers to drift on rows containing fullwidth chars.
  // Building the row as one string and rendering via a single <Text> bypasses
  // Yoga's per-cell measurement and lets the terminal align via the spaces
  // we have already padded using visibleWidth.
  const renderRow = (row: Record<string, string>, isFooter = false, rowIndex = 0): string => {
    const rowColorFn = isFooter ? undefined : rowColor?.(row, rowIndex);

    const cells = columns.map((col, i) => {
      const raw = truncateByDisplayWidth(row[col.key] ?? '', colWidths[i]);
      const padded = padCell(raw, colWidths[i], col.align);

      if (isFooter) return chalk.bold(padded);
      if (rowColorFn) return rowColorFn(padded);
      if (col.color) return col.color(padded);
      return padded;
    });

    return cells.join(DIV);
  };

  return (
    <Box flexDirection="column" paddingLeft={paddingLeft} width={maxTotalWidth}>
      {/* ── Header row with bg color ── */}
      <Box>
        <Text bold color={theme.tableHeader.fg} backgroundColor={theme.tableHeader.bg} wrap={wrap}>
          {headerStr}
        </Text>
      </Box>

      {/* ── Separator (─┼─ pattern, brand dark purple) ── */}
      <Text wrap={wrap}>{separator}</Text>

      {/* ── Data rows (single <Text> per row to avoid Yoga CJK mismeasure) ── */}
      {data.map((row, rowIndex) => (
        <Text key={rowIndex} wrap={wrap}>
          {renderRow(row, false, rowIndex)}
        </Text>
      ))}

      {/* ── Footer ── */}
      {footer && (
        <>
          <Text wrap={wrap}>{separator}</Text>
          <Text wrap={wrap}>{renderRow(footer, true)}</Text>
        </>
      )}
    </Box>
  );
}

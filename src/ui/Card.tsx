import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { theme } from './theme.js';
import { padEndVisible } from './textWrap.js';

export interface CardProps {
  title: string;
  children: React.ReactNode;
  width?: number;
}

export function Card({ title, children, width = 80 }: CardProps) {
  const safeWidth = Math.max(10, width);
  const innerWidth = safeWidth - 2; // subtract left + right │

  const h = theme.border('─'.repeat(innerWidth));
  const topBorder = theme.border('┌') + h + theme.border('┐');
  const titleContent = padEndVisible(' ' + title, innerWidth);
  const titleLine =
    theme.border('│') +
    chalk.bgHex(theme.tableHeader.bg).hex(theme.tableHeader.fg).bold(titleContent) +
    theme.border('│');
  const bottomBorder = theme.border('└') + h + theme.border('┘');
  const emptyLine = theme.border('│') + ' '.repeat(innerWidth) + theme.border('│');

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text>{topBorder}</Text>
      <Text>{titleLine}</Text>
      <Box flexDirection="column">{children}</Box>
      <Text>{emptyLine}</Text>
      <Text>{bottomBorder}</Text>
    </Box>
  );
}

// CardLine: a single line inside a card, wrapped with │ ... │
// Supports a `lines` prop for pre-wrapped multi-line content
export interface CardLineProps {
  children?: React.ReactNode;
  width?: number;
  /** Pre-wrapped lines (for long text that needs multiple bordered lines) */
  lines?: string[];
  /** Apply bold styling to lines (only used when `lines` is provided) */
  boldLine?: boolean;
}

export function CardLine({ children, lines, boldLine, width = 80 }: CardLineProps) {
  const innerWidth = Math.max(0, width - 6);
  const borderChar = theme.border('│');

  // Lines mode: each line rendered as a SINGLE <Text> string containing both
  // border characters and padded content. This bypasses Ink's Yoga layout
  // engine entirely — Yoga mismeasures CJK/emoji/ambiguous-width characters,
  // causing border misalignment. By concatenating into one string we let the
  // terminal itself handle character rendering at exact column positions.
  if (lines && lines.length > 0) {
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => {
          const padded = padEndVisible(line, innerWidth);
          const inner = boldLine ? chalk.bold(padded) : padded;
          return <Text key={i}>{`${borderChar}  ${inner}  ${borderChar}`}</Text>;
        })}
      </Box>
    );
  }

  // Children mode: single line with borders
  return (
    <Box>
      <Text>{`${borderChar}  `}</Text>
      <Box width={innerWidth}>{children}</Box>
      <Text>{`  ${borderChar}`}</Text>
    </Box>
  );
}

// Section divider within a card — brand purple title, blank spacer above
export interface SectionProps {
  title: string;
  children: React.ReactNode;
  width?: number;
}

/**
 * Build the three string segments that make up a Section title line:
 *   `│  ` + paddedTitle + `  │`
 *
 * Exported for tests — pure logic separated from JSX so we can assert visible
 * width without a React renderer. The whitespace MUST live inside string
 * literals (not bare JSX text) to preserve correct border alignment.
 */
export function buildSectionTitleParts(
  title: string,
  width: number,
): { left: string; middle: string; right: string } {
  const safeWidth = Math.max(10, width);
  const innerWidth = Math.max(0, safeWidth - 6); // 3 chars each side (│ + 2 spaces)
  return {
    left: theme.border('│') + '  ',
    middle: padEndVisible(title, innerWidth),
    right: '  ' + theme.border('│'),
  };
}

export function Section({ title, children, width = 80 }: SectionProps) {
  const safeWidth = Math.max(10, width);
  const dividerLine =
    theme.border('├') + theme.border('─'.repeat(safeWidth - 2)) + theme.border('┤');
  const { left, middle, right } = buildSectionTitleParts(title, safeWidth);

  // Render title as single <Text> to bypass Yoga flexbox measurement which
  // diverges from terminal column width for CJK/emoji content.
  const titleLine = left + theme.brand.bold(middle) + right;

  return (
    <Box flexDirection="column">
      {/* Section divider ├──┤ */}
      <Text>{dividerLine}</Text>
      <Text>{titleLine}</Text>
      {children}
    </Box>
  );
}

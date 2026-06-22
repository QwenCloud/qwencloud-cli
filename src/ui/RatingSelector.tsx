import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Section } from './Section.js';
import { colors } from './theme.js';

export interface RatingSelectorProps {
  onSelect: (rating: number) => void;
  onCancel: () => void;
  /** Optional initial highlight index (0-based). Defaults to 4 (5 stars). */
  initialIndex?: number;
}

interface RatingOption {
  rating: number;
  visual: string;
  label: string;
}

const RATING_OPTIONS: RatingOption[] = [
  { rating: 1, visual: '★☆☆☆☆', label: 'Very unsatisfied' },
  { rating: 2, visual: '★★☆☆☆', label: 'Unsatisfied' },
  { rating: 3, visual: '★★★☆☆', label: 'Neutral' },
  { rating: 4, visual: '★★★★☆', label: 'Satisfied' },
  { rating: 5, visual: '★★★★★', label: 'Very satisfied' },
];

/**
 * Vertical radio-style star rating picker. Arrow keys (or j/k) move between
 * the 5 levels; Enter confirms; Esc or Ctrl+C cancels without submitting.
 */
export function RatingSelector({ onSelect, onCancel, initialIndex = 4 }: RatingSelectorProps) {
  const { exit } = useApp();
  const safeInitial = Math.min(Math.max(0, initialIndex), RATING_OPTIONS.length - 1);
  const [selectedIndex, setSelectedIndex] = useState(safeInitial);

  useInput((input, key) => {
    if (input === 'c' && key.ctrl) {
      onCancel();
      exit();
      return;
    }
    if (key.escape) {
      onCancel();
      exit();
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(RATING_OPTIONS.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const option = RATING_OPTIONS[selectedIndex];
      if (!option) return;
      onSelect(option.rating);
      exit();
      return;
    }
  });

  const footer = '↑/↓ Navigate   Enter Select   Esc/Ctrl+C Cancel';

  return (
    <Section
      title="Rate this support experience"
      subtitle="Select a satisfaction level"
      footer={footer}
    >
      <Box flexDirection="column" paddingLeft={2}>
        {RATING_OPTIONS.map((option, idx) => {
          const selected = idx === selectedIndex;
          const marker = selected ? '●' : '○';
          return (
            <Box key={`rate-${option.rating}`}>
              <Text color={selected ? colors.brand : colors.muted}>{`${marker} `}</Text>
              <Text
                color={selected ? colors.headerFg : undefined}
                backgroundColor={selected ? colors.headerBg : undefined}
                bold={selected}
              >
                {`${option.visual}  ${option.label}`}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Section>
  );
}

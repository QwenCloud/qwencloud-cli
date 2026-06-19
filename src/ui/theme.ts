import chalk, { Chalk } from 'chalk';

// Forced-color chalk instance: always emits ANSI escape codes regardless of
// stdout TTY detection. Required for output that may be intercepted by an
// upstream writer (e.g., Commander's configureOutput.writeOut) before
// reaching the terminal — the default chalk instance would silently strip
// styles in that path.
const forcedChalk = new Chalk({ level: 3 });

/** Raw color hex values for Ink <Text color={}> props */
export const colors = {
  brand: '#7C3AED',
  darkPurple: '#4C1D95',
  muted: '#6B7280',
  headerBg: '#6D28D9',
  headerFg: '#FFFFFF',
  success: '#22C55E',
  error: '#EF4444',
  warning: '#F59E0B',
  accent: '#F59E0B',
  codeBg: 'gray',
  codeFg: 'white',
  // Logo art gradient endpoints (deep violet → periwinkle)
  logoGradientFrom: '#8340FF',
  logoGradientTo: '#6073FF',
  // Inline suggestion / ghost text in REPL prompt
  ghost: '#888888',
} as const;

export const theme = {
  // Brand
  brand: chalk.hex('#987BFE'),

  // Semantic colors
  success: chalk.hex('#22C55E'), // green-500
  error: chalk.hex('#EF4444'), // red-500
  warning: chalk.hex('#F59E0B'), // amber-500
  info: chalk.hex('#987BFE'), // brand purple (was blue)
  data: chalk.hex('#A78BFA'), // violet-400 (was cyan)

  // Text hierarchy
  label: chalk.hex('#9CA3AF'), // gray-400
  muted: chalk.hex('#6B7280'), // gray-500
  accent: chalk.hex('#F59E0B'), // amber (pricing emphasis, was magenta)
  highlight: chalk.white.bold,
  border: chalk.hex('#4C1D95'), // violet-900 — dark purple for separators

  // Standard utilities
  dim: chalk.dim,
  bold: chalk.bold,

  // Table header: explicit bg+fg so both dark and light terminals get the same look
  // #6D28D9 (violet-700) bg + white fg → ~7:1 contrast in any terminal theme
  tableHeader: {
    bg: '#987BFE',
    fg: '#FFFFFF',
  },

  // Status symbols
  symbols: {
    pass: '✓',
    fail: '✗',
    warn: '⚠',
    info: 'ℹ',
    arrow: '▸',
    dash: '─',
    dot: '·',
    spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  },

  // Progress bar characters
  bar: {
    filled: '█',
    empty: '░',
  },

  // Inline ghost suggestion shown after the REPL cursor (italic dim gray)
  ghost: chalk.italic.hex('#888888'),

  // Help text styling — applied where output may be captured by Commander
  // before reaching the TTY, so a forced-color chalk instance is used.
  help: {
    sectionTitle: forcedChalk.hex('#987BFE').bold,
    groupTitle: forcedChalk.hex('#A78BFA').bold,
    commandName: forcedChalk.hex('#C4B5FD').bold,
  },

  // Modality type colors — one fixed color per type, high-saturation, non-overlapping
  modalityColors: {
    text: chalk.hex('#C4B5FD'), // violet-300  — on-brand light purple
    image: chalk.hex('#FBB040'), // amber-400   — warm, visual
    video: chalk.hex('#F472B6'), // pink-400    — dynamic / motion
    audio: chalk.hex('#34D399'), // emerald-400 — sound / wave
    embedding: chalk.hex('#60A5FA'), // blue-400    — vector / data
  } as Record<string, (text: string) => string>,
};

/**
 * Build a mini progress bar string.
 * @param pct       Remaining percentage (0–100)
 * @param barWidth  Number of block characters
 * @param colorFn   Override fill color (defaults to 4-stage dynamic color)
 * @param showPct   Append "99.7%" after the bar blocks
 */
// Interpolate between two hex colors, returning a hex string at position t (0–1)
function lerpColor(from: string, to: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(r1 + (r2 - r1) * t)}${hex(g1 + (g2 - g1) * t)}${hex(b1 + (b2 - b1) * t)}`;
}

// Brand gradient: deep violet → light lavender
const GRAD_FROM = '#6D28D9';
const GRAD_TO = '#C4B5FD';

function gradientFilled(count: number): string {
  if (count === 0) return '';
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    return chalk.hex(lerpColor(GRAD_FROM, GRAD_TO, t))(theme.bar.filled);
  }).join('');
}

export function buildProgressBar(
  pct: number,
  barWidth = 10,
  colorFn?: (s: string) => string,
  showPct = false,
): string {
  const filled = Math.round((pct / 100) * barWidth);
  const empty = barWidth - filled;
  // Use gradient when colorFn is theme.data (the brand purple bar), plain color otherwise
  const filledStr =
    colorFn === theme.data
      ? gradientFilled(filled)
      : (colorFn ?? progressColor(pct, 'remaining'))(theme.bar.filled.repeat(filled));
  const bar = filledStr + theme.muted(theme.bar.empty.repeat(empty));
  return showPct ? `${bar} ${parseFloat(pct.toFixed(2))}%` : bar;
}

// Color functions for progress bars
export function progressColor(
  percentage: number,
  mode: 'remaining' | 'used',
): (text: string) => string {
  if (mode === 'remaining') {
    // Free Tier: color by remaining percentage (4 stages)
    if (percentage > 50) return chalk.hex('#22C55E'); // green-500  — plenty left
    if (percentage > 20) return chalk.hex('#84CC16'); // lime-400   — getting lower
    if (percentage > 10) return chalk.hex('#F59E0B'); // amber-500  — running low
    return chalk.hex('#EF4444'); // red-500    — nearly gone
  } else {
    // Coding Plan: color by used percentage (green=low usage, red=high usage)
    if (percentage < 50) return chalk.green;
    if (percentage <= 80) return chalk.yellow;
    return chalk.red;
  }
}

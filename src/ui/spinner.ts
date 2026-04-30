import chalk from 'chalk';
import { theme, colors } from './theme.js';

// Braille dot frames — smooth 10-frame cycle (sourced from theme)
const FRAMES = theme.symbols.spinnerFrames;
const INTERVAL_MS = 80;

// Brand purple spinner, matching CLI theme
const spin = chalk.hex(colors.brand);

/**
 * Run `fn` while showing an animated spinner on stdout.
 * Automatically skips animation in non-TTY or JSON contexts.
 *
 * @param label  Text shown next to the spinner, e.g. "Fetching models"
 * @param fn     Async work to perform
 * @param format Optional resolved format — pass 'json' to suppress output
 */
export async function withSpinner<T>(
  label: string,
  fn: () => Promise<T>,
  format?: string,
): Promise<T> {
  const silent = format === 'json' || !process.stdout.isTTY;

  if (silent) return fn();

  let frame = 0;
  const write = (text: string) => process.stdout.write(text);

  // Draw first frame immediately so there's no blank gap
  write(`\r  ${spin(FRAMES[frame])}  ${label}…`);

  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    write(`\r  ${spin(FRAMES[frame])}  ${label}…`);
  }, INTERVAL_MS);

  try {
    const result = await fn();
    return result;
  } finally {
    clearInterval(timer);
    // Erase the spinner line completely
    write('\r\x1b[K');
  }
}

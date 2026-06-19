/**
 * Vitest setup: patch ink-testing-library Stdin to be compatible with
 * Ink 5.x input handling (readable stream protocol + ref/unref).
 *
 * Problem: Ink 5.x uses 'readable' event + stdin.read() instead of 'data'.
 * Also, useInput registers its listener via useEffect (deferred), so
 * stdin.write() called synchronously after render won't reach the handler.
 *
 * Solution: flush React passive effects before emitting 'readable',
 * ensuring the listener is registered before input is delivered.
 */
import { vi } from 'vitest';
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 30;

// Access Ink's reconciler to flush passive effects
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const reconcilerAbsPath =
  'file://' +
  resolve(
    __dirname,
    'node_modules/.pnpm/ink@5.2.1_@types+react@19.2.14_react@18.3.1/node_modules/ink/build/reconciler.js',
  );
const inkReconciler = (await import(reconcilerAbsPath)) as {
  default: { flushPassiveEffects: () => boolean };
};

vi.mock('ink-testing-library', async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  const originalRender = mod['render'] as (...args: unknown[]) => Record<string, unknown>;

  return {
    ...mod,
    render: (...args: unknown[]) => {
      const inst = originalRender(...args);
      const stdin = inst['stdin'] as Record<string, unknown> & {
        emit: (event: string, ...a: unknown[]) => void;
      };

      // Provide ref/unref for Ink raw mode management
      stdin['ref'] = () => {};
      stdin['unref'] = () => {};

      // Buffer for readable stream protocol
      const buffer: string[] = [];

      // Provide read() for Ink's handleReadable
      stdin['read'] = () => {
        if (buffer.length > 0) {
          return buffer.shift()!;
        }
        return null;
      };

      // Override the instance write to emit 'readable' (Ink 5.x protocol)
      stdin['write'] = (data: string) => {
        buffer.push(data);
        // Flush pending passive effects so useInput's listener is registered
        inkReconciler.default.flushPassiveEffects();
        stdin.emit('readable');
      };

      return inst;
    },
  };
});

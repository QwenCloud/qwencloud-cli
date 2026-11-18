import type { Mock } from 'vitest';

interface PluginIdentity {
  name: string;
  version: string;
}
interface CancellationContext {
  signal?: AbortSignal;
}

export function installedRecord(plugin: PluginIdentity) {
  return { name: plugin.name, version: plugin.version, source: 'npm' as const, enabled: true };
}

export function pendingInstallation(ensure: Mock, abortMessage: string) {
  let context: CancellationContext | undefined;
  let release: (() => void) | undefined;
  ensure.mockImplementationOnce((plugin: PluginIdentity, options?: CancellationContext) => {
    context = options;
    return new Promise((resolve, reject) => {
      release = () => {
        if (options?.signal?.aborted) reject(new Error(abortMessage));
        else resolve(installedRecord(plugin));
      };
    });
  });
  return {
    get signal() {
      return context?.signal;
    },
    release: () => release?.(),
  };
}

export function captureSignalListeners() {
  return new Map(
    (['SIGINT', 'SIGTERM'] as const).map((signal) => [signal, process.listeners(signal)]),
  );
}

export function restoreSignalListeners(
  originals: Map<NodeJS.Signals, ReturnType<typeof process.listeners>>,
): void {
  for (const [signal, original] of originals) {
    for (const listener of process.listeners(signal)) {
      if (!original.includes(listener)) process.removeListener(signal, listener);
    }
  }
}

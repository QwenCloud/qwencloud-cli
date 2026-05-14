import { isPublicKey } from '../../config/schema.js';
import { getConfigValue, getConfigValueWithSource } from '../../config/manager.js';
import { resolveFormat, outputJSON, outputText, outputErrorJSON } from '../../output/format.js';
import { configError } from '../../utils/errors.js';
import { formatCmd } from '../../utils/runtime-mode.js';
import type { ConfigKey, OutputFormat } from '../../types/config.js';

export function configGet(key: string, opts: { format?: string }, parentFormat?: string): void {
  const format = resolveFormat(
    opts.format ?? parentFormat,
    getConfigValue('output.format') as OutputFormat,
  );

  if (!isPublicKey(key)) {
    if (format === 'json') {
      outputErrorJSON(
        configError(
          `Unknown config key '${key}'. Run \`${formatCmd('config list')}\` to see available keys.`,
        ).toJSON(),
      );
    } else {
      console.error(
        `Error: Unknown config key '${key}'. Run \`${formatCmd('config list')}\` to see available keys.`,
      );
    }
    process.exit(1);
  }

  const resolved = getConfigValueWithSource(key as ConfigKey);

  if (format === 'json') {
    outputJSON({
      key,
      value: resolved.value,
      source: resolved.source,
      ...(resolved.sourcePath ? { source_path: resolved.sourcePath } : {}),
    });
    return;
  }

  outputText(resolved.value);
}

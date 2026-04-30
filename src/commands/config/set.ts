import { isPublicKey, validateConfigValue } from '../../config/schema.js';
import { setConfigValue, getConfigValue } from '../../config/manager.js';
import { resolveFormat, outputJSON, outputErrorJSON } from '../../output/format.js';
import { theme } from '../../ui/theme.js';
import type { ConfigKey, OutputFormat } from '../../types/config.js';

export interface ConfigSetOptions {
  format?: string;
}

export function configSet(
  key: string,
  value: string,
  opts: ConfigSetOptions,
  parentFormat?: string,
): void {
  const format = resolveFormat(
    opts.format ?? parentFormat,
    getConfigValue('output.format') as OutputFormat,
  );

  if (!isPublicKey(key)) {
    const msg = `Unknown config key '${key}'. Run \`qwencloud config list\` to see available keys.`;
    if (format === 'json') {
      outputErrorJSON({ error: { code: 'CONFIG_ERROR', message: msg } });
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }

  const validationError = validateConfigValue(key as ConfigKey, value);
  if (validationError) {
    if (format === 'json') {
      outputErrorJSON({ error: { code: 'CONFIG_ERROR', message: validationError } });
    } else {
      console.error(`Error: ${validationError}`);
    }
    process.exit(1);
  }

  setConfigValue(key as ConfigKey, value);

  if (format === 'json') {
    outputJSON({ ok: true, key, value });
  } else {
    console.log(`${theme.success(theme.symbols.pass)}  Set ${key} = ${value}`);
  }
}

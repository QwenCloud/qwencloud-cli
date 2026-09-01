export interface ConfigSchema {
  'output.format': 'auto' | 'table' | 'json' | 'text';
  'api.endpoint': string;
  'auth.endpoint': string; // Auth API base URL
  'cache.ttl': string; // File-cache TTL in milliseconds; '0' disables
  'pricing.precision': 'full' | 'fixed'; // Hidden; controls price display decimal handling
  'model.endpoint': string; // Model-inference base URL or preset name
  'model.api_key': string; // Model-inference API key fallback
}

export type ConfigKey = keyof ConfigSchema;

export type OutputFormat = 'auto' | 'table' | 'json' | 'text';
export type ResolvedFormat = 'table' | 'json' | 'text'; // after auto resolution

export interface ConfigEntry {
  key: ConfigKey;
  value: string;
  source: 'global' | 'default';
  sourcePath?: string;
}

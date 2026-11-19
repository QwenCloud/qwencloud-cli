import { API_ENDPOINT } from './request-adapter.js';
import { site } from '../site.js';
import type { CsDataContext } from '../types/auth.js';
import { CliError } from '../utils/errors.js';

/**
 * Bind the derived session to the active API route.
 * Custom endpoints require their own verified issuer and gateway mapping.
 */
export function defaultCsDataContext(): CsDataContext {
  if (API_ENDPOINT !== site.apiEndpoint.replace(/\/+$/, '')) {
    throw new CliError({
      code: 'CS_DATA_ENDPOINT_UNSUPPORTED',
      message: 'cs-data access is unavailable for the configured API endpoint.',
      exitCode: 4,
    });
  }
  return {
    issuer: `${API_ENDPOINT}/data/v2/api.json`,
    gateway: `${site.csDataEndpoint.replace(/\/+$/, '')}/cli/api.json`,
    environment: 'production',
    region: site.defaults.region,
    site: site.key,
  };
}

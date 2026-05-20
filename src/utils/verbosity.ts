/**
 * Error/diagnostic verbosity — leaf module with no downstream dependencies.
 *
 * Extracted so that debug-buffer.ts (which errors.ts depends on) can also
 * consume getErrorVerbosity() without creating a circular import.
 */

declare const __ERROR_VERBOSITY__: string;

/** Error verbosity levels — controlled via build-time define or env var. */
export type ErrorVerbosity = 'suppress' | 'graceful' | 'verbose';

/**
 * Resolve the current error verbosity.
 * Priority: env var (QWENCLOUD_ERROR_VERBOSITY) > build-time __ERROR_VERBOSITY__ > 'graceful'.
 */
export function getErrorVerbosity(): ErrorVerbosity {
  const envVal = process.env.QWENCLOUD_ERROR_VERBOSITY;
  if (envVal === 'suppress' || envVal === 'graceful' || envVal === 'verbose') return envVal;
  if (typeof __ERROR_VERBOSITY__ !== 'undefined' && __ERROR_VERBOSITY__) {
    return __ERROR_VERBOSITY__ as ErrorVerbosity;
  }
  return 'graceful';
}

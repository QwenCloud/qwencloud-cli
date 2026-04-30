import { homedir } from 'os';
import { join, resolve } from 'path';

const CONFIG_DIR_NAME = '.qwencloud';
const CREDENTIALS_FILE = 'credentials';
const CONFIG_FILE = 'config.json';
const LOCAL_CONFIG_FILE = '.qwencloud.json';
const MIGRATION_STATE_FILE = '.migrated-projects';
const DEVICE_FLOW_PENDING_FILE = '.device-flow-pending';

/**
 * Get the global config directory path (~/.qwencloud).
 */
export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

/**
 * Get the credentials file path (~/.qwencloud/credentials).
 */
export function getCredentialsPath(): string {
  return join(getConfigDir(), CREDENTIALS_FILE);
}

/**
 * Get the global config file path (~/.qwencloud/config.json).
 */
export function getGlobalConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE);
}

/**
 * Path to a legacy project-level config file (.qwencloud.json in cwd).
 * Retained only so the one-time migration can find and merge old files into
 * the global config; it is no longer the active config location.
 */
export function getLocalConfigPath(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), LOCAL_CONFIG_FILE);
}

/**
 * Newline-delimited list of absolute paths whose legacy `.qwencloud.json`
 * has already been merged into the global config.
 */
export function getMigrationStatePath(): string {
  return join(getConfigDir(), MIGRATION_STATE_FILE);
}

/**
 * Path to the device-flow pending state file (~/.qwencloud/.device-flow-pending).
 * Used by --init-only / --complete two-stage login.
 */
export function getDeviceFlowPendingPath(): string {
  return join(getConfigDir(), DEVICE_FLOW_PENDING_FILE);
}

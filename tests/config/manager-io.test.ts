/**
 * Real filesystem IO round-trip tests for config manager.
 *
 * These tests exercise the actual public API of src/config/manager.ts with real
 * file read/write operations. Only the path-resolution module is mocked so that
 * all IO is redirected to an isolated temp directory.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Shared mutable state: mock functions read this at call-time.
const state = vi.hoisted(() => ({ configDir: '' }));

vi.mock('../../src/config/paths.js', () => ({
  getGlobalConfigPath: () => state.configDir + '/config.json',
  getLocalConfigPath: () => '/tmp/__nonexistent_io_test__/.qwencloud.json',
  getMigrationStatePath: () => state.configDir + '/.migrated-projects',
  getConfigDir: () => state.configDir,
}));

import {
  setConfigValue,
  getConfigValue,
  readGlobalConfig,
  unsetConfigValue,
} from '../../src/config/manager.js';

const testRootDir = mkdtempSync(join(tmpdir(), 'config-io-test-'));

afterAll(() => {
  rmSync(testRootDir, { recursive: true, force: true });
});

describe('Config manager — real IO round-trip', () => {
  beforeEach(() => {
    state.configDir = mkdtempSync(join(testRootDir, 'case-'));
    mkdirSync(state.configDir, { recursive: true });
  });

  it('writes a key and reads it back with full fidelity', () => {
    setConfigValue('output.format', 'json');

    const value = getConfigValue('output.format');
    expect(value).toBe('json');
  });

  it('writes multiple keys across different sections', () => {
    setConfigValue('output.format', 'table');
    setConfigValue('api.endpoint', 'https://mock-api.test.qwencloud.com');

    expect(getConfigValue('output.format')).toBe('table');
    expect(getConfigValue('api.endpoint')).toBe('https://mock-api.test.qwencloud.com');
  });

  it('overwrites an existing key preserving other keys in the same section', () => {
    setConfigValue('pricing.precision', 'full');
    setConfigValue('output.format', 'json');
    setConfigValue('output.format', 'text');

    expect(getConfigValue('output.format')).toBe('text');
    expect(getConfigValue('pricing.precision')).toBe('full');
  });

  it('produces valid JSON on disk', () => {
    setConfigValue('api.endpoint', 'https://mock-api.test.qwencloud.com');

    const configPath = state.configDir + '/config.json';
    const raw = readFileSync(configPath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.api.endpoint).toBe('https://mock-api.test.qwencloud.com');
  });

  it('returns empty object for non-existent config file', () => {
    const result = readGlobalConfig();
    expect(result).toEqual({});
  });

  it('returns empty object for corrupted JSON file', () => {
    const configPath = state.configDir + '/config.json';
    writeFileSync(configPath, '{ invalid json content !!!');

    const result = readGlobalConfig();
    expect(result).toEqual({});
  });

  it('returns empty object for empty file', () => {
    const configPath = state.configDir + '/config.json';
    writeFileSync(configPath, '');

    const result = readGlobalConfig();
    expect(result).toEqual({});
  });

  it('ignores non-string values during read', () => {
    const configPath = state.configDir + '/config.json';
    writeFileSync(
      configPath,
      JSON.stringify({
        output: { format: 'json', count: 42, nested: { x: 1 } },
        api: { endpoint: 'https://mock-api.test.qwencloud.com' },
      }),
    );

    const result = readGlobalConfig();
    expect(result['output.format']).toBe('json');
    expect(result['api.endpoint']).toBe('https://mock-api.test.qwencloud.com');
    // Non-string values are silently dropped
    expect((result as Record<string, unknown>)['output.count']).toBeUndefined();
  });

  it('removes a key and cleans up empty sections', () => {
    setConfigValue('output.format', 'json');
    setConfigValue('api.endpoint', 'https://mock-api.test.qwencloud.com');

    unsetConfigValue('output.format');

    const result = readGlobalConfig();
    expect(result['output.format']).toBeUndefined();
    expect(result['api.endpoint']).toBe('https://mock-api.test.qwencloud.com');

    // Verify the output section is fully removed from disk
    const configPath = state.configDir + '/config.json';
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(raw.output).toBeUndefined();
  });

  it('handles unicode values in config file', () => {
    const configPath = state.configDir + '/config.json';
    writeFileSync(
      configPath,
      JSON.stringify({
        api: { endpoint: 'https://mock-api.test.qwencloud.com/测试用户/🚀' },
      }),
    );

    const result = readGlobalConfig();
    expect(result['api.endpoint']).toBe('https://mock-api.test.qwencloud.com/测试用户/🚀');
  });

  it('handles URL values with query params', () => {
    const url = 'https://mock-api.test.qwencloud.com/v1?key=val&foo=bar';
    setConfigValue('api.endpoint', url);

    expect(getConfigValue('api.endpoint')).toBe(url);
  });
});

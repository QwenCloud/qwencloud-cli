import { describe, it, expect } from 'vitest';
import { ALLOWED_PLUGIN_SCOPES, isOfficialPlugin } from '../../src/plugins/allowlist.js';

describe('isOfficialPlugin — exact scope matching for npm installs', () => {
  it('accepts packages within a trusted scope', () => {
    expect(isOfficialPlugin('@qwencloud/qwencloud-plugin-demo')).toBe(true);
    expect(isOfficialPlugin('@qwencloud/plugin-demo')).toBe(true);
    expect(isOfficialPlugin('@qwencloud/a')).toBe(true);
  });

  it('rejects lookalike scopes with similar prefixes', () => {
    expect(isOfficialPlugin('@qwencloudx/pkg')).toBe(false);
    expect(isOfficialPlugin('@qwencloud-evil/pkg')).toBe(false);
    expect(isOfficialPlugin('@qwencloud2/pkg')).toBe(false);
  });

  it('rejects unscoped packages', () => {
    expect(isOfficialPlugin('plugin-demo')).toBe(false);
    expect(isOfficialPlugin('qwencloud-plugin')).toBe(false);
  });

  it('rejects malformed scopes', () => {
    expect(isOfficialPlugin('@qwencloud')).toBe(false);
    expect(isOfficialPlugin('@QWENCLOUD/pkg')).toBe(false);
    expect(isOfficialPlugin('')).toBe(false);
  });

  it('checks only the scope; the installer validates npm package name syntax', () => {
    expect(isOfficialPlugin('@qwencloud/')).toBe(true);
  });

  it('includes the first-party scope in the trusted scopes', () => {
    expect(ALLOWED_PLUGIN_SCOPES).toContain('@qwencloud');
  });
});

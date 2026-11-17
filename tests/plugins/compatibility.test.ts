import { describe, expect, it } from 'vitest';
import {
  comparePluginVersions,
  isCliVersionCompatible,
  resolveMinimumCliVersion,
  resolveHighestCompatiblePluginVersion,
} from '../../src/plugins/compatibility.js';

describe('plugin CLI compatibility', () => {
  it('keeps automatic stable suggestions on stable compatible versions', () => {
    expect(
      resolveHighestCompatiblePluginVersion(
        { '1.1.0': {}, '2.0.0-beta.1': {}, '3.0.0': { qwencloud: { minCliVersion: '99.0.0' } } },
        '1.6.0',
      ),
    ).toBe('1.1.0');
    expect(resolveHighestCompatiblePluginVersion({ '2.0.0-beta.1': {} }, '1.6.0')).toBeUndefined();
  });

  it('allows prereleases only with explicit channel opt-in', () => {
    expect(
      resolveHighestCompatiblePluginVersion(
        { '1.1.0': {}, '2.0.0-beta.1': {} },
        '1.6.0',
        undefined,
        true,
      ),
    ).toBe('2.0.0-beta.1');
  });
  it('uses SemVer prerelease precedence', () => {
    expect(comparePluginVersions('1.8.1-alpha.2', '1.8.1')).toBeLessThan(0);
    expect(comparePluginVersions('1.8.1', '1.8.1-alpha.2')).toBeGreaterThan(0);
    expect(comparePluginVersions('1.8.1+build.2', '1.8.1+build.1')).toBe(0);
    expect(comparePluginVersions('9007199254740993.0.0', '9007199254740992.0.0')).toBeGreaterThan(
      0,
    );
  });

  it('accepts an equal minimum and rejects a higher minimum', () => {
    expect(isCliVersionCompatible('1.8.1', '1.8.1')).toBe(true);
    expect(isCliVersionCompatible('1.8.0', '1.8.1')).toBe(false);
  });

  it('prefers an explicit minimum and recognizes both CLI package names', () => {
    expect(
      resolveMinimumCliVersion({
        qwencloud: { minCliVersion: '2.0.0' },
        engines: { '@qwencloud/qwencloud-cli': '>=1.0.0' },
      }),
    ).toBe('2.0.0');
    expect(resolveMinimumCliVersion({ engines: { '@qwencloud/qwencloud-cli': '^1.8.1' } })).toBe('1.8.1');
    expect(
      resolveMinimumCliVersion({ peerDependencies: { '@qwencloud/qwencloud-cli': '~1.7.0' } }),
    ).toBe('1.7.0');
  });
});

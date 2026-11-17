import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { expandHomePath, isHomePath } from '../../src/utils/expand-home.js';
import { isLocalPluginPath } from '../../src/plugins/default-install.js';

const home = vi.hoisted(() => ({ read: vi.fn<() => string>() }));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, homedir: home.read, default: { ...actual, homedir: home.read } };
});

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const fixtureHome = resolve('.local-test-tmp', 'home-expansion-fixture');

beforeEach(() => {
  home.read.mockReset().mockReturnValue(fixtureHome);
});
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.restoreAllMocks();
});

describe.each(['linux', 'win32'] as const)('home paths on %s', (platform) => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
  });

  it.each(['~', '~/fixture'])('classifies %s without reading the home directory', (input) => {
    expect(isHomePath(input)).toBe(true);
    expect(isLocalPluginPath(input)).toBe(true);
    expect(home.read).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '~other',
    '~other/fixture',
    '$HOME/fixture',
    'part~name',
    'plain',
    '@qwencloud/pkg@1.0',
  ])('preserves the literal input %j', (input) => {
    expect(isHomePath(input)).toBe(false);
    expect(expandHomePath(input)).toBe(input);
    expect(home.read).not.toHaveBeenCalled();
  });

  it('expands the current home and a child path', () => {
    expect(expandHomePath('~')).toBe(fixtureHome);
    expect(expandHomePath('~/fixture')).toBe(join(fixtureHome, 'fixture'));
    expect(home.read).toHaveBeenCalledTimes(2);
  });

  it('uses the platform contract for a backslash after the tilde', () => {
    expect(isHomePath('~\\fixture')).toBe(platform === 'win32');
    expect(isLocalPluginPath('~\\fixture')).toBe(platform === 'win32');
    expect(home.read).not.toHaveBeenCalled();
    expect(expandHomePath('~\\fixture')).toBe(
      platform === 'win32' ? join(fixtureHome, 'fixture') : '~\\fixture',
    );
    expect(home.read).toHaveBeenCalledTimes(platform === 'win32' ? 1 : 0);
  });

  it.each([
    ['./fixture', true],
    ['../fixture', true],
    ['/fixture', true],
    ['fixture', false],
    ['@qwencloud/fixture', false],
    ['@qwencloud/fixture@1.0.0', false],
    ['fixture@latest', false],
  ] as const)('preserves local classification of %s', (input, expected) => {
    expect(isLocalPluginPath(input)).toBe(expected);
    expect(home.read).not.toHaveBeenCalled();
  });
});

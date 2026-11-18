/**
 * Tests for `.npmrc`-aware registry resolution: default fallback, global
 * `registry=`, scope-specific `@scope:registry=` precedence, project isolation,
 * `_authToken` matching (longest-prefix wins, host-relative key), and
 * `${ENV}` expansion.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { resolveRegistryForPackage } from '../../src/plugins/npm-registry.js';

const dirs = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const homedir = () => dirs.home;
  return { ...actual, homedir, default: { ...actual, homedir } };
});

describe('resolveRegistryForPackage', () => {
  let home: string;
  let project: string;

  beforeEach(() => {
    const root = mkdtempSync(path.join(process.cwd(), '.qwencloud-npmrc-'));
    home = path.join(root, 'home');
    dirs.home = home;
    project = path.join(root, 'project');
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(project);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(path.dirname(home), { recursive: true, force: true });
  });

  it('falls back to the public registry when .npmrc is absent', () => {
    expect(resolveRegistryForPackage('foo', home).registry).toBe('https://registry.npmjs.org/');
  });

  it('uses the global registry and adds a trailing slash', () => {
    writeFileSync(path.join(home, '.npmrc'), 'registry=https://custom.test.qwencloud.com', 'utf8');
    expect(resolveRegistryForPackage('foo', home).registry).toBe(
      'https://custom.test.qwencloud.com/',
    );
  });

  it('lets @scope:registry override the global registry for that scope', () => {
    writeFileSync(
      path.join(home, '.npmrc'),
      [
        'registry=https://global.test.qwencloud.com/',
        '@qwencloud:registry=https://anpm.test.qwencloud.com/',
      ].join('\n'),
      'utf8',
    );
    expect(resolveRegistryForPackage('@qwencloud/pkg', home).registry).toBe(
      'https://anpm.test.qwencloud.com/',
    );
    expect(resolveRegistryForPackage('plain', home).registry).toBe(
      'https://global.test.qwencloud.com/',
    );
  });

  it('does not let the project .npmrc override the home .npmrc', () => {
    writeFileSync(path.join(home, '.npmrc'), 'registry=https://home.test.qwencloud.com/', 'utf8');
    writeFileSync(
      path.join(project, '.npmrc'),
      'registry=https://project.test.qwencloud.com/',
      'utf8',
    );
    expect(resolveRegistryForPackage('foo').registry).toBe('https://home.test.qwencloud.com/');
  });

  it.each(['@qwencloud'])('ignores project scope/global registries and tokens for %s', (scope) => {
    writeFileSync(
      path.join(home, '.npmrc'),
      [
        'registry=https://global.test.qwencloud.com/',
        `${scope}:registry=https://registry.test.qwencloud.com/team/`,
        '//registry.test.qwencloud.com/:_authToken=mock-host-token',
        '//registry.test.qwencloud.com/team/:_authToken=mock-user-token',
      ].join('\n'),
    );
    writeFileSync(
      path.join(project, '.npmrc'),
      [
        'registry=https://project.test.qwencloud.com/',
        `${scope}:registry=https://project.test.qwencloud.com/`,
        '//registry.test.qwencloud.com/team/:_authToken=mock-project-token',
      ].join('\n'),
    );

    expect(resolveRegistryForPackage(`${scope}/plugin`)).toEqual({
      registry: 'https://registry.test.qwencloud.com/team/',
      authToken: 'mock-user-token',
    });
  });

  it.each(['@qwencloud'])(
    'ignores project registries and tokens for %s without user configuration',
    (scope) => {
      writeFileSync(
        path.join(project, '.npmrc'),
        [
          'registry=https://project.test.qwencloud.com/',
          `${scope}:registry=https://project.test.qwencloud.com/`,
          '//project.test.qwencloud.com/:_authToken=mock-project-token',
        ].join('\n'),
      );
      const result = resolveRegistryForPackage(`${scope}/plugin`);
      expect(result.registry).toBe('https://registry.npmjs.org/');
      expect(result.authToken).toBeUndefined();
    },
  );

  it('does not let project configuration inject tokens for a user registry', () => {
    writeFileSync(path.join(home, '.npmrc'), 'registry=https://registry.test.qwencloud.com/');
    writeFileSync(
      path.join(project, '.npmrc'),
      '//registry.test.qwencloud.com/:_authToken=mock-project-token',
    );
    expect(resolveRegistryForPackage('@qwencloud/plugin').authToken).toBeUndefined();
  });

  it('matches and attaches _authToken by host', () => {
    writeFileSync(
      path.join(home, '.npmrc'),
      [
        '@qwencloud:registry=https://anpm.test.qwencloud.com/',
        '//anpm.test.qwencloud.com/:_authToken=mock-user-token',
      ].join('\n'),
      'utf8',
    );
    const target = resolveRegistryForPackage('@qwencloud/pkg', home);
    expect(target.registry).toBe('https://anpm.test.qwencloud.com/');
    expect(target.authToken).toBe('mock-user-token');
  });

  it('expands ${ENV} references', () => {
    vi.stubEnv('QWENCLOUD_TEST_TOKEN', 'mock-env-token');
    try {
      writeFileSync(
        path.join(home, '.npmrc'),
        [
          'registry=https://reg.test.qwencloud.com/',
          '//reg.test.qwencloud.com/:_authToken=${QWENCLOUD_TEST_TOKEN}',
        ].join('\n'),
        'utf8',
      );
      expect(resolveRegistryForPackage('foo', home).authToken).toBe('mock-env-token');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not attach authToken when no token matches', () => {
    writeFileSync(path.join(home, '.npmrc'), 'registry=https://reg.test.qwencloud.com/', 'utf8');
    expect(resolveRegistryForPackage('foo', home).authToken).toBeUndefined();
  });
});

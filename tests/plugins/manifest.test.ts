import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { projectTmpdir as tmpdir } from '../fixtures/plugin-temporary-root.js';
import path from 'node:path';
import {
  readInstalledManifest,
  writeInstalledManifest,
  readPluginPackageManifest,
  type InstalledManifest,
} from '../../src/plugins/manifest.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'qwencloud-plugin-manifest-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readInstalledManifest', () => {
  it('returns an empty plugin list when the manifest file is absent', () => {
    const manifest = readInstalledManifest(path.join(root, 'plugins.json'));
    expect(manifest.plugins).toEqual([]);
  });

  it('rejects malformed JSON without replacing its bytes', () => {
    const p = path.join(root, 'plugins.json');
    writeFileSync(p, '{ not valid json', 'utf8');
    expect(() => readInstalledManifest(p)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR', exitCode: 4 }),
    );
    expect(readFileSync(p, 'utf8')).toBe('{ not valid json');
  });

  it.each([null, [], {}, { plugins: {} }, { plugins: [], disabledDefaults: {} }])(
    'rejects malformed manifest schema %j',
    (value) => {
      const p = path.join(root, 'plugins.json');
      const bytes = JSON.stringify(value);
      writeFileSync(p, bytes);
      expect(() => readInstalledManifest(p)).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ERROR', exitCode: 4 }),
      );
      expect(readFileSync(p, 'utf8')).toBe(bytes);
    },
  );

  it('preserves explicitly disabled records and defaults', () => {
    const value: InstalledManifest = {
      plugins: [{ name: 'p', version: '1.0.0', enabled: false, source: 'npm' }],
      disabledDefaults: ['p'],
    };
    const p = path.join(root, 'plugins.json');
    writeFileSync(p, JSON.stringify(value));
    expect(readInstalledManifest(p)).toEqual(value);
  });

  it('reports non-missing filesystem failures', () => {
    writeFileSync(path.join(root, 'file'), 'not a directory');
    expect(() => readInstalledManifest(path.join(root, 'file', 'plugins.json'))).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR', exitCode: 4 }),
    );
  });

  it('reads back persisted plugin entries', () => {
    const p = path.join(root, 'plugins.json');
    const m: InstalledManifest = {
      plugins: [{ name: '@qwencloud/plugin-demo', version: '1.0.0', enabled: true, source: 'npm' }],
    };
    writeInstalledManifest(p, m);
    expect(readInstalledManifest(p).plugins[0].name).toBe('@qwencloud/plugin-demo');
  });
});

describe('writeInstalledManifest', () => {
  it('writes the target file atomically without leaving a .tmp file', () => {
    const p = path.join(root, 'plugins.json');
    writeInstalledManifest(p, { plugins: [] });
    expect(existsSync(p)).toBe(true);
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });
});

describe('readPluginPackageManifest', () => {
  it('reads the command tree from package.json.qwencloud', () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'p',
        qwencloud: { command: 'foo', entry: './i.js', handlerKey: 'foo' },
      }),
      'utf8',
    );
    const m = readPluginPackageManifest(root);
    expect(m?.command).toBe('foo');
  });

  it('returns null when package.json or its qwencloud field is absent', () => {
    expect(readPluginPackageManifest(root)).toBeNull();
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p' }), 'utf8');
    expect(readPluginPackageManifest(root)).toBeNull();
  });

  it('ignores a leftover qwencloud-plugin.manifest.json and reads only package.json.qwencloud', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p' }), 'utf8');
    writeFileSync(
      path.join(root, 'qwencloud-plugin.manifest.json'),
      JSON.stringify({ command: 'legacy', entry: './i.js', handlerKey: 'legacy' }),
      'utf8',
    );
    expect(readPluginPackageManifest(root)).toBeNull();
  });

  it('falls back to package.json main/description when entry/description are absent', () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'p',
        main: './index.mjs',
        description: 'from package.json',
        qwencloud: { command: 'foo', handlerKey: 'foo' },
      }),
      'utf8',
    );
    const m = readPluginPackageManifest(root);
    expect(m?.entry).toBe('./index.mjs');
    expect(m?.description).toBe('from package.json');
  });

  it('lets explicit qwencloud entry/description override top-level main/description', () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'p',
        main: './pkg.js',
        description: 'pkg desc',
        qwencloud: {
          command: 'foo',
          entry: './explicit.js',
          description: 'explicit desc',
          handlerKey: 'foo',
        },
      }),
      'utf8',
    );
    const m = readPluginPackageManifest(root);
    expect(m?.entry).toBe('./explicit.js');
    expect(m?.description).toBe('explicit desc');
  });

  it('derives an absent minCliVersion from engines[@qwencloud/qwencloud-cli] without the range prefix', () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'p',
        engines: { '@qwencloud/qwencloud-cli': '>=1.4.0' },
        qwencloud: { command: 'foo', entry: './i.js', handlerKey: 'foo' },
      }),
      'utf8',
    );
    expect(readPluginPackageManifest(root)?.minCliVersion).toBe('1.4.0');
  });

  it('derives an absent minCliVersion from peerDependencies when engines are absent', () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'p',
        peerDependencies: { '@qwencloud/qwencloud-cli': '^1.4' },
        qwencloud: { command: 'foo', entry: './i.js', handlerKey: 'foo' },
      }),
      'utf8',
    );
    expect(readPluginPackageManifest(root)?.minCliVersion).toBe('1.4');
  });

  it('preserves explicit minCliVersion over engines and peerDependencies', () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'p',
        engines: { '@qwencloud/qwencloud-cli': '>=2.0.0' },
        qwencloud: { command: 'foo', entry: './i.js', handlerKey: 'foo', minCliVersion: '1.5.0' },
      }),
      'utf8',
    );
    expect(readPluginPackageManifest(root)?.minCliVersion).toBe('1.5.0');
  });
});

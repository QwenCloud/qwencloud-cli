import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getConfiguredOpenApiRules,
  type OpenApiPolicyRule,
} from '../../src/config/openapi-policy.js';
import {
  installManagedPlugin,
  readUsableDefaultPlugin,
} from '../../src/plugins/default-install.js';
import { installLocalPlugin, type InstallTransaction } from '../../src/plugins/installer.js';
import type { DefaultPlugin } from '../../src/plugins/defaults.js';
import type {
  InstalledManifest,
  InstalledPlugin,
  PluginManifest,
} from '../../src/plugins/manifest.js';
import { writePluginPackage } from '../fixtures/plugin-package.js';
import { snapshotDirectory } from '../fixtures/plugin-directory.js';

const state = vi.hoisted(() => ({
  root: '',
  pluginsDir: '',
  manifestPath: '',
  target: '',
  observing: false,
  external: false,
  reads: 0,
  bytes: [] as string[],
  descriptors: new Map<number, string>(),
  writes: [] as string[],
  hookCalls: { beforeOpen: 0, beforeRead: 0, afterRead: 0 },
  beforeOpen: undefined as (() => void) | undefined,
  beforeRead: undefined as (() => void) | undefined,
  afterRead: undefined as (() => void) | undefined,
}));

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  function change(name: 'beforeOpen' | 'beforeRead' | 'afterRead'): void {
    const hook = state[name];
    state[name] = undefined;
    if (!hook) return;
    state.hookCalls[name] += 1;
    const external = state.external;
    state.external = true;
    try {
      hook();
    } finally {
      state.external = external;
    }
  }
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const filename = typeof args[0] === 'number' ? state.descriptors.get(args[0]) : String(args[0]);
    const observed = state.observing && !state.external && filename === state.target;
    if (observed) {
      state.reads += 1;
      if (typeof args[0] !== 'number') change('beforeOpen');
      change('beforeRead');
    }
    const result = actual.readFileSync(...args);
    if (observed) {
      state.bytes.push(typeof result === 'string' ? result : result.toString('utf8'));
      change('afterRead');
    }
    return result;
  }) as typeof actual.readFileSync;
  function mutation<T extends (...args: never[]) => unknown>(name: string, operation: T): T {
    return ((...args: Parameters<T>) => {
      if (state.observing && !state.external) state.writes.push(name);
      return Reflect.apply(operation, actual, args);
    }) as T;
  }
  const openSync: typeof actual.openSync = (...args) => {
    if (state.observing && !state.external && String(args[0]) === state.target)
      change('beforeOpen');
    if (state.observing && !state.external && !['r', 'rs', 0].includes(args[1]))
      state.writes.push('openSync');
    const descriptor = actual.openSync(...args);
    state.descriptors.set(descriptor, String(args[0]));
    return descriptor;
  };
  const closeSync: typeof actual.closeSync = (descriptor) => {
    try {
      return actual.closeSync(descriptor);
    } finally {
      state.descriptors.delete(descriptor);
    }
  };
  const wrapped = {
    ...actual,
    readFileSync,
    openSync,
    closeSync,
    writeFileSync: mutation('writeFileSync', actual.writeFileSync),
    writeSync: mutation('writeSync', actual.writeSync),
    mkdirSync: mutation('mkdirSync', actual.mkdirSync),
    renameSync: mutation('renameSync', actual.renameSync),
    rmSync: mutation('rmSync', actual.rmSync),
    unlinkSync: mutation('unlinkSync', actual.unlinkSync),
  };
  return { ...wrapped, default: wrapped };
});
vi.mock('../../src/config/paths.js', async (original) => ({
  ...(await original<typeof import('../../src/config/paths.js')>()),
  getConfigDir: () => state.root,
  getPluginsDir: () => state.pluginsDir,
  getPluginsManifestPath: () => state.manifestPath,
}));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  const homedir = () => state.root;
  return { ...actual, homedir, default: { ...actual, homedir } };
});
vi.mock('../../src/plugins/defaults.js', () => ({
  getDefaultPlugins: () => [],
  getDefaultPlugin: () => undefined,
}));
vi.mock('../../plugins.preload.json', () => ({ default: { plugins: [] } }));

const packageName = '@qwencloud/committed-reader';
const healthyName = '@qwencloud/committed-healthy';
const oldPolicy: OpenApiPolicyRule = {
  product: 'CommittedPortal',
  actions: ['ReadCommitted'],
  auth: 'required',
};
const candidatePolicy: OpenApiPolicyRule = {
  product: 'CommittedPortal',
  actions: ['ReadCandidate'],
  auth: 'optional',
};
const healthyPolicy: OpenApiPolicyRule = {
  product: 'HealthyPortal',
  actions: ['ReadHealthy'],
  auth: 'required',
};
const declared: PluginManifest = {
  command: 'committedreader',
  entry: './index.mjs',
  handlerKey: 'run',
  apiPolicy: [oldPolicy],
};

function definition(): DefaultPlugin {
  return {
    name: packageName,
    version: '1.0.0',
    command: declared.command,
    source: { type: 'npm' },
  };
}

function context(): Parameters<typeof installManagedPlugin>[1] {
  return {
    pluginsDir: state.pluginsDir,
    manifestPath: state.manifestPath,
    cliVersion: '1.10.0',
    definitions: [],
  };
}

function destination(): string {
  return path.join(state.pluginsDir, 'node_modules', packageName);
}

function source(id: string, manifest: PluginManifest = declared, name = packageName): string {
  return writePluginPackage(
    path.join(state.root, 'sources', id),
    { name, version: '1.0.0', qwencloud: manifest },
    {
      name: 'index.mjs',
      content: `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(state.root, 'imported'))}, 'imported');\nexport const handlers = { run() {} };`,
    },
  );
}

function installed(): InstalledManifest {
  return JSON.parse(fs.readFileSync(state.manifestPath, 'utf8')) as InstalledManifest;
}

function writeInstalled(value: InstalledManifest): void {
  fs.writeFileSync(state.manifestPath, JSON.stringify(value));
}

function candidate(): InstallTransaction {
  const result = installLocalPlugin(
    source('candidate', { ...declared, apiPolicy: [candidatePolicy] }),
    state.pluginsDir,
    { recoverable: true },
  );
  if (!result.ok) throw new Error(result.error);
  return result.tx;
}

type Reader = 'policy' | 'default';
function read(reader: Reader): unknown {
  return reader === 'policy'
    ? getConfiguredOpenApiRules()
    : readUsableDefaultPlugin(definition(), context());
}

interface ReadHooks {
  beforeOpen?: () => void;
  beforeRead?: () => void;
  afterRead?: () => void;
}

function observe(reader: Reader, hooks: ReadHooks = {}): unknown {
  state.target = path.join(destination(), 'package.json');
  state.beforeOpen = hooks.beforeOpen;
  state.beforeRead = hooks.beforeRead;
  state.afterRead = hooks.afterRead;
  state.hookCalls = { beforeOpen: 0, beforeRead: 0, afterRead: 0 };
  state.reads = 0;
  state.bytes = [];
  state.writes = [];
  state.observing = true;
  try {
    return read(reader);
  } finally {
    state.observing = false;
    state.beforeOpen = undefined;
    state.beforeRead = undefined;
    state.afterRead = undefined;
    expect(state.hookCalls).toEqual({
      beforeOpen: hooks.beforeOpen ? 1 : 0,
      beforeRead: hooks.beforeRead ? 1 : 0,
      afterRead: hooks.afterRead ? 1 : 0,
    });
    expect(state.writes).toEqual([]);
    expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
  }
}

function expectAccepted(reader: Reader, value: unknown, record: InstalledPlugin): void {
  expect(value).toEqual(
    reader === 'policy' ? [oldPolicy] : { record, pkgDir: destination(), manifest: declared },
  );
}

beforeEach(() => {
  const temporaryRoot = path.resolve(__dirname, '../../.local-test-tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  state.root = fs.mkdtempSync(path.join(temporaryRoot, 'committed-metadata-'));
  state.pluginsDir = path.join(state.root, 'plugins');
  state.manifestPath = path.join(state.root, 'plugins.json');
  state.observing = false;
  state.external = false;
  writeInstalled({ plugins: [] });
  vi.stubEnv('QWENCLOUD_CONFIG_DIR', state.root);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Network is forbidden');
    }),
  );
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(state.root, 'imported'))).toBe(false);
  } finally {
    state.observing = false;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

describe.each(['policy', 'default'] as const)('committed %s metadata reads', (reader) => {
  it.each(['identified', 'legacy'] as const)(
    'reads stable %s metadata once without side effects',
    async (identity) => {
      await installManagedPlugin(source('old'), context());
      const committed = installed();
      if (identity === 'legacy') delete committed.plugins[0].installationId;
      writeInstalled(committed);
      const before = snapshotDirectory(state.root);

      expectAccepted(reader, observe(reader), committed.plugins[0]);

      expect(state.reads).toBe(1);
      expect(snapshotDirectory(state.root)).toEqual(before);
    },
  );

  it('rejects a same-version pending candidate that appears during its metadata read', async () => {
    await installManagedPlugin(source('old'), context());
    const committed = fs.readFileSync(state.manifestPath, 'utf8');
    let transaction: InstallTransaction | undefined;
    let pendingFiles: Record<string, string> | undefined;
    try {
      const result = observe(reader, {
        beforeRead: () => {
          transaction = candidate();
          pendingFiles = snapshotDirectory(state.pluginsDir);
        },
      });

      expect(result).toEqual(reader === 'policy' ? [] : null);
      expect(state.reads).toBe(1);
      expect(snapshotDirectory(state.pluginsDir)).toEqual(pendingFiles);
      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(committed);
    } finally {
      transaction?.rollback();
    }
  });

  it('rejects candidate bytes even when rollback restores the old record and path before recheck', async () => {
    await installManagedPlugin(source('old'), context());
    const before = installed();
    let transaction: InstallTransaction | undefined;
    try {
      const result = observe(reader, {
        beforeOpen: () => {
          transaction = candidate();
        },
        afterRead: () => {
          transaction?.rollback();
        },
      });

      expect(result).toEqual(reader === 'policy' ? [] : null);
      expect(state.reads).toBe(1);
      expect(state.bytes).toHaveLength(1);
      expect(JSON.parse(state.bytes[0]).qwencloud.apiPolicy).toEqual([candidatePolicy]);
      expect(installed()).toEqual(before);
      expectAccepted(reader, observe(reader), before.plugins[0]);
    } finally {
      transaction?.rollback();
    }
  });

  it.each([
    'installation identity',
    'record version',
    'record path',
    'command aliases',
    'disabled record',
    'disabled default',
    'removed record',
    'unsupported source',
  ] as const)('rejects a changed %s after reading metadata', async (change) => {
    await installManagedPlugin(source('old'), context());
    const result = observe(reader, {
      afterRead: () => {
        const current = installed();
        if (change === 'installation identity')
          current.plugins[0].installationId = 'replacement-identity';
        if (change === 'record version') current.plugins[0].version = '2.0.0';
        if (change === 'record path') current.plugins[0].path = source('alternate-path');
        if (change === 'command aliases') current.plugins[0].commandAliases = ['committedalias'];
        if (change === 'disabled record') current.plugins[0].enabled = false;
        if (change === 'disabled default') current.disabledDefaults = [packageName];
        if (change === 'removed record') current.plugins = [];
        if (change === 'unsupported source') {
          fs.writeFileSync(
            state.manifestPath,
            JSON.stringify({ plugins: [{ ...current.plugins[0], source: 'unsupported' }] }),
          );
        } else writeInstalled(current);
      },
    });

    expect(result).toEqual(reader === 'policy' ? [] : null);
    expect(state.reads).toBe(1);
  });

  it.each(['replacement', 'timestamp', 'containment'] as const)(
    'rejects metadata %s during the read',
    async (change) => {
      await installManagedPlugin(source('old'), context());
      const result = observe(reader, {
        afterRead: () => {
          const packagePath = path.join(destination(), 'package.json');
          if (change === 'replacement') {
            const replacement = path.join(state.root, 'replacement.json');
            fs.writeFileSync(replacement, fs.readFileSync(packagePath));
            fs.renameSync(replacement, packagePath);
          } else if (change === 'timestamp') {
            const before = fs.statSync(packagePath);
            fs.utimesSync(packagePath, before.atime, new Date(before.mtimeMs + 10_000));
          } else {
            const outside = path.join(state.root, 'outside-package');
            fs.renameSync(destination(), outside);
            fs.symlinkSync(outside, destination());
          }
        },
      });

      expect(result).toEqual(reader === 'policy' ? [] : null);
      expect(state.reads).toBe(1);
    },
  );

  it('preserves an unrelated healthy plugin while another installation becomes pending', async () => {
    const old = await installManagedPlugin(source('old'), context());
    await installManagedPlugin(
      source(
        'healthy',
        { ...declared, command: 'committedhealthy', apiPolicy: [healthyPolicy] },
        healthyName,
      ),
      context(),
    );
    const committed = installed();
    for (const record of committed.plugins) record.commandAliases = [];
    writeInstalled(committed);
    old.commandAliases = [];
    let transaction: InstallTransaction | undefined;
    try {
      if (reader === 'policy') {
        expect(
          observe(reader, {
            beforeRead: () => {
              transaction = candidate();
            },
          }),
        ).toEqual([healthyPolicy]);
      } else {
        const pending = installLocalPlugin(
          source(
            'healthy-new',
            { ...declared, command: 'committedhealthy', apiPolicy: [healthyPolicy] },
            healthyName,
          ),
          state.pluginsDir,
          { recoverable: true },
        );
        if (!pending.ok) throw new Error(pending.error);
        transaction = pending.tx;
        expectAccepted(reader, observe(reader), old);
      }
      expect(state.reads).toBe(1);
    } finally {
      transaction?.rollback();
    }
  });
});

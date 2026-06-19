import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';

vi.mock('../../../src/config/manager.js', () => ({
  getConfigEntries: () => [
    { key: 'output.format', value: 'auto', source: 'default' },
    { key: 'api.endpoint', value: 'https://mock-api.test.qwencloud.com', source: 'global', sourcePath: '~/.qwencloud/config.json' },
  ],
  getConfigValue: () => 'auto',
}));

const { configList } = await import('../../../src/commands/config/list.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function buildList(program: import('commander').Command) {
  const config = program.command('config');
  config
    .command('list')
    .option('--format <fmt>')
    .action((opts: { format?: string }) => {
      configList(opts, program.opts().format as string | undefined);
    });
}

describe('config list command', () => {
  it('JSON mode → returns configs array with key/value/source', async () => {
    const r = await runCommand(buildList, ['config', 'list', '--format', 'json']);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.configs).toHaveLength(2);
    expect(payload.configs[0].key).toBe('output.format');
    expect(payload.configs[1].source_path).toBe('~/.qwencloud/config.json');
  });

  it('text mode → renders headers and rows', async () => {
    const r = await runCommand(buildList, ['config', 'list', '--format', 'text']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('output.format');
    expect(r.stdout).toContain('api.endpoint');
  });

  it('table (default) mode → renders Config header', async () => {
    const r = await runCommand(buildList, ['config', 'list', '--format', 'table']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('Config');
    expect(r.stdout).toContain('output.format');
  });
});

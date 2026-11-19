import { afterEach, describe, expect, it, vi } from 'vitest';
import { tabCompleter } from '../../src/repl/completer.js';
import { registerCompletionCommand } from '../../src/commands/completion.js';
import { runCommand } from '../helpers/run-command.js';

const { appendFileSync } = vi.hoisted(() => ({
  appendFileSync: vi.fn(() => {
    throw new Error('Generating completion must not modify shell files');
  }),
}));
vi.mock('fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  appendFileSync,
  mkdirSync: vi.fn(),
}));
afterEach(() => {
  expect(appendFileSync).not.toHaveBeenCalled();
  vi.clearAllMocks();
});

describe('Token Plan completion surface', () => {
  it('offers only the visible Token Plan subcommands', () => {
    const [commands] = tabCompleter('subscription tokenplan ');
    expect(commands).toEqual(expect.arrayContaining(['list', 'status', 'seats', '--help']));
    expect(commands).not.toContain('addons');
    expect(commands).not.toContain('purchase');
  });

  it('offers all supported list flags without international Harness options', () => {
    const [flags] = tabCompleter('subscription tokenplan list ');
    expect(flags).toEqual(
      expect.arrayContaining([
        '--edition',
        '--billing-cycle',
        '--include-models',
        '--format',
        '--help',
      ]),
    );
    expect(flags).not.toContain('--include-harness');
  });

  it.each([
    ['subscription tokenplan list --edition ', ['individual', 'team', 'all']],
    ['subscription tokenplan status --edition ', ['individual', 'team', 'all']],
    ['subscription tokenplan list --billing-cycle ', ['monthly', 'quarterly', 'yearly']],
    ['subscription tokenplan list --format ', ['table', 'json', 'text']],
  ])('offers exact allowed values after %s', (line, expected) => {
    expect(tabCompleter(line)[0]).toEqual(expected);
  });

  it.each(['zsh', 'bash', 'fish'])(
    'generates %s completion for the new read-only command surface',
    async (shell) => {
      const chunks: string[] = [];
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
        chunk: unknown,
      ) => {
        chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      }) as typeof process.stdout.write);
      try {
        const result = await runCommand(registerCompletionCommand, [
          'completion',
          'generate',
          '--shell',
          shell,
        ]);
        const script = chunks.join('');
        expect(result.exitCode).toBeUndefined();
        expect(script).toContain('tokenplan');
        expect(script).toContain('list');
        expect(script).toContain('edition');
        expect(script).toContain('billing-cycle');
        expect(script).toContain('include-models');
        expect(script).not.toContain('include-harness');
        expect(script).not.toContain('tokenplan addons');
      } finally {
        stdoutWriteSpy.mockRestore();
      }
    },
  );
});

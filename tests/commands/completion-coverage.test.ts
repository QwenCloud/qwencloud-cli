import { describe, it, expect, vi } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../../src/cli.js';
import { TOP_COMMANDS, SUBCOMMANDS } from '../../src/repl/completer.js';
import { registerCompletionCommand } from '../../src/commands/completion.js';
import { runCommand } from '../helpers/run-command.js';

const REPL_ONLY_TOP_COMMANDS = new Set<string>(['help', 'clear']);

function isHidden(c: Command): boolean {
  return Boolean((c as unknown as { _hidden?: boolean })._hidden);
}

function topLevelCommands(program: Command): Command[] {
  return program.commands.filter((c) => !isHidden(c) && c.name() !== 'plugin');
}

async function generateScript(shell: string): Promise<string> {
  const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await runCommand(
      (program) => registerCompletionCommand(program),
      ['completion', 'generate', '--shell', shell],
    );
    return stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    stdoutWriteSpy.mockRestore();
  }
}

describe('completion command coverage', () => {
  const program = createProgram({ loadPlugins: false });
  const commands = topLevelCommands(program);
  const names = commands.map((c) => c.name());

  it('REPL TOP_COMMANDS lists every supported builtin command', () => {
    for (const name of names) {
      expect(TOP_COMMANDS, `missing "${name}" in REPL TOP_COMMANDS`).toContain(name);
    }
    for (const name of TOP_COMMANDS) {
      if (REPL_ONLY_TOP_COMMANDS.has(name)) continue;
      expect(names, `stale "${name}" in REPL TOP_COMMANDS`).toContain(name);
    }
  });

  it('REPL SUBCOMMANDS lists every supported builtin subcommand', () => {
    for (const cmd of commands) {
      const subs = cmd.commands.filter((s) => !isHidden(s)).map((s) => s.name());
      if (subs.length === 0) continue;
      const declared = SUBCOMMANDS[cmd.name()] ?? [];
      for (const sub of subs) {
        expect(declared, `missing "${cmd.name()} ${sub}" in REPL SUBCOMMANDS`).toContain(sub);
      }
    }
  });

  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    it(`${shell} completion offers every supported builtin command`, async () => {
      const script = await generateScript(shell);
      for (const name of names) {
        const re = new RegExp(`\\b${name}\\b`);
        expect(re.test(script), `"${name}" missing from ${shell} completion`).toBe(true);
      }
    });
  }
});

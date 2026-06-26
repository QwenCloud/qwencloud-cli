import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const ANSI_ESCAPE_REGEX = /\x1b\[/;

describe('help formatter color mode', () => {
  afterEach(() => {
    vi.resetModules();
  });

  const indexOf = (output: string, text: string) => {
    const index = output.indexOf(text);
    expect(index, `${text} should appear in help output`).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('keeps one-shot help plain text', async () => {
    const { createProgram } = await import('../../src/cli.js');

    const output = createProgram().helpInformation();

    expect(output).not.toMatch(ANSI_ESCAPE_REGEX);
  });

  it('groups top-level commands by workflow priority', async () => {
    const { createProgram } = await import('../../src/cli.js');

    const output = createProgram().helpInformation();
    const commandRowIndexOf = (command: string) => indexOf(output, `\n      ${command}`);

    const core = indexOf(output, 'Core:');
    const accountAccess = indexOf(output, 'Account & access:');
    const usageBilling = indexOf(output, 'Usage & billing:');
    const operations = indexOf(output, 'Operations:');
    const support = indexOf(output, 'Support:');

    expect(core).toBeLessThan(accountAccess);
    expect(accountAccess).toBeLessThan(usageBilling);
    expect(usageBilling).toBeLessThan(operations);
    expect(operations).toBeLessThan(support);

    expect(commandRowIndexOf('models')).toBeLessThan(commandRowIndexOf('docs'));
    expect(commandRowIndexOf('usage')).toBeLessThan(commandRowIndexOf('billing'));
    expect(commandRowIndexOf('doctor')).toBeLessThan(commandRowIndexOf('config'));
  });

  it('colors headings and command names in REPL mode', async () => {
    const { setReplMode } = await import('../../src/utils/runtime-mode.js');
    const { createProgram } = await import('../../src/cli.js');

    setReplMode();
    const program = createProgram();
    let output = '';
    program.configureOutput({
      getOutHasColors: () => true,
      writeOut: (str) => {
        output += str;
      },
    });
    program.outputHelp();

    expect(output).toMatch(ANSI_ESCAPE_REGEX);
    expect(output).toContain('Commands:');
    expect(output).toContain('Core:');
  });
});

// The help formatter renders positional arguments of commands that also own
// subcommands. Two visible effects:
//   1. Usage line includes the positional token, BEFORE `<subcommand>`.
//   2. A new `Arguments:` block (after Description, before Subcommands) lists each
//      positional argument that carries a non-empty description.
// Commands without their own positional argument, and positional arguments
// without a description, keep the standard rendering (backward compatible).
//
// SUT: the real `formatHelp(cmd)` renderer is invoked against a hand-built
// commander Command. The renderer is never mocked; assertions read its literal
// string output. Each scenario imports the module fresh (resetModules) so REPL
// state set by an earlier test cannot leak in and strip the program name.
describe('help formatter — positional Arguments rendering (commands with subcommands)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  /**
   * A command that owns BOTH a described positional and a subcommand.
   * The command is attached to a root program so the formatter treats it as a
   * level-1 command (`<subcommand>` usage).
   */
  async function buildPositionalShape(): Promise<{ formatHelp: (cmd: Command) => string; cmd: Command }> {
    const { formatHelp } = await import('../../src/output/help-formatter.js');
    const { setLongDescription } = await import('../../src/utils/commander-helpers.js');

    const program = new Command('qwencloud');
    const cmd = program.command('example');
    cmd.argument(
      '[message...]',
      'User prompt. Piped stdin, if any, is prepended as context; on an interactive terminal with no pipe, stdin is not read.',
    );
    setLongDescription(cmd, 'Execute multimodal inference');
    cmd.command('task').description('Async task lifecycle helpers');
    return { formatHelp, cmd };
  }

  it('Usage line includes the positional token and keeps it before <subcommand>', async () => {
    const { formatHelp, cmd } = await buildPositionalShape();

    const out = formatHelp(cmd);
    const usageLine = out.split('\n').find((l) => l.includes('Usage:')) ?? '';

    expect(usageLine).toContain('[message...]');
    expect(usageLine).toContain('<subcommand>');
    // Positional precedes the subcommand placeholder in the usage suffix.
    expect(usageLine.indexOf('[message...]')).toBeLessThan(usageLine.indexOf('<subcommand>'));
  });

  it('renders an Arguments block listing the positional name and its description', async () => {
    const { formatHelp, cmd } = await buildPositionalShape();

    const out = formatHelp(cmd);

    expect(out).toContain('Arguments:');
    // The positional name token appears in the Arguments block.
    expect(out).toMatch(/Arguments:[\s\S]*\bmessage\b/);
    // The H-3 merge-semantics description text is now user-visible.
    expect(out).toContain('prepended as context');
  });

  it('orders Arguments after Description and before Subcommands', async () => {
    const { formatHelp, cmd } = await buildPositionalShape();

    const out = formatHelp(cmd);
    const descIdx = out.indexOf('Execute multimodal inference');
    const argsIdx = out.indexOf('Arguments:');
    const subsIdx = out.indexOf('Subcommands:');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(argsIdx).toBeGreaterThanOrEqual(0);
    expect(subsIdx).toBeGreaterThanOrEqual(0);
    expect(descIdx).toBeLessThan(argsIdx);
    expect(argsIdx).toBeLessThan(subsIdx);
  });

  it('omits the Arguments block for a subcommand-owning command with no positional (regression)', async () => {
    const { formatHelp } = await import('../../src/output/help-formatter.js');
    const { setLongDescription } = await import('../../src/utils/commander-helpers.js');

    // config shape: subcommands but no positional argument of its own.
    // Attached to a root program so it renders as a level-1 `<subcommand>` command.
    const program = new Command('qwencloud');
    const cmd = program.command('config');
    setLongDescription(cmd, 'Manage CLI configuration');
    cmd.command('get').description('Read a configuration value');
    cmd.command('set').description('Write a configuration value');

    const out = formatHelp(cmd);

    expect(out).not.toContain('Arguments:');
    // Usage is unchanged: still `<subcommand> [flags]`, with no positional token
    // inserted before `<subcommand>`. Asserting the exact suffix is the tightest
    // regression guard against H-4 leaking a positional placeholder here.
    const usageLine = out.split('\n').find((l) => l.includes('Usage:')) ?? '';
    expect(usageLine.trim()).toBe('Usage: qwencloud config <subcommand> [flags]');
  });

  it('omits the Arguments block when the positional has no description (compat)', async () => {
    const { formatHelp } = await import('../../src/output/help-formatter.js');
    const { setLongDescription } = await import('../../src/utils/commander-helpers.js');

    // A command with a subcommand and an UNDESCRIBED positional argument.
    // Attached to a root program so it renders as a level-1 `<subcommand>` command.
    const program = new Command('qwencloud');
    const cmd = program.command('thing');
    cmd.argument('<id>'); // no description supplied
    setLongDescription(cmd, 'A thing with subcommands');
    cmd.command('sub').description('A subcommand');

    const out = formatHelp(cmd);

    // Undescribed positional → no Arguments block.
    expect(out).not.toContain('Arguments:');
    // Usage may still surface the positional token, but the Arguments table is suppressed.
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

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

    expect(core).toBeLessThan(accountAccess);
    expect(accountAccess).toBeLessThan(usageBilling);
    expect(usageBilling).toBeLessThan(operations);

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
    expect(output).toContain('models');
  });
});

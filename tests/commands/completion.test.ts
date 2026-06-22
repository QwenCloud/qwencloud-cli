/**
 * Unit tests for the `completion` command (install + generate subcommands).
 *
 * Validates:
 *   - Shell auto-detection from $SHELL environment variable
 *   - Install for each shell type (zsh, bash, fish)
 *   - Duplicate installation detection (already installed)
 *   - Unsupported shell rejection
 *   - Generate subcommand output for each shell type
 *   - Generate without detectable shell errors out
 *   - Install without detectable shell errors out
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCommand } from '../helpers/run-command.js';

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: vi.fn(() => '/mock-home'),
  };
});

const { existsSync, readFileSync, appendFileSync, mkdirSync } = await import('fs');
const { registerCompletionCommand } = await import('../../src/commands/completion.js');

// ── Helpers ─────────────────────────────────────────────────────────────

function setupCompletion(program: import('commander').Command) {
  registerCompletionCommand(program);
}

let originalShell: string | undefined;

beforeEach(() => {
  originalShell = process.env.SHELL;
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockReturnValue('');
  vi.mocked(appendFileSync).mockReset();
  vi.mocked(mkdirSync).mockClear();
});

afterEach(() => {
  if (originalShell !== undefined) {
    process.env.SHELL = originalShell;
  } else {
    delete process.env.SHELL;
  }
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('completion install — shell detection', () => {
  it('detects zsh from $SHELL', async () => {
    process.env.SHELL = '/bin/zsh';
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('zsh');
    expect(appendFileSync).toHaveBeenCalled();
  });

  it('detects bash from $SHELL', async () => {
    process.env.SHELL = '/bin/bash';
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('bash');
    expect(appendFileSync).toHaveBeenCalled();
  });

  it('detects fish from $SHELL', async () => {
    process.env.SHELL = '/usr/local/bin/fish';
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('fish');
    expect(appendFileSync).toHaveBeenCalled();
  });

  it('exits with error when $SHELL is unrecognized', async () => {
    process.env.SHELL = '/usr/bin/csh';

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unable to detect shell/i);
  });

  it('exits with error when $SHELL is empty', async () => {
    process.env.SHELL = '';

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unable to detect shell/i);
  });
});

describe('completion install — explicit --shell flag', () => {
  it('installs zsh completion via --shell zsh', async () => {
    process.env.SHELL = '';
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install', '--shell', 'zsh']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('zsh');
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    const appendedContent = vi.mocked(appendFileSync).mock.calls[0][1] as string;
    expect(appendedContent).toContain('qwencloud completion generate --shell zsh');
  });

  it('installs bash completion via --shell bash', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install', '--shell', 'bash']);

    expect(r.exitCode).toBeUndefined();
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    const appendedContent = vi.mocked(appendFileSync).mock.calls[0][1] as string;
    expect(appendedContent).toContain('qwencloud completion generate --shell bash');
  });

  it('installs fish completion via --shell fish', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install', '--shell', 'fish']);

    expect(r.exitCode).toBeUndefined();
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    const appendedContent = vi.mocked(appendFileSync).mock.calls[0][1] as string;
    expect(appendedContent).toContain('qwencloud completion generate --shell fish');
  });

  it('creates the fish config directory before writing so a fresh setup does not ENOENT', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install', '--shell', 'fish']);

    expect(r.exitCode).toBeUndefined();
    expect(mkdirSync).toHaveBeenCalledWith('/mock-home/.config/fish', { recursive: true });
    const mkdirOrder = vi.mocked(mkdirSync).mock.invocationCallOrder[0];
    const appendOrder = vi.mocked(appendFileSync).mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(appendOrder);
  });

  it('reports a graceful error (no stack trace) when the rc write fails', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(appendFileSync).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    const r = await runCommand(setupCompletion, ['completion', 'install', '--shell', 'fish']);

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/failed to write completion config/i);
    expect(r.stderr).not.toMatch(/\n\s+at\s/);
  });

  it('rejects unsupported shell type with error', async () => {
    const r = await runCommand(setupCompletion, ['completion', 'install', '--shell', 'tcsh']);

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unsupported shell/i);
  });
});

describe('completion install — duplicate detection', () => {
  it('skips installation when completion line already exists in rc file', async () => {
    process.env.SHELL = '/bin/zsh';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '# existing config\neval "$(qwencloud completion generate --shell zsh)"\n',
    );

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toMatch(/already installed/i);
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('installs when rc file exists but does not contain completion line', async () => {
    process.env.SHELL = '/bin/zsh';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('# just some aliases\nalias ll="ls -la"\n');

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('Done');
    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('completion install — success message', () => {
  it('prints source command hint after successful zsh install', async () => {
    process.env.SHELL = '/bin/zsh';
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('source ~/.zshrc');
  });

  it('prints source command hint after successful bash install', async () => {
    process.env.SHELL = '/bin/bash';
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('source ~/.bashrc');
  });

  it('prints source command hint after successful fish install', async () => {
    process.env.SHELL = '/usr/bin/fish';
    vi.mocked(existsSync).mockReturnValue(false);

    const r = await runCommand(setupCompletion, ['completion', 'install']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('source ~/.config/fish/config.fish');
  });
});

describe('completion generate — script output', () => {
  it('outputs zsh completion script to stdout', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const r = await runCommand(setupCompletion, ['completion', 'generate', '--shell', 'zsh']);

    // The generate command writes directly to process.stdout.write
    expect(r.exitCode).toBeUndefined();
    const written = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('_qwencloud');
    expect(written).toContain('compdef');

    stdoutWriteSpy.mockRestore();
  });

  it('outputs bash completion script to stdout', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const r = await runCommand(setupCompletion, ['completion', 'generate', '--shell', 'bash']);

    expect(r.exitCode).toBeUndefined();
    const written = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('_qwencloud');
    expect(written).toContain('complete -F');

    stdoutWriteSpy.mockRestore();
  });

  it('outputs fish completion script to stdout', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const r = await runCommand(setupCompletion, ['completion', 'generate', '--shell', 'fish']);

    expect(r.exitCode).toBeUndefined();
    const written = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('complete -c qwencloud');

    stdoutWriteSpy.mockRestore();
  });

  it('auto-detects shell for generate when --shell is omitted', async () => {
    process.env.SHELL = '/bin/bash';
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const r = await runCommand(setupCompletion, ['completion', 'generate']);

    expect(r.exitCode).toBeUndefined();
    const written = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('complete -F _qwencloud');

    stdoutWriteSpy.mockRestore();
  });

  it('exits with error when generate cannot detect shell', async () => {
    process.env.SHELL = '';

    const r = await runCommand(setupCompletion, ['completion', 'generate']);

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unable to detect shell/i);
  });

  it('rejects unsupported shell for generate', async () => {
    const r = await runCommand(setupCompletion, [
      'completion',
      'generate',
      '--shell',
      'powershell',
    ]);

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unsupported shell/i);
  });
});

async function generateScript(shell: string): Promise<string> {
  const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const r = await runCommand(setupCompletion, ['completion', 'generate', '--shell', shell]);
    expect(r.exitCode).toBeUndefined();
    return stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    stdoutWriteSpy.mockRestore();
  }
}

describe('completion generate — auth subcommand surface', () => {
  it('zsh script offers login/logout/status but never refresh', async () => {
    const script = await generateScript('zsh');
    expect(script).toContain('login');
    expect(script).toContain('logout');
    expect(script).toContain('status');
    expect(script).not.toContain('refresh');
    expect(script).not.toContain('Refresh token');
  });

  it('bash script offers login/logout/status but never refresh', async () => {
    const script = await generateScript('bash');
    expect(script).toContain('login');
    expect(script).toContain('logout');
    expect(script).toContain('status');
    expect(script).not.toContain('refresh');
  });

  it('fish script offers login/logout/status but never refresh', async () => {
    const script = await generateScript('fish');
    expect(script).toContain('login');
    expect(script).toContain('logout');
    expect(script).toContain('status');
    expect(script).not.toContain('refresh');
  });
});

describe('completion — bare command shows help', () => {
  it('does not crash when no subcommand is given', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const r = await runCommand(setupCompletion, ['completion']);

    // The bare command calls outputHelp() which Commander swallows in test mode,
    // then writes a newline to process.stdout.write. Just verify no error exit.
    expect(r.exitCode).toBeUndefined();

    stdoutWriteSpy.mockRestore();
  });
});

#!/usr/bin/env node
export {};

import { resetGlobalCache } from '../src/utils/cache.js';

const args = process.argv.slice(2);

if (args.length === 0) {
  // REPL mode — dynamic import to avoid loading cost in one-shot mode
  const { startRepl } = await import('../src/repl.js');
  try {
    await startRepl();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`REPL error: ${message}\n`);
    resetGlobalCache();
    process.exitCode = 1;
  }
} else {
  // One-shot mode
  const { createProgram } = await import('../src/cli.js');
  const { CliError, HandledError } = await import('../src/utils/errors.js');
  const { flushDebugReport } = await import('../src/api/debug-buffer.js');
  const program = createProgram();

  // Detect --format from argv before parsing — Commander may throw on an
  // unknown command before populating program.opts(), so we need our own scan.
  const formatFromArgv = (): string | undefined => {
    const args = process.argv.slice(2);
    const i = args.findIndex((a) => a === '--format' || a.startsWith('--format='));
    if (i < 0) return undefined;
    const arg = args[i];
    if (arg.includes('=')) return arg.split('=', 2)[1];
    return args[i + 1];
  };

  const wantsJSON = (): boolean => formatFromArgv() === 'json';

  // --quiet / -q: silence every byte to stdout/stderr before any command runs,
  // so Agents that only need the exit code don't have to redirect manually.
  // We also strip the flag from argv so subcommands (which don't declare
  // --quiet themselves) don't trip Commander's unknown-option check; the
  // top-level program still registers it so it shows up in `--help`.
  const quietIdx = process.argv.findIndex((a) => a === '--quiet' || a === '-q');
  if (quietIdx >= 0) {
    const noop = (..._args: unknown[]): boolean => true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = noop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = noop;
    // Force non-TTY so commands take the non-interactive code path and don't
    // wait on Ink-rendered prompts the user can't see.
    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
    } catch {
      /* some runtimes mark these read-only — best-effort */
    }
    process.argv.splice(quietIdx, 1);
  }

  // Use process.exitCode instead of process.exit() throughout one-shot mode.
  // process.exit() forcibly tears down the event loop, which on Windows can
  // race with undici's (fetch) async handle cleanup and trigger:
  //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:76
  // Setting process.exitCode and letting the event loop drain naturally avoids
  // the race entirely.

  try {
    await program.parseAsync(process.argv);
    flushDebugReport();
    resetGlobalCache();
  } catch (err: unknown) {
    flushDebugReport();

    // Help / version are surfaced as CommanderError but with exitCode 0 — they're
    // success paths, the help text was already written to stdout.
    const e = err as { code?: string; exitCode?: number; message?: string };
    if (e && typeof e.code === 'string' && e.code.startsWith('commander.')) {
      const exitCode = typeof e.exitCode === 'number' ? e.exitCode : 1;
      if (exitCode === 0) {
        resetGlobalCache();
      } else {
        // Real Commander parse error — emit in user's chosen format.
        const code = mapCommanderCode(e.code);
        let message = e.message || 'Command parse error';
        // Commander messages already start with 'error: ' — strip it to avoid
        // double prefix when we prepend our own 'Error: '.
        if (message.startsWith('error: ')) {
          message = message.slice(7);
        }
        if (wantsJSON()) {
          process.stderr.write(
            JSON.stringify(
              {
                error: { code, message, exit_code: exitCode },
              },
              null,
              2,
            ) + '\n',
          );
        } else {
          console.error(`Error: ${message}`);
        }
        resetGlobalCache();
        process.exitCode = exitCode;
      }
    } else if (err instanceof HandledError) {
      // handleError() already formatted & printed the message — just propagate
      // the exit code without duplicating output.
      resetGlobalCache();
      process.exitCode = err.exitCode;
    } else if (err instanceof CliError) {
      if (wantsJSON()) {
        process.stderr.write(JSON.stringify(err.toJSON(), null, 2) + '\n');
      } else {
        console.error(`Error: ${err.message}`);
      }
      resetGlobalCache();
      process.exitCode = err.exitCode;
    } else {
      const message = err instanceof Error ? err.message : String(err);
      if (wantsJSON()) {
        process.stderr.write(
          JSON.stringify(
            {
              error: { code: 'UNKNOWN_ERROR', message, exit_code: 1 },
            },
            null,
            2,
          ) + '\n',
        );
      } else {
        console.error(`Error: ${message}`);
      }
      resetGlobalCache();
      process.exitCode = 1;
    }
  }

  // Close undici's global HTTP dispatcher so keep-alive sockets are released
  // immediately and don't hold the event loop open for seconds after the
  // command has finished.  Without this the process would hang until the
  // connection pool's keep-alive timeout expires.
  try {
    // Node 18-20 use 'undici.globalDispatcher', Node 21+ switched to
    // 'undici.globalDispatcher.1'.  Try both for maximum compatibility.
    const sym1 = Symbol.for('undici.globalDispatcher.1');
    const sym0 = Symbol.for('undici.globalDispatcher');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatcher = (globalThis as any)[sym1] ?? (globalThis as any)[sym0];
    if (dispatcher && typeof dispatcher.close === 'function') {
      await dispatcher.close();
    }
  } catch {
    // Best-effort — if the dispatcher doesn't exist or close fails,
    // the process will still exit (just potentially with a small delay).
  }
}

function mapCommanderCode(code: string): string {
  switch (code) {
    case 'commander.unknownCommand':
      return 'UNKNOWN_COMMAND';
    case 'commander.unknownOption':
      return 'UNKNOWN_OPTION';
    case 'commander.missingArgument':
      return 'MISSING_ARGUMENT';
    case 'commander.missingMandatoryOptionValue':
      return 'MISSING_OPTION';
    case 'commander.optionMissingArgument':
      return 'MISSING_OPTION_VALUE';
    case 'commander.invalidArgument':
      return 'INVALID_ARGUMENT';
    case 'commander.excessArguments':
      return 'EXCESS_ARGUMENTS';
    default:
      return 'INVALID_USAGE';
  }
}

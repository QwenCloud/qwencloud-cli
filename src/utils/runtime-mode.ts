/**
 * Runtime mode detection — distinguishes REPL (interactive) from one-shot mode.
 *
 * In REPL mode, users are already inside `qwencloud`, so hints like
 * "Run: login" suffice. In one-shot mode the full "Run: qwencloud login"
 * is needed because the user invokes commands directly from the shell.
 */

let _isRepl = false;

/** Mark the current process as running in REPL mode. Call once at REPL startup. */
export function setReplMode(): void {
  _isRepl = true;
}

/** Whether the CLI is currently running in REPL / interactive mode. */
export function isReplMode(): boolean {
  return _isRepl;
}

/** Return the login command hint appropriate for the current runtime mode. */
export function loginCommand(): string {
  return _isRepl ? 'login' : 'qwencloud login';
}

/** Format a CLI command for display, adding the binary prefix in one-shot mode. */
export function formatCmd(cmd: string): string {
  return _isRepl ? cmd : `qwencloud ${cmd}`;
}

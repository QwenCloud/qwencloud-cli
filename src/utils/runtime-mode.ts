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

/**
 * Return the appropriate login command hint for the current runtime mode.
 * - REPL:     `"login"`
 * - One-shot: `"qwencloud login"`
 */
export function loginCommand(): string {
  return _isRepl ? 'login' : 'qwencloud login';
}

/**
 * Format a CLI command for display in user-facing messages.
 * - REPL:     returns `cmd` as-is (e.g. `"auth logout"`)
 * - One-shot: returns with prefix (e.g. `"qwencloud auth logout"`)
 */
export function formatCmd(cmd: string): string {
  return _isRepl ? cmd : `qwencloud ${cmd}`;
}

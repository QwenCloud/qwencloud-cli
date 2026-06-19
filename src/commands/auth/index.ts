import type { Command } from 'commander';
import { registerLoginCommand } from './login.js';
import { registerLogoutCommand } from './logout.js';
import { registerStatusCommand } from './status.js';
import type { ClientFactory } from '../../api/client.js';

/**
 * Register all auth subcommands on a Commander command.
 * Also registers top-level login/logout aliases on the program root.
 */
export function registerAuthCommands(program: Command, getClient: ClientFactory): void {
  const auth = program
    .command('auth')
    .description('Manage authentication (login / logout / status)');

  // Register subcommands under `auth`
  registerLoginCommand(auth, getClient);
  registerLogoutCommand(auth, getClient);
  registerStatusCommand(auth, getClient);

  auth.action(() => {
    auth.outputHelp();
    process.stdout.write('\n');
  });

  // Top-level aliases: `qwencloud login` and `qwencloud logout`
  registerLoginCommand(program, getClient);
  registerLogoutCommand(program, getClient);
}

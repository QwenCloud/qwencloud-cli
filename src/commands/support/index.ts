import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { registerSupportListCommand } from './list.js';
import { registerSupportViewCommand } from './view.js';
import { registerSupportCreateCommand } from './create.js';
import { registerSupportCloseCommand } from './close.js';
import { registerSupportReplyCommand } from './reply.js';
import { registerSupportRateCommand } from './rate.js';

export function registerSupportCommands(program: Command, getClient: ClientFactory): void {
  const support = program
    .command('support')
    .description('Manage support tickets (list, view, create, reply, close, rate)');

  registerSupportListCommand(support, getClient);
  registerSupportViewCommand(support, getClient);
  registerSupportCreateCommand(support, getClient);
  registerSupportReplyCommand(support, getClient);
  registerSupportCloseCommand(support, getClient);
  registerSupportRateCommand(support, getClient);

  support.action(() => {
    support.outputHelp();
    process.stdout.write('\n');
  });
}

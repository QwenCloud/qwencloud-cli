import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import { handleError } from '../../utils/errors.js';
import { confirmPrompt } from '../../utils/confirm.js';
import { addExamples } from '../../utils/commander-helpers.js';
import { formatCmd } from '../../utils/runtime-mode.js';

export function registerSupportCloseCommand(parent: Command, getClient: ClientFactory): void {
  const close = parent
    .command('close')
    .description('Close a support ticket (cancel request)')
    .argument('<ticket-id>', 'Ticket ID to close')
    .option('--yes', 'Skip confirmation prompt', false)
    .option('--format <format>', 'Output format: table, json, text (default: auto)');

  addExamples(close, [
    formatCmd('support close <ticket-id>'),
    formatCmd('support close <ticket-id> --yes'),
  ]);

  close.action(supportCloseAction(close, getClient));
}

export function supportCloseAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command, ticketId: string, options: Record<string, unknown>) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      ensureAuthenticated();

      const client = await getClient();
      await withSpinner(
        'Verifying ticket',
        () => client.supportService.getTicket(ticketId),
        format,
      );

      if (!options.yes) {
        const ok = await confirmPrompt(`Are you sure you want to close ticket ${ticketId}? (y/N)`);
        if (!ok) {
          if (format === 'json') {
            outputJSON({ ticketId, cancelled: true });
          } else {
            console.log('Operation cancelled.');
          }
          return;
        }
      }

      await withSpinner(
        'Closing ticket',
        () => client.supportService.cancelTicket(ticketId),
        format,
      );

      if (format === 'json') {
        outputJSON({ ticketId, status: 'closed' });
        return;
      }

      console.log(`Ticket ${ticketId} has been closed.`);
    } catch (error) {
      handleError(error, format);
    }
  };
}

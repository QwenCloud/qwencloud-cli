import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import { handleError, invalidArgError } from '../../utils/errors.js';
import { multilineInput } from '../../utils/multiline-input.js';
import { addExamples } from '../../utils/commander-helpers.js';
import { formatCmd } from '../../utils/runtime-mode.js';

const MESSAGE_MAX_LENGTH = 2000;

export function registerSupportReplyCommand(parent: Command, getClient: ClientFactory): void {
  const reply = parent
    .command('reply')
    .description('Add a reply to a support ticket')
    .argument('<ticket-id>', 'Ticket ID to reply to')
    .option(
      '--message <text>',
      `Reply message body, max ${MESSAGE_MAX_LENGTH} characters (enter interactive mode if omitted)`,
    )
    .option('--format <format>', 'Output format: table, json, text (default: auto)');

  addExamples(reply, [
    formatCmd('support reply <ticket-id> --message "Please check the logs"'),
    `${formatCmd('support reply <ticket-id>')}    (interactive mode)`,
  ]);

  reply.action(supportReplyAction(reply, getClient));
}

export function supportReplyAction(cmd: Command, getClient: ClientFactory) {
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

      let message = typeof options.message === 'string' ? options.message.trim() : '';

      if (!message) {
        if (!process.stdin.isTTY) {
          throw invalidArgError(
            'Reply message is required in non-interactive mode. Use --message <text>.',
          );
        }
        const typed = await multilineInput({
          title: 'Type your reply message',
          placeholder: 'Enter reply content. Tab to switch to buttons, Enter to send.',
        });
        message = typed.trim();
        if (!message) {
          if (format === 'json') {
            outputJSON({ ticketId, cancelled: true });
          } else {
            console.log('Operation cancelled.');
          }
          return;
        }
      }

      if (message.length > MESSAGE_MAX_LENGTH) {
        process.stderr.write(
          `Warning: Input exceeds ${MESSAGE_MAX_LENGTH} characters and has been truncated.\n`,
        );
        message = message.slice(0, MESSAGE_MAX_LENGTH);
      }

      const isInteractive = !options.message;

      // Content pre-check: block submission when flagged.
      // Interactive: prompt user to revise; Non-interactive: error out.
      let hasRisk = false;
      try {
        const result = await client.supportService.identifyRiskWord(ticketId, message);
        hasRisk = result.hasRisk;
      } catch {
        // Non-critical; proceed on failure.
      }

      if (hasRisk) {
        if (!isInteractive) {
          throw invalidArgError('Your message may need revising. Please modify and retry.');
        }

        // Interactive: loop until content passes or user cancels
        while (hasRisk) {
          process.stderr.write('Your message may need revising.\n');
          const revised = await multilineInput({
            title: 'Revise your reply message',
            placeholder:
              'Edit your reply. Tab to switch to buttons, Enter to send. Leave empty to cancel.',
          });
          message = revised.trim();
          if (!message) {
            if (format === 'json') {
              outputJSON({ ticketId, cancelled: true });
            } else {
              console.log('Operation cancelled.');
            }
            return;
          }
          try {
            const recheck = await client.supportService.identifyRiskWord(ticketId, message);
            hasRisk = recheck.hasRisk;
          } catch {
            hasRisk = false;
          }
        }
      }

      await withSpinner(
        'Sending reply',
        () => client.supportService.createMessage(ticketId, message),
        format,
      );

      if (format === 'json') {
        outputJSON({ ticketId, status: 'sent' });
        return;
      }

      console.log(`Reply sent to ticket ${ticketId}.`);
    } catch (error) {
      handleError(error, format);
    }
  };
}

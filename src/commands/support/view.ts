import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import { buildSupportViewViewModel } from '../../view-models/support/index.js';
import { renderTextSupportView } from '../../output/text/support.js';
import { renderSupportViewInk } from '../../ui/SupportView.js';
import { handleError } from '../../utils/errors.js';
import { addExamples } from '../../utils/commander-helpers.js';
import { formatCmd } from '../../utils/runtime-mode.js';

export function registerSupportViewCommand(parent: Command, getClient: ClientFactory): void {
  const view = parent
    .command('view')
    .description('View support ticket details and message history')
    .argument('<ticket-id>', 'Ticket ID to view')
    .option('--format <format>', 'Output format: table, json, text (default: auto)');

  addExamples(view, [
    formatCmd('support view <ticket-id>'),
    formatCmd('support view <ticket-id> --format json'),
  ]);

  view.action(supportViewAction(view, getClient));
}

export function supportViewAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command, ticketId: string) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      await ensureAuthenticated();
      const client = await getClient();
      const { detail, messages: messagesResult } = await withSpinner(
        'Fetching ticket details',
        () => client.supportService.getTicketDetail(ticketId),
        format,
      );

      const vm = buildSupportViewViewModel(
        detail,
        messagesResult.messages,
        messagesResult.truncated,
      );

      if (format === 'json') {
        outputJSON(vm);
        return;
      }

      if (format === 'text') {
        renderTextSupportView(vm);
        return;
      }

      // Table mode: Ink-rendered detail card when attached to a TTY,
      // plain-text fallback otherwise (pipes, redirects, non-interactive).
      if (process.stdout.isTTY) {
        await renderSupportViewInk(vm);
        return;
      }

      renderTextSupportView(vm);
    } catch (error) {
      handleError(error, format);
    }
  };
}

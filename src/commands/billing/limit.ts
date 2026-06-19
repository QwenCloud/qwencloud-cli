import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import { buildBillingLimitViewModel, defaultViewContext } from '../../view-models/billing/index.js';
import { renderBillingLimitInk } from '../../ui/BillingLimit.js';
import { renderTextBillingLimit } from '../../output/text/billing.js';
import { handleError } from '../../utils/errors.js';

export function registerBillingLimitCommand(parent: Command, getClient: ClientFactory): void {
  const limit = parent
    .command('limit')
    .description('Show consumption limit and alert configuration')
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  limit.action(billingLimitAction(limit, getClient));
}

export function billingLimitAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      await ensureAuthenticated();
      const client = await getClient();
      const data = await withSpinner('Fetching usage limit', () => client.getUsageLimit(), format);

      if (format === 'json') {
        outputJSON(data);
        return;
      }

      const vm = buildBillingLimitViewModel(data, defaultViewContext());
      if (format === 'text') {
        renderTextBillingLimit(vm);
      } else {
        await renderBillingLimitInk(vm);
      }
    } catch (error) {
      handleError(error, format);
    }
  };
}

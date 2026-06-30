import { Option, type Command } from 'commander';
import type { ClientFactory } from '../../../api/client.js';
import { resolveFormatFromCommand, outputJSON, formatTextTable } from '../../../output/format.js';
import { getEffectiveConfig } from '../../../config/manager.js';
import { ensureAuthenticated } from '../../../auth/credentials.js';
import { withSpinner } from '../../../ui/spinner.js';
import { handleError } from '../../../utils/errors.js';
import { buildPaymentMethodListViewModel } from '../../../view-models/billing/payment-method.js';
import { renderPaymentMethodListInk } from '../../../ui/PaymentMethodList.js';

const EMPTY_HINT = 'No payment methods found.';

export function registerBillingPaymentMethodListCommand(
  parent: Command,
  getClient: ClientFactory,
): void {
  const list = parent
    .command('list')
    .description('List bound payment methods')
    .addOption(
      new Option('--format <fmt>', 'Output format: table, json, text (default: auto)')
        .choices(['table', 'json', 'text']),
    );

  list.action(billingPaymentMethodListAction(list, getClient));
}

export function billingPaymentMethodListAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      await ensureAuthenticated();
      const client = await getClient();

      const raw = await withSpinner(
        'Fetching payment methods',
        () => client.getPaymentMethods(),
        format,
      );

      const data: typeof raw = {
        ...raw,
        items: raw.items.filter((item) => item.status.toUpperCase() === 'VALID'),
      };

      if (format === 'json') {
        outputJSON(data);
        return;
      }

      const vm = buildPaymentMethodListViewModel(data);

      if (vm.rows.length === 0) {
        console.log(EMPTY_HINT);
        return;
      }

      if (format === 'text') {
        const headers = ['TYPE', 'NUMBER', 'STATUS'];
        const rows = vm.rows.map((r) => [r.type, r.number, r.status]);
        console.log(formatTextTable(headers, rows));
        console.log(`  TOTAL: ${vm.rows.length}`);
      } else {
        await renderPaymentMethodListInk(vm);
      }
    } catch (error) {
      handleError(error, format);
    }
  };
}

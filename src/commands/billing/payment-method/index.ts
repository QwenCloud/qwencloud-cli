import type { Command } from 'commander';
import type { ClientFactory } from '../../../api/client.js';
import { registerBillingPaymentMethodBindCommand } from './bind.js';
import { registerBillingPaymentMethodListCommand } from './list.js';

export function registerBillingPaymentMethodCommands(
  parent: Command,
  getClient: ClientFactory,
): void {
  const paymentMethod = parent.command('payment-method').description('Manage payment methods');

  registerBillingPaymentMethodBindCommand(paymentMethod, getClient);
  registerBillingPaymentMethodListCommand(paymentMethod, getClient);

  paymentMethod.action(() => {
    paymentMethod.outputHelp();
    process.stdout.write('\n');
  });
}

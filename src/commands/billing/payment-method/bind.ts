import { Option, type Command } from 'commander';
import type { ClientFactory } from '../../../api/client.js';
import type { ResolvedFormat } from '../../../types/config.js';
import { resolveFormat, outputJSON } from '../../../output/format.js';
import { openBrowser } from '../../../utils/open-browser.js';

const BIND_URL = 'https://home.qwencloud.com/billing/overview?target=payment';

export function registerBillingPaymentMethodBindCommand(
  parent: Command,
  _getClient: ClientFactory,
): void {
  const bind = parent
    .command('bind')
    .description('Open browser to manage or bind a payment method')
    .addOption(
      new Option('--format <fmt>', 'Output format: table, json, text')
        .choices(['table', 'json', 'text']),
    );

  bind.action(billingPaymentMethodBindAction(bind, _getClient));
}

export function billingPaymentMethodBindAction(cmd: Command, _getClient: ClientFactory) {
  return async function (this: Command) {
    const format = resolveBindFormat(this ?? cmd);

    let opened = true;
    try {
      const result: unknown = (openBrowser as (url: string) => unknown)(BIND_URL);
      if (result instanceof Promise) {
        opened = (await result) !== false;
      } else if (result === false) {
        opened = false;
      }
    } catch {
      opened = false;
    }

    if (format === 'json') {
      const message = opened
        ? 'If the browser did not open automatically, copy the link below.'
        : 'Please copy the link below and open it in your browser.';
      outputJSON({ bindUrl: BIND_URL, opened, message });
      return;
    }

    if (format === 'text') {
      if (opened) {
        console.log('If the browser did not open automatically, copy the link below:');
      } else {
        console.log('Please copy the link below and open it in your browser:');
      }
      console.log(BIND_URL);
      return;
    }

    // TUI format
    const oscUrl = `\x1b]8;;${BIND_URL}\x07${BIND_URL}\x1b]8;;\x07`;
    if (opened) {
      console.log(
        `\x1b[32m\u2713\x1b[0m Opening payment method management page in your browser...`,
      );
      console.log('');
      console.log('  If the browser did not open automatically, copy the link below:');
      console.log(`  ${oscUrl}`);
    } else {
      console.log(`\x1b[33m\u26a0\x1b[0m Could not open browser automatically.`);
      console.log('  Please copy the link below and open it in your browser:');
      console.log(`  ${oscUrl}`);
    }

  };
}

function resolveBindFormat(cmd: Command): ResolvedFormat {
  let current: Command | null = cmd;
  while (current) {
    const opts = current.opts();
    if (opts.format && typeof opts.format === 'string' && opts.format !== 'table') {
      return resolveFormat(opts.format);
    }
    current = current.parent ?? null;
  }
  return 'table';
}

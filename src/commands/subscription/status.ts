import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import { buildSubscriptionStatusViewModel } from '../../view-models/subscription/index.js';
import { formatSubscriptionStatusJson } from '../../view-models/subscription/shared.js';
import { renderSubscriptionStatusInk } from '../../ui/SubscriptionStatus.js';
import { renderTextSubscriptionStatus } from '../../output/text/subscription.js';
import { handleError, CliError, HandledError } from '../../utils/errors.js';
import { registerCommandInterrupt } from '../../utils/command-interrupt.js';
import { EXIT_CODES } from '../../utils/exit-codes.js';
import { TYPE_LABEL, ORDER_STATUS_LABEL } from '../../view-models/subscription/orders.js';

function totalFailureError(exitCode: 1 | 2 | 3 | 4): CliError {
  if (exitCode === 2)
    return new CliError({
      code: 'AUTH_REQUIRED',
      message: 'Subscription status authentication failed. Run: qwencloud auth login',
      exitCode,
    });
  if (exitCode === 3)
    return new CliError({
      code: 'NETWORK_ERROR',
      message: 'Subscription status requests failed. Check your network connection.',
      exitCode,
    });
  if (exitCode === 4)
    return new CliError({
      code: 'CONFIG_ERROR',
      message: 'Subscription status configuration or response protocol is invalid.',
      exitCode,
    });
  return new CliError({
    code: 'SUBSCRIPTION_STATUS_UNAVAILABLE',
    message: 'No subscription status data could be confirmed.',
    exitCode,
  });
}

export function registerSubscriptionStatusCommand(parent: Command, getClient: ClientFactory): void {
  const status = parent
    .command('status')
    .description('Aggregate individual and team Token Plan and Coding Plan subscription status')
    .option('--plan <kind>', 'Filter by plan: token | coding')
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  status.action(subscriptionStatusAction(status, getClient));
}

export function subscriptionStatusAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command, options: Record<string, unknown>) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on('SIGINT', cancel);
    const unregister = registerCommandInterrupt(cancel);
    try {
      let plan: 'token' | 'coding' | undefined;
      if (options.plan === 'token' || options.plan === 'coding') plan = options.plan;
      else if (options.plan !== undefined)
        throw new CliError({
          code: 'INVALID_ARGUMENT',
          message: '--plan must be token or coding.',
          exitCode: EXIT_CODES.INVALID_ARGUMENT,
        });
      await ensureAuthenticated();
      const client = await getClient();
      const result = await withSpinner(
        'Loading subscription status',
        () =>
          client.getSubscriptionStatus({ ...(plan ? { plan } : {}), signal: controller.signal }),
        format === 'text' ? 'json' : format,
      );
      controller.signal.throwIfAborted();

      if (format === 'json') {
        const { data, diagnostics } = result;
        if (data) {
          const jsonData = { ...data };
          if (jsonData.recentOrders && Array.isArray(jsonData.recentOrders)) {
            jsonData.recentOrders = jsonData.recentOrders.map((o) => ({
              ...o,
              orderType: TYPE_LABEL[(o.orderType ?? '').toLowerCase()] ?? o.orderType ?? '—',
              status: ORDER_STATUS_LABEL[(o.status ?? '').toUpperCase()] ?? o.status ?? '—',
            }));
          }
          outputJSON(
            plan === 'token'
              ? formatSubscriptionStatusJson({ ...jsonData, diagnostics })
              : {
                  ...jsonData,
                  ...(jsonData.individual
                    ? { individual: formatSubscriptionStatusJson(jsonData.individual) }
                    : {}),
                  ...(jsonData.team ? { team: formatSubscriptionStatusJson(jsonData.team) } : {}),
                  diagnostics,
                },
          );
        } else {
          outputJSON({ data: null, diagnostics });
          handleError(totalFailureError(result.failureExitCode ?? 1), format);
        }
        return;
      }

      const vm = buildSubscriptionStatusViewModel(result.data, result.diagnostics);
      if (format === 'text') {
        renderTextSubscriptionStatus(vm);
      } else {
        await renderSubscriptionStatusInk(vm);
      }
      controller.signal.throwIfAborted();
      if (result.data === null) {
        handleError(totalFailureError(result.failureExitCode ?? 1), format);
      }
    } catch (error) {
      if (error instanceof HandledError) throw error;
      if (controller.signal.aborted)
        handleError(
          new CliError({
            code: 'INTERRUPTED',
            message: 'Subscription status query cancelled.',
            exitCode: 130,
          }),
          format,
        );
      handleError(error, format);
    } finally {
      controller.abort();
      process.off('SIGINT', cancel);
      unregister();
    }
  };
}

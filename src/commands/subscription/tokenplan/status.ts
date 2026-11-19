import type { Command } from 'commander';
import type { ClientFactory } from '../../../api/client.js';
import { resolveFormatFromCommand, outputJSON, formatTextTable } from '../../../output/format.js';
import { getEffectiveConfig } from '../../../config/manager.js';
import { withSpinner } from '../../../ui/spinner.js';
import {
  buildTokenPlanStatusViewModel,
  type TokenPlanStatusViewModel,
} from '../../../view-models/subscription/tokenplan-status.js';
import { formatSubscriptionStatusJson } from '../../../view-models/subscription/shared.js';
import { renderSubscriptionTokenPlanStatusInk } from '../../../ui/SubscriptionTokenPlanStatus.js';
import { handleError, CliError, HandledError } from '../../../utils/errors.js';
import { EXIT_CODES } from '../../../utils/exit-codes.js';
import { registerCommandInterrupt } from '../../../utils/command-interrupt.js';
import {
  collectTokenPlanDiagnostics,
  subscriptionFailureExitCode,
} from '../../../services/subscription-diagnostics.js';
import type {
  TokenPlanStatusResult,
  TokenPlanStatusOptions,
} from '../../../types/tokenplan-subscription.js';

function tokenPlanStatusFailureMessage(exitCode: number): string {
  if (exitCode === 2) return 'Token Plan status authentication failed. Run: qwencloud auth login';
  if (exitCode === 3) return 'Token Plan status requests failed. Check your network connection.';
  if (exitCode === 4) return 'Token Plan status configuration or response protocol is invalid.';
  return 'No Token Plan subscription status could be confirmed.';
}

import { hasConfirmedTokenPlanEdition } from '../../../services/tokenplan-team.js';

function isTotalFailure(
  result: TokenPlanStatusResult,
  edition: TokenPlanStatusOptions['edition'],
): boolean {
  const selected =
    edition === 'individual'
      ? [result.individual]
      : edition === 'team'
        ? [result.team]
        : [result.individual, result.team];
  if (selected.some((node) => node !== undefined))
    return !selected.some(hasConfirmedTokenPlanEdition);
  return (
    result.seatSummary === null &&
    result.period === null &&
    result.autoRenew === null &&
    result.renewable === null
  );
}

export function subscriptionTokenPlanStatusAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command): Promise<void> {
    const current = this ?? cmd;
    const format = resolveFormatFromCommand(current, getEffectiveConfig());
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on('SIGINT', cancel);
    const unregister = registerCommandInterrupt(cancel);
    try {
      const edition = current.opts<{ edition?: string }>().edition ?? 'all';
      if (edition !== 'all' && edition !== 'individual' && edition !== 'team') {
        throw new CliError({
          code: 'INVALID_ARGUMENT',
          message: '--edition must be all, individual or team.',
          exitCode: EXIT_CODES.INVALID_ARGUMENT,
        });
      }
      const { ensureAuthenticated } = await import('../../../auth/credentials.js');
      await ensureAuthenticated();
      const client = await getClient();
      const result = await withSpinner(
        'Loading Token Plan status',
        () =>
          client.subscriptionTokenPlanService.getTokenPlanStatus({
            edition,
            signal: controller.signal,
          }),
        format === 'text' ? 'json' : format,
      );
      controller.signal.throwIfAborted();
      const vm = buildTokenPlanStatusViewModel(
        result,
        format === 'json' ? 'json' : format === 'text' ? 'text' : 'tui',
      );
      if (format === 'json') {
        outputJSON(
          formatSubscriptionStatusJson({
            product: vm.product,
            period: vm.period,
            autoRenew: vm.autoRenew,
            renewable: vm.renewable,
            seatSummary: vm.seatSummary,
            diagnostics: vm.diagnostics,
            ...(vm.individual === undefined ? {} : { individual: vm.individual }),
            ...(vm.team === undefined ? {} : { team: vm.team }),
          }),
        );
      } else if (format === 'text') renderTextTokenPlanStatus(vm);
      else await renderSubscriptionTokenPlanStatusInk(vm);
      controller.signal.throwIfAborted();
      if (isTotalFailure(result, edition))
        handleError(
          new CliError({
            code: 'TOKENPLAN_STATUS_UNAVAILABLE',
            message: tokenPlanStatusFailureMessage(
              subscriptionFailureExitCode(collectTokenPlanDiagnostics(result)),
            ),
            exitCode: subscriptionFailureExitCode(collectTokenPlanDiagnostics(result)),
          }),
          format,
        );
    } catch (error) {
      if (error instanceof HandledError) throw error;
      if (controller.signal.aborted)
        handleError(
          new CliError({
            code: 'INTERRUPTED',
            message: 'Token Plan status query cancelled.',
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

function renderTextTokenPlanStatus(vm: TokenPlanStatusViewModel): void {
  console.log('TOKEN PLAN STATUS');
  for (const [index, section] of vm.editionSections.entries()) {
    if (index > 0) console.log('');
    console.log(`  ${section.title}`);
    for (const field of section.fields) console.log(`    ${field.label.padEnd(18)}${field.value}`);
    for (const table of section.detailTables ?? []) {
      console.log(`\n    ${table.title}`);
      console.log(
        table.rows.length
          ? formatTextTable(table.headers, table.rows, 4)
          : `    ${table.emptyMessage}`,
      );
      if (table.note)
        console.log(
          table.note
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n'),
        );
    }
  }
  if (vm.editionSections.length === 0 && vm.header) {
    console.log(`  ${'Product:'.padEnd(14)}${vm.header.product}`);
    console.log(`  ${'End At:'.padEnd(14)}${vm.header.period}`);
    console.log(`  ${'Auto-Renew:'.padEnd(14)}${vm.header.autoRenew}`);
    console.log(`  ${'Renewable:'.padEnd(14)}${vm.header.renewable}`);
    if (vm.seatLines?.length)
      console.log(
        `\n${formatTextTable(
          ['Seat Type', 'Seats', 'Total Credits', 'Remaining Credits', 'Reset At'],
          vm.seatLines.map((row) => [
            row.specType,
            row.seats,
            row.totalValue,
            row.surplusValue,
            row.nextCycleFlushTime,
          ]),
          2,
        )}`,
      );
  }
  if (vm.warnings?.length)
    console.log(`\n${vm.warnings.map((warning) => `  ${warning}`).join('\n')}`);
  if (vm.footnote) console.log(`\n  ${vm.footnote}`);
}

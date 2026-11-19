import type { Command } from 'commander';
import type { ClientFactory } from '../../../api/client.js';
import { subscriptionTokenPlanListAction } from './list.js';
import { subscriptionTokenPlanStatusAction } from './status.js';
import { subscriptionTokenPlanSeatsAction } from './seats.js';
import { addExamples } from '../../../utils/commander-helpers.js';
import { formatCmd } from '../../../utils/runtime-mode.js';
import { wrapText } from '../../../ui/textWrap.js';

export function registerSubscriptionTokenPlanCommands(
  parent: Command,
  getClient: ClientFactory,
): void {
  const tokenplan = parent
    .command('tokenplan')
    .description('Individual and team Token Plan subscriptions');
  const list = tokenplan
    .command('list')
    .usage('[flags]')
    .helpOption('-h, --help', 'Show this help')
    .description('List Token Plan prices, quota windows and optional supported models.')
    .option(
      '--edition <edition>',
      'Edition to display: all, individual, team (default: all)',
      'all',
    )
    .option(
      '--billing-cycle <cycle>',
      'Billing cycle to display. Individual: monthly, quarterly, yearly. Team: monthly, yearly (default: monthly)',
      'monthly',
    )
    .option(
      '--include-models',
      'Include supported models for the selected editions (default: false)',
      false,
    )
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');
  list.addHelpText(
    'after',
    [
      '  You can view Token Plan prices without logging in.',
      '  To view your subscription status and account-specific availability, run:',
      `    ${formatCmd('auth login')}`,
      '',
      '  Your purchase status shown here is for reference only. Your eligibility will be verified again before purchase.',
    ].join('\n'),
  );
  addExamples(list, [
    formatCmd('subscription tokenplan list'),
    formatCmd(
      'subscription tokenplan list --edition individual --billing-cycle quarterly --include-models --format json',
    ),
  ]);
  list.action(subscriptionTokenPlanListAction(list, getClient));

  const status = tokenplan
    .command('status')
    .description('Show Token Plan subscriptions, validity, auto-renewal and remaining quotas.')
    .option('--edition <edition>', 'Edition: individual, team, all (default: all)', 'all')
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');
  status.addHelpText('after', ({ command }) => {
    const columns = process.stdout.columns;
    const helpWidth = Math.min(
      80,
      command.createHelp().helpWidth ?? 80,
      Number.isFinite(columns) && columns > 1 ? Math.floor(columns) - 1 : 80,
    );
    return [
      'Individual results include tiers.',
      'Team results include seatSummaries grouped by seatType.',
      'Each seat summary includes seatType, seatCount, totalCredits, remainingCredits, remainingPct and resetAt.',
      '',
      'endAt is subscription validity; resetAt is the Credit reset time.',
    ]
      .flatMap((paragraph) =>
        wrapText(paragraph, Math.max(1, helpWidth - 4)).map((line) => (line ? `    ${line}` : '')),
      )
      .join('\n');
  });
  addExamples(status, [
    formatCmd('subscription tokenplan status'),
    formatCmd('subscription tokenplan status --edition team --format json'),
  ]);
  status.action(subscriptionTokenPlanStatusAction(status, getClient));

  const seats = tokenplan.command('seats').description('List Token Plan seat instances');
  seats.action(subscriptionTokenPlanSeatsAction(seats, getClient));
  tokenplan.action(() => {
    tokenplan.outputHelp();
    process.stdout.write('\n');
  });
}

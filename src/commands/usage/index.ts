import type { Command } from 'commander';
import { usageSummaryAction } from './summary.js';
import { usageBreakdownAction } from './breakdown.js';
import { usageFreeTierAction } from './free-tier.js';
import { usagePaygAction } from './payg.js';
import { usageLogsAction } from './logs.js';
import { formatCmd } from '../../utils/runtime-mode.js';
import { setLongDescription, addExamples } from '../../utils/commander-helpers.js';
import type { ClientFactory } from '../../api/client.js';

export { usageSummaryAction } from './summary.js';
export { usageBreakdownAction } from './breakdown.js';
export { usageFreeTierAction } from './free-tier.js';
export { usagePaygAction } from './payg.js';
export { usageLogsAction, registerUsageLogsCommand } from './logs.js';

const collectRepeatable = (value: string, previous: string[] | undefined): string[] =>
  previous ? [...previous, value] : [value];

export function registerUsageCommands(program: Command, getClient: ClientFactory): void {
  const usage = program.command('usage').description('View usage and billing');

  const summaryCmd = usage
    .command('summary')
    .description('Show usage summary across all models')
    .option('--from <date>', 'Start date (YYYY-MM-DD)')
    .option('--to <date>', 'End date (YYYY-MM-DD)')
    .option(
      '--period <preset>',
      'Period preset: today, yesterday, week, month, last-month, quarter, year, YYYY-MM',
    )
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  summaryCmd.action(usageSummaryAction(summaryCmd, getClient));

  addExamples(summaryCmd, [
    formatCmd('usage summary'),
    formatCmd('usage summary --period last-month --format json'),
  ]);

  const breakdownCmd = usage
    .command('breakdown')
    .description('Show per-day/month/quarter usage for a model (PAYG only)')
    // Use .option (not .requiredOption) so the missing --model case is handled
    // by the action's structured invalidArgError, giving Agents a parseable
    // {"error":...} JSON instead of Commander's bare `error: required option ...`.
    .option('--model <id>', 'Model ID (required)')
    .option('--granularity <g>', 'Time granularity: day, month, quarter (default: day)')
    .option('--from <date>', 'Start date (YYYY-MM-DD)')
    .option('--to <date>', 'End date (YYYY-MM-DD)')
    .option(
      '--period <preset>',
      'Period preset: today, yesterday, week, month, last-month, quarter, year, YYYY-MM',
    )
    .option('--days <n>', 'Number of days to look back')
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  breakdownCmd.action(usageBreakdownAction(breakdownCmd, getClient));

  setLongDescription(
    breakdownCmd,
    `Show usage breakdown for a specific model (time-series).\n\n  Note: PAYG only — free tier consumption is not available as a historical\n  series. Use \`${formatCmd('usage free-tier')}\` for current quota state.`,
  );

  addExamples(breakdownCmd, [
    formatCmd('usage breakdown --model qwen-plus --period last-month --granularity month'),
    formatCmd('usage breakdown --model qwen-plus --days 7 --format json'),
  ]);

  const freeTierCmd = usage
    .command('free-tier')
    .description('Browse all free tier models with quota status')
    .option('--from <date>', 'Start date (YYYY-MM-DD)')
    .option('--to <date>', 'End date (YYYY-MM-DD)')
    .option(
      '--period <preset>',
      'Period preset: today, yesterday, week, month, last-month, quarter, year, YYYY-MM',
    )
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  freeTierCmd.action(usageFreeTierAction(freeTierCmd, getClient));

  addExamples(freeTierCmd, [
    formatCmd('usage free-tier'),
    formatCmd('usage free-tier --format json'),
  ]);

  const paygCmd = usage
    .command('payg')
    .description('Browse pay-as-you-go usage across all models')
    .option('--from <date>', 'Start date (YYYY-MM-DD)')
    .option('--to <date>', 'End date (YYYY-MM-DD)')
    .option(
      '--period <preset>',
      'Period preset: today, yesterday, week, month, last-month, quarter, year, YYYY-MM',
    )
    .option('--days <n>', 'Number of days to look back')
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  paygCmd.action(usagePaygAction(paygCmd, getClient));

  addExamples(paygCmd, [
    formatCmd('usage payg'),
    formatCmd('usage payg --period last-month'),
    formatCmd('usage payg --from 2026-01-01 --to 2026-03-31'),
  ]);

  const logsCmd = usage
    .command('logs')
    .description('Browse paginated call logs filtered by time, model, and status')
    .option('--from <date>', 'Start date (YYYY-MM-DD or RFC3339)')
    .option('--to <date>', 'End date (YYYY-MM-DD or RFC3339)')
    .option('--period <preset>', 'Period preset: today, week, month, ...')
    .option('--model <id>', 'Model id (repeatable)', collectRepeatable)
    .option(
      '--status <type>',
      'Status filter: 0 (cancel), 2xx (success), 4xx (client error), 5xx (server error). Repeatable',
      collectRepeatable,
    )
    .option('--request-id <id>', 'Exact request id; ignores other filters when set')
    .option('--page <n>', 'Page number', (v) => parseInt(v, 10), 1)
    .option('--page-size <n>', 'Page size (1..100)', (v) => parseInt(v, 10), 20)
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  logsCmd.action(usageLogsAction(logsCmd, getClient));

  addExamples(logsCmd, [
    formatCmd('usage logs --period 24h'),
    formatCmd('usage logs --model qwen-plus --status 5xx --format json'),
    formatCmd('usage logs --request-id 9f2c…a1bd'),
  ]);

  usage.action(() => {
    usage.outputHelp();
    process.stdout.write('\n');
  });
}

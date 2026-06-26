import React from 'react';
import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import {
  buildSupportListViewModel,
  type SupportListItemViewModel,
} from '../../view-models/support/index.js';
import { renderTextSupportList } from '../../output/text/support.js';
import { handleError, invalidArgError } from '../../utils/errors.js';
import { InteractiveTable } from '../../ui/InteractiveTable.js';
import { renderInteractive } from '../../ui/render.js';
import type { Column } from '../../ui/Table.js';
import { theme } from '../../ui/theme.js';
import { addExamples } from '../../utils/commander-helpers.js';
import { formatCmd } from '../../utils/runtime-mode.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

const SUPPORT_LIST_COLUMNS: Column[] = [
  { key: 'id', header: 'Ticket ID', color: (v: string) => theme.data(v) },
  { key: 'title', header: 'Title' },
  { key: 'status', header: 'Status' },
  { key: 'createdAt', header: 'Created' },
];

function toRows(items: SupportListItemViewModel[]): Record<string, string>[] {
  return items.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    createdAt: t.createdAt,
  }));
}

export function registerSupportListCommand(parent: Command, getClient: ClientFactory): void {
  const list = parent
    .command('list')
    .description('List support tickets for the current account')
    .option('--page <n>', 'Page number (default: 1)')
    .option('--page-size <n>', 'Page size, 1-10 (default: 10)')
    .option('--format <format>', 'Output format: table, json, text (default: auto)');

  addExamples(list, [
    formatCmd('support list'),
    formatCmd('support list --page 2 --page-size 5'),
    formatCmd('support list --format json'),
  ]);

  list.action(supportListAction(list, getClient));
}

const INTEGER_PATTERN = /^[+-]?\d+$/;

function parseStrictInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !INTEGER_PATTERN.test(raw)) return null;
  return parseInt(raw, 10);
}

export function supportListAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command, options: Record<string, unknown>) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      let page = DEFAULT_PAGE;
      if (options.page !== undefined) {
        const parsed = parseStrictInt(options.page);
        if (parsed === null || parsed < 1) {
          throw invalidArgError('page must be a positive integer');
        }
        page = parsed;
      }

      let pageSize = DEFAULT_PAGE_SIZE;
      if (options.pageSize !== undefined) {
        const parsed = parseStrictInt(options.pageSize);
        if (parsed === null || parsed < 1 || parsed > 10) {
          throw invalidArgError('--page-size must be a positive integer between 1 and 10.');
        }
        pageSize = parsed;
      }

      await ensureAuthenticated();
      const client = await getClient();
      const result = await withSpinner(
        'Fetching support tickets',
        () => client.supportService.listTickets({ page, pageSize }),
        format,
      );

      const vm = buildSupportListViewModel(
        result.tickets,
        result.page,
        result.pageSize,
        result.total,
      );

      if (format === 'json') {
        const { emptyMessage: _emptyMessage, ...jsonPayload } = vm;
        outputJSON(jsonPayload);
        return;
      }

      if (vm.isEmpty) {
        if (vm.total > 0) {
          console.log(`No tickets on page ${page} (total: ${vm.total}).`);
        } else {
          console.log(vm.emptyMessage);
        }
        return;
      }

      if (format === 'text') {
        renderTextSupportList(vm);
        return;
      }

      // Table mode: interactive TUI when attached to a TTY,
      // plain text fallback when piped or redirected.
      if (process.stdout.isTTY) {
        const initialRows = toRows(vm.items);

        const loadPage = async (p: number): Promise<Record<string, string>[]> => {
          if (p === page) return initialRows;
          const r = await client.supportService.listTickets({ page: p, pageSize });
          const v = buildSupportListViewModel(r.tickets, r.page, r.pageSize, r.total);
          return toRows(v.items);
        };

        await renderInteractive(
          React.createElement(InteractiveTable, {
            columns: SUPPORT_LIST_COLUMNS,
            totalItems: vm.total,
            perPage: pageSize,
            loadPage,
            initialPage: page,
            initialRows,
            title: 'Support Tickets',
          }),
        );
        return;
      }

      renderTextSupportList(vm);
    } catch (error) {
      handleError(error, format);
    }
  };
}

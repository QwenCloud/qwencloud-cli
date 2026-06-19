/**
 * `docs search` — keyword search against the public docs index.
 *
 * Public endpoint via authOptional. Routes to DocsService through the
 * CliFacade, then fans the result out to the three rendering modes. The
 * view-model layer handles the partial-response degradation diagnostics so
 * the renderers stay declarative.
 */

import React from 'react';
import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { withSpinner } from '../../ui/spinner.js';
import {
  buildDocsSearchViewModel,
  buildDocContentViewModel,
} from '../../view-models/docs/index.js';
import { InteractiveDocsSearch } from '../../ui/InteractiveDocsSearch.js';
import { renderInteractive } from '../../ui/render.js';
import { renderTextDocsSearch, renderTextDocContent } from '../../output/text/docs.js';
import { DocsViewerHost } from './view.js';
import { handleError, CliError } from '../../utils/errors.js';
import { EXIT_CODES } from '../../utils/exit-codes.js';
import { site } from '../../site.js';
import type { DocsSearchOptions } from '../../services/docs-service.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;
const MAX_LIMIT = 100;
const TUI_PAGE_SIZE = 5;

function resolveLanguage(raw: unknown): 'en' | 'zh' {
  const v = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (v.startsWith('zh')) return 'zh';
  if (v === 'en') return 'en';
  return site.defaults.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function docsSearchAction(
  cmd: Command,
  getClient: ClientFactory,
): (...args: any[]) => void | Promise<void> {
  return async function (this: Command, query: string, options: Record<string, unknown>) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      const trimmed = (query ?? '').trim();
      if (!trimmed) {
        process.stderr.write('Error: query is required.\n');
        process.exitCode = 2;
        return;
      }
      const rawLimit = clampLimit(options.limit);
      const effectiveLimit = format === 'table' ? Math.min(rawLimit, TUI_PAGE_SIZE) : rawLimit;
      const page = clampPage(options.page);
      const language = resolveLanguage(options.language);

      const client = await getClient();
      const callOpts: DocsSearchOptions = {
        query: trimmed,
        limit: effectiveLimit,
        page,
        language,
      };
      const data = await withSpinner('Searching docs', () => client.searchDocs(callOpts), format);

      const vm = buildDocsSearchViewModel(data, {
        query: trimmed,
        page,
        pageSize: effectiveLimit,
        language,
      });

      const viewIndex = parseViewIndex(options.view);
      if (viewIndex !== null) {
        if (viewIndex < 1 || viewIndex > vm.items.length) {
          process.stderr.write(
            `Error: --view index ${viewIndex} is out of range (1..${vm.items.length}).\n`,
          );
          process.exitCode = 1;
          return;
        }
        const targetItem = vm.items[viewIndex - 1];
        if (targetItem.isDegraded || !targetItem.url) {
          process.stderr.write('Error: the selected item is unavailable.\n');
          process.exitCode = 1;
          return;
        }
        const result = await withSpinner(
          'Fetching document',
          () => client.fetchDocContent(targetItem.url),
          format,
        );
        if (format === 'json') {
          outputJSON({
            url: result.url,
            resolvedMarkdownUrl: result.resolvedMarkdownUrl,
            contentType: 'markdown',
            content: result.content,
            error: result.error,
          });
          if (result.error) process.exitCode = 1;
          return;
        }
        if (format === 'text') {
          renderTextDocContent(result);
          return;
        }
        const contentVm = buildDocContentViewModel(result);
        const noop = () => {};
        await renderInteractive(
          React.createElement(DocsViewerHost, {
            vm: contentVm,
            url: targetItem.url,
            onBack: noop,
            onQuit: noop,
          }),
        );
        return;
      }

      if (format === 'json') {
        outputJSON({
          query: vm.query,
          totalCount: vm.totalCount,
          page: vm.page,
          pageSize: vm.pageSize,
          items: vm.items,
          diagnostics: vm.diagnostics,
        });
        return;
      }

      if (format === 'text') {
        renderTextDocsSearch(vm);
        return;
      }

      await renderInteractive(
        React.createElement(InteractiveDocsSearch, {
          initialVm: vm,
          loadPage: async (pageNum: number) => {
            const data = await client.searchDocs({
              query: trimmed,
              limit: effectiveLimit,
              page: pageNum,
              language,
            });
            return buildDocsSearchViewModel(data, {
              query: trimmed,
              page: pageNum,
              pageSize: effectiveLimit,
              language,
            });
          },
          fetchContent: async (url: string) => {
            const result = await client.fetchDocContent(url);
            return buildDocContentViewModel(result);
          },
        }),
      );
    } catch (error) {
      handleError(error, format);
    }
  };
}

export function registerDocsSearchCommand(parent: Command, getClient: ClientFactory): Command {
  const search = parent
    .command('search <query>')
    .description('Search the official docs by keyword')
    .option('--limit <n>', 'Page size (1..100)', (v) => parseInt(v, 10), DEFAULT_LIMIT)
    .option('--page <n>', 'Page number', (v) => parseInt(v, 10), DEFAULT_PAGE)
    .option('--language <lang>', 'Language: en | zh (default from config)')
    .option('--view <index>', 'View content of search result at given index (1-based)')
    .option('--format <fmt>', 'Output format: table, json, text (default: auto)');

  search.action(docsSearchAction(search, getClient));
  return search;
}

function clampLimit(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_LIMIT;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new CliError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid value "${String(raw)}" for --limit. Must be a positive integer.`,
      exitCode: EXIT_CODES.INVALID_ARGUMENT,
    });
  }
  const truncated = Math.floor(n);
  if (truncated > MAX_LIMIT) {
    process.stderr.write(`Warning: --limit clamped to ${MAX_LIMIT}\n`);
    return MAX_LIMIT;
  }
  return truncated;
}

function clampPage(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_PAGE;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new CliError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid value "${String(raw)}" for --page. Must be a positive integer.`,
      exitCode: EXIT_CODES.INVALID_ARGUMENT,
    });
  }
  return Math.floor(n);
}

function parseViewIndex(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

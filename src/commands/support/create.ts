import React from 'react';
import type { Command } from 'commander';
import type { CliFacade, ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON, formatTextTable } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import { handleError, invalidArgError } from '../../utils/errors.js';
import { confirmPrompt } from '../../utils/confirm.js';
import { multilineInput } from '../../utils/multiline-input.js';
import { releaseOrKeepStdin } from '../../utils/stdin-control.js';
import { renderInteractive, renderWithInk } from '../../ui/render.js';
import { Table } from '../../ui/Table.js';
import type { Column } from '../../ui/Table.js';
import { CategorySelector, type CategorySelection } from '../../ui/CategorySelector.js';
import { SuggestionPicker, type SuggestionChoice } from '../../ui/SuggestionPicker.js';
import type { CategoryNode, CategorySuggestion } from '../../types/support.js';
import { addExamples } from '../../utils/commander-helpers.js';
import { formatCmd } from '../../utils/runtime-mode.js';

const DESCRIPTION_PREVIEW_LIMIT = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

export function registerSupportCreateCommand(parent: Command, getClient: ClientFactory): void {
  const create = parent
    .command('create')
    .description('Create a new support ticket')
    .option('--list-categories', 'List all available categories and exit')
    .option('--category-id <id>', 'Category ID for non-interactive ticket creation')
    .option('--description <text>', 'Issue description for non-interactive ticket creation (max 2000 chars)')
    .option('--format <format>', 'Output format: table, json, text (default: auto)')
    .addHelpText(
      'after',
      `
Interactive mode (default when no flags provided):
  1. Select issue category
  2. Describe the issue (Tab → Submit button)
  3. Review and confirm submission

Non-interactive mode:
  ${formatCmd('support create --category-id <id> --description "issue text"')}
  ${formatCmd('support create --list-categories')}`,
    );

  addExamples(create, [
    formatCmd('support create'),
    formatCmd('support create --list-categories'),
    formatCmd('support create --category-id <id> --description "issue text"'),
  ]);

  create.action(supportCreateAction(create, getClient));
}

export function supportCreateAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command, options: Record<string, unknown>) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      ensureAuthenticated();

      const listCategories = options.listCategories === true;
      const categoryId = typeof options.categoryId === 'string' ? options.categoryId.trim() : '';
      const descriptionFlag = typeof options.description === 'string' ? options.description : '';

      // Determine execution mode
      const isListMode = listCategories;
      const isNonInteractive = !isListMode && categoryId !== '' && descriptionFlag !== '';

      // TTY guard: only required for interactive mode
      if (!isListMode && !isNonInteractive) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          throw invalidArgError(
            'Interactive ticket creation requires a TTY. Run this command directly in a terminal.',
          );
        }
      }

      // Validate non-interactive partial args
      if (!isListMode && !isNonInteractive) {
        if (categoryId && !descriptionFlag) {
          throw invalidArgError(
            '--description is required when --category-id is provided.',
          );
        }
        if (!categoryId && descriptionFlag) {
          throw invalidArgError(
            '--category-id is required when --description is provided.',
          );
        }
      }

      const client = await getClient();

      // Mode 1: List categories
      if (isListMode) {
        const tree = await withSpinner(
          'Loading categories',
          () => client.supportService.getCategoryTree(),
          format,
        );
        await outputCategoryTree(tree, format);
        return;
      }

      // Mode 2: Non-interactive creation
      if (isNonInteractive) {
        let description = descriptionFlag.trim();
        if (description.length > DESCRIPTION_MAX_LENGTH) {
          process.stderr.write(
            `Warning: Input exceeds ${DESCRIPTION_MAX_LENGTH} characters and has been truncated.\n`,
          );
          description = description.slice(0, DESCRIPTION_MAX_LENGTH);
        }

        // Validate category-id against the category tree
        let validationTree: CategoryNode[];
        try {
          validationTree = await withSpinner(
            'Validating category',
            () => client.supportService.getCategoryTree(),
            format,
          );
        } catch {
          throw invalidArgError('Failed to fetch category list. Cannot validate category ID.');
        }
        const validIds: string[] = [];
        flattenCategoryIds(validationTree, validIds);
        if (!validIds.includes(categoryId)) {
          throw invalidArgError(
            `Invalid category ID: ${categoryId}. Use --list-categories to see available IDs.`,
          );
        }

        const result = await withSpinner(
          'Creating ticket',
          () =>
            client.supportService.createTicket({
              categoryId,
              description,
            }),
          format,
        );

        if (format === 'json') {
          outputJSON({
            id: result.vid,
            status: 'created',
            categoryId,
          });
          return;
        }

        console.log(`Ticket created successfully. ID: ${result.vid}`);
        return;
      }

      // Mode 3: Interactive creation (original flow)
      const tree = await withSpinner(
        'Loading categories',
        () => client.supportService.getCategoryTree(),
        format,
      );
      if (!Array.isArray(tree) || tree.length === 0) {
        throw invalidArgError('No support categories are available for this account.');
      }

      const selection = await selectCategoryInteractive(tree);
      if (!selection) {
        notifyCancelled(format);
        return;
      }

      // Stage 2: description input + AI suggestion
      let description = await multilineInput({
        title: 'Describe the issue in detail',
        placeholder: 'Type your description here. Tab to switch to buttons, Enter to submit.',
      });
      if (!description.trim()) {
        notifyCancelled(format);
        return;
      }
      description = description.trim();
      if (description.length > DESCRIPTION_MAX_LENGTH) {
        process.stderr.write(
          `Warning: Input exceeds ${DESCRIPTION_MAX_LENGTH} characters and has been truncated.\n`,
        );
        description = description.slice(0, DESCRIPTION_MAX_LENGTH);
      }

      let finalCategoryId = selection.id;
      let finalCategoryPath = selection.path;

      const suggestions = await fetchSuggestionsBestEffort(client, description);
      const distinctSuggestions = suggestions.filter(
        (s) => s.categoryId && s.categoryId !== selection.id,
      );

      if (distinctSuggestions.length > 0) {
        const choice = await pickSuggestionInteractive(selection, distinctSuggestions);
        if (choice === 'cancelled') {
          notifyCancelled(format);
          return;
        }
        if (choice) {
          finalCategoryId = choice.categoryId;
          finalCategoryPath = choice.categoryPath;
        }
      }

      // Stage 3: summary + confirmation
      printTicketSummary(finalCategoryPath, description);

      const ok = await confirmPrompt('Submit this ticket? (y/N)');
      if (!ok) {
        notifyCancelled(format);
        return;
      }

      const result = await withSpinner(
        'Creating ticket',
        () =>
          client.supportService.createTicket({
            categoryId: finalCategoryId,
            description,
          }),
        format,
      );

      if (format === 'json') {
        outputJSON({
          id: result.vid,
          status: 'created',
          categoryId: finalCategoryId,
          categoryPath: finalCategoryPath,
        });
        return;
      }

      console.log(`Ticket created successfully. ID: ${result.vid}`);
    } catch (error) {
      handleError(error, format);
    }
  };
}

// Helpers

async function selectCategoryInteractive(tree: CategoryNode[]): Promise<CategorySelection | null> {
  let result: CategorySelection | null = null;
  await renderInteractive(
    React.createElement(CategorySelector, {
      tree,
      onSelect: (sel: CategorySelection) => {
        result = sel;
      },
      onCancel: () => {
        result = null;
      },
    }),
  );

  // Yield one event-loop tick so Ink fully releases stdin before readline takes
  // over; otherwise the multi-line prompt may inherit a paused stream and miss
  // the first keystrokes.
  await new Promise((resolve) => setImmediate(resolve));
  releaseOrKeepStdin();

  return result;
}

async function pickSuggestionInteractive(
  current: CategorySelection,
  suggestions: CategorySuggestion[],
): Promise<SuggestionChoice | 'cancelled' | null> {
  let outcome: SuggestionChoice | 'cancelled' | null = null;
  await renderInteractive(
    React.createElement(SuggestionPicker, {
      userCategoryId: current.id,
      userCategoryPath: current.path,
      suggestions,
      onSelect: (c: SuggestionChoice) => {
        outcome = c;
      },
      onCancel: () => {
        outcome = 'cancelled';
      },
    }),
  );

  // Yield one event-loop tick so Ink fully releases stdin before any subsequent
  // readline-based prompt (e.g. confirmPrompt) takes over.
  await new Promise((resolve) => setImmediate(resolve));
  releaseOrKeepStdin();

  return outcome;
}

async function fetchSuggestionsBestEffort(
  client: CliFacade,
  description: string,
): Promise<CategorySuggestion[]> {
  try {
    return await client.supportService.suggestCategory(description);
  } catch {
    // AI suggestion is advisory only — never block the create flow on it.
    return [];
  }
}

function printTicketSummary(categoryPath: string, description: string): void {
  const trimmed =
    description.length > DESCRIPTION_PREVIEW_LIMIT
      ? description.slice(0, DESCRIPTION_PREVIEW_LIMIT) + '…'
      : description;
  process.stdout.write('\n═══ Ticket Summary ═══\n');
  process.stdout.write(`Category: ${categoryPath}\n`);
  process.stdout.write('Severity: Normal\n');
  process.stdout.write('Description:\n');
  for (const line of trimmed.split('\n')) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('\n');
}

const CATEGORY_COLUMNS: Column[] = [
  { key: 'id', header: 'ID' },
  { key: 'category', header: 'Category' },
];

async function outputCategoryTree(tree: CategoryNode[], format: 'json' | 'table' | 'text'): Promise<void> {
  const rows: { id: string; category: string }[] = [];
  flattenCategoryTree(tree, '', rows);

  if (format === 'json') {
    outputJSON(rows);
    return;
  }

  if (rows.length === 0) {
    console.log('No categories available.');
    return;
  }

  if (format === 'table') {
    await renderWithInk(React.createElement(Table, { columns: CATEGORY_COLUMNS, data: rows, paddingLeft: 0 }));
    return;
  }

  const tableRows = rows.map((r) => [r.id, r.category]);
  console.log(formatTextTable(['ID', 'Category'], tableRows));
}

function flattenCategoryIds(nodes: CategoryNode[], result: string[]): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      flattenCategoryIds(node.children, result);
    } else {
      result.push(node.id);
    }
  }
}

function flattenCategoryTree(
  nodes: CategoryNode[],
  parentPath: string,
  result: { id: string; category: string }[],
): void {
  for (const node of nodes) {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (node.children && node.children.length > 0) {
      flattenCategoryTree(node.children, path, result);
    } else {
      result.push({ id: node.id, category: node.name });
    }
  }
}

function notifyCancelled(format: 'json' | 'table' | 'text'): void {
  if (format === 'json') {
    outputJSON({ cancelled: true });
    return;
  }
  console.log('Operation cancelled.');
}

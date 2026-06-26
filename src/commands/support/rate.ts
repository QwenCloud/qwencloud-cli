import React from 'react';
import type { Command } from 'commander';
import type { ClientFactory } from '../../api/client.js';
import { resolveFormatFromCommand, outputJSON } from '../../output/format.js';
import { getEffectiveConfig } from '../../config/manager.js';
import { ensureAuthenticated } from '../../auth/credentials.js';
import { withSpinner } from '../../ui/spinner.js';
import { handleError, invalidArgError, HandledError } from '../../utils/errors.js';
import { EXIT_CODES } from '../../utils/exit-codes.js';
import { renderInteractive } from '../../ui/render.js';
import { releaseOrKeepStdin } from '../../utils/stdin-control.js';
import { multilineInput } from '../../utils/multiline-input.js';
import { RatingSelector } from '../../ui/RatingSelector.js';
import { TagSelector } from '../../ui/TagSelector.js';
import { buildSupportRateViewModel } from '../../view-models/support/index.js';
import type { SupportRateViewModel } from '../../view-models/support/index.js';
import type { AssessmentCardData } from '../../types/support.js';
import { addExamples } from '../../utils/commander-helpers.js';
import { formatCmd } from '../../utils/runtime-mode.js';

const COMMENT_MAX_LENGTH = 500;

const GOOD_TAGS = [
  'Good Service Attitude',
  'Fast Service Efficiency',
  'Strong Service Professionalism',
  'Comprehensive Product Functionality',
  'User-friendly Product Interface',
  'Reasonable Product Rules',
];

const BAD_TAGS = [
  'Poor Service Attitude',
  'Slow Service Efficiency',
  'Weak Service Capability',
  'Lacks Product Functionality',
  'Unfriendly Product Interface',
  'Product Rules Unreasonable',
];

export function registerSupportRateCommand(parent: Command, getClient: ClientFactory): void {
  const rate = parent
    .command('rate')
    .description('Rate a resolved support ticket (1-5 stars)')
    .argument('<ticket-id>', 'Ticket ID to rate')
    .option('--rating <n>', 'Satisfaction rating (1-5). Omit to enter interactive mode.')
    .option('--comment <text>', `Optional comment (max ${COMMENT_MAX_LENGTH} characters)`)
    .option('--format <format>', 'Output format: table, json, text (default: auto)');

  addExamples(rate, [
    formatCmd('support rate <ticket-id> --rating 5 --comment "Excellent"'),
    formatCmd('support rate <ticket-id> --rating 4'),
    `${formatCmd('support rate <ticket-id>')}    (interactive mode)`,
  ]);

  rate.action(supportRateAction(rate, getClient));
}

export function supportRateAction(cmd: Command, getClient: ClientFactory) {
  return async function (this: Command, ticketId: string, options: Record<string, unknown>) {
    const config = getEffectiveConfig();
    const format = resolveFormatFromCommand(this ?? cmd, config);

    try {
      const ratingFlag = parseRatingFlag(options.rating);
      let comment = sanitizeComment(options.comment, format);

      if (ratingFlag === undefined && !process.stdin.isTTY) {
        throw invalidArgError('Rating is required in non-interactive mode. Use --rating <1-5>.');
      }

      ensureAuthenticated();

      const client = await getClient();

      const ticket = await withSpinner(
        'Fetching ticket',
        () => client.supportService.getTicket(ticketId),
        format,
      );
      if (!ticket || !ticket.id) {
        throw invalidArgError(`Ticket not found: ${ticketId}`);
      }

      const cardData: AssessmentCardData = await withSpinner(
        'Checking rating eligibility',
        () => client.supportService.getAssessmentCard(ticketId),
        format,
      );

      if (cardData.alreadyRated) {
        notifyAlreadyRated(ticketId, cardData.satisfaction, format);
        throw new HandledError(EXIT_CODES.SUCCESS);
      }
      if (!cardData.hasCard) {
        throw invalidArgError(
          `Ticket ${ticketId} is not awaiting rating (it may not be closed yet).`,
        );
      }
      if (!cardData.editable) {
        throw invalidArgError(`Ticket ${ticketId} is not available for rating.`);
      }

      const isInteractive = ratingFlag === undefined;

      let rating: number;
      if (ratingFlag !== undefined) {
        rating = ratingFlag;
      } else {
        const interactive = await promptRatingInteractive();
        if (interactive === null) {
          notifyCancelled(ticketId, format);
          return;
        }
        rating = interactive;
      }

      let tags: { good?: string[]; bad?: string[] } | undefined;
      if (isInteractive) {
        if (rating < 4) {
          const selectedTags = await promptTagsInteractive(BAD_TAGS, true);
          if (selectedTags === null) {
            notifyCancelled(ticketId, format);
            return;
          }
          if (selectedTags.length > 0) {
            tags = { bad: selectedTags };
          }
        } else {
          const selectedTags = await promptTagsInteractive(GOOD_TAGS, false);
          if (selectedTags === null) {
            notifyCancelled(ticketId, format);
            return;
          }
          if (selectedTags.length > 0) {
            tags = { good: selectedTags };
          }
        }
      }

      if (isInteractive && !comment) {
        comment = await promptCommentInteractive(format);
      }

      const {
        editable: _editable,
        hasCard: _hasCard,
        alreadyRated: _alreadyRated,
        satisfaction: _satisfaction,
        ...metadata
      } = cardData;
      void _editable;
      void _hasCard;
      void _alreadyRated;
      void _satisfaction;
      const result = await withSpinner(
        'Submitting rating',
        () => client.supportService.rateTicket(ticketId, rating, comment, metadata, tags),
        format,
      );

      const vm = buildSupportRateViewModel(ticketId, rating, comment, result?.timestamp);
      emitResult(vm, format);
    } catch (error) {
      if (error instanceof HandledError) throw error;
      handleError(error, format);
    }
  };
}

// Helpers

function parseRatingFlag(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 5) {
    throw invalidArgError('Invalid --rating value. Must be an integer between 1 and 5.');
  }
  return value;
}

function sanitizeComment(raw: unknown, _format: 'json' | 'table' | 'text'): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= COMMENT_MAX_LENGTH) return trimmed;
  process.stderr.write(
    `Warning: Comment exceeds ${COMMENT_MAX_LENGTH} characters and was truncated.\n`,
  );
  return trimmed.slice(0, COMMENT_MAX_LENGTH);
}

async function promptRatingInteractive(): Promise<number | null> {
  let chosen: number | null = null;
  await renderInteractive(
    React.createElement(RatingSelector, {
      onSelect: (value: number) => {
        chosen = value;
      },
      onCancel: () => {
        chosen = null;
      },
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  releaseOrKeepStdin();
  return chosen;
}

async function promptTagsInteractive(
  tagOptions: string[],
  required: boolean,
): Promise<string[] | null> {
  let chosen: string[] | null = null;
  let cancelled = false;
  await renderInteractive(
    React.createElement(TagSelector, {
      tags: tagOptions,
      required,
      onSelect: (selected: string[]) => {
        chosen = selected;
      },
      onCancel: () => {
        cancelled = true;
        chosen = null;
      },
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  releaseOrKeepStdin();
  return cancelled ? null : (chosen ?? []);
}

async function promptCommentInteractive(
  format: 'json' | 'table' | 'text',
): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;

  const raw = await multilineInput({
    title: 'Add a comment (optional)',
    placeholder: 'Type your comment here. Tab to switch to buttons, Enter to submit.',
  });
  return sanitizeComment(raw, format);
}

function emitResult(vm: SupportRateViewModel, format: 'json' | 'table' | 'text'): void {
  if (format === 'json') {
    outputJSON({
      ticketId: vm.ticketId,
      rating: vm.rating,
      ratingLabel: vm.ratingLabel,
      comment: vm.comment ?? null,
      status: vm.status,
      statusLabel: vm.statusLabel,
      timestamp: vm.timestamp,
    });
    return;
  }

  if (format === 'text') {
    console.log(`Rating submitted for ticket ${vm.ticketId}`);
    console.log(`Rating: ${vm.rating}/5 (${vm.ratingLabel})`);
    console.log(`Comment: ${vm.comment ?? '(none)'}`);
    console.log(`Status: ${vm.statusLabel}`);
    return;
  }

  // table
  console.log(`✓ Ticket ${vm.ticketId} rated successfully`);
  console.log(`  Rating:  ${vm.ratingVisual} ${vm.ratingLabel}`);
  if (vm.comment) {
    console.log(`  Comment: ${vm.comment}`);
  }
  console.log(`  Status:  ${vm.statusLabel}`);
}

function notifyCancelled(ticketId: string, format: 'json' | 'table' | 'text'): void {
  if (format === 'json') {
    outputJSON({ ticketId, cancelled: true });
    return;
  }
  console.log('Operation cancelled.');
}

function notifyAlreadyRated(
  ticketId: string,
  satisfaction: number | undefined,
  format: 'json' | 'table' | 'text',
): void {
  if (format === 'json') {
    outputJSON({ ticketId, alreadyRated: true, satisfaction });
    return;
  }
  console.log(`Ticket ${ticketId} has already been rated (${satisfaction}/5).`);
}

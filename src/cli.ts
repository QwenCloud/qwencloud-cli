import { Command } from 'commander';
import { VERSION } from './index.js';
import { registerModelsCommands as registerModelsCommandsImpl } from './commands/models/index.js';
import { registerConfigCommands } from './commands/config/index.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerCompletionCommand } from './commands/completion.js';
import { registerVersionCommand, registerUpdateCommand } from './commands/version.js';
import { formatCmd } from './utils/runtime-mode.js';
import { registerUsageCommands } from './commands/usage/index.js';
import { registerAuthCommands } from './commands/auth/index.js';
import { registerDocsCommands } from './commands/docs/index.js';
import { registerWorkspaceCommands } from './commands/workspace/index.js';
import { registerBillingCommands } from './commands/billing/index.js';
import { registerSubscriptionCommands } from './commands/subscription/index.js';
import { registerSupportCommands } from './commands/support/index.js';
import {
  setCommandHelpMetadata,
  setCommandHidden,
  setLongDescription,
  addExamples,
} from './utils/commander-helpers.js';
import { formatHelp } from './output/help-formatter.js';
import { isHelpRequest } from './utils/cli-help.js';
import { createClient, type ClientFactory } from './api/client.js';

// ---------------------------------------------------------------------------
// Apply custom help to every command recursively
// ---------------------------------------------------------------------------

function applyCustomHelp(cmd: Command): void {
  cmd.configureHelp({
    formatHelp: () => formatHelp(cmd),
  });
  cmd.helpOption('-h, --help', 'Show this help');
  for (const sub of cmd.commands) {
    applyCustomHelp(sub);
  }
}

// Apply .exitOverride() and silence Commander's default writeErr on every
// subcommand so a missing `<id>` arg under `models info`, an unknown subcommand
// under `usage`, etc. all surface through bin/qwencloud.ts as structured JSON
// when --format json is in effect.
function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  cmd.configureOutput({ writeErr: () => {} });
  for (const sub of cmd.commands) {
    applyExitOverride(sub);
  }
}

// Commander assigns the token after a value-taking option as that option's
// value, so `<cmd> --opt --help` swallows the help flag instead of triggering
// help. Reaching preAction with a -h/--help token still in the raw args means
// it was swallowed (a standalone help flag fires during parsing and never gets
// here), so render the action command's help instead. Scanning the raw args
// rather than parsed options also catches options whose argParser would have
// turned the swallowed flag into NaN/other values.
function applyHelpFlagGuard(program: Command): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    const rawArgs = (program as unknown as { rawArgs?: string[] }).rawArgs ?? [];
    if (isHelpRequest(...rawArgs)) {
      actionCommand.outputHelp();
      throw Object.assign(new Error('(outputHelp)'), {
        code: 'commander.helpDisplayed',
        exitCode: 0,
      });
    }
  });
}

function setTopLevelHelpMetadata(
  program: Command,
  commandName: string,
  group: string,
  order: number,
): void {
  const command = program.commands.find((c) => c.name() === commandName);
  if (command) setCommandHelpMetadata(command, group, order);
}

function applyTopLevelHelpMetadata(program: Command): void {
  setTopLevelHelpMetadata(program, 'models', 'Core', 100);
  setTopLevelHelpMetadata(program, 'docs', 'Core', 120);

  setTopLevelHelpMetadata(program, 'auth', 'Account & access', 200);
  setTopLevelHelpMetadata(program, 'workspace', 'Account & access', 210);

  setTopLevelHelpMetadata(program, 'usage', 'Usage & billing', 300);
  setTopLevelHelpMetadata(program, 'billing', 'Usage & billing', 310);
  setTopLevelHelpMetadata(program, 'subscription', 'Usage & billing', 320);

  setTopLevelHelpMetadata(program, 'doctor', 'Operations', 400);
  setTopLevelHelpMetadata(program, 'config', 'Operations', 410);
  setTopLevelHelpMetadata(program, 'completion', 'Operations', 420);
  setTopLevelHelpMetadata(program, 'version', 'Operations', 430);

  setTopLevelHelpMetadata(program, 'support', 'Support', 500);
  setTopLevelHelpMetadata(program, 'update', 'Support', 510);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

// Auth commands are now imported from src/commands/auth/index.ts

function registerModelsCommands(program: Command, getClient: ClientFactory): void {
  // Delegate to real implementation
  registerModelsCommandsImpl(program, getClient);

  // Apply descriptions and examples to the registered commands
  const models = program.commands.find((c) => c.name() === 'models')!;
  setLongDescription(models, 'Browse, search, and inspect available models on QwenCloud.');

  const list = models.commands.find((c) => c.name() === 'list')!;
  setLongDescription(list, 'List available models with pricing, modality, and free tier info.');
  addExamples(list, [
    formatCmd('models list'),
    formatCmd('models list --input image --output text'),
    formatCmd('models list --all --format json'),
  ]);

  const info = models.commands.find((c) => c.name() === 'info')!;
  addExamples(info, [
    formatCmd('models info qwen3.6-plus'),
    formatCmd('models info qwen3.6-plus --format json'),
  ]);

  const search = models.commands.find((c) => c.name() === 'search')!;
  addExamples(search, [
    formatCmd('models search "function calling"'),
    formatCmd('models search image --format json'),
  ]);
}

// Config commands are now in src/commands/config/index.ts

// Doctor command is now in src/commands/doctor.ts

// Completion command is now in src/commands/completion.ts

// Version command is now in src/commands/version.ts

// Update command is now in src/commands/version.ts

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createProgram(): Command {
  const program = new Command();

  // Lazy singleton client factory — shared across all commands in this process
  let clientPromise: Promise<import('./api/client.js').CliFacade> | null = null;
  const getClient: ClientFactory = () => {
    if (!clientPromise) clientPromise = createClient();
    return clientPromise;
  };

  program
    .name('qwencloud')
    .description('Manage QwenCloud models, usage, and configuration from your terminal.')
    .version(VERSION, '-v, --version', 'Show version')
    .option('--format <table|json|text>', 'Output format (default: auto)')
    .option('-q, --quiet', 'Suppress all output; rely on exit code only');

  // Register all command groups
  registerAuthCommands(program, getClient);
  registerModelsCommands(program, getClient);
  registerUsageCommands(program, getClient);
  registerConfigCommands(program);
  registerDoctorCommand(program, getClient);
  registerCompletionCommand(program);
  registerVersionCommand(program, getClient);
  registerUpdateCommand(program, getClient);
  registerDocsCommands(program, getClient);
  registerWorkspaceCommands(program, getClient);
  registerBillingCommands(program, getClient);
  registerSubscriptionCommands(program, getClient);
  registerSupportCommands(program, getClient);
  applyTopLevelHelpMetadata(program);

  // Hide the top-level login/logout aliases from L0 help
  const loginAlias = program.commands.find((c) => c.name() === 'login');
  if (loginAlias) setCommandHidden(loginAlias, true);
  const logoutAlias = program.commands.find((c) => c.name() === 'logout');
  if (logoutAlias) setCommandHidden(logoutAlias, true);

  // Apply custom help formatting to all commands
  applyCustomHelp(program);
  applyExitOverride(program);
  applyHelpFlagGuard(program);

  // Override the top-level help
  program.configureHelp({
    formatHelp: () => formatHelp(program),
  });

  return program;
}

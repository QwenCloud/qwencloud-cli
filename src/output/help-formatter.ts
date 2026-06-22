import { Command } from 'commander';
import {
  isHiddenCommand,
  getCommandArgs,
  getCommandExamples,
  getCommandHelpGroup,
  getCommandHelpOrder,
  getLongDescription,
} from '../utils/commander-helpers.js';
import { isReplMode } from '../utils/runtime-mode.js';
import { theme } from '../ui/theme.js';

// ---------------------------------------------------------------------------
// Custom help formatter for CLI help output
// ---------------------------------------------------------------------------

function padCmd(name: string, width: number): string {
  return name.padEnd(width);
}

function styleSectionTitle(text: string): string {
  return isReplMode() ? theme.help.sectionTitle(text) : text;
}

function styleGroupTitle(text: string): string {
  return isReplMode() ? theme.help.groupTitle(text) : text;
}

function styleCommandName(text: string): string {
  return isReplMode() ? theme.help.commandName(text) : text;
}

function commandNameWithArgs(cmd: Command): string {
  const args = getCommandArgs(cmd);
  const argStr = args.length
    ? args.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`)).join(' ')
    : '';
  return cmd.name() + (argStr ? ' ' + argStr : '');
}

function commandHelpOrder(cmd: Command): number {
  return getCommandHelpOrder(cmd) ?? Number.MAX_SAFE_INTEGER;
}

function compareCommands(a: Command, b: Command): number {
  return commandHelpOrder(a) - commandHelpOrder(b) || a.name().localeCompare(b.name());
}

function commandNameMaxLength(commands: Command[]): number {
  return Math.max(...commands.map((cmd) => commandNameWithArgs(cmd).length));
}

function pushCommandRow(lines: string[], indent: string, cmd: Command, maxLen: number): void {
  const name = styleCommandName(padCmd(commandNameWithArgs(cmd), maxLen + 4));
  lines.push(`${indent}  ${name}${cmd.description()}`);
}

/** Build a fully custom help string for a Command. */
export function formatHelp(cmd: Command): string {
  const lines: string[] = [];
  const indent = '  ';

  // --- Usage line ---
  // In REPL mode, strip the root program name ('qwencloud') so help reads
  // "Usage: models …" instead of "Usage: qwencloud models …".
  const isRoot = !cmd.parent;
  const fullName = isReplMode() && isRoot ? '' : cmd.name();
  const ancestors: string[] = [];
  let p = cmd.parent;
  while (p) {
    // Skip the root program name in REPL mode
    if (!(isReplMode() && !p.parent)) {
      ancestors.unshift(p.name());
    }
    p = p.parent;
  }
  const prefix = ancestors.length ? ancestors.join(' ') + ' ' : '';
  const visibleSubs = cmd.commands.filter((c) => !isHiddenCommand(c));
  const shouldGroupRootCommands = isRoot && visibleSubs.some((c) => getCommandHelpGroup(c));
  const subs = shouldGroupRootCommands ? [...visibleSubs].sort(compareCommands) : visibleSubs;
  const hasSubcommands = subs.length > 0;
  // A command is "root" when it has no parent (the actual program root).
  // In REPL mode ancestors may be empty even for L1 commands (models, auth …)
  // because the root name is stripped, so use `isRoot` for level detection.

  // Determine usage suffix
  let usageSuffix: string;
  if (isRoot && hasSubcommands) {
    // L0: qwencloud <command> [flags]
    usageSuffix = '<command> [flags]';
  } else if (hasSubcommands) {
    usageSuffix = '<subcommand> [flags]';
  } else {
    // Collect arguments
    const args = getCommandArgs(cmd);
    const argParts: string[] = [];
    if (args) {
      for (const a of args) {
        argParts.push(a.required ? `<${a.name()}>` : `[${a.name()}]`);
      }
    }
    usageSuffix = [...argParts, '[flags]'].join(' ');
  }

  const namePart = [prefix, fullName].filter(Boolean).join('');
  lines.push(`${indent}Usage: ${namePart ? namePart + ' ' : ''}${usageSuffix}`);
  lines.push('');

  // --- Description ---
  const desc = getLongDescription(cmd);
  if (desc) {
    lines.push(`${indent}${desc}`);
    lines.push('');
  }

  // --- Subcommands / Commands ---
  if (hasSubcommands) {
    const label = isRoot ? 'Commands' : 'Subcommands';
    lines.push(`${indent}${styleSectionTitle(`${label}:`)}`);

    const maxLen = commandNameMaxLength(subs);

    if (shouldGroupRootCommands) {
      const groups = new Map<string, Command[]>();
      for (const sub of subs) {
        const groupName = getCommandHelpGroup(sub) ?? 'Other';
        const group = groups.get(groupName) ?? [];
        group.push(sub);
        groups.set(groupName, group);
      }

      const groupedEntries = [...groups.entries()].sort(([, a], [, b]) => {
        const firstA = a[0] ? commandHelpOrder(a[0]) : Number.MAX_SAFE_INTEGER;
        const firstB = b[0] ? commandHelpOrder(b[0]) : Number.MAX_SAFE_INTEGER;
        return firstA - firstB;
      });

      for (const [groupName, groupCommands] of groupedEntries) {
        lines.push(`${indent}  ${styleGroupTitle(`${groupName}:`)}`);
        for (const sub of groupCommands.sort(compareCommands)) {
          pushCommandRow(lines, `${indent}  `, sub, maxLen);
        }
      }
    } else {
      for (const sub of subs) {
        pushCommandRow(lines, indent, sub, maxLen);
      }
    }
    lines.push('');
  }

  // --- Flags ---
  lines.push(`${indent}${styleSectionTitle('Flags:')}`);
  // Collect visible options + always include -h, --help
  const opts = cmd.options.filter((o) => !o.hidden);
  // Build flag entries: regular opts, -h/--help, then -v/--version at end
  type FlagEntry = { flags: string; desc: string };
  const flagEntries: FlagEntry[] = [];
  // Regular options (non-version, non-help)
  for (const o of opts) {
    if (o.long === '--version') continue; // will be appended at end
    flagEntries.push({ flags: o.flags, desc: o.description });
  }
  flagEntries.push({ flags: '-h, --help', desc: 'Show this help' });
  // Version flag last (only on top-level)
  const versionOpt = opts.find((o) => o.long === '--version');
  if (versionOpt) {
    flagEntries.push({ flags: versionOpt.flags, desc: versionOpt.description });
  }
  const maxOptLen = Math.max(...flagEntries.map((f) => f.flags.length));
  for (const f of flagEntries) {
    lines.push(`${indent}  ${padCmd(f.flags, maxOptLen + 4)}${f.desc}`);
  }
  lines.push('');

  // --- Examples (stored via .summary()) ---
  const examples = getCommandExamples(cmd);
  if (examples.length > 0) {
    lines.push(`${indent}${styleSectionTitle('Examples:')}`);
    for (const ex of examples) {
      lines.push(`${indent}  ${ex}`);
    }
    lines.push('');
  }

  // --- Footer ---
  if (hasSubcommands) {
    if (isRoot) {
      lines.push(
        `${indent}Run ${fullName ? fullName + ' ' : ''}<command> --help for command-specific help.`,
      );
    } else {
      const cmdPath = [prefix, fullName].filter(Boolean).join('');
      lines.push(
        `${indent}Run ${cmdPath ? cmdPath + ' ' : ''}<subcommand> --help for subcommand-specific help.`,
      );
    }
  }

  // Trailing newline ensures terminals show a clean prompt after `--help`.
  return lines.join('\n') + '\n';
}

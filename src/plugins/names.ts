import type { Command } from 'commander';
import type { InstalledPlugin } from './manifest.js';

export type PluginConflict = 'ok' | 'reserved' | 'duplicate';

const HOST_COMMANDS = new Set(['help', 'clear', 'cls', 'exit', 'quit', 'q']);

/**
 * A manifest command may embed commander arg syntax ("greet [name]",
 * "models <id>"); the reserved set is built from commander's own .name()
 * which strips args. Normalize the manifest side to its first token so both
 * sides compare on the bare command name.
 */
export function normalizeCommandName(raw: string): string {
  return raw.trim().split(/\s+/)[0] ?? '';
}

export function collectReservedNames(program: Command): Set<string> {
  const reserved = new Set(HOST_COMMANDS);
  for (const command of program.commands) {
    reserved.add(command.name());
    for (const alias of command.aliases()) reserved.add(alias);
  }
  return reserved;
}

/**
 * A plugin contributes a command plus optional aliases; ALL of them are
 * registered into commander (buildStub calls cmd.alias). Collision detection
 * must therefore check every name — a colliding alias would otherwise be
 * silently shadowed (registration order lets the built-in/earlier plugin win).
 */
export function pluginNames(command: string, aliases: string[] | undefined): string[] {
  const names = [normalizeCommandName(command), ...(aliases ?? []).map(normalizeCommandName)];
  return [...new Set(names.filter((n) => n !== ''))];
}

export function resolvePluginConflict(
  names: string[],
  reserved: Set<string>,
  installedNames: string[],
): PluginConflict {
  if (names.some((n) => HOST_COMMANDS.has(n.toLowerCase()) || reserved.has(n))) return 'reserved';
  if (names.some((n) => installedNames.includes(n))) return 'duplicate';
  return 'ok';
}

/**
 * `reserved` contains only built-in names; `installed` supplies plugin ownership.
 * Reinstallation exempts only names already owned by this plugin.
 */
export function classifyInstallCollision(
  rawCommand: string,
  rawAliases: string[] | undefined,
  reserved: Set<string>,
  installed: InstalledPlugin[],
  selfName: string,
): PluginConflict {
  const names = pluginNames(rawCommand, rawAliases);
  if (names.some((name) => HOST_COMMANDS.has(name.toLowerCase()))) return 'reserved';
  const selfOwned = new Set(
    installed
      .filter((plugin) => plugin.name === selfName)
      .flatMap((plugin) => pluginNames(plugin.command ?? '', plugin.commandAliases)),
  );
  const otherOwned = new Set(
    installed
      .filter((plugin) => plugin.name !== selfName)
      .flatMap((plugin) => pluginNames(plugin.command ?? '', plugin.commandAliases)),
  );

  // Exemption is per name, not per plugin. Sharing one legitimate old name
  // must not allow a reinstall to add a different name owned by another plugin
  // or reserved by a built-in.
  if (names.some((name) => otherOwned.has(name))) return 'duplicate';
  if (names.some((name) => !selfOwned.has(name) && reserved.has(name))) return 'reserved';
  return 'ok';
}

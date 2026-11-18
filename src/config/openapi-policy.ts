import { getPluginsDir, getPluginsManifestPath } from './paths.js';
import { getDefaultPlugins } from '../plugins/defaults.js';
import { readCommittedInstalledPlugins } from '../plugins/default-install.js';
import { readInstalledManifest } from '../plugins/manifest.js';
import { parsePluginApiPolicy, type OpenApiPolicyRule } from '../plugins/api-policy.js';
import { VERSION } from '../version.js';
import { CliError } from '../utils/errors.js';
import { EXIT_CODES } from '../utils/exit-codes.js';

export type { OpenApiPolicyRule } from '../plugins/api-policy.js';

let reservedNames: ReadonlySet<string> = new Set();

export function setOpenApiPolicyReservedNames(names: ReadonlySet<string>): void {
  reservedNames = new Set(names);
}

/** Read current metadata without importing executable code or preparing missing plugins. */
function readConfiguredOpenApiPolicies(): {
  rules: OpenApiPolicyRule[];
  conflicts: Set<string>;
} {
  const context = {
    pluginsDir: getPluginsDir(),
    manifestPath: getPluginsManifestPath(),
    cliVersion: VERSION,
    definitions: getDefaultPlugins(),
    reservedNames: new Set(reservedNames),
  };
  const state = readInstalledManifest(context.manifestPath);
  const rules: OpenApiPolicyRule[] = [];
  for (const installed of readCommittedInstalledPlugins(context, state)) {
    rules.push(...(installed.manifest.apiPolicy ?? []));
  }
  const settings = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const rule of rules) {
    for (const action of rule.actions) {
      const key = JSON.stringify([rule.product, action]);
      const value = JSON.stringify([rule.auth, rule.response ?? null]);
      const previous = settings.get(key);
      if (previous !== undefined && previous !== value) conflicts.add(key);
      settings.set(key, value);
    }
  }
  return {
    rules: parsePluginApiPolicy(
      rules
        .map((rule) => ({
          ...rule,
          actions: rule.actions.filter(
            (action) => !conflicts.has(JSON.stringify([rule.product, action])),
          ),
        }))
        .filter((rule) => rule.actions.length > 0),
    ),
    conflicts,
  };
}

export function getConfiguredOpenApiRules(): readonly OpenApiPolicyRule[] {
  return readConfiguredOpenApiPolicies().rules;
}

export function findConfiguredOpenApiPolicy(
  product: string,
  action: string,
): OpenApiPolicyRule | undefined {
  const { rules, conflicts } = readConfiguredOpenApiPolicies();
  if (conflicts.has(JSON.stringify([product, action]))) {
    throw new CliError({
      code: 'PLUGIN_API_POLICY_CONFLICT',
      message: `Conflicting plugin API policies for ${product}/${action}.`,
      exitCode: EXIT_CODES.INVALID_ARGUMENT,
    });
  }
  return rules.find((rule) => rule.product === product && rule.actions.includes(action));
}

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writePluginPackage(
  directory: string,
  packageJson: Record<string, unknown>,
  entry: { name: string; content: string } | false = {
    name: 'index.mjs',
    content: 'export const handlers = {};',
  },
): string {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify(packageJson), 'utf8');
  if (entry) writeFileSync(path.join(directory, entry.name), entry.content, 'utf8');
  return directory;
}

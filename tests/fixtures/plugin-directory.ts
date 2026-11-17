import fs from 'node:fs';
import path from 'node:path';

export function snapshotDirectory(directory: string): Record<string, string> {
  if (!fs.existsSync(directory)) return {};
  return Object.fromEntries(
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return Object.entries(snapshotDirectory(file));
      return [
        [file, entry.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file, 'base64')],
      ];
    }),
  );
}

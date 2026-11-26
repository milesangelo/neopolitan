import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  path.join(rootDir, 'coverage'),
  path.join(rootDir, 'docs', 'api'),
  path.join(rootDir, 'docs', '.vitepress', 'cache'),
  path.join(rootDir, 'docs', '.vitepress', 'dist'),
  path.join(rootDir, 'examples', 'dist'),
  path.join(rootDir, 'examples', 'tsconfig.tsbuildinfo'),
];

const packagesDir = path.join(rootDir, 'packages');
for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  targets.push(path.join(packagesDir, entry.name, 'dist'));
  targets.push(path.join(packagesDir, entry.name, 'tsconfig.tsbuildinfo'));
}

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
}

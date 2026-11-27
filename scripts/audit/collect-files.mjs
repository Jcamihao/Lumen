import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { EXTENSIONS, IGNORED_DIRS } from './config.mjs';

export function classify(path) {
  if (path.endsWith('.spec.ts')) return 'spec';
  if (path.endsWith('.html')) return 'template';
  if (path.endsWith('.scss')) return 'style';
  return 'code';
}

export function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split('\n').length;
  return source.endsWith('\n') ? lines - 1 : lines;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.includes(extname(entry.name)) && !entry.name.endsWith('.d.ts')) yield full;
  }
}

export function collectFiles(root, roots) {
  const files = [];
  for (const rel of roots) {
    for (const full of walk(join(root, rel))) {
      const source = readFileSync(full, 'utf8');
      const path = full.slice(root.length + 1);
      files.push({ path, kind: classify(path), lines: countLines(source), source });
    }
  }
  return files;
}

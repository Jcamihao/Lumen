import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import { analyze } from './analyze.mjs';
import { collectFiles } from './collect-files.mjs';
import { ROOTS } from './config.mjs';
import { loadTypescript } from './load-typescript.mjs';
import { renderReport } from './report.mjs';
import { countViolations, findViolations } from './violations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function filterByModule(files, prefix) {
  return prefix ? files.filter((file) => file.path.includes(prefix)) : files;
}

function main() {
  const { limits, options } = parseArgs(process.argv.slice(2));
  const ts = loadTypescript(root);
  const files = filterByModule(collectFiles(root, ROOTS), options.modulePrefix);
  const result = analyze(files, limits, ts);
  const violations = findViolations(result, limits);

  if (options.json) {
    console.log(JSON.stringify({ limits, violations }, null, 2));
  } else {
    console.log(renderReport({ result, violations, limits, top: options.top, tsAvailable: Boolean(ts) }));
  }
  if (options.failOnViolation && countViolations(violations) > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`audit: ${error.message}`);
  process.exit(2);
}

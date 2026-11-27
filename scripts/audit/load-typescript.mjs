import { createRequire } from 'node:module';
import { join } from 'node:path';

const CANDIDATES = ['', 'backend', 'frontend'];

/** Procura o compilador do TypeScript nos node_modules do projeto. Devolve null se nao achar. */
export function loadTypescript(root) {
  const fromEnv = process.env.AUDIT_TS_FROM;
  const bases = fromEnv ? [fromEnv] : CANDIDATES.map((dir) => join(root, dir));
  for (const base of bases) {
    try {
      return createRequire(join(base, 'package.json'))('typescript');
    } catch {
      // tenta o proximo
    }
  }
  return null;
}

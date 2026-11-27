/** Agrupa um caminho em "backend/<modulo>" ou "frontend/<feature|core|shared>". */
export function moduleOf(path) {
  const parts = path.split('/');
  const app = parts[0];
  if (app === 'backend') return `backend/${parts[2] ?? '(raiz)'}`;
  const featuresAt = parts.indexOf('features');
  if (featuresAt >= 0) return `frontend/features/${parts[featuresAt + 1]}`;
  const appAt = parts.indexOf('app');
  return `frontend/${parts[appAt + 1] ?? '(raiz)'}`;
}

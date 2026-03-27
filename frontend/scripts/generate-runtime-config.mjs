import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'src', 'assets', 'app-config.js');

const apiBaseUrl =
  process.env.FRONTEND_APP_API_BASE_URL ??
  process.env.FRONTEND_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3000/api/v1';
const wsBaseUrl =
  process.env.FRONTEND_APP_WS_BASE_URL ??
  process.env.FRONTEND_WS_BASE_URL ??
  process.env.WS_BASE_URL ??
  'http://localhost:3000';
const clientLoggingEnabled =
  (process.env.FRONTEND_APP_CLIENT_LOGGING_ENABLED ??
    process.env.FRONTEND_CLIENT_LOGGING_ENABLED ??
    process.env.CLIENT_LOGGING_ENABLED ??
    'true') === 'true';

const contents = `window.__APP_CONFIG__ = ${JSON.stringify(
  {
    apiBaseUrl,
    wsBaseUrl,
    clientLoggingEnabled,
  },
  null,
  2,
)};\n`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, contents, 'utf8');

console.log(`Runtime config generated at ${outputPath}`);

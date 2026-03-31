import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'src', 'assets', 'app-config.js');
const workspaceRoot = path.resolve(projectRoot, '..');

function parseDotenv(raw) {
  const entries = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

async function readDotenvFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return parseDotenv(raw);
  } catch {
    return {};
  }
}

const dotenvFromWorkspace = await readDotenvFile(path.join(workspaceRoot, '.env'));
const dotenvFromFrontend = await readDotenvFile(path.join(projectRoot, '.env'));
const configEnv = {
  ...dotenvFromWorkspace,
  ...dotenvFromFrontend,
  ...process.env,
};

const apiBaseUrl =
  configEnv.FRONTEND_APP_API_BASE_URL ??
  configEnv.FRONTEND_API_BASE_URL ??
  configEnv.API_BASE_URL ??
  'http://localhost:3000/api/v1';
const wsBaseUrl =
  configEnv.FRONTEND_APP_WS_BASE_URL ??
  configEnv.FRONTEND_WS_BASE_URL ??
  configEnv.WS_BASE_URL ??
  'http://localhost:3000';
const clientLoggingEnabled =
  (configEnv.FRONTEND_APP_CLIENT_LOGGING_ENABLED ??
    configEnv.FRONTEND_CLIENT_LOGGING_ENABLED ??
    configEnv.CLIENT_LOGGING_ENABLED ??
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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'src', 'assets', 'app-config.js');
const workspaceRoot = path.resolve(projectRoot, '..');
const backendRoot = path.join(workspaceRoot, 'backend');

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
const dotenvFromBackend = await readDotenvFile(path.join(backendRoot, '.env'));
const dotenvFromFrontend = await readDotenvFile(path.join(projectRoot, '.env'));

function getFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function trimTrailingSlash(value) {
  return value?.replace(/\/+$/, '');
}

const explicitApiBaseUrl = getFirstDefined(
  process.env.FRONTEND_APP_API_BASE_URL,
  process.env.FRONTEND_API_BASE_URL,
  process.env.API_BASE_URL,
  dotenvFromFrontend.FRONTEND_APP_API_BASE_URL,
  dotenvFromFrontend.FRONTEND_API_BASE_URL,
  dotenvFromFrontend.API_BASE_URL,
);

const explicitWsBaseUrl = getFirstDefined(
  process.env.FRONTEND_APP_WS_BASE_URL,
  process.env.FRONTEND_WS_BASE_URL,
  process.env.WS_BASE_URL,
  dotenvFromFrontend.FRONTEND_APP_WS_BASE_URL,
  dotenvFromFrontend.FRONTEND_WS_BASE_URL,
  dotenvFromFrontend.WS_BASE_URL,
);

const backendExplicitApiBaseUrl = getFirstDefined(
  dotenvFromBackend.FRONTEND_APP_API_BASE_URL,
  dotenvFromBackend.FRONTEND_API_BASE_URL,
  dotenvFromBackend.API_BASE_URL,
);

const backendExplicitWsBaseUrl = getFirstDefined(
  dotenvFromBackend.FRONTEND_APP_WS_BASE_URL,
  dotenvFromBackend.FRONTEND_WS_BASE_URL,
  dotenvFromBackend.WS_BASE_URL,
);

const backendBaseUrl = trimTrailingSlash(
  getFirstDefined(
    process.env.APP_URL,
    dotenvFromBackend.APP_URL,
    dotenvFromBackend.PORT ? `http://localhost:${dotenvFromBackend.PORT}` : undefined,
  ),
);

const workspaceApiBaseUrl = getFirstDefined(
  dotenvFromWorkspace.FRONTEND_APP_API_BASE_URL,
  dotenvFromWorkspace.FRONTEND_API_BASE_URL,
  dotenvFromWorkspace.API_BASE_URL,
);

const workspaceWsBaseUrl = getFirstDefined(
  dotenvFromWorkspace.FRONTEND_APP_WS_BASE_URL,
  dotenvFromWorkspace.FRONTEND_WS_BASE_URL,
  dotenvFromWorkspace.WS_BASE_URL,
);

const apiBaseUrl = trimTrailingSlash(
  getFirstDefined(
    explicitApiBaseUrl,
    workspaceApiBaseUrl,
    backendExplicitApiBaseUrl,
    backendBaseUrl ? `${backendBaseUrl}/api/v1` : undefined,
    'http://localhost:3000/api/v1',
  ),
);

const wsBaseUrl = trimTrailingSlash(
  getFirstDefined(
    explicitWsBaseUrl,
    workspaceWsBaseUrl,
    backendExplicitWsBaseUrl,
    backendBaseUrl,
    'http://localhost:3000',
  ),
);
const clientLoggingEnabled =
  (getFirstDefined(
    process.env.FRONTEND_APP_CLIENT_LOGGING_ENABLED,
    process.env.FRONTEND_CLIENT_LOGGING_ENABLED,
    process.env.CLIENT_LOGGING_ENABLED,
    dotenvFromFrontend.FRONTEND_APP_CLIENT_LOGGING_ENABLED,
    dotenvFromFrontend.FRONTEND_CLIENT_LOGGING_ENABLED,
    dotenvFromFrontend.CLIENT_LOGGING_ENABLED,
    dotenvFromWorkspace.FRONTEND_APP_CLIENT_LOGGING_ENABLED,
    dotenvFromWorkspace.FRONTEND_CLIENT_LOGGING_ENABLED,
    dotenvFromWorkspace.CLIENT_LOGGING_ENABLED,
    'true',
  ) ?? 'true') === 'true';
const mfaEnabled =
  (getFirstDefined(
    process.env.FRONTEND_APP_MFA_ENABLED,
    process.env.FRONTEND_MFA_ENABLED,
    process.env.AUTH_MFA_ENABLED,
    dotenvFromFrontend.FRONTEND_APP_MFA_ENABLED,
    dotenvFromFrontend.FRONTEND_MFA_ENABLED,
    dotenvFromFrontend.AUTH_MFA_ENABLED,
    dotenvFromBackend.AUTH_MFA_ENABLED,
    dotenvFromWorkspace.FRONTEND_APP_MFA_ENABLED,
    dotenvFromWorkspace.FRONTEND_MFA_ENABLED,
    dotenvFromWorkspace.AUTH_MFA_ENABLED,
    'false',
  ) ?? 'false') === 'true';

const contents = `window.__APP_CONFIG__ = ${JSON.stringify(
  {
    apiBaseUrl,
    wsBaseUrl,
    clientLoggingEnabled,
    mfaEnabled,
  },
  null,
  2,
)};\n`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, contents, 'utf8');

console.log(`Runtime config generated at ${outputPath}`);

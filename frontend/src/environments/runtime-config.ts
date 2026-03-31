type RuntimeWindowConfig = {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  clientLoggingEnabled?: boolean;
};

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeWindowConfig;
  }
}

const fallbackConfig = {
  apiBaseUrl: 'http://localhost:3000/api/v1',
  wsBaseUrl: 'http://localhost:3000',
  clientLoggingEnabled: true,
};

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function normalizeLocalDevUrl(value: string | undefined, port: string) {
  if (typeof window === 'undefined' || !value) {
    return value;
  }

  if (window.location.port !== '4200') {
    return value;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    const isLegacyLocalBackend =
      isLoopbackHost(parsed.hostname) &&
      parsed.port === '3001' &&
      isLoopbackHost(window.location.hostname);

    if (!isLegacyLocalBackend) {
      return value;
    }

    parsed.protocol = window.location.protocol;
    parsed.hostname = window.location.hostname;
    parsed.port = port;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

const browserConfig =
  typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined;

const normalizedApiBaseUrl = normalizeLocalDevUrl(
  browserConfig?.apiBaseUrl ?? fallbackConfig.apiBaseUrl,
  '3000',
);

const normalizedWsBaseUrl = normalizeLocalDevUrl(
  browserConfig?.wsBaseUrl ?? fallbackConfig.wsBaseUrl,
  '3000',
);

export const runtimeConfig = {
  apiBaseUrl: normalizedApiBaseUrl ?? fallbackConfig.apiBaseUrl,
  wsBaseUrl: normalizedWsBaseUrl ?? fallbackConfig.wsBaseUrl,
  clientLoggingEnabled:
    browserConfig?.clientLoggingEnabled ?? fallbackConfig.clientLoggingEnabled,
};

export {};

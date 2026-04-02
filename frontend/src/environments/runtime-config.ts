import { Capacitor } from '@capacitor/core';

type RuntimeWindowConfig = {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  clientLoggingEnabled?: boolean;
  mfaEnabled?: boolean;
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
  mfaEnabled: false,
};

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function normalizeLocalDevUrl(value: string | undefined, port: string) {
  if (typeof window === 'undefined' || !value) {
    return value;
  }

  try {
    const parsed = new URL(value, window.location.origin);

    if (!isLoopbackHost(parsed.hostname) || isNativePlatform()) {
      return value;
    }

    const currentHostname = window.location.hostname;
    const currentProtocol = window.location.protocol;
    const shouldUseCurrentHost = !isLoopbackHost(currentHostname);

    if (!shouldUseCurrentHost) {
      const isLegacyLocalBackend =
        parsed.port === '3001' &&
        window.location.port === '4200' &&
        isLoopbackHost(currentHostname);

      if (!isLegacyLocalBackend) {
        return value;
      }

      parsed.protocol = currentProtocol;
      parsed.hostname = currentHostname;
      parsed.port = port;
      return parsed.toString().replace(/\/$/, '');
    }

    parsed.protocol = currentProtocol;
    parsed.hostname = currentHostname;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

function warnIfNativeLoopbackUrl(value: string | undefined, label: string) {
  if (typeof window === 'undefined' || !value || !isNativePlatform()) {
    return;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (!isLoopbackHost(parsed.hostname)) {
      return;
    }

    console.warn(
      `[Lumen runtime-config] ${label} is using a loopback host (${parsed.hostname}). On a phone this points to the device itself, not your dev machine. Configure FRONTEND_APP_${label === 'apiBaseUrl' ? 'API' : 'WS'}_BASE_URL with your LAN IP before building mobile.`,
    );
  } catch {
    // Ignore malformed runtime config here and let consumers fail normally.
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

warnIfNativeLoopbackUrl(normalizedApiBaseUrl, 'apiBaseUrl');
warnIfNativeLoopbackUrl(normalizedWsBaseUrl, 'wsBaseUrl');

export const runtimeConfig = {
  apiBaseUrl: normalizedApiBaseUrl ?? fallbackConfig.apiBaseUrl,
  wsBaseUrl: normalizedWsBaseUrl ?? fallbackConfig.wsBaseUrl,
  clientLoggingEnabled:
    browserConfig?.clientLoggingEnabled ?? fallbackConfig.clientLoggingEnabled,
  mfaEnabled: browserConfig?.mfaEnabled ?? fallbackConfig.mfaEnabled,
};

export {};

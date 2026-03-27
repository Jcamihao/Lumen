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

const browserConfig =
  typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined;

export const runtimeConfig = {
  apiBaseUrl: browserConfig?.apiBaseUrl ?? fallbackConfig.apiBaseUrl,
  wsBaseUrl: browserConfig?.wsBaseUrl ?? fallbackConfig.wsBaseUrl,
  clientLoggingEnabled:
    browserConfig?.clientLoggingEnabled ?? fallbackConfig.clientLoggingEnabled,
};

export {};

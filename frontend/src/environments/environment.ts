import { runtimeConfig } from './runtime-config';

export const environment = {
  production: true,
  apiBaseUrl: runtimeConfig.apiBaseUrl,
  wsBaseUrl: runtimeConfig.wsBaseUrl,
  clientLoggingEnabled: runtimeConfig.clientLoggingEnabled,
};

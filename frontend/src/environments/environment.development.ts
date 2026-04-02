import { runtimeConfig } from './runtime-config';

export const environment = {
  production: false,
  apiBaseUrl: runtimeConfig.apiBaseUrl,
  wsBaseUrl: runtimeConfig.wsBaseUrl,
  clientLoggingEnabled: runtimeConfig.clientLoggingEnabled,
  mfaEnabled: runtimeConfig.mfaEnabled,
};

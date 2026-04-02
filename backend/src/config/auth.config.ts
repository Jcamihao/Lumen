import { registerAs } from '@nestjs/config';

const DEFAULT_ACCESS_SECRET = 'lumen_access_secret';
const DEFAULT_REFRESH_SECRET = 'lumen_refresh_secret';
const DEFAULT_MFA_ENCRYPTION_SECRET = 'lumen_mfa_encryption_secret';

function resolveSecret(
  envName: string,
  fallback: string,
  isProduction: boolean,
) {
  const value = process.env[envName]?.trim();

  if (value) {
    if (isProduction && value === fallback) {
      throw new Error(
        `${envName} nao pode usar o valor padrao em producao. Configure uma secret forte.`,
      );
    }

    return value;
  }

  if (isProduction) {
    throw new Error(
      `${envName} e obrigatoria em producao. Configure uma secret forte antes de subir a API.`,
    );
  }

  return fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseSameSite(value: string | undefined) {
  const normalizedValue = value?.trim().toLowerCase();

  if (
    normalizedValue === 'strict' ||
    normalizedValue === 'lax' ||
    normalizedValue === 'none'
  ) {
    return normalizedValue;
  }

  return 'lax';
}

export const authConfig = registerAs('auth', () => {
  const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';
  const mfaEnabled = parseBoolean(process.env.AUTH_MFA_ENABLED, false);

  return {
    accessSecret: resolveSecret(
      'JWT_ACCESS_SECRET',
      DEFAULT_ACCESS_SECRET,
      isProduction,
    ),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: resolveSecret(
      'JWT_REFRESH_SECRET',
      DEFAULT_REFRESH_SECRET,
      isProduction,
    ),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    refreshCookieName:
      process.env.AUTH_REFRESH_COOKIE_NAME ?? 'lumen.refreshToken',
    refreshCookieDomain: process.env.AUTH_REFRESH_COOKIE_DOMAIN || undefined,
    refreshCookiePath: process.env.AUTH_REFRESH_COOKIE_PATH ?? '/api/v1/auth',
    refreshCookieSecure: parseBoolean(
      process.env.AUTH_REFRESH_COOKIE_SECURE,
      isProduction,
    ),
    refreshCookieSameSite: parseSameSite(
      process.env.AUTH_REFRESH_COOKIE_SAME_SITE,
    ),
    mfaEnabled,
    mfaEncryptionSecret: mfaEnabled
      ? resolveSecret(
          'AUTH_MFA_ENCRYPTION_SECRET',
          DEFAULT_MFA_ENCRYPTION_SECRET,
          isProduction,
        )
      : process.env.AUTH_MFA_ENCRYPTION_SECRET?.trim() ||
        DEFAULT_MFA_ENCRYPTION_SECRET,
    mfaIssuer: process.env.AUTH_MFA_ISSUER ?? 'LUMEN',
    mfaChallengeExpiresInSeconds: parseInt(
      process.env.AUTH_MFA_CHALLENGE_EXPIRES_IN_SECONDS ?? '300',
      10,
    ),
  };
});

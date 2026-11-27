import { TOTP_DIGITS } from "./totp-code";

export function buildOtpAuthUrl(issuer: string, email: string, secret: string) {
  const label = `${issuer}:${email}`;

  return (
    `otpauth://totp/${encodeURIComponent(label)}` +
    `?secret=${encodeURIComponent(secret)}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=30`
  );
}

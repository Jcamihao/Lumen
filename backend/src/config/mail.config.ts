import { registerAs } from "@nestjs/config";

const parseBoolean = (value: string | undefined, defaultValue = false) => {
  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const mailConfig = registerAs("mail", () => ({
  enabled: parseBoolean(process.env.RESEND_ENABLED, false),
  apiKey: process.env.RESEND_API_KEY?.trim() ?? "",
  baseUrl: (process.env.RESEND_BASE_URL ?? "https://api.resend.com").replace(
    /\/+$/,
    "",
  ),
  fromEmail: process.env.RESEND_FROM_EMAIL?.trim() ?? "",
  fromName: process.env.RESEND_FROM_NAME?.trim() ?? "LUMEN",
  replyTo: process.env.RESEND_REPLY_TO?.trim() ?? "",
  timeoutMs: parseInt(process.env.RESEND_TIMEOUT_MS ?? "10000", 10),
}));

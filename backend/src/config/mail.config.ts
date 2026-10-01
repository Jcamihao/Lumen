import { registerAs } from "@nestjs/config";
import { parseBoolean } from "./parse-boolean.util";

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

import { SendEmailOptions } from "../mail.types";
import { ResendSettings } from "./resend.settings";

export type ResendTag = { name: string; value: string };

export type ResendEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  tags?: ResendTag[];
};

function sanitizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 256);
}

export function buildTags(tags: string[]): ResendTag[] {
  const usedNames = new Set<string>();

  return tags
    .map((tag, index) => {
      const baseName = sanitizeTag(tag) || `tag_${index + 1}`;
      const name = usedNames.has(baseName) ? `${baseName}_${index + 1}` : baseName;
      usedNames.add(name);
      return { name, value: "true" };
    })
    .filter((tag) => Boolean(tag.name));
}

function expandRecipients(value: string | string[]): string[] {
  const recipients = Array.isArray(value) ? value : [value];
  return recipients.map((recipient) => recipient.trim()).filter(Boolean);
}

/** Corpo da requisicao ao Resend a partir das opcoes do email e da configuracao. */
export function buildPayload(options: SendEmailOptions, settings: ResendSettings): ResendEmailPayload {
  const payload: ResendEmailPayload = {
    from: `${settings.fromName()} <${settings.fromEmail()}>`,
    to: expandRecipients(options.to),
    subject: options.subject,
  };
  if (options.text) payload.text = options.text;
  if (options.html) payload.html = options.html;

  const replyTo = options.replyTo ?? settings.replyTo();
  const headers: Record<string, string> = {
    ...(replyTo ? { "Reply-To": replyTo } : {}),
    ...(options.headers ?? {}),
  };
  if (Object.keys(headers).length > 0) payload.headers = headers;

  const tags = buildTags(options.tags ?? []);
  if (tags.length > 0) payload.tags = tags;

  return payload;
}

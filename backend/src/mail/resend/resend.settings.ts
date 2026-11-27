import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Configuracao do Resend lida do ambiente (mail.*). */
@Injectable()
export class ResendSettings {
  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.config.get<boolean>("mail.enabled"));
  }

  hasRequiredConfiguration(): boolean {
    return Boolean(this.apiKey() && this.fromEmail());
  }

  apiKey(): string {
    return this.config.get<string>("mail.apiKey") ?? "";
  }

  baseUrl(): string {
    return this.config.get<string>("mail.baseUrl") ?? "https://api.resend.com";
  }

  fromEmail(): string {
    return this.config.get<string>("mail.fromEmail") ?? "";
  }

  fromName(): string {
    return this.config.get<string>("mail.fromName") ?? "LUMEN";
  }

  replyTo(): string {
    return this.config.get<string>("mail.replyTo") ?? "";
  }

  timeoutMs(): number {
    return this.config.get<number>("mail.timeoutMs") ?? 10000;
  }
}

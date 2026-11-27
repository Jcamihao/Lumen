import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const DEFAULT_TIMEOUT_MS = 50000;
const DEFAULT_FALLBACK_TIMEOUT_MS = 15000;

/** Configuracao da integracao com o SelahIA (SELAH_*). */
@Injectable()
export class SelahSettings {
  constructor(private readonly configService: ConfigService) {}

  readEnv(key: string): string {
    return String(this.configService.get<string>(key) || "").trim();
  }

  readBooleanEnv(key: string): boolean {
    return String(this.configService.get<string>(key) || "").trim().toLowerCase() === "true";
  }

  timeoutMs(): number {
    return this.positiveNumber("SELAH_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  }

  fallbackTimeoutMs(): number {
    return this.positiveNumber("SELAH_FALLBACK_TIMEOUT_MS", DEFAULT_FALLBACK_TIMEOUT_MS);
  }

  private positiveNumber(key: string, fallback: number): number {
    const value = Number(this.readEnv(key) || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}

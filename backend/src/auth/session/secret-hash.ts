import { createHash, timingSafeEqual } from "crypto";
import * as bcrypt from "bcryptjs";
import { RetiredRefreshToken } from "./session.types";

/** sha256 em hex: basta para segredos com 256 bits de entropia (links, refresh tokens). */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Compara dois textos em tempo constante (e recusa tamanhos diferentes). */
export function safeEqual(left: string, right: string): boolean {
  const expected = Buffer.from(left);
  const received = Buffer.from(right);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Compara o refresh token com o hash guardado. Sessoes antigas guardam bcrypt (que so
 * le os 72 primeiros bytes do JWT, entao nao distingue tokens do mesmo usuario): valem
 * ate a proxima rotacao, que regrava o hash em sha256.
 */
export async function refreshTokenMatches(token: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("$2")) return bcrypt.compare(token, stored);
  return safeEqual(stored, hashSecret(token));
}

const isRetiredToken = (item: unknown, limit: number): item is RetiredRefreshToken =>
  !!item &&
  typeof item === "object" &&
  typeof (item as RetiredRefreshToken).hash === "string" &&
  typeof (item as RetiredRefreshToken).retiredAt === "number" &&
  (item as RetiredRefreshToken).retiredAt >= limit;

/** Tokens aposentados que ainda estao dentro da janela de tolerancia. */
export function recentRetiredRefreshTokens(value: unknown, graceSeconds: number): RetiredRefreshToken[] {
  const limit = Date.now() - graceSeconds * 1000;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RetiredRefreshToken => isRetiredToken(item, limit));
}

/** O token apresentado e o vigente ou um dos aposentados recentes (tolerancia a abas concorrentes). */
export async function isRefreshTokenAccepted(
  token: string,
  currentHash: string,
  recent: RetiredRefreshToken[],
): Promise<boolean> {
  if (await refreshTokenMatches(token, currentHash)) return true;
  for (const entry of recent) {
    if (await refreshTokenMatches(token, entry.hash)) return true;
  }
  return false;
}

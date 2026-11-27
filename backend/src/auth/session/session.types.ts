import { UserRole } from "@prisma/client";
import { UsersService } from "../../users/users.service";

export type SessionContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export type UserRecord = Awaited<ReturnType<UsersService["findById"]>>;

export type AuthTokensResponse = {
  accessToken: string;
  refreshToken: string;
  user: Awaited<ReturnType<UsersService["sanitizeUser"]>>;
};

export type RetiredRefreshToken = { hash: string; retiredAt: number };

/** Outra requisicao rotacionou o refresh token no meio desta: refazer a leitura. */
export class RefreshRotationConflictError extends Error {}

export type IssueTokensInput = {
  userId: string;
  email: string;
  role: UserRole;
  user: UserRecord;
  sessionContext: SessionContext;
  existingSessionId?: string;
  /** Rotacao de refresh token: a troca so acontece se o hash vigente ainda for o lido (atomico). */
  rotation?: { expectedRefreshTokenHash: string; retired: RetiredRefreshToken[] };
};

export type SessionTimes = { refreshTokenHash: string; expiresAt: Date; now: Date };

import { AuthChallengeType, Prisma } from "@prisma/client";

export const WITH_FULL_USER = {
  user: {
    include: {
      taskCategories: { orderBy: { name: "asc" } },
      financeCategories: { orderBy: { name: "asc" } },
      tagGroups: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
  },
} satisfies Prisma.AuthChallengeInclude;

type OpenCheck = { type: AuthChallengeType; completedAt: Date | null; expiresAt: Date };

/** Desafio ainda utilizavel: do tipo esperado, nao concluido e dentro do prazo. */
export function isOpenChallenge<T extends OpenCheck>(challenge: T | null, type: AuthChallengeType): challenge is T {
  return !!challenge && challenge.type === type && !challenge.completedAt && challenge.expiresAt > new Date();
}

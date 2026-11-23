-- 9a-1 (contrato item 9, secoes 2 e 3): cartoes nomeados.
-- Ordem: cria CreditCard, backfill do "Principal" por usuario, depois o cardId
-- dos tetos (NOT NULL so depois do backfill) e o cardId opcional dos lancamentos.
-- Lancamentos CREDIT antigos ficam com cardId nulo e contam no cartao padrao.

-- CreateTable
CREATE TABLE "CreditCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "closingDay" INTEGER NOT NULL,
    "dueDay" INTEGER,
    "countAllPayments" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCard_pkey" PRIMARY KEY ("id")
);

-- Backfill: um "Principal" padrao por usuario, copiando os campos atuais do User.
-- Idempotente: so cria quando o usuario ainda nao tem cartao padrao ativo.
-- Clamp na faixa 1..31: dado antigo pode estar fora dela (0, 45, -3; so por SQL direto, pois os
-- DTOs sempre validaram 1..31). Sem o clamp, o Principal nasceria com o mesmo valor invalido.
-- dueDay usa CASE porque LEAST/GREATEST ignoram NULL no Postgres (GREATEST(1, NULL) = 1), e
-- vencimento ausente tem que continuar NULL.
INSERT INTO "CreditCard" ("id", "userId", "name", "closingDay", "dueDay", "countAllPayments", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", 'Principal',
  LEAST(31, GREATEST(1, u."monthClosingDay")),
  CASE WHEN u."creditDueDay" IS NULL THEN NULL ELSE LEAST(31, GREATEST(1, u."creditDueDay")) END,
  u."creditCycleCountAllPayments", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (
    SELECT 1 FROM "CreditCard" c
    WHERE c."userId" = u."id" AND c."isDefault" = true AND c."archivedAt" IS NULL
);

-- CreateIndex (unicos parciais: so entre cartoes ativos)
CREATE UNIQUE INDEX "CreditCard_userId_lower_name_active_key" ON "CreditCard" ("userId", lower("name")) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "CreditCard_userId_default_active_key" ON "CreditCard" ("userId") WHERE "isDefault" = true AND "archivedAt" IS NULL;
CREATE INDEX "CreditCard_userId_archivedAt_idx" ON "CreditCard"("userId", "archivedAt");

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: teto passa a pertencer ao cartao
ALTER TABLE "CreditCycleCeiling" ADD COLUMN "cardId" TEXT;
UPDATE "CreditCycleCeiling" cc
SET "cardId" = c."id"
FROM "CreditCard" c
WHERE c."userId" = cc."userId" AND c."isDefault" = true AND c."archivedAt" IS NULL AND cc."cardId" IS NULL;
ALTER TABLE "CreditCycleCeiling" ALTER COLUMN "cardId" SET NOT NULL;

-- Unicidade do teto: (cardId, closingDate) no lugar de (userId, closingDate)
DROP INDEX IF EXISTS "CreditCycleCeiling_userId_closingDate_key";
CREATE UNIQUE INDEX "CreditCycleCeiling_cardId_closingDate_key" ON "CreditCycleCeiling"("cardId", "closingDate");

-- AddForeignKey
ALTER TABLE "CreditCycleCeiling" ADD CONSTRAINT "CreditCycleCeiling_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: cardId opcional nos lancamentos, parcelados e recorrencias (sem backfill)
ALTER TABLE "Transaction" ADD COLUMN "cardId" TEXT;
ALTER TABLE "InstallmentPurchase" ADD COLUMN "cardId" TEXT;
ALTER TABLE "RecurringTransaction" ADD COLUMN "cardId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_cardId_idx" ON "Transaction"("cardId");
CREATE INDEX "InstallmentPurchase_cardId_idx" ON "InstallmentPurchase"("cardId");
CREATE INDEX "RecurringTransaction_cardId_idx" ON "RecurringTransaction"("cardId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InstallmentPurchase" ADD CONSTRAINT "InstallmentPurchase_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

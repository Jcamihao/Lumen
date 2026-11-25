-- Item 11b (11b-1a): carteira compartilhada de lancamentos e categorias (contrato 2026-11-25).
-- Marca de compartilhamento por item: sharedGroupOwnerId = pagador do grupo. Nulo = privado.
-- Escrita a mao: `prisma migrate dev` propoe derrubar os indices unicos parciais de CreditCard — nao usar.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "sharedGroupOwnerId" TEXT;

-- AlterTable
ALTER TABLE "FinanceCategory" ADD COLUMN "sharedGroupOwnerId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_sharedGroupOwnerId_idx" ON "Transaction"("sharedGroupOwnerId");

-- CreateIndex
CREATE INDEX "FinanceCategory_sharedGroupOwnerId_idx" ON "FinanceCategory"("sharedGroupOwnerId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sharedGroupOwnerId_fkey" FOREIGN KEY ("sharedGroupOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCategory" ADD CONSTRAINT "FinanceCategory_sharedGroupOwnerId_fkey" FOREIGN KEY ("sharedGroupOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Item 11b (11b-1b): cartoes compartilhados (contrato 2026-11-25, secao 8).
-- Marca de compartilhamento por item: sharedGroupOwnerId = pagador do grupo. Nulo = privado.
-- Escrita a mao: `prisma migrate dev` propoe derrubar os indices unicos parciais de CreditCard — nao usar.

-- AlterTable
ALTER TABLE "CreditCard" ADD COLUMN "sharedGroupOwnerId" TEXT;

-- CreateIndex
CREATE INDEX "CreditCard_sharedGroupOwnerId_idx" ON "CreditCard"("sharedGroupOwnerId");

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_sharedGroupOwnerId_fkey" FOREIGN KEY ("sharedGroupOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

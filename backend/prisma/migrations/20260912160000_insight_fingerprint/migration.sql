-- Insight ganha identidade estavel (fingerprint) e controle de notificacao.
--
-- Antes, refreshForUser apagava e recriava todos os insights do usuario, entao
-- cada linha nascia com id novo e o worker da fila nao tinha como saber se ja
-- havia avisado sobre aquela situacao. Com fingerprint + notifiedAt, a linha
-- sobrevive ao refresh e a notificacao acontece uma vez por situacao.
--
-- Insights sao 100% regeneraveis a partir do estado atual do usuario, entao as
-- linhas antigas sao descartadas em vez de receberem um fingerprint inventado.
DELETE FROM "Insight";

ALTER TABLE "Insight" ADD COLUMN "fingerprint" TEXT NOT NULL;
ALTER TABLE "Insight" ADD COLUMN "notifiedAt" TIMESTAMP(3);
ALTER TABLE "Insight" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "Insight_userId_fingerprint_key" ON "Insight"("userId", "fingerprint");
CREATE INDEX "Insight_userId_notifiedAt_idx" ON "Insight"("userId", "notifiedAt");

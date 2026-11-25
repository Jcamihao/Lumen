-- 9c-2: o CreditCard (padrao) e a fonte unica de fechamento/vencimento/escopo do
-- ciclo. Remove o espelho do User que a 9a mantinha em sincronia (secao 4.2 do
-- contrato do item 9; contrato 2026-11-25-conversa-contrato-item-9c2, D1).
-- Dados ja viviam no cartao; nada a copiar. Checagem de segurança antes do deploy
-- (dessincronia residual) esta no contrato da 9c-2.
ALTER TABLE "User" DROP COLUMN "monthClosingDay";
ALTER TABLE "User" DROP COLUMN "creditDueDay";
ALTER TABLE "User" DROP COLUMN "creditCycleCountAllPayments";

-- Garantia no banco: uma conta fixa gera no maximo um lancamento por data.
-- (NULL em recurringTransactionId nao conflita, entao lancamentos manuais nao sao afetados.)
-- O indice unico ja atende as buscas por recurringTransactionId.
DROP INDEX "Transaction_recurringTransactionId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_recurringTransactionId_date_key" ON "Transaction"("recurringTransactionId", "date");

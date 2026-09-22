-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CREDIT', 'DEBIT');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "paymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN     "paymentMethod" "PaymentMethod";

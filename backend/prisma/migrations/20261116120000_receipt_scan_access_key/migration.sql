-- AlterTable
ALTER TABLE "ReceiptScan" ADD COLUMN "accessKey" TEXT;

-- CreateIndex
CREATE INDEX "ReceiptScan_userId_accessKey_idx" ON "ReceiptScan"("userId", "accessKey");

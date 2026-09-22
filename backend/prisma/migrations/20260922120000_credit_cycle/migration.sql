-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creditDueDay" INTEGER;

-- CreateTable
CREATE TABLE "CreditCycleCeiling" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "closingDate" TIMESTAMP(3) NOT NULL,
    "ceiling" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCycleCeiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditCycleCeiling_userId_closingDate_idx" ON "CreditCycleCeiling"("userId", "closingDate");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "CreditCycleCeiling_userId_closingDate_key" ON "CreditCycleCeiling"("userId", "closingDate");

-- AddForeignKey
ALTER TABLE "CreditCycleCeiling" ADD CONSTRAINT "CreditCycleCeiling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "SupportRequest" ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "area" TEXT,
ADD COLUMN     "canContact" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SupportRequest_type_createdAt_idx" ON "SupportRequest"("type", "createdAt");

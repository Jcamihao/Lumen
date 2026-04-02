-- CreateEnum
CREATE TYPE "AuthChallengeType" AS ENUM ('MFA_LOGIN');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "mfaPendingTotpSecretEncrypted" TEXT,
ADD COLUMN     "mfaRecoveryCodes" JSONB,
ADD COLUMN     "mfaTotpSecretEncrypted" TEXT;

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthChallengeType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthChallenge_userId_type_expiresAt_completedAt_idx" ON "AuthChallenge"("userId", "type", "expiresAt", "completedAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

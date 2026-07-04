-- AlterEnum
ALTER TYPE "AuthChallengeType" ADD VALUE 'MFA_EMAIL_BYPASS';

-- AlterTable
ALTER TABLE "AuthChallenge" ADD COLUMN "token" TEXT;

-- AlterEnum
ALTER TYPE "AuthChallengeType" ADD VALUE 'PASSWORD_RESET';
ALTER TYPE "AuthChallengeType" ADD VALUE 'EMAIL_VERIFICATION';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "emailWeeklyDigest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailReminders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailInsightAlerts" BOOLEAN NOT NULL DEFAULT true;

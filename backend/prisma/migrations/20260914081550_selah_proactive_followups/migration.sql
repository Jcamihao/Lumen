-- AlterTable
ALTER TABLE "Insight" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastWeeklyDigestAt" TIMESTAMP(3);


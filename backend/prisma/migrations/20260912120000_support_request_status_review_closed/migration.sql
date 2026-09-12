-- AlterEnum
-- SupportRequestStatus: REVIEWED vira IN_REVIEW e CLOSED passa a existir.
-- O frontend (admin-support-page / support-page) ja usava IN_REVIEW e CLOSED
-- desde a v1.5.0, mas o enum nunca foi migrado, o que fazia o painel admin
-- estourar 500 ao mudar o status.
ALTER TYPE "SupportRequestStatus" RENAME TO "SupportRequestStatus_old";

CREATE TYPE "SupportRequestStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

ALTER TABLE "SupportRequest" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "SupportRequest"
  ALTER COLUMN "status" TYPE "SupportRequestStatus"
  USING (
    CASE "status"::text
      WHEN 'REVIEWED' THEN 'IN_REVIEW'
      ELSE "status"::text
    END
  )::"SupportRequestStatus";

ALTER TABLE "SupportRequest" ALTER COLUMN "status" SET DEFAULT 'OPEN';

DROP TYPE "SupportRequestStatus_old";

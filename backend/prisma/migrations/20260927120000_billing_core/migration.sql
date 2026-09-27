-- Billing (nucleo): assinaturas, eventos do provedor de pagamento e uso do Selah.
-- Sem dado existente afetado: so tabelas e tipos novos.
CREATE TYPE "BillingPlan" AS ENUM ('INDIVIDUAL', 'SHARED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE "SubscriptionSource" AS ENUM ('ASAAS', 'GRANT');
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "source" "SubscriptionSource" NOT NULL,
    "interval" "BillingInterval",
    "seats" INTEGER NOT NULL DEFAULT 1,
    "currentPeriodEnd" TIMESTAMP(3),
    "pastDueSince" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "asaasCheckoutId" TEXT,
    "asaasSubscriptionId" TEXT,
    "asaasCustomerId" TEXT,
    "grantedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'ASAAS',
    "externalEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SelahUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelahUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_asaasCheckoutId_key" ON "Subscription"("asaasCheckoutId");
CREATE UNIQUE INDEX "Subscription_asaasSubscriptionId_key" ON "Subscription"("asaasSubscriptionId");
CREATE INDEX "Subscription_ownerUserId_status_idx" ON "Subscription"("ownerUserId", "status");

CREATE UNIQUE INDEX "BillingEvent_externalEventId_key" ON "BillingEvent"("externalEventId");
CREATE INDEX "BillingEvent_type_createdAt_idx" ON "BillingEvent"("type", "createdAt");

CREATE INDEX "SelahUsage_userId_createdAt_idx" ON "SelahUsage"("userId", "createdAt");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SelahUsage" ADD CONSTRAINT "SelahUsage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

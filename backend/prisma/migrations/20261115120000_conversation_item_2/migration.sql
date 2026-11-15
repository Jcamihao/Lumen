-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('APP', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('COLLECTING_FIELDS', 'AWAITING_CONFIRMATION', 'AWAITING_IMPORT_FILE', 'AWAITING_IMPORT_REVIEW', 'PROCESSING');

-- CreateEnum
CREATE TYPE "ConversationOutcome" AS ENUM ('RECOGNIZED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'UNRECOGNIZED', 'DUPLICATE', 'ERROR');

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "state" "ConversationState" NOT NULL,
    "intent" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "messageId" TEXT,
    "intent" TEXT,
    "outcome" "ConversationOutcome" NOT NULL,
    "appliedKey" TEXT,
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationSession_expiresAt_idx" ON "ConversationSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSession_userId_channel_key" ON "ConversationSession"("userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationEvent_appliedKey_key" ON "ConversationEvent"("appliedKey");

-- CreateIndex
CREATE INDEX "ConversationEvent_userId_createdAt_idx" ON "ConversationEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationEvent_userId_channel_messageId_key" ON "ConversationEvent"("userId", "channel", "messageId");

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationEvent" ADD CONSTRAINT "ConversationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


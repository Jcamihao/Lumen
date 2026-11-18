-- CreateTable
CREATE TABLE "WhatsappLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappLinkCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappLink_userId_key" ON "WhatsappLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappLink_jid_key" ON "WhatsappLink"("jid");

-- CreateIndex
CREATE INDEX "WhatsappLinkCode_userId_createdAt_idx" ON "WhatsappLinkCode"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappLinkCode_codeHash_idx" ON "WhatsappLinkCode"("codeHash");

-- AddForeignKey
ALTER TABLE "WhatsappLink" ADD CONSTRAINT "WhatsappLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappLinkCode" ADD CONSTRAINT "WhatsappLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

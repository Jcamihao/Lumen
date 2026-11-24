-- Item 11 (11a): grupo do plano Compartilhado — membros e convites (contrato 2026-11-24).
-- O indice unico de "um grupo ativo por usuario" e PARCIAL (WHERE "leftAt" IS NULL): igual aos
-- indices do 9a, ele so existe na SQL e o `prisma migrate dev` vai propor remove-lo — nao rodar sem revisar.

-- CreateTable
CREATE TABLE "GroupMembership" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "memberUserId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupInvite" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "GroupInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupInvite_tokenHash_key" ON "GroupInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "GroupInvite_ownerUserId_idx" ON "GroupInvite"("ownerUserId");

-- CreateIndex
CREATE INDEX "GroupMembership_ownerUserId_leftAt_idx" ON "GroupMembership"("ownerUserId", "leftAt");

-- CreateIndex
CREATE INDEX "GroupMembership_memberUserId_leftAt_idx" ON "GroupMembership"("memberUserId", "leftAt");

-- Um usuario so pode ter UMA membership ativa (o "grupo" de saida em cascata do D5 usa isso)
CREATE UNIQUE INDEX "GroupMembership_active_member_key" ON "GroupMembership"("memberUserId") WHERE "leftAt" IS NULL;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_memberUserId_fkey" FOREIGN KEY ("memberUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInvite" ADD CONSTRAINT "GroupInvite_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

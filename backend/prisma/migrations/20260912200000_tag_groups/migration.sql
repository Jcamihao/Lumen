-- Grupos de tags para organizar notas fiscais e permitir comparacao entre
-- compras do mesmo grupo (ex.: "Padaria", "Compras do mes").
CREATE TABLE "TagGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TagGroup_userId_name_key" ON "TagGroup"("userId", "name");
CREATE INDEX "TagGroup_userId_sortOrder_idx" ON "TagGroup"("userId", "sortOrder");

ALTER TABLE "TagGroup" ADD CONSTRAINT "TagGroup_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReceiptScan ganha o grupo (escolhido antes do upload) e a opcao de comparar
-- com a nota anterior do mesmo grupo. Nulo/false em notas ja existentes —
-- elas nao entram na comparacao ate o usuario recomecar a marcar um grupo.
ALTER TABLE "ReceiptScan" ADD COLUMN "tagGroupId" TEXT;
ALTER TABLE "ReceiptScan" ADD COLUMN "compareWithPrevious" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ReceiptScan_tagGroupId_idx" ON "ReceiptScan"("tagGroupId");

ALTER TABLE "ReceiptScan" ADD CONSTRAINT "ReceiptScan_tagGroupId_fkey"
    FOREIGN KEY ("tagGroupId") REFERENCES "TagGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: todo usuario existente ganha os mesmos 4 grupos padrao que um
-- usuario novo recebe no cadastro (ver DEFAULT_TAG_GROUPS em
-- users.service.ts). sortOrder segue a ordem de criacao (gen_random_uuid()
-- do Postgres para o id, timestamp igual pra todos do backfill).
INSERT INTO "TagGroup" ("id", "userId", "name", "color", "isDefault", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", defaults.name, defaults.color, true, defaults.sort_order, now(), now()
FROM "User" u
CROSS JOIN (VALUES
    ('Compras do mes', '#F4A261', 0),
    ('Padaria', '#E76F51', 1),
    ('Farmacia', '#2A9D8F', 2),
    ('Restaurante', '#E9C46A', 3)
) AS defaults(name, color, sort_order);

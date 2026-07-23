-- CreateTable
CREATE TABLE "StoreKnowledge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "progress" TEXT,
    "lastSyncAt" DATETIME,
    "error" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QueryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "aiResponse" TEXT,
    "reason" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "StoreKnowledge_shopDomain_idx" ON "StoreKnowledge"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "StoreKnowledge_shopDomain_type_key" ON "StoreKnowledge"("shopDomain", "type");

-- CreateIndex
CREATE UNIQUE INDEX "SyncStatus_shopDomain_key" ON "SyncStatus"("shopDomain");

-- CreateIndex
CREATE INDEX "QueryLog_shopDomain_idx" ON "QueryLog"("shopDomain");

-- CreateIndex
CREATE INDEX "QueryLog_createdAt_idx" ON "QueryLog"("createdAt");

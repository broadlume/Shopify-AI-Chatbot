-- CreateTable
CREATE TABLE "MetafieldPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MetafieldPermission_shopDomain_ownerType_namespace_key_key" ON "MetafieldPermission"("shopDomain", "ownerType", "namespace", "key");

-- CreateIndex
CREATE INDEX "MetafieldPermission_shopDomain_ownerType_enabled_idx" ON "MetafieldPermission"("shopDomain", "ownerType", "enabled");

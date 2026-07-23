-- CreateTable
CREATE TABLE "ShopConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "bubbleColor" TEXT NOT NULL DEFAULT '#5046E4',
    "welcomeMsg" TEXT NOT NULL DEFAULT '👋 Hi there! How can I help you today?',
    "promptType" TEXT NOT NULL DEFAULT 'standardAssistant',
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopConfig_shopDomain_key" ON "ShopConfig"("shopDomain");

-- Chat connection (docs/superpowers/specs/2026-11-04-chat-connection-design.md §4, §5):
-- a student's chat (ChatGPT, Claude, ...) is registered, paired with a device by a
-- short code, and reads a snapshot the phone sealed with a key the server never
-- keeps. New tables only: every existing table stays as it is, and a server without
-- this code never reads them. A device's delete takes its codes, grants, tokens and
-- snapshot with it.

-- CreateTable
CREATE TABLE "chat_client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedAt" TIMESTAMP(3),

    CONSTRAINT "chat_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_code" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "key" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_auth_code" (
    "codeHash" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_auth_code_pkey" PRIMARY KEY ("codeHash")
);

-- CreateTable
CREATE TABLE "chat_grant" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "clientId" TEXT NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "chat_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_token" (
    "tokenHash" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "chat_token_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "chat_snapshot" (
    "deviceId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "writtenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_snapshot_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "chat_attempt" (
    "id" SERIAL NOT NULL,
    "ip" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_code_codeHash_key" ON "chat_code"("codeHash");

-- CreateIndex
CREATE INDEX "chat_grant_deviceId_idx" ON "chat_grant"("deviceId");

-- CreateIndex
CREATE INDEX "chat_token_grantId_idx" ON "chat_token"("grantId");

-- CreateIndex
CREATE INDEX "chat_attempt_ip_at_idx" ON "chat_attempt"("ip", "at");

-- AddForeignKey
ALTER TABLE "chat_code" ADD CONSTRAINT "chat_code_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_auth_code" ADD CONSTRAINT "chat_auth_code_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "chat_grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_grant" ADD CONSTRAINT "chat_grant_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_grant" ADD CONSTRAINT "chat_grant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "chat_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_token" ADD CONSTRAINT "chat_token_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "chat_grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_snapshot" ADD CONSTRAINT "chat_snapshot_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

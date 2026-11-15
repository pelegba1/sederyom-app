-- Friends ("חברים"): a friend's encrypted box. The server keeps ciphertext
-- under an id derived from a secret it never sees, and which device wrote it;
-- nothing of who reads it. A new table only: every existing table stays as it
-- is, and a server without this table's code reads nothing from it.

-- CreateTable
CREATE TABLE "buddy_box" (
    "id" TEXT NOT NULL,
    "writerDeviceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buddy_box_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buddy_box_writerDeviceId_idx" ON "buddy_box"("writerDeviceId");

-- CreateIndex
CREATE INDEX "buddy_box_updatedAt_idx" ON "buddy_box"("updatedAt");

-- AddForeignKey
ALTER TABLE "buddy_box" ADD CONSTRAINT "buddy_box_writerDeviceId_fkey" FOREIGN KEY ("writerDeviceId") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

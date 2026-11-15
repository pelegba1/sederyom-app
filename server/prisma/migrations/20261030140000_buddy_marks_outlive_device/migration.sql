-- Friends: a used link's mark outlives the device that wrote it. A mark is an
-- emptied invite or reply (`ciphertext` ''); it keeps its link from being armed
-- again under the inviter's name. Deleting a device used to take every box it
-- wrote with it, marks too. Now the box keeps its row with no writer: the
-- device's delete (`DELETE /v2/device`) empties its live invite and reply rows
-- and deletes its pair rows first, so that a row with no writer is always a
-- mark. No row is changed here; the column only stops being required.

-- DropForeignKey
ALTER TABLE "buddy_box" DROP CONSTRAINT "buddy_box_writerDeviceId_fkey";

-- AlterTable
ALTER TABLE "buddy_box" ALTER COLUMN "writerDeviceId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "buddy_box" ADD CONSTRAINT "buddy_box_writerDeviceId_fkey" FOREIGN KEY ("writerDeviceId") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

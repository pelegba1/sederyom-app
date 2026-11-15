-- A push names the class change events it carried, so a later batch for the
-- same day leaves out what this device was already told. An event stays open
-- while any other device still waits for it (quiet hours, a failed send), and
-- until now it rode along again in every later push of that evening.

-- AlterTable
ALTER TABLE "device_notification" ADD COLUMN "eventIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

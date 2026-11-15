-- AlterTable
ALTER TABLE "school_class" ADD COLUMN     "examCalendarSetBy" TEXT;

-- Who set a calendar was not recorded before. The class's oldest follower is
-- the likeliest; a class nobody follows keeps none, and whoever follows it
-- next may set its own.
UPDATE "school_class" AS c
SET "examCalendarSetBy" = (
  SELECT d."id" FROM "device" AS d WHERE d."classId" = c."id" ORDER BY d."createdAt" ASC LIMIT 1
)
WHERE c."examCalendarId" IS NOT NULL;

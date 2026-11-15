-- A class that already has an exam calendar is not told that it has an exam board
-- when this version comes out: the announcement is for a class whose board is new
-- (examBoardAnnouncedAt empty). Without this the first tick would push every such
-- class's followers. Changes data only: no column or table is touched.
UPDATE "school_class"
SET "examBoardAnnouncedAt" = CURRENT_TIMESTAMP
WHERE "examCalendarId" IS NOT NULL
  AND "examBoardAnnouncedAt" IS NULL;

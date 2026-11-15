-- The exam board from a link or a file: where a class's uploaded board came from
-- and when (routes/examBoard.ts), and the count that keeps a device to ten
-- previews an hour. Adds only: every row keeps working as it is.

-- AlterTable
ALTER TABLE "school_class" ADD COLUMN     "examBoardKind" TEXT,
ADD COLUMN     "examBoardSetAt" TIMESTAMP(3),
ADD COLUMN     "examBoardAnnouncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "device" ADD COLUMN     "boardPreviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "boardPreviewWindowAt" TIMESTAMP(3);

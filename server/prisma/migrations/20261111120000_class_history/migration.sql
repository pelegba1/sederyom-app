-- AlterTable
ALTER TABLE "school_class" ADD COLUMN     "historyBackfillDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "historyBackfilledTo" TEXT,
ADD COLUMN     "historyFrozenTo" TEXT;

-- CreateTable
CREATE TABLE "class_lesson_history" (
    "classId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hourIndex" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "teacher" TEXT NOT NULL DEFAULT '',
    "room" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "status" TEXT,
    "substitute" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL,
    "changeSeenAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_lesson_history_pkey" PRIMARY KEY ("classId","date","hourIndex","subject","teacher")
);

-- CreateTable
CREATE TABLE "class_exam_history" (
    "classId" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "details" TEXT,
    "source" TEXT NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_exam_history_pkey" PRIMARY KEY ("classId","naturalKey")
);

-- CreateIndex
CREATE INDEX "class_lesson_history_classId_date_idx" ON "class_lesson_history"("classId", "date");

-- CreateIndex
CREATE INDEX "class_exam_history_classId_date_idx" ON "class_exam_history"("classId", "date");


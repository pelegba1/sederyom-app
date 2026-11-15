-- AlterTable
ALTER TABLE "school_class" ADD COLUMN     "examCalendarId" TEXT,
ADD COLUMN     "exams" JSONB,
ADD COLUMN     "examsError" TEXT,
ADD COLUMN     "examsOkAt" TIMESTAMP(3),
ADD COLUMN     "examsPolledAt" TIMESTAMP(3);


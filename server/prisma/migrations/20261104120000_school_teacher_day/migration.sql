-- "איפה המורה?": today's day of every teacher at the school, read from all of
-- its class timetables and kept for half an hour (routes/teachers.ts). Not
-- snapshots: it never goes through the delta engine and never notifies.

-- AlterTable
ALTER TABLE "school" ADD COLUMN     "teacherDay" JSONB,
ADD COLUMN     "teacherDayReadAt" TIMESTAMP(3),
ADD COLUMN     "teacherDayError" TEXT;

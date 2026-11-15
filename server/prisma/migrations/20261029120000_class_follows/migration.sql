-- Parents mode, stage 2: a device follows up to five classes besides its own
-- (`device.classId`), a parent's other children. A new table only: every
-- device's own class stays where it is, and a server without this table's
-- code reads nothing from it.

-- CreateTable
CREATE TABLE "class_follow" (
    "deviceId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "prefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_follow_pkey" PRIMARY KEY ("deviceId","classId")
);

-- CreateIndex
CREATE INDEX "class_follow_classId_idx" ON "class_follow"("classId");

-- AddForeignKey
ALTER TABLE "class_follow" ADD CONSTRAINT "class_follow_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_follow" ADD CONSTRAINT "class_follow_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

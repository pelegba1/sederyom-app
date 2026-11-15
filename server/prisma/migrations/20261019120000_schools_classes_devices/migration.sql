-- CreateTable
CREATE TABLE "school" (
    "id" TEXT NOT NULL,
    "shahafUrl" TEXT NOT NULL,
    "semel" INTEGER,
    "limitPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_class" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "shahafClassId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "polledAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "freshness" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "pushToken" TEXT,
    "classId" TEXT,
    "prefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_snapshot" (
    "classId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "partition" TEXT,
    "payload" JSONB NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "class_snapshot_pkey" PRIMARY KEY ("classId","kind","naturalKey")
);

-- CreateTable
CREATE TABLE "class_change_event" (
    "id" SERIAL NOT NULL,
    "classId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "class_change_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_notification" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_shahafUrl_key" ON "school"("shahafUrl");

-- CreateIndex
CREATE INDEX "school_class_polledAt_idx" ON "school_class"("polledAt");

-- CreateIndex
CREATE UNIQUE INDEX "school_class_schoolId_shahafClassId_key" ON "school_class"("schoolId", "shahafClassId");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokenHash_key" ON "device"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_pushToken_key" ON "device"("pushToken");

-- CreateIndex
CREATE INDEX "device_classId_idx" ON "device"("classId");

-- CreateIndex
CREATE INDEX "class_snapshot_classId_kind_partition_idx" ON "class_snapshot"("classId", "kind", "partition");

-- CreateIndex
CREATE INDEX "class_change_event_notifiedAt_idx" ON "class_change_event"("notifiedAt");

-- CreateIndex
CREATE INDEX "class_change_event_classId_createdAt_idx" ON "class_change_event"("classId", "createdAt");

-- CreateIndex
CREATE INDEX "device_notification_sentAt_idx" ON "device_notification"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_notification_deviceId_dedupeKey_key" ON "device_notification"("deviceId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "school_class" ADD CONSTRAINT "school_class_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_class"("id") ON DELETE SET NULL ON UPDATE CASCADE;


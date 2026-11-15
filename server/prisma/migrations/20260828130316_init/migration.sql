-- CreateTable
CREATE TABLE "user_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "json" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_token" (
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_token_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "google_auth" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "schoolCalendarId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_auth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mashov_session" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "blobEnc" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unknown',

    CONSTRAINT "mashov_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot" (
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "partition" TEXT,
    "payload" JSONB NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "snapshot_pkey" PRIMARY KEY ("source","kind","naturalKey")
);

-- CreateTable
CREATE TABLE "change_event" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "change_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "hourIndex" INTEGER NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "subject" TEXT NOT NULL,
    "teacher" TEXT,
    "room" TEXT,
    "status" TEXT NOT NULL,
    "substitute" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam" (
    "naturalKey" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "details" TEXT,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_pkey" PRIMARY KEY ("naturalKey")
);

-- CreateTable
CREATE TABLE "school_event" (
    "naturalKey" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_event_pkey" PRIMARY KEY ("naturalKey")
);

-- CreateTable
CREATE TABLE "homework" (
    "naturalKey" TEXT NOT NULL,
    "dueDate" TEXT,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "linkedTaskId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homework_pkey" PRIMARY KEY ("naturalKey")
);

-- CreateTable
CREATE TABLE "grade" (
    "naturalKey" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "valueText" TEXT,
    "weight" DOUBLE PRECISION,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_pkey" PRIMARY KEY ("naturalKey")
);

-- CreateTable
CREATE TABLE "school_message" (
    "naturalKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "from" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_message_pkey" PRIMARY KEY ("naturalKey")
);

-- CreateTable
CREATE TABLE "task_cache" (
    "googleId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "listTitle" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "due" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "updated" TIMESTAMP(3),
    "linkedHomeworkKey" TEXT,

    CONSTRAINT "task_cache_pkey" PRIMARY KEY ("googleId")
);

-- CreateTable
CREATE TABLE "calendar_event_cache" (
    "googleId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "location" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "calendar_event_cache_pkey" PRIMARY KEY ("googleId")
);

-- CreateTable
CREATE TABLE "sync_status" (
    "source" TEXT NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "degradedSince" TIMESTAMP(3),
    "lastError" TEXT,
    "sourceFreshness" TIMESTAMP(3),
    "needsReauth" BOOLEAN NOT NULL DEFAULT false,
    "brokenNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "sync_status_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursor" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "snapshot_source_kind_idx" ON "snapshot"("source", "kind");

-- CreateIndex
CREATE INDEX "snapshot_source_kind_partition_idx" ON "snapshot"("source", "kind", "partition");

-- CreateIndex
CREATE INDEX "change_event_notifiedAt_idx" ON "change_event"("notifiedAt");

-- CreateIndex
CREATE INDEX "change_event_createdAt_idx" ON "change_event"("createdAt");

-- CreateIndex
CREATE INDEX "lesson_date_idx" ON "lesson"("date");

-- CreateIndex
CREATE INDEX "exam_date_idx" ON "exam"("date");

-- CreateIndex
CREATE INDEX "school_event_date_idx" ON "school_event"("date");

-- CreateIndex
CREATE INDEX "homework_dueDate_idx" ON "homework"("dueDate");

-- CreateIndex
CREATE INDEX "grade_date_idx" ON "grade"("date");

-- CreateIndex
CREATE INDEX "school_message_date_idx" ON "school_message"("date");

-- CreateIndex
CREATE INDEX "task_cache_due_idx" ON "task_cache"("due");

-- CreateIndex
CREATE INDEX "calendar_event_cache_start_idx" ON "calendar_event_cache"("start");

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_dedupeKey_key" ON "notification_log"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_log_sentAt_idx" ON "notification_log"("sentAt");

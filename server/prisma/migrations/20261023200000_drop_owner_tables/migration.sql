-- The single owner's tables (plan 2f, B2). Since B1 nothing reads or writes
-- them: the owner's phone keeps its own Mashov, Google, settings and
-- notifications, and the server keeps only schools, classes and devices.
-- None of them has a foreign key to those.

-- DropTable
DROP TABLE "user_settings";

-- DropTable
DROP TABLE "push_token";

-- DropTable
DROP TABLE "google_auth";

-- DropTable
DROP TABLE "classroom_auth";

-- DropTable
DROP TABLE "mashov_session";

-- DropTable
DROP TABLE "snapshot";

-- DropTable
DROP TABLE "change_event";

-- DropTable
DROP TABLE "lesson";

-- DropTable
DROP TABLE "exam";

-- DropTable
DROP TABLE "school_event";

-- DropTable
DROP TABLE "homework";

-- DropTable
DROP TABLE "grade";

-- DropTable
DROP TABLE "school_message";

-- DropTable
DROP TABLE "task_cache";

-- DropTable
DROP TABLE "calendar_event_cache";

-- DropTable
DROP TABLE "sync_status";

-- DropTable
DROP TABLE "notification_log";

-- DropTable
DROP TABLE "sync_cursor";


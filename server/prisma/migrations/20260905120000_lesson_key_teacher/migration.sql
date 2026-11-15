-- The Shahaf lesson key gained a fourth segment, the teacher: two groups of one
-- subject share a period, and `date|hour|subject` could hold only one of them.
--
-- Re-key the rows already stored so the next poll finds its own keys and emits
-- nothing. Without this, every lesson in the horizon would be "deleted" and
-- "created" at once, and the notification engine turns a deleted lesson on
-- today or tomorrow into a push — one per lesson.
--
-- Old keys carry exactly two separators; the guard makes this idempotent.
UPDATE "snapshot"
SET "naturalKey" = "naturalKey" || '|' || COALESCE(payload->>'teacher', '')
WHERE source = 'shahaf'
  AND kind = 'lesson'
  AND length("naturalKey") - length(replace("naturalKey", '|', '')) = 2;

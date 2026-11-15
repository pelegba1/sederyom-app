-- Homework can be ticked off in the app ("עשיתי"). The mark is ours: Mashov is
-- never written to, and the homework projection only rewrites the source's own
-- fields, so a re-poll keeps it — the same arrangement as `linkedTaskId`.
--
-- Purely additive: a nullable column, no default, no backfill. Every existing
-- item reads as not done.
ALTER TABLE "homework" ADD COLUMN "doneAt" TIMESTAMP(3);

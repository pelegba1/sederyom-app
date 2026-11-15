-- Google Classroom connects with its own account (plan 14.5): usually the
-- school account, not the one Calendar and Tasks use. A table of its own keeps
-- every existing `google_auth` query, and the connection it holds, untouched.
--
-- Purely additive: a new table, nothing else changes.
CREATE TABLE "classroom_auth" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "email" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classroom_auth_pkey" PRIMARY KEY ("id")
);

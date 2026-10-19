-- Serverless avatar storage: the uploaded JPEG bytes live in the database on
-- hosts whose filesystem is read-only (e.g. Vercel), instead of public/uploads/.
-- Local/self-hosted installs keep storing files on disk and leave this empty.

CREATE TABLE "UserAvatar" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "mimeType" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

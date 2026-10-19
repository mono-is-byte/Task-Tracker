import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql/web";

/**
 * The schema provider is `sqlite` in every environment, but the database
 * itself can live in two places:
 *
 *  - a local file (`file:./dev.db`) for development, tests and self-hosting,
 *  - a remote libSQL/Turso database (`libsql://…`) for serverless hosts such
 *    as Vercel, whose filesystem is read-only and therefore cannot hold a
 *    SQLite file at all.
 *
 * Both use the same migrations, the same seed and the same test suite, so the
 * only difference is which driver adapter the client is built with. Set
 * `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`) to point the app at Turso;
 * otherwise `DATABASE_URL` is treated as a local file.
 *
 * The remote adapter is imported from `@prisma/adapter-libsql/web`: it talks
 * HTTP/WebSocket through `@libsql/client/web` and pulls in no native module,
 * which is what serverless hosts need.
 */
const fileUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const looksRemote = /^(libsql|wss?|https?):/i.test(fileUrl);
const remoteUrl = process.env.TURSO_DATABASE_URL ?? (looksRemote ? fileUrl : undefined);

/** True when the app talks to a remote libSQL/Turso database instead of a local file. */
export const usesRemoteSqlite = Boolean(remoteUrl);

function makeClient() {
  if (remoteUrl) {
    const adapter = new PrismaLibSql({
      url: remoteUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter });
  }
  const adapter = new PrismaBetterSqlite3({ url: fileUrl });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export function makeTestClient(testUrl: string) {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: testUrl }) });
}

export function taskKey(prefix: string, serial: number) {
  return `${prefix}-${serial}`;
}

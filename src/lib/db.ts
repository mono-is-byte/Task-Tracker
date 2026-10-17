import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const url = process.env.DATABASE_URL ?? "file:./dev.db";

function makeClient() {
  const adapter = new PrismaBetterSqlite3({ url });
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

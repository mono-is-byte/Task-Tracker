import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  migrations: {
    path: "./prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // The CLI (migrate/generate/seed) always works against a local SQLite file.
    // Remote libSQL/Turso is reached at runtime by the driver adapter in
    // src/lib/db.ts, because Prisma Migrate cannot talk to Turso over HTTP.
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});

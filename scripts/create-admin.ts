import "dotenv/config";
import { db, usesRemoteSqlite } from "../src/lib/db";
import { hashPassword, passwordProblems, verifyPassword } from "../src/lib/password";

/**
 * Creates — or repairs — a fixed super-admin account.
 *
 * Usage:
 *   npm run admin:create                       # admin / Demo1234!
 *   npm run admin:create -- <user> <password>  # custom credentials
 *
 * Targets whatever database src/lib/db.ts selects: the local SQLite file by
 * default, or the remote libSQL/Turso database when TURSO_DATABASE_URL (and
 * TURSO_AUTH_TOKEN) are set in the environment or in .env.
 *
 * The account is created active, unlocked and without the forced first-login
 * password change, so the credentials keep working exactly as given.
 */

const username = process.argv[2] ?? "admin";
const password = process.argv[3] ?? "Demo1234!";
const email = process.argv[4] ?? "admin@demo.local";
const name = "Administrator";

async function main() {
  const problems = passwordProblems(password);
  if (problems.length > 0) {
    console.error(`Password is too weak — needs ${problems.join(", ")}.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const data = {
    username,
    email,
    name,
    passwordHash,
    mustChangePassword: false,
    isSuperAdmin: true,
    active: true,
    deletedAt: null,
    lockedUntil: null,
    failedLogins: 0,
  };

  const existing = await db.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true },
  });

  if (existing) {
    await db.user.update({ where: { id: existing.id }, data });
    console.log(`Updated admin user "${username}" (${email}) — superadmin, active, unlocked.`);
  } else {
    await db.user.create({ data });
    console.log(`Created admin user "${username}" (${email}) — superadmin.`);
  }

  const check = await db.user.findUnique({
    where: { username },
    select: { passwordHash: true },
  });
  const ok = check ? await verifyPassword(password, check.passwordHash) : false;

  console.log(`Target database: ${usesRemoteSqlite ? "remote libSQL/Turso" : "local SQLite file"}`);
  console.log(`Login: ${username} / ${password}`);
  console.log(ok ? "Verified: password hash round-trips." : "Verification FAILED — see the output above.");
  if (!ok) process.exitCode = 1;
  console.log("⚠️  Change this password before exposing the instance publicly.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

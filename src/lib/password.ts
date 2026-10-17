import bcrypt from "bcryptjs";

const ROUNDS = 11;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** Returns a list of unmet rules; empty = strong enough. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("at least 8 characters");
  if (!/[a-z]/.test(password)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("a digit");
  return problems;
}

const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Temporary password that always passes strength rules. */
export function generateTempPassword(): string {
  let core = "";
  for (let i = 0; i < 9; i++) {
    core += TEMP_ALPHABET[Math.floor(Math.random() * TEMP_ALPHABET.length)];
  }
  const digits = "23456789";
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  // guarantee upper + digit presence
  return `T${core}${digits[Math.floor(Math.random() * digits.length)]}${uppers[Math.floor(Math.random() * uppers.length)]}!`;
}

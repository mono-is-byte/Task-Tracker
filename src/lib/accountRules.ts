/**
 * Change request Phase 2 — account self-service rules.
 *
 * Pure, dependency-free constants and validators shared by the SERVER (zod
 * schemas in the API routes and `changeUsername` in auth.ts) and the CLIENT
 * (the Profile page and the Users admin page). Keeping them here — instead of in
 * auth.ts — means a client component can import them without pulling bcrypt and
 * the database into the browser bundle.
 */

/** The only gender values the app accepts, in display order. */
export const GENDERS = ["Male", "Female", "Other", "Prefer not to say"] as const;
export type Gender = (typeof GENDERS)[number];

export function isGender(v: unknown): v is Gender {
  return typeof v === "string" && (GENDERS as readonly string[]).includes(v);
}

/** Login username limits (change request Phase 2). */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
/** Letters, digits, dot, underscore, hyphen — no spaces. */
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;
/** How many times a user may rename themselves per rolling 24h window. */
export const USERNAME_CHANGE_DAILY_LIMIT = 5;

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns a list of human-readable problems with a candidate username, or an
 * empty array when it is acceptable. Names are matched case-insensitively
 * (callers lower-case before comparing) and may not look like an email address,
 * because `login()` accepts an email OR a username as the identifier.
 */
export function usernameProblems(value: string): string[] {
  const v = value.trim();
  const problems: string[] = [];
  if (v.length < USERNAME_MIN) problems.push(`at least ${USERNAME_MIN} characters`);
  if (v.length > USERNAME_MAX) problems.push(`at most ${USERNAME_MAX} characters`);
  if (/\s/.test(v)) problems.push("no spaces");
  if (!USERNAME_RE.test(v)) problems.push("only letters, digits, dot, underscore or hyphen");
  if (v.includes("@") || EMAIL_SHAPE_RE.test(v)) problems.push("must not look like an email address");
  return problems;
}

/** Fields the profile form may change (gender/username have their own routes). */
const PROFILE_FIELDS = ["name", "theme", "hoursPerDay", "avatarUrl", "gender"] as const;

export type ProfileChange = {
  /** Only the fields that ACTUALLY differ — an empty object means "nothing to write". */
  data: Record<string, unknown>;
  /** Small `{ field: [old, new] }` summary for the audit row (never images/passwords). */
  diff: Record<string, [unknown, unknown]>;
};

/**
 * Compare an incoming profile patch against the stored row.
 *
 * PHASE 6b rule: "no change = no audit row". The Profile page re-submits the
 * full form on every save, so comparing here keeps an unchanged save a silent
 * no-op instead of flooding the Audit Log with empty `user.profile_update`
 * entries. Values of `undefined` mean "field not sent". The avatar is summarised
 * as set/none so the audit diff never contains the image data itself.
 */
export function profileChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): ProfileChange {
  const data: Record<string, unknown> = {};
  const diff: Record<string, [unknown, unknown]> = {};
  for (const field of PROFILE_FIELDS) {
    const incoming = patch[field];
    if (incoming === undefined || incoming === before[field]) continue;
    diff[field] = field === "avatarUrl"
      ? [before[field] ? "set" : "none", incoming ? "set" : "none"]
      : [before[field] ?? null, incoming];
    data[field] = incoming;
  }
  return { data, diff };
}

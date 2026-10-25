import type { User } from "@prisma/client";
import { COOKIE_NAME, getSessionUser } from "./auth";
import { db } from "./db";
import { getMembership, type Action, type Membership } from "./permissions";

export function ok(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export function fail(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, details } }, { status });
}

/**
 * Turn an unexpected route failure (database/schema mismatch, connection loss,
 * …) into a clean JSON 500. Without this, such a failure produced an EMPTY 500
 * body — the calendar page then showed nothing at all, with no hint why. The
 * real error still reaches the server log.
 */
export function serverError(e: unknown, message = "The server could not complete this request."): Response {
  console.error("[api] unhandled route error:", e);
  return fail(500, "server_error", message);
}

export async function readJson<T>(req: Request): Promise<{ value?: T; error?: Response }> {
  try {
    const value = (await req.json()) as T;
    return { value };
  } catch {
    return { error: fail(400, "bad_json", "Request body must be valid JSON.") };
  }
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function tokenFromRequest(req: Request): string | null {
  return parseCookies(req.headers.get("cookie"))[COOKIE_NAME] ?? null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** CSRF: for cookie-authenticated mutations, require same-origin Origin/Referer when present. */
function checkSameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host");
  if (!origin && !referer) return true; // non-browser client (curl, tests)
  if (!host) return true;
  const same = (url: string) => {
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  };
  if (origin && !same(origin)) return false;
  if (!origin && referer && !same(referer)) return false;
  return true;
}

export async function requireUser(req: Request): Promise<{ user: User; sessionId: string } | { response: Response }> {
  if (!checkSameOrigin(req)) return { response: fail(403, "csrf", "Cross-origin request blocked.") };
  const token = tokenFromRequest(req);
  const su = await getSessionUser(db, token);
  if (!su) return { response: fail(401, "unauthorized", "Login required.") };
  return su;
}

export async function requireMember(
  req: Request,
  projectId: string,
  action: Action,
): Promise<{ user: User; sessionId: string; membership: Membership } | { response: Response }> {
  const auth = await requireUser(req);
  if ("response" in auth) return auth;
  const membership = await getMembership(db, auth.user.id, auth.user.isSuperAdmin, projectId);
  if (!membership) return { response: fail(403, "forbidden", "No access to this project.") };
  if (!membership.perms[action]) return { response: fail(403, "forbidden", `Role "${membership.roleName}" cannot ${action}.`) };
  return { ...auth, membership };
}

export async function requireAdmin(req: Request): Promise<{ user: User; sessionId: string } | { response: Response }> {
  const auth = await requireUser(req);
  if ("response" in auth) return auth;
  if (!auth.user.isSuperAdmin) return { response: fail(403, "forbidden", "Super Admin only.") };
  return auth;
}

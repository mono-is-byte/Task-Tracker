import { z } from "zod";
import { fail, ok, readJson, clientIp } from "@/lib/api";
import { audit, createSession, login, sessionCookieHeader, themeCookieHeader } from "@/lib/auth";
import { db } from "@/lib/db";

const Body = z.object({
  identifier: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().optional(),
});

export async function POST(req: Request) {
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Email/username and password are required.");
  const { identifier, password, rememberMe } = parsed.data;
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent") ?? undefined;
  const result = await login(db, { identifier, password, rememberMe, ip, userAgent: ua });
  if (!result.ok) {
    const status = result.code === "locked" ? 429 : result.code === "deactivated" ? 403 : 401;
    return fail(status, result.code ?? "invalid_credentials", result.error);
  }
  const secure = (process.env.APP_URL ?? "").startsWith("https://") || process.env.NODE_ENV === "production";
  const res = ok({
    user: {
      id: result.user.id, email: result.user.email, username: result.user.username,
      name: result.user.name, isSuperAdmin: result.user.isSuperAdmin,
      mustChangePassword: result.user.mustChangePassword,
    },
  });
  res.headers.set("Set-Cookie", sessionCookieHeader(result.token, { rememberMe: rememberMe ?? false, secure }));
  // Seed the theme cookie from the saved profile when this device has no explicit
  // choice yet, so the root layout's no-FOUC script can apply it before first paint.
  // Precedence is unchanged: an existing device choice always wins.
  const profileTheme = result.user.theme;
  const deviceChoseTheme = /(?:^|;\s*)tt_theme=/.test(req.headers.get("cookie") ?? "");
  if (!deviceChoseTheme && (profileTheme === "light" || profileTheme === "dark")) {
    res.headers.append("Set-Cookie", themeCookieHeader(profileTheme, { secure }));
  }
  return res;
}

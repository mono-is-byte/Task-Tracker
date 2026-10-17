import { fail, ok, tokenFromRequest, clientIp } from "@/lib/api";
import { clearSessionCookieHeader, logout } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const token = tokenFromRequest(req);
  await logout(db, token, undefined, clientIp(req));
  const res = ok({ loggedOut: true });
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}

export async function GET() {
  return fail(405, "method", "Use POST to log out.");
}

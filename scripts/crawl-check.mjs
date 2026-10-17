// Phase 0 diagnostic: logs in and requests every page + API route, reporting status/errors.
const BASE = process.env.APP_URL || "http://localhost:3000";

const TOKEN = process.argv[2];
if (!TOKEN) throw new Error("usage: node scripts/crawl-check.mjs <session-token> (see scripts/_tmp-session.mjs)");

const proj = await (async () => {
  const cookie = `tt_session=${TOKEN}`;
  // /api/projects has no GET (lists are server-rendered); read ids from the DB like the app does.
  const Database = (await import("better-sqlite3")).default;
  const raw = new Database("dev.db");
  const rows = raw.prepare(`SELECT id, key FROM Project ORDER BY key`).all();
  raw.close();
  return { cookie, list: rows };
})();

console.log(`logged in, ${proj.list.length} projects:`, proj.list.map((p) => `${p.key}:${p.id}`).join(", "));
const pid = proj.list[0]?.id;

const pages = [
  "/login", "/forgot-password", "/no-access",
  "/", "/profile", "/change-password",
  "/users", "/admin/roles", "/admin/audit",
  ...(pid ? [
    `/p/${pid}/board`, `/p/${pid}/table`, `/p/${pid}/timeline`,
    `/p/${pid}/workload`, `/p/${pid}/reports`, `/p/${pid}/archive`, `/p/${pid}/members`, `/p/${pid}/settings`,
  ] : []),
  "/p/does-not-exist/board",
  "/this-route-404",
];

const apis = [
  "/api/auth/me", "/api/projects", "/api/notifications",
  ...(pid ? [
    `/api/projects/${pid}/lookups`, `/api/projects/${pid}/tasks`, `/api/projects/${pid}/activity`,
    `/api/projects/${pid}/epics`, `/api/projects/${pid}/stories`,
    `/api/projects/${pid}/workflow`, `/api/projects/${pid}/fields`, `/api/projects/${pid}/automation`,
    `/api/projects/${pid}/holidays`, `/api/projects/${pid}/views`, `/api/projects/${pid}/export`,
  ] : []),
  "/api/projects/does-not-exist/tasks",
];

let bad = 0;
for (const path of [...pages, ...apis]) {
  const isPage = !path.startsWith("/api/");
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: proj.cookie, accept: "text/html" },
      redirect: "manual",
    });
    let detail = "";
    if (isPage && (res.status >= 500 || res.status === 404 || res.status === 400)) {
      const text = await res.text();
      const m = text.match(/<h1[^>]*>([^<]{0,200})<\/h1>/i) || text.match(/"message":"([^"]{0,200})/);
      detail = m ? ` :: ${m[1].trim()}` : ` :: ${text.slice(0, 150).replace(/\s+/g, " ")}`;
    }
    if (!isPage) {
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        if (j.error) detail = ` :: ${j.error.code}: ${j.error.message}`;
      } catch { detail = ` :: ${text.slice(0, 150).replace(/\s+/g, " ")}`; }
    }
    const flag = res.status >= 500 ? "ERR " : res.status >= 400 ? "WARN" : "ok  ";
    if (flag !== "ok  ") bad++;
    console.log(`${flag} ${String(res.status).padEnd(3)} ${path}${detail}`);
  } catch (e) {
    bad++;
    console.log(`ERR  --- ${path} :: ${e.message}`);
  }
}
console.log(bad === 0 ? "\nALL CLEAN" : `\n${bad} non-2xx routes`);

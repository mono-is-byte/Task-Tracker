const base = "http://localhost:3100";
async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "pm", password: "Demo1234!" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
  const projectId = me.data.memberships[0].projectId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  const res = await fetch(`${base}/api/projects/${projectId}/events`, {
    headers: { cookie },
    signal: ctrl.signal,
  });
  console.log("sse status:", res.status, res.headers.get("content-type"));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let got = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      got += dec.decode(value);
      if (got.includes("hello")) break;
    }
  } catch { /* aborted */ }
  clearTimeout(timer);
  console.log("sse payload:", JSON.stringify(got.slice(0, 200)));
  try { await reader.cancel(); } catch { /* noop */ }
  process.exit(0);
}
main().catch((e) => { console.error("sse failed:", e.message); process.exit(1); });

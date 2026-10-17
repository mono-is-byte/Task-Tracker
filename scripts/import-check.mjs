const base = "http://localhost:3100";
const csv = [
  "SL,Epic,User Story,Task title,Story Points,Est. Hours,Est. Days,Description,Priority,Status,Assignee,Start Date,End Date,Remarks,Git Branch,Tested By,Dependency,Feedback",
  ',Cumilla EPZ Map,কুমিল্লা EPZ প্লট ম্যাপে overlay,Import test task A,3,10,,Imported via CSV round-trip test,High,To Do,,,,Import remark,,,,',
  ',,,Import test task B,,4,,Hours-only import test,Low,To Do,,,,,,,,,',
].join("\n");

async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "pm", password: "Demo1234!" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
  const projectId = me.data.memberships.find((m) => m.projectKey === "MAP").projectId;
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "test.csv");
  const res = await fetch(`${base}/api/projects/${projectId}/import`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  const json = await res.json();
  console.log("import status:", res.status);
  console.log(JSON.stringify(json.data, null, 1).slice(0, 600));
  process.exit(res.ok ? 0 : 1);
}
main().catch((e) => { console.error("import failed:", e.message); process.exit(1); });

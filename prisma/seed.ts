import { db, taskKey } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_ROLES } from "../src/lib/permissions";
import { defaultAutomationRules, runAutomation } from "../src/lib/automation";
import { defaultBannerNote } from "../src/lib/domain";

const DEMO_PASSWORD = "Demo1234!";

interface SeedUser {
  email: string;
  username: string;
  name: string;
  isSuperAdmin?: boolean;
  locale?: string;
}

const USERS: SeedUser[] = [
  { email: "admin@demo.local", username: "admin", name: "Administrator", isSuperAdmin: true },
  { email: "pm@demo.local", username: "pm", name: "Farhana Karim" },
  { email: "saju@demo.local", username: "saju", name: "Md. Saju Ahmed" },
  { email: "shovon@demo.local", username: "shovon", name: "Md. Muktaruzzaman Shovon" },
  { email: "sumit@demo.local", username: "sumit", name: "Sumit Chandra Shovan" },
  { email: "apon@demo.local", username: "apon", name: "Tazbir Mahmud Apon" },
  { email: "viewer@demo.local", username: "viewer", name: "Rahim Uddin" },
];

const STATUSES = [
  { name: "To Do", category: "todo", color: "#64748b", timerRole: "NONE" },
  { name: "In Progress", category: "inprogress", color: "#3b82f6", timerRole: "TRACK" },
  { name: "Development Done", category: "inprogress", color: "#f59e0b", timerRole: "TRACK" },
  { name: "In Testing", category: "inprogress", color: "#a855f7", timerRole: "TRACK" },
  { name: "Re-open", category: "inprogress", color: "#ef4444", timerRole: "NONE" },
  { name: "Done", category: "done", color: "#22c55e", timerRole: "FINAL" },
];

const PRIORITIES = [
  { name: "Highest", level: 5, color: "#dc2626" },
  { name: "High", level: 4, color: "#ea580c" },
  { name: "Medium", level: 3, color: "#ca8a04" },
  { name: "Low", level: 2, color: "#2563eb" },
  { name: "Lowest", level: 1, color: "#64748b" },
];

const ISSUE_TYPES = [
  { name: "Task", color: "#3b82f6" },
  { name: "Story", color: "#22c55e" },
  { name: "Bug", color: "#ef4444" },
  { name: "Epic", color: "#a855f7" },
  { name: "Sub-task", color: "#64748b" },
];

async function wipe() {
  const tables = [
    "TaskStageTime",
    "Notification", "SavedView", "Activity", "Comment", "TaskLink", "Task",
    "Story", "Sprint", "Epic", "AutomationRule", "CustomField", "StatusTransition",
    "Status", "Priority", "IssueType", "ProjectMember", "Role", "Holiday",
    "PasswordReset", "LoginAttempt", "Session", "AuditLog", "User", "Project",
  ];
  for (const t of tables) {
    await (db as unknown as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t[0].toLowerCase() + t.slice(1)]?.deleteMany({});
  }
}

async function main() {
  if (process.argv.includes("--reset")) await wipe();

  const existing = await db.user.count();
  if (existing > 0 && !process.argv.includes("--reset")) {
    console.log("Seed skipped: users already exist. Use --reset to reseed.");
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Roles
  const roleIds: Record<string, string> = {};
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    const role = await db.role.create({
      data: {
        name,
        description: def.description,
        permissions: JSON.stringify(def.permissions),
        fieldRules: JSON.stringify(def.fieldRules),
        isSystem: true,
      },
    });
    roleIds[name] = role.id;
  }

  // Users
  const userIds: Record<string, string> = {};
  for (const u of USERS) {
    const user = await db.user.create({
      data: {
        email: u.email, username: u.username, name: u.name,
        passwordHash, mustChangePassword: true,
        isSuperAdmin: u.isSuperAdmin ?? false,
      },
    });
    userIds[u.username] = user.id;
  }

  const projects = [
    { key: "MAP", name: "Map Integration Projects", bannerNote: defaultBannerNote() },
    { key: "LVM", name: "Letter View Management", bannerNote: defaultBannerNote() },
    { key: "NM", name: "Net Metering", bannerNote: defaultBannerNote() },
  ];

  const membershipPlan: Record<string, string> = {
    pm: "Project Manager", saju: "Developer", shovon: "Developer",
    sumit: "QA / Tester", apon: "QA / Tester", viewer: "Viewer / Stakeholder",
  };

  // Designation = a REFERENCE to a role (labels only — grants no
  // permissions); the seeded roles above supply the ids.
  await db.user.update({ where: { id: userIds.pm }, data: { designation: roleIds["Project Manager"] } });
  await db.user.update({ where: { id: userIds.shovon }, data: { designation: roleIds["Developer"] } });
  await db.user.update({ where: { id: userIds.sumit }, data: { designation: roleIds["QA / Tester"] } });

  for (const p of projects) {
    const project = await db.project.create({ data: { key: p.key, name: p.name, bannerNote: p.bannerNote } });

    for (const [username, roleName] of Object.entries(membershipPlan)) {
      await db.projectMember.create({
        data: { projectId: project.id, userId: userIds[username], roles: { create: [{ roleId: roleIds[roleName] }] } },
      });
    }

    // statuses
    const statusIds: Record<string, string> = {};
    for (let i = 0; i < STATUSES.length; i++) {
      const s = await db.status.create({
        data: { projectId: project.id, name: STATUSES[i].name, category: STATUSES[i].category, color: STATUSES[i].color, position: i, timerRole: STATUSES[i].timerRole },
      });
      statusIds[s.name] = s.id;
    }
    // transitions: Dev chain for dev+pm; QA handoff for qa+pm; reopen for all; manager full mesh
    const T = async (from: string, to: string, roles: string[]) => {
      await db.statusTransition.create({
        data: {
          projectId: project.id, fromId: statusIds[from], toId: statusIds[to],
          roleIds: JSON.stringify(roles.map((r) => roleIds[r])),
        },
      });
    };
    const dev = ["Project Manager", "Developer"];
    const qa = ["Project Manager", "QA / Tester"];
    await db.statusTransition.create({
      data: { projectId: project.id, fromId: statusIds["To Do"], toId: statusIds["In Progress"], roleIds: "[]" },
    });
    await T("In Progress", "Development Done", dev);
    await T("Development Done", "In Testing", qa);
    await T("In Testing", "Done", qa);
    await T("In Testing", "Re-open", qa);
    await T("Re-open", "In Progress", []);
    await T("Done", "Re-open", ["Project Manager", "QA / Tester"]);
    await T("Development Done", "In Progress", dev); // send back for fixes

    for (const pr of PRIORITIES) {
      await db.priority.create({ data: { projectId: project.id, ...pr } });
    }
    const typeIds: Record<string, string> = {};
    for (const it of ISSUE_TYPES) {
      const t = await db.issueType.create({ data: { projectId: project.id, ...it } });
      typeIds[t.name] = t.id;
    }
    for (const r of defaultAutomationRules()) {
      await db.automationRule.create({
        data: {
          projectId: project.id, name: r.name, trigger: r.trigger,
          condition: JSON.stringify(r.condition), action: JSON.stringify(r.action),
        },
      });
    }
    // sample custom fields — change request: "Nice-to-have" is no longer an
    // offered Customer Impact option (existing tasks keep their saved value).
    await db.customField.create({
      data: { projectId: project.id, name: "Customer Impact", fieldType: "select", options: JSON.stringify(["Blocking", "High", "Normal"]), showIn: JSON.stringify(["table", "card", "form"]), position: 0 },
    });
    await db.customField.create({
      data: { projectId: project.id, name: "Docs URL", fieldType: "url", showIn: JSON.stringify(["card", "form"]), position: 1 },
    });
  }

  // global holidays
  await db.holiday.create({ data: { date: new Date("2026-02-21"), name: "Language Martyrs' Day" } });
  await db.holiday.create({ data: { date: new Date("2026-03-26"), name: "Independence Day" } });

  // ---------- MAP project content ----------
  const map = await db.project.findUniqueOrThrow({ where: { key: "MAP" } });
  const lvm = await db.project.findUniqueOrThrow({ where: { key: "LVM" } });
  const nm = await db.project.findUniqueOrThrow({ where: { key: "NM" } });

  async function refs(projectId: string) {
    const [statuses, priorities, types] = await Promise.all([
      db.status.findMany({ where: { projectId } }),
      db.priority.findMany({ where: { projectId } }),
      db.issueType.findMany({ where: { projectId } }),
    ]);
    const byName = <T extends { name: string }>(arr: T[]) => Object.fromEntries(arr.map((x) => [x.name, x]));
    return { S: byName(statuses) as Record<string, (typeof statuses)[number]>, P: byName(priorities) as Record<string, (typeof priorities)[number]>, Ty: byName(types) as Record<string, (typeof types)[number]> };
  }

  const mapRefs = await refs(map.id);
  const lvmRefs = await refs(lvm.id);
  const nmRefs = await refs(nm.id);

  const epics: Record<string, string> = {};
  for (const [proj, name, color] of [
    [map.id, "Bangladesh Map Integration", "#2563eb"],
    [map.id, "Cumilla EPZ Map", "#059669"],
    [map.id, "BEPZA Economic Zone Map", "#7c3aed"],
    [lvm.id, "Letter View Management System", "#0891b2"],
    [nm.id, "Net Metering", "#ca8a04"],
  ] as const) {
    const e = await db.epic.create({ data: { projectId: proj, name, color } });
    epics[name] = e.id;
  }

  const stories: Record<string, string> = {};
  async function mkStory(projectId: string, key: string, title: string, description: string, epic?: string) {
    const s = await db.story.create({
      data: { projectId, title, description, epicId: epic ? epics[epic] : null },
    });
    stories[key] = s.id;
  }
  await mkStory(map.id, "div", "ম্যাপে বিভাগগুলো প্রদর্শন", "বাংলাদেশের সব বিভাগ ম্যাপে রঙসহ দেখাতে হবে।", "Bangladesh Map Integration");
  await mkStory(map.id, "zoom", "জুম করলে জেলার বিস্তারিত দেখা", "জুম-ইন করলে সংশ্লিষ্ট জেলার তথ্য পপ-আপে দেখাবে।", "Bangladesh Map Integration");
  await mkStory(map.id, "epz", "কুমিল্লা EPZ প্লট ম্যাপে overlay", "EPZ-এর প্লটগুলো সীমানাসহ ম্যাপে দেখাতে হবে।", "Cumilla EPZ Map");
  await mkStory(map.id, "bepza", "BEPZA জোনের সীমানা ইমপোর্ট", "শেপ ফাইল থেকে জোনের সীমানা ইমপোর্ট করতে হবে।", "BEPZA Economic Zone Map");
  await mkStory(lvm.id, "sms", "চিঠি ইস্যু হওয়ার সাথে সাথে প্রাপককে জানাতে একটি স্বয়ংক্রিয় এসএমএস/ইমেইল ব্যবস্থা প্রয়োজন", "ইস্যুর সাথে সাথে প্রাপকের মোবাইলে SMS ও ইমেইলে ইমেইল যাবে।", "Letter View Management System");
  await mkStory(lvm.id, "inbox", "চিঠির ইনবক্স তালিকা", "অবস্থাভেদে ফিল্টারসহ চিঠির তালিকা দেখাবে।", "Letter View Management System");
  await mkStory(nm.id, "apply", "নেট মিটারিং আবেদন অনলাইনে গ্রহণ", "গ্রাহক অনলাইনে আবেদন করবে ও ট্র্যাক করতে পারবে।", "Net Metering");

  let serial = 0;
  async function mkTask(projectId: string, input: {
    title: string; description?: string; storyPoints?: number | null; estHours?: number | null;
    priority: string; status: string; assignee?: string; testedBy?: string;
    startDate?: string; endDate?: string; gitBranch?: string;
    epic?: string; story?: string; labels?: string[]; rdTime?: number; type?: string;
  }) {
    const R = projectId === map.id ? mapRefs : projectId === lvm.id ? lvmRefs : nmRefs;
    serial = projectId === map.id ? serial : serial; // serials unique per project below
    const count = await db.task.count({ where: { projectId } });
    const task = await db.task.create({
      data: {
        projectId, serial: count + 1,
        typeId: R.Ty[input.type ?? "Task"].id,
        title: input.title, description: input.description ?? null,
        storyPoints: input.storyPoints ?? null, estHours: input.estHours ?? null,
        rdTime: input.rdTime ?? 0,
        priorityId: R.P[input.priority].id, statusId: R.S[input.status].id,
        assigneeId: input.assignee ? userIds[input.assignee] : null,
        testedById: input.testedBy ? userIds[input.testedBy] : null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        gitBranch: input.gitBranch ?? null,
        epicId: input.epic ? epics[input.epic] : null,
        storyId: input.story ? stories[input.story] : null,
        labels: JSON.stringify(input.labels ?? []),
        position: count,
      },
    });
    return task;
  }

  // MAP tasks
  await mkTask(map.id, { title: "Render division boundaries on map", description: "ম্যাপে বিভাগগুলো প্রদর্শন — রঙ ও লেবেলসহ।", storyPoints: 5, estHours: 12, priority: "High", status: "Done", assignee: "saju", testedBy: "sumit", startDate: "2026-08-04", endDate: "2026-08-10", gitBranch: "feature/map-divisions", epic: "Bangladesh Map Integration", story: "div" });
  await mkTask(map.id, { title: "District drill-down on click", description: "Clicking a division zooms to its districts.", storyPoints: 8, estHours: 20, priority: "Highest", status: "Done", assignee: "shovon", testedBy: "sumit", startDate: "2026-08-05", endDate: "2026-08-14", gitBranch: "feature/district-drilldown", epic: "Bangladesh Map Integration", story: "zoom" });
  await mkTask(map.id, { title: "EPZ marker clustering", storyPoints: 5, estHours: 14, priority: "High", status: "In Testing", assignee: "saju", testedBy: "apon", startDate: "2026-09-29", gitBranch: "feature/epz-clustering", epic: "Cumilla EPZ Map", story: "epz" });
  const tReopen = await mkTask(map.id, { title: "Map legend localization", description: "লেজেন্ডে বাংলা লেবেল দেখাতে হবে।", storyPoints: 3, estHours: 8, priority: "Medium", status: "Re-open", assignee: "shovon", testedBy: "sumit", startDate: "2026-09-30", gitBranch: "feature/legend-bn", epic: "Cumilla EPZ Map" });
  await mkTask(map.id, { title: "Export map as image", storyPoints: 3, estHours: 10, priority: "Medium", status: "Development Done", assignee: "saju", testedBy: "apon", startDate: "2026-10-01", gitBranch: "feature/map-export", epic: "Cumilla EPZ Map" });
  await mkTask(map.id, { title: "Cumilla EPZ plot overlay", description: "কুমিল্লা EPZ প্লট overlay — R&D সহ সময় লাগছে।", storyPoints: 5, estHours: 16, rdTime: 6, priority: "Highest", status: "In Progress", assignee: "shovon", startDate: "2026-10-05", gitBranch: "feature/epz-overlay", epic: "Cumilla EPZ Map", story: "epz" });
  await mkTask(map.id, { title: "Search location by name (Bangla)", description: "বাংলা নামে লোকেশন সার্চ।", estHours: 6, priority: "High", status: "In Progress", assignee: "saju", startDate: "2026-10-08", epic: "Bangladesh Map Integration" });
  await mkTask(map.id, { title: "Print-friendly map layout", storyPoints: 2, estHours: 6, priority: "Low", status: "To Do", epic: "Cumilla EPZ Map" });
  await mkTask(map.id, { title: "Offline tile caching", estHours: 10, priority: "Low", status: "To Do", epic: "BEPZA Economic Zone Map" });
  const tZone = await mkTask(map.id, { title: "BEPZA zone boundary import", description: "শেপ ফাইল থেকে জোনের সীমানা ইমপোর্ট।", storyPoints: 8, estHours: 24, priority: "Highest", status: "In Testing", assignee: "saju", testedBy: "sumit", startDate: "2026-10-06", gitBranch: "feature/zone-import", epic: "BEPZA Economic Zone Map", story: "bepza" });
  await mkTask(map.id, { title: "Project setup & repo branching", estHours: 4, priority: "Medium", status: "Done", assignee: "shovon", testedBy: "sumit", startDate: "2026-08-03", endDate: "2026-08-03", epic: "Bangladesh Map Integration" });
  const tColor = await mkTask(map.id, { title: "Color-code zones by status", storyPoints: 3, estHours: 9, priority: "Medium", status: "To Do", assignee: "saju", epic: "BEPZA Economic Zone Map", story: "bepza" });
  await db.taskLink.create({ data: { fromId: tColor.id, toId: tZone.id, kind: "blocks" } });

  // LVM tasks
  await mkTask(lvm.id, { title: "Letter inbox list with status", description: "চিঠির ইনবক্স তালিকা — অবস্থাভেদে ফিল্টার।", storyPoints: 5, estHours: 12, priority: "High", status: "Done", assignee: "saju", testedBy: "apon", startDate: "2026-09-28", endDate: "2026-10-02", gitBranch: "feature/letter-inbox", epic: "Letter View Management System", story: "inbox" });
  await mkTask(lvm.id, { title: "Auto SMS on letter issue", description: "চিঠি ইস্যু হওয়ার সাথে সাথে প্রাপককে SMS/ইমেইল।", storyPoints: 8, estHours: 20, priority: "Highest", status: "Development Done", assignee: "shovon", testedBy: "sumit", startDate: "2026-10-03", gitBranch: "feature/letter-sms", epic: "Letter View Management System", story: "sms" });
  await mkTask(lvm.id, { title: "Letter view with attachments", storyPoints: 5, estHours: 15, priority: "High", status: "In Progress", assignee: "saju", startDate: "2026-10-07", epic: "Letter View Management System", story: "inbox" });
  await mkTask(lvm.id, { title: "Role-based letter visibility", estHours: 8, priority: "Medium", status: "To Do", epic: "Letter View Management System" });

  // NM tasks
  await mkTask(nm.id, { title: "Net metering application form", storyPoints: 5, estHours: 14, priority: "High", status: "In Testing", assignee: "shovon", testedBy: "apon", startDate: "2026-10-06", gitBranch: "feature/nm-apply", epic: "Net Metering", story: "apply" });
  await mkTask(nm.id, { title: "Meter reading import (CSV)", storyPoints: 3, estHours: 10, priority: "Medium", status: "To Do", assignee: "saju", epic: "Net Metering" });
  await mkTask(nm.id, { title: "Billing calculation engine", estHours: 18, priority: "Highest", status: "In Progress", assignee: "shovon", startDate: "2026-10-09", epic: "Net Metering" });
  await mkTask(nm.id, { title: "Consumer SMS notification", storyPoints: 2, estHours: 6, priority: "Low", status: "To Do", epic: "Net Metering" });

  // comments: remarks + feedback threads
  const overlay = await db.task.findFirstOrThrow({ where: { projectId: map.id, title: "Cumilla EPZ plot overlay" } });
  await db.comment.create({ data: { taskId: overlay.id, authorId: userIds["shovon"], kind: "remark", body: "Continued. Also takes lots of time in R&D excluding the task estimation" } });
  await db.comment.create({ data: { taskId: tReopen.id, authorId: userIds["sumit"], kind: "feedback", body: "Legend still shows English labels on zoom level 8+. Please fix before closing." } });
  await db.comment.create({ data: { taskId: tZone.id, authorId: userIds["saju"], kind: "remark", body: "Shape file import done, verifying coordinates against survey data." } });

  // sample notification for QA queue
  await db.notification.create({
    data: { userId: userIds["apon"], kind: "status_changed", title: "Ready for testing", body: "EPZ marker clustering moved to In Testing.", link: "#" },
  });

  // activities for recently-changed feed
  const recent = await db.task.findMany({ take: 6, orderBy: { updatedAt: "desc" } });
  for (const t of recent) {
    await db.activity.create({ data: { taskId: t.id, actorId: t.assigneeId, action: "task.updated", field: "status" } });
  }

  // exercise automation once so rules exist in audit trail (no-op publish only)
  await runAutomation(db, { projectId: map.id, taskId: overlay.id, trigger: "task_created", task: { id: overlay.id } });

  const counts = {
    users: await db.user.count(),
    projects: await db.project.count(),
    tasks: await db.task.count(),
  };
  console.log(`Seed done. Demo password for all users: ${DEMO_PASSWORD} (must change on first login)`);
  console.log(`Keys: admin/pm/saju/shovon/sumit/apon/viewer. Counts:`, counts);
  void taskKey;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

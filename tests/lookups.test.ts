import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import {
  CLEAR_ISSUE_TYPE,
  isHexColor,
  lookupNameKey,
  normalizeLookupName,
} from "../src/lib/lookups";
import { createLookup, removeLookup, updateLookup } from "../src/lib/lookups-server";

const TEST_URL = "file:./tests/test-lookups.db";

const db = makeTestClient(TEST_URL);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

let projectId = "";
let statusId = "";
let keepPriorityId = "";
let typeAId = "";
let serial = 1;
/** The acting user the reassignment activity lines reference. */
let actorId = "";

async function makeTask(priorityId: string, typeId: string | null = null) {
  return db.task.create({
    data: { projectId, serial: serial++, title: uniq("task"), priorityId, statusId, typeId },
  });
}

beforeAll(async () => {
  await db.$connect();
  const actor = await db.user.create({
    data: { email: uniq("actor") + "@t.local", username: uniq("actor"), name: "Actor", passwordHash: "x" },
  });
  actorId = actor.id;
  const project = await db.project.create({ data: { key: uniq("LK"), name: "Lookups project" } });
  projectId = project.id;
  const status = await db.status.create({
    data: { projectId, name: "To Do", category: "todo", color: "#888888", position: 0 },
  });
  statusId = status.id;
  const kept = await createLookup(db, projectId, "priority", { name: "Medium", level: 3, color: "#888888" });
  if (kept.ok && kept.priority) keepPriorityId = kept.priority.id;
  const typeA = await createLookup(db, projectId, "issuetype", { name: "Task", color: "#0000ff" });
  if (typeA.ok && typeA.issueType) typeAId = typeA.issueType.id;
});

describe("lookup name / colour helpers", () => {
  it("normalises names and compares case-insensitively", () => {
    expect(normalizeLookupName("  High   Priority ")).toBe("High Priority");
    expect(lookupNameKey(" high  priority ")).toBe("high priority");
  });
  it("accepts only #rrggbb colours", () => {
    expect(isHexColor("#fff2f2")).toBe(true);
    expect(isHexColor("#ABCDEF")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });
});

describe("createLookup", () => {
  it("trims names and applies sensible defaults", async () => {
    const p = await createLookup(db, projectId, "priority", { name: "  Urgent  " });
    expect(p.ok).toBe(true);
    if (p.ok && p.priority) {
      expect(p.priority.name).toBe("Urgent");
      expect(p.priority.level).toBe(3);
      expect(p.priority.color).toBe("#94a3b8");
    }
    const t = await createLookup(db, projectId, "issuetype", { name: "Spike" });
    expect(t.ok).toBe(true);
    if (t.ok && t.issueType) expect(t.issueType.color).toBe("#6366f1");
  });

  it("rejects duplicates regardless of case and spacing", async () => {
    const dup = await createLookup(db, projectId, "priority", { name: "  medium " });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("duplicate");
    const typeDup = await createLookup(db, projectId, "issuetype", { name: "TASK" });
    expect(typeDup.ok).toBe(false);
    if (!typeDup.ok) expect(typeDup.code).toBe("duplicate");
  });

  it("rejects invalid names, colours and levels", async () => {
    const blank = await createLookup(db, projectId, "priority", { name: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe("invalid");
    const colour = await createLookup(db, projectId, "priority", { name: uniq("p"), color: "red" });
    expect(colour.ok).toBe(false);
    if (!colour.ok) expect(colour.code).toBe("invalid");
    const level = await createLookup(db, projectId, "priority", { name: uniq("p"), level: 2.5 });
    expect(level.ok).toBe(false);
    if (!level.ok) expect(level.code).toBe("invalid");
  });
});

describe("updateLookup", () => {
  it("renames, re-levels and recolours, and refuses duplicates", async () => {
    const created = await createLookup(db, projectId, "priority", { name: uniq("Edit"), level: 1 });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.priority) throw new Error("setup failed");
    const id = created.priority.id;
    const renamed = await updateLookup(db, projectId, "priority", id, { name: "Renamed", level: 7, color: "#123456" });
    expect(renamed.ok).toBe(true);
    if (renamed.ok && renamed.priority) {
      expect(renamed.priority.name).toBe("Renamed");
      expect(renamed.priority.level).toBe(7);
      expect(renamed.priority.color).toBe("#123456");
    }
    const dup = await updateLookup(db, projectId, "priority", id, { name: "Medium" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("duplicate");
    // Renaming to its own name (different case) is not a duplicate.
    const same = await updateLookup(db, projectId, "priority", id, { name: "renamed" });
    expect(same.ok).toBe(true);
  });

  it("edits issue types and reports missing rows", async () => {
    const created = await createLookup(db, projectId, "issuetype", { name: uniq("Type") });
    if (!created.ok || !created.issueType) throw new Error("setup failed");
    const edited = await updateLookup(db, projectId, "issuetype", created.issueType.id, { name: "Renamed type", color: "#abcdef" });
    expect(edited.ok).toBe(true);
    if (edited.ok && edited.issueType) expect(edited.issueType.name).toBe("Renamed type");
    const missing = await updateLookup(db, projectId, "issuetype", "does-not-exist", { name: "x" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("not_found");
  });
});

describe("removeLookup", () => {
  it("never deletes the project's only priority", async () => {
    const solo = await db.project.create({ data: { key: uniq("SOLO"), name: "Solo" } });
    const only = await createLookup(db, solo.id, "priority", { name: "Only" });
    if (!only.ok || !only.priority) throw new Error("setup failed");
    const res = await removeLookup(db, solo.id, "priority", only.priority.id, null, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("last_priority");
  });

  it("refuses a used priority until a replacement is named, then moves the tasks", async () => {
    const created = await createLookup(db, projectId, "priority", { name: uniq("Temp"), level: 2 });
    if (!created.ok || !created.priority) throw new Error("setup failed");
    const tempId = created.priority.id;
    await makeTask(tempId);
    await makeTask(tempId);

    const refused = await removeLookup(db, projectId, "priority", tempId, null, null);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe("in_use");
      expect(refused.used).toBe(2);
    }
    // Nothing was written by the refusal.
    expect(await db.task.count({ where: { priorityId: tempId } })).toBe(2);

    const moved = await removeLookup(db, projectId, "priority", tempId, keepPriorityId, actorId);
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.result.moved).toBe(2);
    expect(await db.task.count({ where: { priorityId: tempId } })).toBe(0);
    expect(await db.task.count({ where: { priorityId: keepPriorityId } })).toBe(2);
    expect(await db.priority.findUnique({ where: { id: tempId } })).toBeNull();
    // The move leaves a readable history line on each task.
    const field = await db.activity.findMany({ where: { action: "task.updated", field: "priority" } });
    expect(field.length).toBeGreaterThanOrEqual(2);
  });

  it("reassigns or clears a used issue type, and deletes unused ones directly", async () => {
    const used = await createLookup(db, projectId, "issuetype", { name: uniq("Used") });
    if (!used.ok || !used.issueType) throw new Error("setup failed");
    const usedId = used.issueType.id;

    const unused = await createLookup(db, projectId, "issuetype", { name: uniq("Unused") });
    if (!unused.ok || !unused.issueType) throw new Error("setup failed");
    const gone = await removeLookup(db, projectId, "issuetype", unused.issueType.id, null, null);
    expect(gone.ok).toBe(true);

    await makeTask(keepPriorityId, usedId);
    const refused = await removeLookup(db, projectId, "issuetype", usedId, null, null);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("in_use");

    const cleared = await removeLookup(db, projectId, "issuetype", usedId, CLEAR_ISSUE_TYPE, actorId);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.result.moved).toBe(1);
    expect(await db.task.count({ where: { typeId: usedId } })).toBe(0);
    const nulls = await db.task.count({ where: { projectId, typeId: null } });
    expect(nulls).toBeGreaterThanOrEqual(1);

    // Reassignment to another type keeps the task's type set.
    const target = await createLookup(db, projectId, "issuetype", { name: uniq("Target") });
    const source = await createLookup(db, projectId, "issuetype", { name: uniq("Source") });
    if (!target.ok || !target.issueType || !source.ok || !source.issueType) throw new Error("setup failed");
    await makeTask(keepPriorityId, source.issueType.id);
    const reassigned = await removeLookup(db, projectId, "issuetype", source.issueType.id, target.issueType.id, actorId);
    expect(reassigned.ok).toBe(true);
    expect(await db.task.count({ where: { typeId: target.issueType.id } })).toBe(1);
  });

  it("reports a missing option", async () => {
    const res = await removeLookup(db, projectId, "priority", "missing", null, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
  });
});
